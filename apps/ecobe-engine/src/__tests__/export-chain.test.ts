import { persistExportBatch } from '../lib/proof/export-chain'

describe('proof export chain', () => {
  it('creates chained hashes for consecutive batches', () => {
    const first = persistExportBatch(`test-batch-${Date.now()}-a`, { a: 1 })
    const second = persistExportBatch(`test-batch-${Date.now()}-b`, { b: 2 })

    expect(first.batchHash).toBeTruthy()
    expect(second.batchHash).toBeTruthy()
    expect(second.previousBatchHash).toBe(first.batchHash)
  })
})

