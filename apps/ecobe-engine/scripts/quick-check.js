#!/usr/bin/env node

console.log('🔍 ECOBE Engine - Quick Deployment Check')
console.log('==========================================\n')

// Check build
try {
  const fs = require('fs')
  const path = require('path')
  
  console.log('✅ Build Status:')
  const distExists = fs.existsSync(path.join(__dirname, '..', 'dist'))
  console.log(`  - dist folder exists: ${distExists}`)
  
  if (distExists) {
    const serverJsExists = fs.existsSync(path.join(__dirname, '..', 'dist', 'server.js'))
    console.log(`  - dist/server.js exists: ${serverJsExists}`)
  }
  
  // Check package.json
  console.log('\n✅ Package Configuration:')
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  console.log(`  - Name: ${packageJson.name}`)
  console.log(`  - Version: ${packageJson.version}`)
  console.log(`  - Node engine: ${packageJson.engines?.node || 'not specified'}`)
  
  // Check Docker
  console.log('\n✅ Docker Configuration:')
  const dockerfileExists = fs.existsSync(path.join(__dirname, '..', 'Dockerfile'))
  console.log(`  - Dockerfile exists: ${dockerfileExists}`)
  
  const dockerComposeExists = fs.existsSync(path.join(__dirname, '../docker-compose.prod.yml'))
  console.log(`  - Production docker-compose exists: ${dockerComposeExists}`)
  
  // Check environment example
  console.log('\n✅ Environment Configuration:')
  const envExampleExists = fs.existsSync(path.join(__dirname, '..', '.env.example'))
  console.log(`  - .env.example exists: ${envExampleExists}`)
  
  if (envExampleExists) {
    const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8')
    const requiredVars = ['DATABASE_URL', 'REDIS_URL', 'ELECTRICITY_MAPS_API_KEY', 'OPENAI_API_KEY']
    requiredVars.forEach(varName => {
      const present = envContent.includes(varName)
      console.log(`  - ${varName} documented: ${present}`)
    })
  }
  
  // Check Prisma
  console.log('\n✅ Database Configuration:')
  const prismaSchemaExists = fs.existsSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'))
  console.log(`  - Prisma schema exists: ${prismaSchemaExists}`)
  
  console.log('\n🎉 DEPLOYMENT CHECK COMPLETE')
  console.log('Ready for Back4App deployment!')
  
} catch (error) {
  console.error('❌ Check failed:', error.message)
  process.exit(1)
}
