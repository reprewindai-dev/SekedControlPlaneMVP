import express from 'express'
import { env } from './config/env'

const app = express()
app.use(express.json())

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

// Green routing endpoint (simplified for demo)
app.post('/api/v1/route/green', (req, res) => {
  const { preferredRegions, maxCarbonGPerKwh } = req.body
  
  // Simple mock response that simulates carbon optimization
  const chosenRegion = preferredRegions?.[0] || 'US-EAST-4'
  const carbonGPerKwh = Math.floor(Math.random() * 200) + 100 // Random between 100-300
  
  res.json({
    chosenRegion,
    carbonGPerKwh,
    maxCarbonGPerKwh,
    optimization: {
      originalCarbon: maxCarbonGPerKwh || 400,
      optimizedCarbon: carbonGPerKwh,
      carbonSaved: (maxCarbonGPerKwh || 400) - carbonGPerKwh,
      regions: preferredRegions || ['US-EAST-4']
    },
    timestamp: new Date().toISOString()
  })
})

// Start server
const PORT = env.PORT || 3004
app.listen(PORT, () => {
  console.log(`🚀 ECOBE Engine demo server running on port ${PORT}`)
  console.log(`📊 Health: http://localhost:${PORT}/health`)
  console.log(`🌱 Green Routing: http://localhost:${PORT}/api/v1/route/green`)
})
