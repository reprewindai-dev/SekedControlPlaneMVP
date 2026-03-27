import { createHash, randomBytes, timingSafeEqual } from 'crypto'

import { prisma } from './prisma'
import { env } from './env'

type AuthFailure = { ok: false; response: Response }
type PlatformAdminAccess = {
  ok: true
  isPlatformAdmin: true
  organizationId: null
  scopes: ['*']
}
type ServiceAccountAccess = {
  ok: true
  isPlatformAdmin: false
  organizationId: string
  scopes: string[]
  serviceAccountId: string
}

export type ScopedAccess = PlatformAdminAccess | ServiceAccountAccess | AuthFailure
type AdminRequirement = { ok: true } | { ok: false; response: Response }

export async function requireAdmin(request: Request): Promise<AdminRequirement> {
  const token = request.headers.get('x-ecobe-admin-token')
  if (!token || token !== env.ECOBE_ADMIN_TOKEN) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  return { ok: true }
}

export async function requireScopedAccess(request: Request, requiredScopes: string[]): Promise<ScopedAccess> {
  const admin = await requireAdmin(request)
  if (admin.ok) {
    return {
      ok: true,
      isPlatformAdmin: true,
      organizationId: null,
      scopes: ['*'],
    }
  }

  const serviceAccount = await authenticateServiceAccount(request)
  if (!serviceAccount) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const grantedScopes = Array.isArray(serviceAccount.scopes) ? (serviceAccount.scopes as string[]) : []
  const hasScopes = requiredScopes.every((scope) => grantedScopes.includes(scope))
  if (!hasScopes) {
    return { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return {
    ok: true,
    isPlatformAdmin: false,
    organizationId: serviceAccount.organizationId,
    scopes: grantedScopes,
    serviceAccountId: serviceAccount.id,
  }
}

export function assertOrganizationAccess(access: PlatformAdminAccess | ServiceAccountAccess, organizationId: string) {
  if (access.isPlatformAdmin) {
    return true
  }

  return access.organizationId === organizationId
}

export function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex')
}

export function generateApiKey() {
  return generateCredential('ecobe')
}

export function generateServiceAccountKey() {
  return generateCredential('svc')
}

export async function authenticateApiKey(request: Request) {
  const presented = request.headers.get('x-api-key') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!presented) {
    return null
  }

  const [prefix] = presented.split('.')
  if (!prefix || !prefix.startsWith('ecobe_')) {
    return null
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { prefix },
    include: {
      organization: true,
      project: true,
    },
  })

  if (!apiKey || apiKey.status !== 'active') {
    return null
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null
  }

  if (!secretsMatch(apiKey.keyHash, presented)) {
    return null
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  })

  return apiKey
}

export async function authenticateServiceAccount(request: Request) {
  const presented =
    request.headers.get('x-service-account-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (!presented) {
    return null
  }

  const [prefix] = presented.split('.')
  if (!prefix || !prefix.startsWith('svc_')) {
    return null
  }

  const serviceAccount = await prisma.serviceAccount.findUnique({
    where: { prefix },
  })

  if (!serviceAccount || serviceAccount.status !== 'active') {
    return null
  }

  if (!secretsMatch(serviceAccount.secretHash, presented)) {
    return null
  }

  await prisma.serviceAccount.update({
    where: { id: serviceAccount.id },
    data: { lastUsedAt: new Date() },
  })

  return serviceAccount
}

function secretsMatch(storedHash: string, presented: string) {
  const presentedHash = hashSecret(presented)
  const stored = Buffer.from(storedHash)
  const provided = Buffer.from(presentedHash)
  return stored.length === provided.length && timingSafeEqual(stored, provided)
}

function generateCredential(prefixBase: string) {
  const prefix = `${prefixBase}_${randomBytes(4).toString('hex')}`
  const secret = randomBytes(24).toString('hex')
  return {
    prefix,
    plaintext: `${prefix}.${secret}`,
    hash: hashSecret(`${prefix}.${secret}`),
  }
}
