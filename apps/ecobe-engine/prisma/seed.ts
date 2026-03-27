import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const regions = [
    { code: 'US-CAL-CISO', name: 'California (US)', country: 'US' },
    { code: 'FR', name: 'France', country: 'FR' },
    { code: 'DE', name: 'Germany', country: 'DE' },
    { code: 'GB', name: 'United Kingdom', country: 'GB' },
    { code: 'SE', name: 'Sweden', country: 'SE' },
    { code: 'NO', name: 'Norway', country: 'NO' },
  ]

  for (const region of regions) {
    await prisma.region.upsert({
      where: { code: region.code },
      update: {
        name: region.name,
        country: region.country,
      },
      create: {
        code: region.code,
        name: region.name,
        country: region.country,
      },
    })
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
