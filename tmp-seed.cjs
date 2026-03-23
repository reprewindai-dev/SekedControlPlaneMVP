const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.org.upsert({
    where: { id: '11111111-1111-1111-1111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'BarBank Internal',
      plan: 'enterprise',
    },
  })

  const project = await prisma.project.upsert({
    where: { orgId_name_environment: { orgId: org.id, name: 'barbank', environment: 'prod' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'barbank',
      environment: 'prod',
    },
  })

  const policy = await prisma.policy.upsert({
    where: { orgId_name: { orgId: org.id, name: 'default' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'default',
      sekedConfig: {},
      convergeConfig: { maxAttempts: 3, qualityThreshold: 0.85 },
      ecobeConfig: { orgId: org.id },
      status: 'approved',
    },
  })

  const schema = await prisma.schema.create({
    data: {
      orgId: org.id,
      name: 'default-output',
      version: 1,
      status: 'active',
      jsonSchema: {
        type: 'object',
        properties: {
          result: { type: 'string' },
          timestamp: { type: 'string' },
          attempt: { type: 'number' },
        },
        required: ['result', 'timestamp', 'attempt'],
      },
    },
  })

  await prisma.routingPolicy.create({
    data: {
      orgId: org.id,
      name: 'default',
      active: true,
      weightsJson: { carbon: 0.4, cost: 0.3, latency: 0.3 },
    },
  }).catch(() => {})

  await prisma.gridIntensitySample.createMany({
    data: [
      { orgId: org.id, region: 'us-east-1', carbonIntensityGco2Kwh: 320, source: 'seed', validUntil: new Date(Date.now() + 86400000) },
      { orgId: org.id, region: 'us-west-2', carbonIntensityGco2Kwh: 260, source: 'seed', validUntil: new Date(Date.now() + 86400000) },
      { orgId: org.id, region: 'eu-west-1', carbonIntensityGco2Kwh: 180, source: 'seed', validUntil: new Date(Date.now() + 86400000) },
    ],
    skipDuplicates: false,
  }).catch(() => {})

  const plainKey = 'sek_test_internal_barbank'
  const hashedKey = await bcrypt.hash(plainKey, 10)

  await prisma.apiKey.create({
    data: {
      orgId: org.id,
      name: 'internal-seed',
      role: 'admin',
      hashedKey,
    },
  }).catch(() => {})

  console.log(JSON.stringify({ orgId: org.id, projectId: project.id, policyId: policy.id, schemaId: schema.id, apiKey: plainKey }))
}

main().finally(() => prisma.$disconnect())
