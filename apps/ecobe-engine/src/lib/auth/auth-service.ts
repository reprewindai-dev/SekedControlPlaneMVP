import { prisma } from '../prisma'
import { redis } from '../redis'
import { createHash, randomBytes } from 'crypto'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import { OrganizationStatus, OrgPlanTier } from '@prisma/client'

// JWT Configuration
const JWT_SECRET = env.JWT_SECRET || randomBytes(32).toString('hex')
const JWT_EXPIRES_IN = '24h'
const REFRESH_TOKEN_EXPIRES_IN = '30d'

// Session Configuration
const SESSION_PREFIX = 'session:'
const API_KEY_PREFIX = 'apikey:'
const RATE_LIMIT_PREFIX = 'ratelimit:'

// Plan Limits
export const PLAN_LIMITS = {
  FREE: {
    monthlyCommands: 1000,
    maxRegions: 3,
    maxConcurrentRequests: 10,
    supportLevel: 'community',
    slaGuarantee: false,
    customModels: false,
    dedicatedSupport: false,
    apiRateLimit: 100, // per hour
  },
  GROWTH: {
    monthlyCommands: 50000,
    maxRegions: 10,
    maxConcurrentRequests: 100,
    supportLevel: 'email',
    slaGuarantee: true,
    customModels: true,
    dedicatedSupport: false,
    apiRateLimit: 1000, // per hour
  },
  ENTERPRISE: {
    monthlyCommands: -1, // unlimited
    maxRegions: -1, // unlimited
    maxConcurrentRequests: -1, // unlimited
    supportLevel: 'dedicated',
    slaGuarantee: true,
    customModels: true,
    dedicatedSupport: true,
    apiRateLimit: -1, // unlimited
  },
}

export interface AuthTokenPayload {
  orgId: string
  planTier: OrgPlanTier
  permissions: string[]
}

export interface Session {
  id: string
  orgId: string
  apiKey: string
  planTier: OrgPlanTier
  permissions: string[]
  createdAt: Date
  expiresAt: Date
}

export class AuthService {
  /**
   * Generate a secure API key
   */
  static generateApiKey(): string {
    const prefix = 'ecobe_'
    const randomPart = randomBytes(32).toString('base64url')
    return `${prefix}${randomPart}`
  }

  /**
   * Hash an API key for storage
   */
  static hashApiKey(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex')
  }

  /**
   * Create a new organization with API key
   */
  static async createOrganization(data: {
    name: string
    billingEmail: string
    planTier?: OrgPlanTier
  }) {
    const apiKey = this.generateApiKey()
    const hashedApiKey = this.hashApiKey(apiKey)
    
    const org = await prisma.organization.create({
      data: {
        name: data.name,
        slug: data.name.toLowerCase().replace(/\s+/g, '-'),
        apiKey: hashedApiKey,
        billingEmail: data.billingEmail,
        planTier: data.planTier || OrgPlanTier.FREE,
        status: OrganizationStatus.ACTIVE,
        monthlyCommandLimit: PLAN_LIMITS[data.planTier || OrgPlanTier.FREE].monthlyCommands,
      },
    })

    // Cache the API key mapping
    await redis.setex(
      `${API_KEY_PREFIX}${hashedApiKey}`,
      86400 * 30, // 30 days
      JSON.stringify({
        orgId: org.id,
        planTier: org.planTier,
        status: org.status,
      })
    )

    return {
      organization: org,
      apiKey, // Return the unhashed key only once
    }
  }

