import { Index } from '@upstash/vector'
import { env } from '../config/env'

let vectorIndex: Index | null = null

export const vectorNamespace = env.UPSTASH_VECTOR_INDEX_NAME

export function getWorkloadVectorIndex(): Index | null {
  if (!env.UPSTASH_VECTOR_REST_URL || !env.UPSTASH_VECTOR_REST_TOKEN) {
    return null
  }
  if (!vectorIndex) {
    vectorIndex = new Index({
      url: env.UPSTASH_VECTOR_REST_URL,
      token: env.UPSTASH_VECTOR_REST_TOKEN,
    })
  }
  return vectorIndex
}
