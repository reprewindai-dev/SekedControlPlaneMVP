import { env } from './env'
import { validateAgainstSchema } from './json-schema'
import { executeFreestyleWriterPipeline } from './freestyle-writer-pipeline'

type GenerationResult = {
  output: Record<string, any> | null
  attemptCount: number
  schemaValid: boolean
  qualityScore: number
  finalDecision: string
  model: string
  provider: string
  error?: string
}

type ExecutionPayload = {
  input?: Record<string, any>
  schema?: Record<string, any>
  temperature?: number
  operation?: string
}

export async function executeGovernedPayload(payload: ExecutionPayload): Promise<GenerationResult> {
  const prompt = String(payload.input?.prompt ?? '').trim()
  const schema = payload.schema as Record<string, any> | undefined
  const transcript = String(payload.input?.transcript ?? '').trim()

  if (!prompt) {
    return {
      output: payload.input?.output ?? null,
      attemptCount: 1,
      schemaValid: true,
      qualityScore: 100,
      finalDecision: 'accepted',
      model: env.OLLAMA_MODEL,
      provider: 'passthrough',
    }
  }

  if (!env.OLLAMA_BASE_URL) {
    throw new Error('OLLAMA_BASE_URL is required for governed generation')
  }

  if (isFreestyleWriterPayload(payload)) {
    const freestyleResult = await executeFreestyleWriterPipeline({
      transcript,
      instructions: (payload.input?.instructions as Record<string, unknown> | undefined) ?? {},
      schema,
      temperature: payload.temperature ?? 0.55,
      maxAttempts: env.OLLAMA_MAX_ATTEMPTS,
      model: env.OLLAMA_MODEL,
      preservationPolicy: (payload.input?.preservationPolicy as Record<string, any> | undefined) ?? {},
      artistMemory: (payload.input?.artistMemory as Record<string, unknown> | undefined) ?? undefined,
      generateWithOllama,
    })

    return {
      output: freestyleResult.output,
      attemptCount: freestyleResult.attemptCount,
      schemaValid: freestyleResult.schemaValid,
      qualityScore: freestyleResult.qualityScore,
      finalDecision: freestyleResult.finalDecision,
      model: env.OLLAMA_MODEL,
      provider: 'ollama',
      error: freestyleResult.error,
    }
  }

  const contextEntries = Object.entries(payload.input ?? {}).filter(([key]) => key !== 'prompt')
  const baseTask = buildBaseTask(prompt, contextEntries, schema)
  let lastError = 'Model generation failed without a specific error'

  for (let attempt = 1; attempt <= env.OLLAMA_MAX_ATTEMPTS; attempt += 1) {
    const task = attempt === 1 ? baseTask : `${baseTask}\n\nPrevious validation error: ${lastError}\nReturn corrected JSON only.`

    try {
      const rawContent = await generateWithOllama({
        task,
        schema,
        temperature: payload.temperature ?? 0.65,
      })

      const parsed = parseJsonResponse(rawContent)
      const validation = validateAgainstSchema(parsed, schema)
      const preservation = evaluatePreservation(parsed, transcript)

      if (validation.valid && preservation.valid) {
        return {
          output: parsed as Record<string, any>,
          attemptCount: attempt,
          schemaValid: true,
          qualityScore: Math.max(72, Math.round((preservation.score + 96 - (attempt - 1) * 6) / 2)),
          finalDecision: 'accepted',
          model: env.OLLAMA_MODEL,
          provider: 'ollama',
        }
      }

      lastError = [...validation.errors, ...preservation.errors].join('; ')
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    output: null,
    attemptCount: env.OLLAMA_MAX_ATTEMPTS,
    schemaValid: false,
    qualityScore: 0,
    finalDecision: 'rejected',
    model: env.OLLAMA_MODEL,
    provider: 'ollama',
    error: lastError,
  }
}

function isFreestyleWriterPayload(payload: ExecutionPayload) {
  if (payload.operation === 'freestyle-writer-song-generation') {
    return true
  }

  const schemaProperties = payload.schema?.properties
  return Boolean(
    payload.input?.transcript &&
      schemaProperties?.melodic &&
      schemaProperties?.fast &&
      schemaProperties?.hybrid &&
      schemaProperties?.remix,
  )
}

async function generateWithOllama(input: {
  task: string
  schema?: Record<string, any>
  temperature: number
}) {
  const response = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OLLAMA_MODEL,
      stream: false,
      format: input.schema ?? 'json',
      options: {
        temperature: input.temperature,
        num_predict: env.OLLAMA_NUM_PREDICT,
      },
      messages: [
        {
          role: 'system',
          content:
            'You are the execution layer for a governed production control plane. Return valid JSON only, follow the provided schema exactly, preserve the source voice, preserve slang and emotional tone, prioritize preservation over novelty, and do not add markdown fences.',
        },
        {
          role: 'user',
          content: input.task,
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama request failed with ${response.status}: ${await response.text()}`)
  }

  const data = await response.json()
  const content = data?.message?.content

  if (!content || typeof content !== 'string') {
    throw new Error('Ollama returned an empty response')
  }

  return content
}

function evaluatePreservation(output: unknown, transcript: string) {
  if (!transcript) {
    return {
      valid: true,
      score: 96,
      errors: [] as string[],
    }
  }

  const transcriptTerms = tokenizeDistinctiveTerms(transcript)
  if (transcriptTerms.length === 0) {
    return {
      valid: true,
      score: 96,
      errors: [] as string[],
    }
  }

  const lyricBodies = extractLyrics(output)
  if (lyricBodies.length === 0) {
    return {
      valid: false,
      score: 0,
      errors: ['Generated output did not contain any lyric bodies to score for preservation'],
    }
  }

  const overlaps = lyricBodies.map((lyrics) => computeTermOverlap(transcriptTerms, lyrics))
  const averageOverlap = overlaps.reduce((sum, value) => sum + value, 0) / overlaps.length
  const minimumOverlap = Math.min(...overlaps)
  const score = Math.round(Math.min(99, averageOverlap * 140))
  const errors: string[] = []

  if (minimumOverlap < 0.22) {
    errors.push(`Preservation drift too high: weakest version only retained ${(minimumOverlap * 100).toFixed(1)}% of distinctive source terms`)
  }

  if (averageOverlap < 0.3) {
    errors.push(`Preservation target missed: average retention was ${(averageOverlap * 100).toFixed(1)}% of distinctive source terms`)
  }

  return {
    valid: errors.length === 0,
    score,
    errors,
  }
}

function extractLyrics(output: unknown) {
  if (!output || typeof output !== 'object') {
    return []
  }

  return Object.values(output as Record<string, unknown>)
    .map((value) => {
      if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).lyrics === 'string') {
        return String((value as Record<string, unknown>).lyrics)
      }
      return null
    })
    .filter((value): value is string => Boolean(value))
}

function tokenizeDistinctiveTerms(text: string) {
  const stopwords = new Set([
    'about', 'after', 'again', 'aint', 'been', 'before', 'being', 'but', 'came', 'cant', 'could', 'dont', 'each',
    'from', 'have', 'into', 'just', 'made', 'make', 'more', 'must', 'only', 'over', 'same', 'should', 'some', 'than',
    'that', 'them', 'then', 'they', 'this', 'through', 'trying', 'turn', 'with', 'your', 'youre', 'where', 'while',
  ])

  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9']+/g)?.filter((token) => token.length >= 4 && !stopwords.has(token)) ?? [],
    ),
  )
}

function computeTermOverlap(transcriptTerms: string[], lyrics: string) {
  const lyricTokens = new Set(lyrics.toLowerCase().match(/[a-z0-9']+/g) ?? [])
  const matched = transcriptTerms.filter((token) => lyricTokens.has(token)).length
  return matched / transcriptTerms.length
}

function buildBaseTask(prompt: string, contextEntries: [string, unknown][], schema?: Record<string, any>) {
  const contextBlock =
    contextEntries.length === 0
      ? 'No additional context.'
      : contextEntries
          .map(([key, value]) => `${key}:\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`)
          .join('\n\n')

  return [
    `Task:\n${prompt}`,
    `Context:\n${contextBlock}`,
    schema ? `JSON schema:\n${JSON.stringify(schema, null, 2)}` : null,
    'Return one JSON object only.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function parseJsonResponse(content: string) {
  const trimmed = content.trim()
  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed

  return JSON.parse(withoutFence)
}