  /**
   * Validate an API key and return organization info
   */
  static async validateApiKey(apiKey: string): Promise<{
    valid: boolean
    organization?: any
    error?: string
  }> {
    try {
      const hashedKey = this.hashApiKey(apiKey)
      
      // Check cache first
      const cached = await redis.get(`${API_KEY_PREFIX}${hashedKey}`)
      if (cached) {
        const data = JSON.parse(cached)
        if (data.status !== OrganizationStatus.ACTIVE) {
          return { valid: false, error: 'Organization suspended' }
        }
        
        const org = await prisma.organization.findUnique({
          where: { id: data.orgId },
        })
        
        return { valid: true, organization: org }
      }

      // Check database
      const org = await prisma.organization.findUnique({
        where: { apiKey: hashedKey },
      })

      if (!org) {
        return { valid: false, error: 'Invalid API key' }
      }

      if (org.status !== OrganizationStatus.ACTIVE) {
        return { valid: false, error: 'Organization suspended' }
      }

      // Cache for future requests
      await redis.setex(
        `${API_KEY_PREFIX}${hashedKey}`,
        86400 * 30,
        JSON.stringify({
          orgId: org.id,
          planTier: org.planTier,
          status: org.status,
        })
      )

      return { valid: true, organization: org }
    } catch (error) {
      console.error('API key validation error:', error)
      return { valid: false, error: 'Validation failed' }
    }
  }

  /**
   * Check rate limits for an organization
   */
  static async checkRateLimit(orgId: string, planTier: OrgPlanTier): Promise<{
    allowed: boolean
    remaining: number
    resetAt: Date
  }> {
    const limit = PLAN_LIMITS[planTier].apiRateLimit
    if (limit === -1) {
      return { allowed: true, remaining: -1, resetAt: new Date() }
    }

    const key = `${RATE_LIMIT_PREFIX}${orgId}:${new Date().getHours()}`
    const current = await redis.incr(key)
    
    if (current === 1) {
      await redis.expire(key, 3600) // 1 hour
    }

    const resetAt = new Date()
    resetAt.setHours(resetAt.getHours() + 1, 0, 0, 0)

    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      resetAt,
    }
  }

  /**
   * Generate JWT tokens
   */
  static generateTokens(payload: AuthTokenPayload) {
    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    })

    const refreshToken = jwt.sign(
      { orgId: payload.orgId },
      JWT_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
    )

    return { accessToken, refreshToken }
  }

  /**
   * Verify JWT token
   */
  static verifyToken(token: string): AuthTokenPayload | null {
    try {
      return jwt.verify(token, JWT_SECRET) as AuthTokenPayload
    } catch {
      return null
    }
  }

  /**
   * Create a session
   */
  static async createSession(orgId: string, apiKey: string): Promise<Session> {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    })

    if (!org) {
      throw new Error('Organization not found')
    }

    const session: Session = {
      id: randomBytes(16).toString('hex'),
      orgId,
      apiKey: this.hashApiKey(apiKey),
      planTier: org.planTier,
      permissions: this.getPermissionsForPlan(org.planTier),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    }

    await redis.setex(
      `${SESSION_PREFIX}${session.id}`,
      86400, // 24 hours
      JSON.stringify(session)
    )

    return session
  }

  /**
   * Get permissions based on plan tier
   */
  static getPermissionsForPlan(planTier: OrgPlanTier): string[] {
    const basePermissions = [
      'carbon:command:create',
      'carbon:command:read',
      'dashboard:read',
    ]

    const planPermissions = {
      [OrgPlanTier.FREE]: basePermissions,
      [OrgPlanTier.GROWTH]: [
        ...basePermissions,
        'carbon:command:schedule',
        'intelligence:read',
        'credits:read',
        'analytics:advanced',
      ],
      [OrgPlanTier.ENTERPRISE]: [
        ...basePermissions,
        'carbon:command:schedule',
        'intelligence:read',
        'intelligence:write',
        'credits:read',
        'credits:write',
        'analytics:advanced',
        'admin:all',
      ],
    }

    return planPermissions[planTier] || basePermissions
  }

  /**
   * Invalidate a session
   */
  static async invalidateSession(sessionId: string): Promise<void> {
    await redis.del(`${SESSION_PREFIX}${sessionId}`)
  }

  /**
   * Get session by ID
   */
  static async getSession(sessionId: string): Promise<Session | null> {
    const data = await redis.get(`${SESSION_PREFIX}${sessionId}`)
    if (!data) return null

    const session = JSON.parse(data) as Session
    if (new Date(session.expiresAt) < new Date()) {
      await this.invalidateSession(sessionId)
      return null
    }

    return session
  }
}
