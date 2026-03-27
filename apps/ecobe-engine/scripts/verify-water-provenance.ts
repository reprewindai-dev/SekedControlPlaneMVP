import { verifyWaterDatasetProvenance } from '../src/lib/water/provenance'

const persistManifest = process.argv.includes('--persist')

const result = verifyWaterDatasetProvenance({ persistManifest })

console.log(
  JSON.stringify(
    {
      checkedAt: result.checkedAt,
      summary: result.summary,
      persisted: persistManifest,
      datasets: result.datasets.map((dataset) => ({
        name: dataset.name,
        verificationStatus: dataset.verificationStatus,
        discoveredSourcePath: dataset.discoveredSourcePath,
        manifestHash: dataset.manifestHash,
        computedHash: dataset.computedHash,
      })),
    },
    null,
    2
  )
)
