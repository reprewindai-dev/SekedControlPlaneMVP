import { Router } from 'express'
import { z } from 'zod'

import { prisma } from '../lib/db'
import { getWaterArtifactMetadata, summarizeWaterProviders } from '../lib/water/bundle'
import { inspectWaterDatasetProvenance, verifyWaterDatasetProvenance } from '../lib/water/provenance'
import { internalServiceGuard } from '../middleware/internal-auth'
import { createDecision, requestSchema } from './ci'

const router = Router()

router.get('/providers', async (_req, res) => {
  try {
    const providers = summarizeWaterProviders()
    const metadata = getWaterArtifactMetadata()

    return res.json({
      generatedAt: new Date().toISOString(),
      bundleVersion: 'water_bundle_v2',
      bundleHash: metadata.bundleHash,
      manifestHash: metadata.manifestHash,
      providers,
      authorityStatus: {
        doctrine: 'suppliers_feed_ecobe_authorizes',
        sourceCount: metadata.sourceCount,
        suppliers: metadata.suppliers,
        datasetHashesPresent: metadata.datasetHashesPresent,
      },
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to resolve water providers',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.get('/provenance', (_req, res) => {
  try {
    return res.json(verifyWaterDatasetProvenance())
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to inspect water provenance',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.post('/provenance/verify', internalServiceGuard, (req, res) => {
  try {
    const payload = z
      .object({
        persistManifest: z.boolean().default(false),
      })
      .parse(req.body ?? {})

    return res.json(verifyWaterDatasetProvenance(payload))
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to verify water provenance',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.post('/scenarios/plan', async (req, res) => {
  try {
    const payload = z
      .object({
        requests: z.array(requestSchema).min(1).max(25),
      })
      .parse(req.body)

    const results = await Promise.all(
      payload.requests.map(async (input) => {
        const result = await createDecision({
          ...input,
          decisionMode: 'scenario_planning',
        })
        return result.response
      })
    )

    return res.json({
      generatedAt: new Date().toISOString(),
      count: results.length,
      decisions: results,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid scenario planning payload',
        details: error.errors,
      })
    }

    return res.status(500).json({
      error: 'Failed to compute scenario plan',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

router.get('/evidence/:decisionFrameId', async (req, res) => {
  try {
    const decisionFrameId = z.string().min(1).parse(req.params.decisionFrameId)
    const [decision, evidence, scenarioRuns, telemetry] = await Promise.all([
      prisma.cIDecision.findFirst({
        where: { decisionFrameId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.waterPolicyEvidence.findMany({
        where: { decisionFrameId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.waterScenarioRun.findMany({
        where: { decisionFrameId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.facilityWaterTelemetry.findMany({
        where: {
          OR: [
            { telemetryRef: { contains: decisionFrameId } },
            { facilityId: { not: null } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])

    if (!decision) {
      return res.status(404).json({
        error: 'Decision evidence not found',
        code: 'WATER_EVIDENCE_NOT_FOUND',
      })
    }

    return res.json({
      decisionFrameId,
      decision: {
        selectedRegion: decision.selectedRegion,
        decisionMode: decision.decisionMode,
        waterAuthorityMode: decision.waterAuthorityMode,
        waterScenario: decision.waterScenario,
        facilityId: decision.facilityId,
        proofHash: decision.proofHash,
        waterEvidenceRefs: decision.waterEvidenceRefs,
      },
      evidence,
      scenarioRuns,
      telemetry,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to load water evidence',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export default router
