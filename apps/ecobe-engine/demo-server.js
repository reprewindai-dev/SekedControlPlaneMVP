const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'ECOBE Engine',
    version: '1.0.0',
    timestamp: new Date().toISOString() 
  })
})

// Carbon Command endpoint (mock for demo)
app.post('/api/v1/carbon/command', (req, res) => {
  console.log('Carbon command request:', JSON.stringify(req.body, null, 2))
  
  const { workload, constraints } = req.body
  
  // Mock response that simulates carbon optimization
  const regions = constraints?.mustRunRegions || ['EU-NORTH-1', 'US-EAST-1', 'AP-SOUTHEAST-1']
  const selectedRegion = regions[0] || 'EU-NORTH-1'
  const estimatedEmissionsKgCo2e = workload?.estimatedGpuHours ? 
    Math.round(workload.estimatedGpuHours * 0.32 * 100) / 100 : 38.4
  const estimatedSavingsKgCo2e = Math.round(estimatedEmissionsKgCo2e * 0.21 * 100) / 100
  
  res.json({
    success: true,
    command: {
      id: 'cmd_' + Date.now(),
      orgId: req.body.orgId,
      status: 'RECOMMENDED',
      createdAt: new Date().toISOString()
    },
    decision: {
      selectedRegion,
      expectedCarbonIntensity: 120,
      estimatedEmissionsKgCo2e,
      estimatedSavingsKgCo2e,
      confidence: 0.86,
      reasoning: `Selected ${selectedRegion} for optimal carbon-to-performance ratio`,
      alternatives: regions.slice(1).map(r => ({
        region: r,
        score: 0.75 + Math.random() * 0.15,
        estimatedEmissionsKgCo2e: estimatedEmissionsKgCo2e * (1 + Math.random() * 0.3)
      }))
    },
    intelligence: {
      similarWorkloads: Array.from({ length: 3 }, (_, i) => ({
        id: `workload_${i + 1}`,
        type: workload?.type || 'Transformer Training',
        region: selectedRegion,
        emissionsKgCo2e: estimatedEmissionsKgCo2e * (0.9 + Math.random() * 0.2),
        similarity: 0.8 + Math.random() * 0.15
      })),
      benchmarkData: {
        totalWorkloads: 184,
        avgCarbonIntensity: 125,
        regionEfficiency: 0.91
      }
    },
    timestamp: new Date().toISOString()
  })
})

// Start server
const PORT = process.env.PORT || 3002
app.listen(PORT, () => {
  console.log(`🚀 ECOBE Engine demo server running on port ${PORT}`)
  console.log(`📊 Health: http://localhost:${PORT}/health`)
  console.log(`🌱 Carbon Command: http://localhost:${PORT}/api/v1/carbon/command`)
})
