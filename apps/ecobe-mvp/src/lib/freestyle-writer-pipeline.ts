import { validateAgainstSchema } from './json-schema'

type JsonObject = Record<string, any>

type ExtractionResult = {
  signaturePhrases: string[]
  slangTokens: string[]
  emotionalTone: string
  hookCandidates: string[]
  verseCandidates: string[]
  discardCandidates: string[]
  highlightBars: string[]
  reusableLines: string[]
  brokenFragments: string[]
  unusableFragments: string[]
}

type PreservationPolicy = {
  sourceReuseTarget?: number
  maxInventedLinesPerSection?: number
  allowedConnectiveLinesPerVersion?: number
  preferredStructures?: Record<string, string[]>
}

type PipelineResult = {
  output: JsonObject | null
  attemptCount: number
  schemaValid: boolean
  qualityScore: number
  finalDecision: string
  error?: string
}

type ScoredSourceLine = {
  line: string
  intensityScore: number
  clarityScore: number
  uniquenessScore: number
  hookPotential: number
  compositeScore: number
  highlightScore: number
}

type VersionStyle = 'melodic' | 'fast' | 'hybrid' | 'remix'

type StructureSkeleton = {
  style: VersionStyle
  structure: string[]
  hook_lines: string[]
  verse_lines: string[]
  verse_one_lines: string[]
  verse_two_lines: string[]
  highlight_bars: string[]
  minimum_unique_verse_lines: number
  target_line_range: [number, number]
  style_focus: string
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  required: [
    'signaturePhrases',
    'slangTokens',
    'emotionalTone',
    'hookCandidates',
    'verseCandidates',
    'discardCandidates',
    'highlightBars',
    'reusableLines',
    'brokenFragments',
    'unusableFragments',
  ],
  properties: {
    signaturePhrases: stringArraySchema(),
    slangTokens: stringArraySchema(),
    emotionalTone: { type: 'string' },
    hookCandidates: stringArraySchema(),
    verseCandidates: stringArraySchema(),
    discardCandidates: stringArraySchema(),
    highlightBars: stringArraySchema(),
    reusableLines: stringArraySchema(),
    brokenFragments: stringArraySchema(),
    unusableFragments: stringArraySchema(),
  },
} as const

export async function executeFreestyleWriterPipeline(input: {
  transcript: string
  instructions?: Record<string, unknown>
  schema?: JsonObject
  temperature: number
  maxAttempts: number
  model: string
  generateWithOllama: (input: { task: string; schema?: JsonObject; temperature: number }) => Promise<string>
  preservationPolicy?: PreservationPolicy
  artistMemory?: Record<string, unknown>
}): Promise<PipelineResult> {
  const transcript = input.transcript.trim()
  const deterministic = extractTranscriptMaterial(transcript)
  const extraction = await extractWithModel({
    transcript,
    deterministic,
    temperature: Math.min(0.35, input.temperature),
    generateWithOllama: input.generateWithOllama,
  })
  const merged = mergeExtraction(deterministic, extraction)
  let lastError = 'Freestyle Writer generation failed'

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const task = buildGenerationTask({
      transcript,
      extraction: merged,
      instructions: input.instructions ?? {},
      schema: input.schema,
      policy: input.preservationPolicy,
      artistMemory: input.artistMemory,
      previousError: attempt === 1 ? null : lastError,
    })

    try {
      const rawContent = await input.generateWithOllama({
        task,
        schema: input.schema,
        temperature: Math.min(0.5, input.temperature),
      })

      const parsed = parseJsonResponse(rawContent)
      normalizeFreestyleArrangement(parsed, merged)
      normalizeFreestyleCategory(parsed, transcript)
      hydrateVersionScores(parsed, transcript, merged, input.preservationPolicy)

      const schemaValidation = validateAgainstSchema(parsed, input.schema)
      let quality = evaluateFreestyleQuality(parsed, transcript, merged, input.preservationPolicy)

      if (!quality.valid && canRecoverWithDeterministicArrangement(quality.errors)) {
        normalizeFreestyleArrangement(parsed, merged, transcript, { forceReplaceAll: true })
        hydrateVersionScores(parsed, transcript, merged, input.preservationPolicy)
        quality = evaluateFreestyleQuality(parsed, transcript, merged, input.preservationPolicy)
      }

      if (schemaValidation.valid && quality.valid) {
        return {
          output: parsed,
          attemptCount: attempt,
          schemaValid: true,
          qualityScore: quality.score,
          finalDecision: 'accepted',
        }
      }

      lastError = [...schemaValidation.errors, ...quality.errors].join('; ')
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    output: null,
    attemptCount: input.maxAttempts,
    schemaValid: false,
    qualityScore: 0,
    finalDecision: 'rejected',
    error: lastError,
  }
}

function extractTranscriptMaterial(transcript: string): ExtractionResult {
  const rawLines = transcript
    .split(/\r?\n|[.!?](?:\s+|$)|[,;](?:\s+|$)/)
    .map((line) => normalizeSourceCandidate(line))
    .filter(Boolean)
  const clauseLines = rawLines
    .flatMap((line) => splitSourceClauses(line))
    .map((line) => normalizeSourceCandidate(line))
    .filter(Boolean)
  const fragmentLines = clauseLines
    .flatMap((line) => expandArrangementFragments(line))
    .map((line) => normalizeSourceCandidate(line))
    .filter(Boolean)
  const sourceCandidates = fuzzyUnique([...rawLines, ...clauseLines, ...fragmentLines], 0.8).filter(
    (line) => !looksLikeNoiseLine(line),
  )

  const scoredCandidates = sourceCandidates
    .map((line, _, pool) => scoreSourceLineCandidate(line, pool))
    .sort((left, right) => {
      if (right.compositeScore !== left.compositeScore) {
        return right.compositeScore - left.compositeScore
      }
      return right.highlightScore - left.highlightScore
    })

  const hookCount = clamp(Math.ceil(scoredCandidates.length * 0.15), 2, Math.min(6, scoredCandidates.length))
  const verseCount = clamp(
    Math.ceil(scoredCandidates.length * 0.5),
    Math.min(4, scoredCandidates.length),
    Math.min(14, scoredCandidates.length),
  )

  const hookCandidates = fuzzyUnique(
    [...scoredCandidates]
      .sort((left, right) => {
        if (right.hookPotential !== left.hookPotential) {
          return right.hookPotential - left.hookPotential
        }
        return right.compositeScore - left.compositeScore
      })
      .slice(0, hookCount)
      .map((entry) => entry.line),
  )

  const verseCandidates = fuzzyUnique(
    scoredCandidates
      .filter((entry) => !containsNearDuplicate(hookCandidates, entry.line))
      .slice(0, verseCount)
      .map((entry) => entry.line),
  )

  const highlightBars = fuzzyUnique(
    scoredCandidates
      .filter((entry) => countWords(entry.line) >= 5 && countWords(entry.line) <= 14)
      .sort((left, right) => right.highlightScore - left.highlightScore)
      .slice(0, 2)
      .map((entry) => entry.line),
  )

  const discardCandidates = fuzzyUnique(
    scoredCandidates
      .filter(
        (entry) =>
          !containsNearDuplicate(hookCandidates, entry.line) && !containsNearDuplicate(verseCandidates, entry.line),
      )
      .map((entry) => entry.line),
  ).slice(0, 12)

  const reusableLines = fuzzyUnique([
    ...highlightBars,
    ...hookCandidates,
    ...verseCandidates,
    ...scoredCandidates.map((entry) => entry.line),
  ]).slice(0, 20)
  const signaturePhrases = fuzzyUnique(
    [...highlightBars, ...hookCandidates, ...verseCandidates]
      .filter((phrase) => countWords(phrase) >= 3 && countWords(phrase) <= 10)
      .sort((left, right) => scoreArrangementLine(right) - scoreArrangementLine(left)),
  ).slice(0, 24)

  const slangTokens = unique(
    (transcript.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(isRecognizedSlangToken),
  ).slice(0, 16)

  const brokenFragments = fuzzyUnique(
    [...rawLines, ...clauseLines].filter((line) => countWords(line) >= 2 && countWords(line) <= 3),
  ).slice(0, 10)
  const unusableFragments = fuzzyUnique(
    [...rawLines, ...clauseLines].filter((line) => countWords(line) < 2 || line.length < 6),
  ).slice(0, 8)

  return {
    signaturePhrases,
    slangTokens,
    emotionalTone: inferTone(transcript),
    hookCandidates,
    verseCandidates,
    discardCandidates,
    highlightBars,
    reusableLines,
    brokenFragments,
    unusableFragments,
  }
}

async function extractWithModel(input: {
  transcript: string
  deterministic: ExtractionResult
  temperature: number
  generateWithOllama: (input: { task: string; schema?: JsonObject; temperature: number }) => Promise<string>
}) {
  const task = [
    'You are extracting preserved artist material for a source-first lyric reconstruction pipeline.',
    'Do not write lyrics.',
    'Only return structured extraction JSON.',
    '',
    `Transcript:\n${input.transcript}`,
    '',
    `Deterministic seed extraction:\n${JSON.stringify(input.deterministic, null, 2)}`,
    '',
    'Rules:',
    '- prefer exact source phrases over paraphrase',
    '- keep slang tokens exactly as spoken',
    '- hook candidates must come from source material',
    '- verseCandidates should be stronger longer source lines, not just hook repeats',
    '- highlightBars must be memorable exact source lines, unchanged',
    '- discardCandidates should hold weaker usable lines, not noise',
    '- put badly broken fragments in brokenFragments or unusableFragments instead of forcing reuse',
  ].join('\n')

  try {
    const raw = await input.generateWithOllama({
      task,
      schema: EXTRACTION_SCHEMA as unknown as JsonObject,
      temperature: input.temperature,
    })
    const parsed = parseJsonResponse(raw)
    const validation = validateAgainstSchema(parsed, EXTRACTION_SCHEMA as unknown as JsonObject)
    if (!validation.valid) {
      return input.deterministic
    }
    return parsed as ExtractionResult
  } catch {
    return input.deterministic
  }
}

function mergeExtraction(deterministic: ExtractionResult, model: ExtractionResult): ExtractionResult {
  return {
    signaturePhrases: fuzzyUnique([...deterministic.signaturePhrases, ...safeArray(model.signaturePhrases)]).slice(0, 24),
    slangTokens: unique([...deterministic.slangTokens, ...safeArray(model.slangTokens)]).slice(0, 18),
    emotionalTone: model.emotionalTone || deterministic.emotionalTone,
    hookCandidates: fuzzyUnique([...deterministic.hookCandidates, ...safeArray(model.hookCandidates)]).slice(0, 8),
    verseCandidates: fuzzyUnique([...deterministic.verseCandidates, ...safeArray(model.verseCandidates)]).slice(0, 16),
    discardCandidates: fuzzyUnique([...deterministic.discardCandidates, ...safeArray(model.discardCandidates)]).slice(0, 12),
    highlightBars: fuzzyUnique([...deterministic.highlightBars, ...safeArray(model.highlightBars)]).slice(0, 2),
    reusableLines: fuzzyUnique([...deterministic.reusableLines, ...safeArray(model.reusableLines)]).slice(0, 20),
    brokenFragments: fuzzyUnique([...deterministic.brokenFragments, ...safeArray(model.brokenFragments)]).slice(0, 10),
    unusableFragments: fuzzyUnique([...deterministic.unusableFragments, ...safeArray(model.unusableFragments)]).slice(0, 8),
  }
}

function buildGenerationTask(input: {
  transcript: string
  extraction: ExtractionResult
  instructions: Record<string, unknown>
  schema?: JsonObject
  policy?: PreservationPolicy
  artistMemory?: Record<string, unknown>
  previousError: string | null
}) {
  const structures = input.policy?.preferredStructures ?? {
    melodic: ['Hook', 'Verse 1', 'Pre-Hook', 'Hook', 'Verse 2', 'Hook', 'Outro'],
    fast: ['Verse 1', 'Hook', 'Verse 2', 'Hook', 'Outro'],
    hybrid: ['Hook', 'Verse 1', 'Pre-Hook', 'Hook', 'Verse 2', 'Bridge', 'Outro'],
    remix: ['Verse 1', 'Hook', 'Verse 2', 'Bridge', 'Hook', 'Outro'],
  }
  const skeletons = buildStructureSkeletons(input.extraction, input.transcript, structures)

  return [
    'You are structuring a rap song from a freestyle.',
    '',
    `Original transcript:\n${input.transcript}`,
    '',
    `Locked extraction material:\n${JSON.stringify(input.extraction, null, 2)}`,
    '',
    `Structure skeletons:\n${JSON.stringify(skeletons, null, 2)}`,
    '',
    input.artistMemory ? `Artist memory:\n${JSON.stringify(input.artistMemory, null, 2)}` : null,
    `Generation policy:\n${JSON.stringify({
      sourceReuseTarget: input.policy?.sourceReuseTarget ?? 0.78,
      maxInventedLinesPerSection: input.policy?.maxInventedLinesPerSection ?? 1,
      allowedConnectiveLinesPerVersion: input.policy?.allowedConnectiveLinesPerVersion ?? 2,
      structures,
    }, null, 2)}`,
    '',
    'Rules:',
    '- Use provided hook_lines and verse_lines first',
    '- Do NOT rewrite original lines unless unusable',
    '- Reorder before inventing',
    '- Hooks must come from hook_lines',
    '- Verses must come from verse_lines with minimal changes',
    '- You may add at most 1-2 connective lines per section',
    '- Do NOT use generic rap filler or cliche phrases',
    '- Preserve slang, tone, and raw phrasing',
    '- Avoid excessive repetition',
    '- Ensure output is a complete song, not a loop',
    '- If the transcript is rich, expand into two real verses and hook returns instead of collapsing the source',
    '- No verse may reuse more than 40% of its own line bodies',
    '- Highlight bars must appear unchanged in hook openings, verse openings, or verse closers',
    '- Rich transcripts should land in the 10 to 16 line range per version',
    '- versions must not be near-duplicates of each other',
    '- Use modern section labels where they fit: Verse 1, Pre-Hook, Hook, Verse 2, Bridge, Outro',
    '- Return readable line-broken lyrics, never paragraphs',
    '',
    'Structure:',
    'Hook',
    'Verse',
    'Hook',
    'Verse',
    'Outro',
    '',
    `Style wrappers:\n${JSON.stringify(input.instructions, null, 2)}`,
    input.schema ? `JSON schema:\n${JSON.stringify(input.schema, null, 2)}` : null,
    input.previousError ? `Previous rejection reason:\n${input.previousError}` : null,
    'Return one JSON object only.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function evaluateFreestyleQuality(
  output: unknown,
  transcript: string,
  extraction: ExtractionResult,
  policy?: PreservationPolicy,
) {
  const lyricBodies = extractLyrics(output)
  if (lyricBodies.length === 0) {
    return {
      valid: false,
      score: 0,
      errors: ['Generated output did not contain any lyric bodies to score for preservation'],
    }
  }

  const sourceTerms = tokenizeDistinctiveTerms(transcript)
  const phrasePool = buildCorePhrasePool(extraction)
  const slangPool = extractTranscriptSlangTokens(transcript)
  const hookPool = extraction.hookCandidates.slice(0, 4)
  const sourceReuseTarget = policy?.sourceReuseTarget ?? 0.78
  const maxConnectiveLines = policy?.allowedConnectiveLinesPerVersion ?? 2
  const sourceArrangementLines = buildSourceArrangementLines(extraction)
  const sourceRichness = sourceArrangementLines.length
  const transcriptWordCount = Math.max(countWords(transcript), 1)
  const targetWordsPerVersion = deriveTargetWordsPerVersion(transcriptWordCount, sourceRichness)
  const targetUniqueLinesPerVersion = deriveTargetUniqueLinesPerVersion(sourceRichness, transcriptWordCount)
  const targetLineRange = deriveTargetLineCountRange(transcriptWordCount, sourceRichness)
  const averageLineCount = avg(lyricBodies.map((lyrics) => normalizeLyricLines(lyrics).length))
  const hookReuseRate = hookPool.length === 0
    ? 1
    : avg(lyricBodies.map((lyrics) => countPhraseMatches(lyrics, hookPool) > 0 ? 1 : 0))
  const pairwiseSimilarity = computeAveragePairwiseSimilarity(lyricBodies)
  const fillerPenalty = countGenericFillerHits(lyricBodies)
  const outputSourceCoverage = computeOutputSourceCoverage(lyricBodies, sourceArrangementLines)

  const perVersion = lyricBodies.map((lyrics) => {
    const lines = normalizeLyricLines(lyrics)
    const comparableLines = comparableLineSequence(lyrics)
    const uniqueComparableLines = new Set(comparableLines)
    const phraseRetention = phrasePool.length === 0 ? 1 : countPhraseMatches(lyrics, phrasePool) / phrasePool.length
    const termRetention = computeTermOverlap(sourceTerms, lyrics)
    const slangRetention =
      slangPool.length === 0
        ? 1
        : slangPool.filter((token) => lyrics.toLowerCase().includes(token.toLowerCase())).length / slangPool.length
    const connectiveLines = lines.filter((line) => !isNearSourceLine(line, extraction)).length
    const wordCount = countWords(stripSectionLabels(lyrics))
    const wordVolume = Math.min(1, wordCount / targetWordsPerVersion)
    const structuralRichness = Math.min(1, uniqueComparableLines.size / targetUniqueLinesPerVersion)
    const sourceCoverage = computeVersionSourceCoverage(lyrics, sourceArrangementLines, targetUniqueLinesPerVersion)
    const compressionResistance = Math.min(1, (wordVolume + sourceCoverage) / 2)
    const repeatedLineRatio = computeVersionRepetitionRatio(lyrics, hookPool)
    const repetitionDensity = computeDuplicateLineDensity(lyrics)
    const verseReuseRatio = computeVerseReuseRatio(lyrics)
    const lineCountDiscipline = computeLineCountDiscipline(lines.length, targetLineRange)
    return {
      phraseRetention,
      termRetention,
      slangRetention,
      connectiveLines,
      compressionResistance,
      structuralRichness,
      sourceCoverage,
      repeatedLineRatio,
      repetitionDensity,
      verseReuseRatio,
      lineCountDiscipline,
    }
  })

  const averagePhraseRetention = avg(perVersion.map((item) => item.phraseRetention))
  const minimumTermRetention = Math.min(...perVersion.map((item) => item.termRetention))
  const averageSlangRetention = avg(perVersion.map((item) => item.slangRetention))
  const maxConnectiveUsed = Math.max(...perVersion.map((item) => item.connectiveLines))
  const averageCompressionResistance = avg(perVersion.map((item) => item.compressionResistance))
  const averageStructuralRichness = avg(perVersion.map((item) => item.structuralRichness))
  const averageLineCountDiscipline = avg(perVersion.map((item) => item.lineCountDiscipline))
  const maxRepeatedLineRatio = Math.max(...perVersion.map((item) => item.repeatedLineRatio))
  const maxRepetitionDensity = Math.max(...perVersion.map((item) => item.repetitionDensity))
  const maxVerseReuseRatio = Math.max(...perVersion.map((item) => item.verseReuseRatio))
  const baseScore =
    averagePhraseRetention * 28 +
    minimumTermRetention * 18 +
    averageSlangRetention * 10 +
    Math.max(0, 8 - maxConnectiveUsed * 2) +
    averageCompressionResistance * 12 +
    averageStructuralRichness * 10 +
    outputSourceCoverage * 8 +
    hookReuseRate * 4 +
    averageLineCountDiscipline * 6 +
    Math.max(0, 4 - maxRepeatedLineRatio * 18) +
    Math.max(0, 5 - maxRepetitionDensity * 18) +
    Math.max(0, 5 - maxVerseReuseRatio * 12) +
    Math.max(0, 10 - pairwiseSimilarity * 10) -
    fillerPenalty * 3
  const guardrailCap = Math.min(
    averagePhraseRetention * 100 + 16,
    minimumTermRetention * 100 + 18,
    averageCompressionResistance * 100 + 8,
    averageStructuralRichness * 100 + 8,
    outputSourceCoverage * 100 + 18,
    averageLineCountDiscipline * 100 + 10,
    (1 - maxRepetitionDensity) * 100 + 12,
    (1 - pairwiseSimilarity) * 100 + 22,
  )
  const score = Math.round(Math.min(99, baseScore, guardrailCap))
  const errors: string[] = []

  if (averagePhraseRetention < sourceReuseTarget) {
    errors.push(
      `Source reuse target missed: average source phrase retention was ${(averagePhraseRetention * 100).toFixed(1)}%`,
    )
  }

  if (minimumTermRetention < 0.24) {
    errors.push(`Distinctive-term retention too low: weakest version retained ${(minimumTermRetention * 100).toFixed(1)}%`)
  }

  if (slangPool.length > 0 && averageSlangRetention < 0.7) {
    errors.push(
      `Slang retention too low: average slang retention was ${(averageSlangRetention * 100).toFixed(1)}% (pool: ${slangPool.join(', ')})`,
    )
  }

  if (maxConnectiveUsed > maxConnectiveLines) {
    errors.push(`Too many invented connective lines: max ${maxConnectiveLines}, saw ${maxConnectiveUsed}`)
  }

  if (averageLineCountDiscipline < 0.82 || averageLineCount < targetLineRange[0]) {
    errors.push(`Arrangement too thin: average version only produced ${averageLineCount.toFixed(1)} lines`)
  }

  if ((sourceRichness >= 4 || transcriptWordCount >= 18) && averageCompressionResistance < 0.86) {
    errors.push(
      `Compression too high: average version only hit ${(averageCompressionResistance * 100).toFixed(1)}% of the expected source-to-structure target`,
    )
  }

  if ((sourceRichness >= 4 || transcriptWordCount >= 18) && averageStructuralRichness < 0.86) {
    errors.push(
      `Structural richness too low: average version only delivered ${(averageStructuralRichness * 100).toFixed(1)}% of the unique-line target`,
    )
  }

  if ((sourceRichness >= 4 || transcriptWordCount >= 18) && outputSourceCoverage < 0.54) {
    errors.push(
      `Source coverage too low: output only used ${(outputSourceCoverage * 100).toFixed(1)}% of the available source lines`,
    )
  }

  if (hookPool.length > 0 && hookReuseRate < 0.5) {
    errors.push(
      `Hook reuse too weak: only ${(hookReuseRate * 100).toFixed(1)}% of versions reused a source hook candidate (pool: ${hookPool.join(' | ')})`,
    )
  }

  if (maxRepeatedLineRatio > 0.24) {
    errors.push(
      `Section repetition too high: worst version repeated ${(maxRepeatedLineRatio * 100).toFixed(1)}% of its line bodies`,
    )
  }

  if (maxRepetitionDensity > 0.34) {
    errors.push(
      `Repetition density too high: worst version duplicated ${(maxRepetitionDensity * 100).toFixed(1)}% of its total lines`,
    )
  }

  if (maxVerseReuseRatio > 0.4) {
    errors.push(
      `Verse duplication too high: worst verse reused ${(maxVerseReuseRatio * 100).toFixed(1)}% of its own lines`,
    )
  }

  if (pairwiseSimilarity > 0.92) {
    errors.push(`Versions too similar: average cross-version similarity was ${(pairwiseSimilarity * 100).toFixed(1)}%`)
  }

  if (fillerPenalty > 1) {
    errors.push(`Generic filler detected too often: ${fillerPenalty} filler-pattern hits`)
  }

  return {
    valid: errors.length === 0,
    score,
    errors,
  }
}

function hydrateVersionScores(
  output: JsonObject,
  transcript: string,
  extraction: ExtractionResult,
  policy?: PreservationPolicy,
) {
  const transcriptTerms = tokenizeDistinctiveTerms(transcript)
  const phrasePool = buildCorePhrasePool(extraction)
  const slangPool = extractTranscriptSlangTokens(transcript)
  const hookPool = extraction.hookCandidates.slice(0, 4)
  const sourceArrangementLines = buildSourceArrangementLines(extraction)
  const sourceRichness = sourceArrangementLines.length
  const transcriptWordCount = Math.max(countWords(transcript), 1)
  const targetWordsPerVersion = deriveTargetWordsPerVersion(transcriptWordCount, sourceRichness)
  const targetUniqueLinesPerVersion = deriveTargetUniqueLinesPerVersion(sourceRichness, transcriptWordCount)
  const targetLineRange = deriveTargetLineCountRange(transcriptWordCount, sourceRichness)
  const maxConnectiveLines = policy?.allowedConnectiveLinesPerVersion ?? 2

  for (const key of ['melodic', 'fast', 'hybrid', 'remix']) {
    const candidate = output[key]
    if (candidate && typeof candidate === 'object' && typeof candidate.lyrics === 'string') {
      const lines = normalizeLyricLines(candidate.lyrics)
      const comparableLines = new Set(comparableLineSequence(candidate.lyrics))
      const termRetention = computeTermOverlap(transcriptTerms, candidate.lyrics)
      const phraseRetention =
        phrasePool.length === 0 ? 1 : countPhraseMatches(candidate.lyrics, phrasePool) / phrasePool.length
      const slangRetention =
        slangPool.length === 0
          ? 1
          : slangPool.filter((token) => candidate.lyrics.toLowerCase().includes(token.toLowerCase())).length / slangPool.length
      const connectiveLines = lines.filter((line) => !isNearSourceLine(line, extraction)).length
      const wordVolume = Math.min(1, countWords(stripSectionLabels(candidate.lyrics)) / targetWordsPerVersion)
      const structuralRichness = Math.min(1, comparableLines.size / targetUniqueLinesPerVersion)
      const sourceCoverage = computeVersionSourceCoverage(candidate.lyrics, sourceArrangementLines, targetUniqueLinesPerVersion)
      const compressionResistance = Math.min(1, (wordVolume + sourceCoverage) / 2)
      const repeatedLineRatio = computeVersionRepetitionRatio(candidate.lyrics, hookPool)
      const repetitionDensity = computeDuplicateLineDensity(candidate.lyrics)
      const verseReuseRatio = computeVerseReuseRatio(candidate.lyrics)
      const hookReuse = hookPool.length === 0 ? 1 : countPhraseMatches(candidate.lyrics, hookPool) > 0 ? 1 : 0
      const lineDiscipline = computeLineCountDiscipline(lines.length, targetLineRange)
      const connectiveDiscipline = Math.max(0, 1 - Math.max(0, connectiveLines - maxConnectiveLines) * 0.35)
      const repetitionResistance = Math.max(0, 1 - repetitionDensity)

      const baseScore =
        termRetention * 24 +
        phraseRetention * 18 +
        slangRetention * 8 +
        compressionResistance * 14 +
        structuralRichness * 12 +
        sourceCoverage * 10 +
        lineDiscipline * 6 +
        hookReuse * 3 +
        repetitionResistance * 3 +
        connectiveDiscipline * 2
      const guardrailCap = Math.min(
        termRetention * 100 + 18,
        phraseRetention * 100 + 14,
        compressionResistance * 100 + 10,
        structuralRichness * 100 + 8,
        sourceCoverage * 100 + 14,
        lineDiscipline * 100 + 10,
        (1 - repetitionDensity) * 100 + 12,
        (1 - verseReuseRatio) * 100 + 10,
      )

      candidate.score = Math.max(1, Math.min(96, Math.round(Math.min(baseScore, guardrailCap))))
    }
  }
}

function normalizeFreestyleArrangement(
  output: JsonObject,
  extraction: ExtractionResult,
  transcript = '',
  options?: { forceReplaceAll?: boolean },
) {
  const sourceLines = buildSourceArrangementLines(extraction)
  if (sourceLines.length === 0) {
    return
  }

  const skeletons = buildStructureSkeletons(extraction, transcript)
  const targetLineRange = deriveTargetLineCountRange(Math.max(countWords(transcript), 1), sourceLines.length)
  const variants: Record<string, string[]> = {
    melodic: buildVariantLines('melodic', skeletons.melodic, sourceLines),
    fast: buildVariantLines('fast', skeletons.fast, sourceLines),
    hybrid: buildVariantLines('hybrid', skeletons.hybrid, sourceLines),
    remix: buildVariantLines('remix', skeletons.remix, sourceLines),
  }

  for (const key of ['melodic', 'fast', 'hybrid', 'remix']) {
    const candidate = output[key]
    if (!candidate || typeof candidate !== 'object' || typeof candidate.lyrics !== 'string') {
      continue
    }

    const normalizedExisting = normalizeLyricLines(candidate.lyrics)
      .map((line) => sanitizeLine(line))
      .filter(Boolean)
    const existingSimilarity = similarity(
      normalizedExisting.join(' ').toLowerCase(),
      variants[key].join(' ').toLowerCase(),
    )
    const shouldReplace =
      options?.forceReplaceAll ||
      normalizedExisting.length < targetLineRange[0] ||
      normalizedExisting.length > targetLineRange[1] + 2 ||
      computeDuplicateLineDensity(candidate.lyrics) > 0.34 ||
      computeVerseReuseRatio(candidate.lyrics) > 0.4 ||
      computeStructuralRichness(candidate.lyrics, sourceLines.length, Math.max(countWords(transcript), 1)) < 0.82 ||
      computeVersionSourceCoverage(candidate.lyrics, sourceLines, deriveTargetUniqueLinesPerVersion(sourceLines.length, countWords(transcript))) < 0.48 ||
      existingSimilarity > 0.92 ||
      countGenericFillerHits([candidate.lyrics]) > 0

    if (shouldReplace) {
      candidate.lyrics = variants[key].join('\n')
    }
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

function normalizeLyricLines(lyrics: string) {
  return lyrics
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function isNearSourceLine(line: string, extraction: ExtractionResult) {
  const comparable = stripSectionLabels(line).toLowerCase()
  const sourcePool = buildSourceArrangementLines(extraction)
  return sourcePool.some((source) => similarity(source.toLowerCase(), comparable) >= 0.58 || comparable.includes(source.toLowerCase()))
}

function similarity(left: string, right: string) {
  const leftTokens = new Set(left.match(/[a-z0-9']+/g) ?? [])
  const rightTokens = new Set(right.match(/[a-z0-9']+/g) ?? [])
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0
  }
  const overlap = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length
  return overlap / Math.max(leftTokens.size, rightTokens.size)
}

function computeAveragePairwiseSimilarity(versions: string[]) {
  if (versions.length < 2) {
    return 0
  }

  const scores: number[] = []
  for (let i = 0; i < versions.length; i += 1) {
    for (let j = i + 1; j < versions.length; j += 1) {
      scores.push(sequenceSimilarity(versions[i], versions[j]))
    }
  }

  return avg(scores)
}

function sequenceSimilarity(left: string, right: string) {
  const leftLines = comparableLineSet(left)
  const rightLines = comparableLineSet(right)
  if (leftLines.size === 0 || rightLines.size === 0) {
    return similarity(stripSectionLabels(left).toLowerCase(), stripSectionLabels(right).toLowerCase())
  }

  const lineOverlap = Array.from(leftLines).filter((token) => rightLines.has(token)).length / Math.max(leftLines.size, rightLines.size)
  const leftSequence = comparableLineSequence(left)
  const rightSequence = comparableLineSequence(right)
  const leftBigrams = buildLineBigrams(leftSequence)
  const rightBigrams = buildLineBigrams(rightSequence)
  const sequenceOverlap =
    leftBigrams.size === 0 || rightBigrams.size === 0
      ? 0
      : Array.from(leftBigrams).filter((token) => rightBigrams.has(token)).length / Math.max(leftBigrams.size, rightBigrams.size)

  return lineOverlap * 0.45 + sequenceOverlap * 0.55
}

function countGenericFillerHits(versions: string[]) {
  const fillerPatterns = [
    /oh yeah/gi,
    /ready for the ride/gi,
    /new perspective/gi,
    /lease on life/gi,
    /flowy/gi,
    /unexpected harmony/gi,
    /oh+$/gim,
    /\byeah+\b/gi,
  ]

  return versions.reduce((count, lyrics) => {
    return (
      count +
      fillerPatterns.reduce((inner, pattern) => inner + (lyrics.match(pattern)?.length ?? 0), 0)
    )
  }, 0)
}

function countPhraseMatches(text: string, phrases: string[]) {
  const lower = text.toLowerCase()
  return phrases.filter((phrase) => lower.includes(phrase.toLowerCase())).length
}

function buildSourceArrangementLines(extraction: ExtractionResult) {
  const exactLines = fuzzyUnique([
    ...extraction.highlightBars,
    ...extraction.hookCandidates,
    ...extraction.verseCandidates,
    ...extraction.reusableLines,
    ...extraction.signaturePhrases,
  ])
    .flatMap((line) => {
      const sanitized = sanitizeLine(line)
      const clauses = splitSourceClauses(sanitized)
      return fuzzyUnique([
        sanitized,
        ...clauses,
        ...clauses.flatMap((clause) => expandArrangementFragments(clause)),
      ])
    })
    .filter((line) => countWords(line) >= 4)

  return fuzzyUnique(exactLines)
    .sort((left, right) => scoreArrangementLine(right) - scoreArrangementLine(left))
    .slice(0, 16)
}

function buildCorePhrasePool(extraction: ExtractionResult) {
  return fuzzyUnique([
    ...extraction.highlightBars,
    ...extraction.hookCandidates,
    ...buildSourceArrangementLines(extraction),
  ])
    .map((phrase) => sanitizeLine(phrase))
    .filter((phrase) => {
      const words = countWords(phrase)
      return words >= 3 && words <= 8
    })
    .slice(0, 6)
}

function buildStructureSkeletons(
  extraction: ExtractionResult,
  transcript: string,
  preferredStructures?: Record<string, string[]>,
): Record<VersionStyle, StructureSkeleton> {
  const sourceLines = buildSourceArrangementLines(extraction)
  const sourceRichness = sourceLines.length
  const transcriptWordCount = Math.max(countWords(transcript), 1)
  const targetLineRange = deriveTargetLineCountRange(transcriptWordCount, sourceRichness)
  const verseLineCount = targetLineRange[0] >= 12 ? 4 : 3
  const sharedHookPool = fuzzyUnique([
    ...extraction.highlightBars.filter((line) => countWords(line) <= 9),
    ...extraction.hookCandidates,
    ...sourceLines,
  ]).slice(0, 4)
  const sharedVersePool = fuzzyUnique([
    ...extraction.highlightBars,
    ...extraction.verseCandidates,
    ...extraction.discardCandidates,
    ...extraction.reusableLines,
    ...sourceLines,
  ]).slice(0, 16)
  const highlightBars = fuzzyUnique([
    ...extraction.highlightBars,
    ...sharedHookPool,
    ...sharedVersePool,
  ]).slice(0, 2)
  const structures = preferredStructures ?? {
    melodic: ['Hook', 'Verse 1', 'Pre-Hook', 'Hook', 'Verse 2', 'Hook', 'Outro'],
    fast: ['Verse 1', 'Hook', 'Verse 2', 'Hook', 'Outro'],
    hybrid: ['Hook', 'Verse 1', 'Pre-Hook', 'Hook', 'Verse 2', 'Bridge', 'Outro'],
    remix: ['Verse 1', 'Hook', 'Verse 2', 'Bridge', 'Hook', 'Outro'],
  }

  const verseExpansionPool = buildVerseExpansionPool(sharedVersePool, sharedHookPool)
  const rankedVersePool = rankVerseCandidates(
    [...sharedVersePool, ...verseExpansionPool],
    sharedHookPool,
    highlightBars,
  )
  const verseOneSeed = takeDistinctLines([highlightBars[0], ...rankedVersePool], verseLineCount, sharedHookPool)
  const verseTwoSeed = takeDistinctLines(
    [highlightBars[1], ...rankedVersePool.slice(verseLineCount), ...rankedVersePool],
    verseLineCount,
    [...sharedHookPool, ...verseOneSeed],
  )

  return {
    melodic: {
      style: 'melodic',
      structure: structures.melodic ?? ['Hook', 'Verse 1', 'Pre-Hook', 'Hook', 'Verse 2', 'Hook', 'Outro'],
      hook_lines: takeDistinctLines(sharedHookPool, 3),
      verse_lines: takeDistinctLines(rankedVersePool, 10),
      verse_one_lines: verseOneSeed,
      verse_two_lines: verseTwoSeed,
      highlight_bars: highlightBars,
      minimum_unique_verse_lines: verseLineCount,
      target_line_range: targetLineRange,
      style_focus: 'Hook-forward, emotionally lifted, recordable melodic structure.',
    },
    fast: {
      style: 'fast',
      structure: structures.fast ?? ['Verse 1', 'Hook', 'Verse 2', 'Hook', 'Outro'],
      hook_lines: takeDistinctLines(sharedHookPool, 2),
      verse_lines: takeDistinctLines(rankedVersePool, 12),
      verse_one_lines: takeDistinctLines([highlightBars[0], ...rankedVersePool], verseLineCount + 1, sharedHookPool),
      verse_two_lines: takeDistinctLines(
        [highlightBars[1], ...rankedVersePool.slice(verseLineCount), ...rankedVersePool],
        verseLineCount + 1,
        [...sharedHookPool, ...verseOneSeed],
      ),
      highlight_bars: highlightBars,
      minimum_unique_verse_lines: verseLineCount,
      target_line_range: targetLineRange,
      style_focus: 'Verse-heavy, punch-line dense, fast delivery with tight hook snap.',
    },
    hybrid: {
      style: 'hybrid',
      structure: structures.hybrid ?? ['Hook', 'Verse 1', 'Pre-Hook', 'Hook', 'Verse 2', 'Bridge', 'Outro'],
      hook_lines: takeDistinctLines(sharedHookPool, 2),
      verse_lines: takeDistinctLines(rankedVersePool, 10),
      verse_one_lines: verseOneSeed,
      verse_two_lines: verseTwoSeed,
      highlight_bars: highlightBars,
      minimum_unique_verse_lines: verseLineCount,
      target_line_range: targetLineRange,
      style_focus: 'Balanced hook and verse energy with a clearer switch or bridge.',
    },
    remix: {
      style: 'remix',
      structure: structures.remix ?? ['Verse 1', 'Hook', 'Verse 2', 'Bridge', 'Hook', 'Outro'],
      hook_lines: takeDistinctLines(sharedHookPool.slice().reverse(), 2),
      verse_lines: takeDistinctLines([...rankedVersePool.slice().reverse(), ...rankedVersePool], 10),
      verse_one_lines: takeDistinctLines([highlightBars[0], ...rankedVersePool.slice().reverse()], verseLineCount, sharedHookPool),
      verse_two_lines: takeDistinctLines(
        [highlightBars[1], ...rankedVersePool, ...rankedVersePool.slice().reverse()],
        verseLineCount,
        [...sharedHookPool, ...verseOneSeed],
      ),
      highlight_bars: highlightBars,
      minimum_unique_verse_lines: verseLineCount,
      target_line_range: targetLineRange,
      style_focus: 'Same source voice but flipped sequencing and sharper switch-up energy.',
    },
  }
}

function normalizeSourceCandidate(line: string) {
  return line
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/^[^a-z0-9']+/i, '')
    .replace(/[^a-z0-9'?!]+$/i, '')
    .trim()
}

function looksLikeNoiseLine(line: string) {
  return !line || !/[a-z]/i.test(line) || /^nah wait$|^hold up$|^run that back$/i.test(line)
}

function scoreSourceLineCandidate(line: string, pool: string[]): ScoredSourceLine {
  const words = countWords(line)
  const intensityWords = (line.match(/\b(kill|grind|motion|pressure|broke|focused|dream|city|money|clean|loud|hurt|pain|scar|legacy|warning|lesson|fire|cold)\b/gi) ?? []).length
  const emphasisWords = (line.match(/\b(never|every|whole|all|now|still|only|really)\b/gi) ?? []).length
  const emotionalWords = (line.match(/\b(heart|chest|hurt|pain|love|shadow|dream|scar|tears|break)\b/gi) ?? []).length
  const intensityScore = intensityWords * 2 + emphasisWords + emotionalWords * 2 + (/!|\?/.test(line) ? 1 : 0)
  const clarityScore =
    (words >= 4 && words <= 12 ? 4 : words >= 3 && words <= 14 ? 3 : 1) +
    (isUsableFragment(line) ? 2 : 0) +
    (/^[a-z0-9']+/i.test(line) && /[a-z0-9']$/i.test(line) ? 1 : 0)
  const nearestNeighborSimilarity = pool
    .filter((candidate) => candidate !== line)
    .reduce((max, candidate) => Math.max(max, similarity(candidate.toLowerCase(), line.toLowerCase())), 0)
  const uniquenessScore = Math.max(0, 6 - Math.round(nearestNeighborSimilarity * 6))
  const hookPotential =
    (words >= 4 && words <= 8 ? 4 : words <= 10 ? 2 : 0) +
    ((line.match(/\b(i|you|we|whole|every|never|now|money|motion|grind|dream|name|city)\b/gi) ?? []).length > 0 ? 2 : 0) +
    (/pain|motion|money|dream|city|grind|love|name|pressure|focused|legacy/i.test(line) ? 2 : 0)
  const compositeScore = intensityScore * 0.32 + clarityScore * 0.24 + uniquenessScore * 0.2 + hookPotential * 0.24
  const highlightScore = intensityScore * 0.45 + clarityScore * 0.25 + uniquenessScore * 0.3

  return {
    line,
    intensityScore,
    clarityScore,
    uniquenessScore,
    hookPotential,
    compositeScore,
    highlightScore,
  }
}

function rankVerseCandidates(verseLines: string[], hookLines: string[], highlightBars: string[]) {
  return fuzzyUnique(verseLines)
    .map((line) => ({
      line,
      score: scoreVersePriority(line, hookLines, highlightBars),
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.line)
}

function scoreVersePriority(line: string, hookLines: string[], highlightBars: string[]) {
  const words = countWords(line)
  const hookOverlap = hookLines.reduce(
    (max, hookLine) => Math.max(max, similarity(stripSectionLabels(hookLine).toLowerCase(), stripSectionLabels(line).toLowerCase())),
    0,
  )
  const highlightBoost = containsNearDuplicate(highlightBars, line) ? 2 : 0
  const detailBoost = /broke|focused|whip|fit|city|thoughts|chest|pressure|shadow|rent|future|lesson|dream|legacy|motion/i.test(line) ? 2 : 0
  const connectiveBoost = /\b(with|before|after|when|cause|still|used to|now|every|trying)\b/i.test(line) ? 2 : 0
  const lengthBoost = words >= 5 && words <= 12 ? 4 : words >= 4 && words <= 14 ? 2 : 0
  const hookPenalty = hookOverlap >= 0.9 ? 5 : hookOverlap >= 0.72 ? 3 : hookOverlap >= 0.58 ? 1 : 0

  return lengthBoost + detailBoost + connectiveBoost + highlightBoost - hookPenalty
}

function containsNearDuplicate(values: string[], candidate: string) {
  return values.some(
    (value) => similarity(stripSectionLabels(value).toLowerCase(), stripSectionLabels(candidate).toLowerCase()) >= 0.82,
  )
}

function takeDistinctLines(pool: Array<string | undefined>, count: number, exclude: string[] = [], minWords = 1) {
  const picked: string[] = []
  const blocked = exclude.filter(Boolean)

  for (const candidate of pool) {
    if (!candidate) {
      continue
    }
    const sanitized = sanitizeLine(candidate)
    if (!sanitized || countWords(sanitized) < minWords || containsNearDuplicate([...blocked, ...picked], sanitized)) {
      continue
    }
    picked.push(sanitized)
    if (picked.length >= count) {
      break
    }
  }

  return picked
}

function ensureVerseHighlight(
  verseLines: string[],
  highlightBar: string,
  minimumCount: number,
  fallbackPool: string[],
  exclude: string[] = [],
) {
  const verse = takeDistinctLines([highlightBar, ...verseLines, ...fallbackPool], minimumCount, exclude, 4)
  if (verse.length < minimumCount) {
    return takeDistinctLines([highlightBar, ...verse, ...fallbackPool], minimumCount, exclude, 4)
  }
  return verse
}

function ensureVerseDensity(
  verseLines: string[],
  minimumCount: number,
  fallbackPool: string[],
  exclude: string[] = [],
) {
  if (verseLines.length >= minimumCount) {
    return verseLines
  }
  return takeDistinctLines([...verseLines, ...fallbackPool], minimumCount, exclude, 4)
}

function balanceVerseSection(lines: string[], hookLines: string[]) {
  const balanced: string[] = []

  for (const line of lines) {
    const comparable = stripSectionLabels(line).toLowerCase()
    if (hookLines.some((hookLine) => similarity(stripSectionLabels(hookLine).toLowerCase(), comparable) >= 0.9)) {
      continue
    }
    if (balanced.some((existing) => similarity(stripSectionLabels(existing).toLowerCase(), comparable) >= 0.82)) {
      continue
    }
    balanced.push(line)
  }

  return balanced.length > 0 ? balanced : lines
}

function buildCompositePool(lines: string[], hookLines: string[] = []) {
  const pool = fuzzyUnique(lines).filter((line) => countWords(line) >= 4)
  const composites: Array<{ line: string; score: number }> = []

  for (let index = 0; index < pool.length; index += 1) {
    for (let offset = index + 1; offset < pool.length; offset += 1) {
      const composite = stitchSourceLines(pool[index], pool[offset])
      if (
        !composite ||
        !isRecordableVerseLine(composite) ||
        containsNearDuplicate([...pool, ...composites.map((entry) => entry.line)], composite)
      ) {
        continue
      }
      composites.push({
        line: composite,
        score: scoreVersePriority(composite, hookLines, []) + scoreArrangementLine(composite),
      })
      if (composites.length >= 12) {
        return composites
          .sort((left, right) => right.score - left.score)
          .slice(0, 8)
          .map((entry) => entry.line)
      }
    }
  }

  return composites
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((entry) => entry.line)
}

function buildVerseExpansionPool(lines: string[], hookLines: string[]) {
  const basePool = fuzzyUnique(lines).filter((line) => countWords(line) >= 4)
  const expansions: Array<{ line: string; score: number }> = []

  for (const line of basePool) {
    for (const candidate of extractVerseFragments(line)) {
      if (
        !candidate ||
        countWords(candidate) < 4 ||
        !isRecordableVerseLine(candidate) ||
        containsNearDuplicate([...basePool, ...expansions.map((entry) => entry.line)], candidate)
      ) {
        continue
      }
      expansions.push({
        line: candidate,
        score: scoreVersePriority(candidate, hookLines, []) + scoreArrangementLine(candidate),
      })
    }
  }

  return expansions
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map((entry) => entry.line)
}

function extractVerseFragments(line: string) {
  const clauses = fuzzyUnique([
    ...splitSourceClauses(line),
    ...expandArrangementFragments(line),
    ...sliceVerseFragments(line),
  ])

  return clauses
    .map((candidate) => sanitizeLine(candidate))
    .filter((candidate) => countWords(candidate) >= 4 && countWords(candidate) <= 12)
    .filter((candidate) => isRecordableVerseLine(candidate))
    .filter((candidate, index, pool) => {
      return !pool.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.length > candidate.length &&
          other.toLowerCase().includes(candidate.toLowerCase()),
      )
    })
}

function sliceVerseFragments(line: string) {
  const words = line.split(/\s+/).filter(Boolean)
  if (words.length < 12) {
    return []
  }

  const front = words.slice(0, Math.min(7, words.length)).join(' ')
  const back = words.slice(Math.max(0, words.length - 7)).join(' ')
  const middleStart = Math.max(0, Math.floor(words.length / 2) - 3)
  const middle = words.slice(middleStart, Math.min(words.length, middleStart + 7)).join(' ')

  return fuzzyUnique([front, middle, back])
}

function stitchSourceLines(primary?: string, secondary?: string) {
  if (!primary) {
    return secondary ?? null
  }
  if (!secondary) {
    return primary
  }

  const left = stripSectionLabels(primary).trim()
  const right = stripSectionLabels(secondary).trim()
  if (!left || !right) {
    return left || right || null
  }
  if (similarity(left.toLowerCase(), right.toLowerCase()) >= 0.72) {
    return left
  }
  const leftLead = left.split(/\s+/).slice(0, 2).join(' ').toLowerCase()
  const rightLead = right.split(/\s+/).slice(0, 2).join(' ').toLowerCase()
  if (leftLead && leftLead === rightLead) {
    return countWords(left) >= countWords(right) ? left : right
  }

  const stitched = `${left}, ${right}`
  if (countWords(stitched) > 12) {
    return countWords(left) >= countWords(right) ? left : right
  }
  if (countWords(stitched) < 6) {
    return null
  }

  return stitched
}

function computeVersionSourceCoverage(lyrics: string, sourceLines: string[], targetUniqueLinesPerVersion: number) {
  if (sourceLines.length === 0) {
    return 1
  }
  const matchedCount = collectMatchedSourceLines([lyrics], sourceLines).size
  const denominator = Math.max(1, Math.min(sourceLines.length, targetUniqueLinesPerVersion + 2))
  return Math.min(1, matchedCount / denominator)
}

function computeOutputSourceCoverage(versions: string[], sourceLines: string[]) {
  if (sourceLines.length === 0) {
    return 1
  }
  return collectMatchedSourceLines(versions, sourceLines).size / sourceLines.length
}

function collectMatchedSourceLines(versions: string[], sourceLines: string[]) {
  const matched = new Set<string>()
  const comparableOutputs = versions.flatMap((lyrics) => comparableLineSequence(lyrics))

  for (const sourceLine of sourceLines) {
    const comparableSource = stripSectionLabels(sourceLine).toLowerCase()
    if (
      comparableOutputs.some(
        (outputLine) =>
          similarity(outputLine, comparableSource) >= 0.58 ||
          outputLine.includes(comparableSource) ||
          comparableSource.includes(outputLine),
      )
    ) {
      matched.add(sourceLine)
    }
  }

  return matched
}

function computeDuplicateLineDensity(lyrics: string) {
  const lines = normalizeLyricLines(lyrics)
  if (lines.length === 0) {
    return 0
  }

  const buckets: Array<{ body: string; count: number; hookAnchored: boolean }> = []
  for (const line of lines) {
    const labelMatch = line.match(/^([A-Za-z0-9 ]+):\s*(.*)$/)
    const label = labelMatch?.[1]?.trim().toLowerCase() ?? ''
    const body = stripSectionLabels(line).toLowerCase()
    if (!body) {
      continue
    }
    const existing = buckets.find((entry) => similarity(entry.body, body) >= 0.82)
    if (existing) {
      existing.count += 1
      existing.hookAnchored = existing.hookAnchored || label.startsWith('hook')
      continue
    }
    buckets.push({
      body,
      count: 1,
      hookAnchored: label.startsWith('hook'),
    })
  }

  let repeatedUnits = 0
  for (const bucket of buckets) {
    const allowance = bucket.hookAnchored ? 1 : 0
    repeatedUnits += Math.max(0, bucket.count - 1 - allowance)
  }

  return repeatedUnits / lines.length
}

function computeVerseReuseRatio(lyrics: string) {
  const lines = normalizeLyricLines(lyrics)
  const sections = new Map<string, string[]>()

  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9 ]+):\s*(.*)$/)
    if (!match) {
      continue
    }
    const label = match[1].trim().toLowerCase()
    if (!label.startsWith('verse')) {
      continue
    }
    const body = match[2].trim().toLowerCase()
    if (!body) {
      continue
    }
    const bucket = sections.get(label) ?? []
    bucket.push(body)
    sections.set(label, bucket)
  }

  const ratios = Array.from(sections.values()).map((sectionLines) => {
    const uniqueLines = new Set(sectionLines)
    return 1 - uniqueLines.size / Math.max(sectionLines.length, 1)
  })

  return ratios.length === 0 ? 0 : Math.max(...ratios)
}

function computeLineCountDiscipline(lineCount: number, targetLineRange: [number, number]) {
  const [minimum, maximum] = targetLineRange
  if (lineCount >= minimum && lineCount <= maximum) {
    return 1
  }
  if (lineCount >= minimum - 1 && lineCount <= maximum + 1) {
    return 0.84
  }
  if (lineCount >= minimum - 2 && lineCount <= maximum + 2) {
    return 0.68
  }
  return 0.4
}

function buildVariantLines(
  style: VersionStyle,
  skeleton: StructureSkeleton,
  sourceLines: string[],
) {
  const verseExpansionPool = buildVerseExpansionPool([...skeleton.verse_lines, ...sourceLines], skeleton.hook_lines)
  const compositePool = buildCompositePool(
    [...verseExpansionPool, ...skeleton.verse_lines, ...sourceLines],
    skeleton.hook_lines,
  )
  const verseFallbackPool = takeDistinctLines(
    [...verseExpansionPool, ...skeleton.verse_lines, ...compositePool, ...sourceLines],
    18,
    skeleton.hook_lines,
    4,
  )
  const hookLines = takeDistinctLines(
    [
      ...skeleton.hook_lines,
      ...skeleton.highlight_bars.filter((line) => countWords(line) <= 9),
      ...sourceLines,
      ...compositePool,
    ],
    2,
    [],
    4,
  )
  const verseTarget = Math.min(5, skeleton.minimum_unique_verse_lines + (style === 'fast' ? 1 : 0))
  const verseOne = balanceVerseSection(ensureVerseDensity(ensureVerseHighlight(
    skeleton.verse_one_lines,
    skeleton.highlight_bars[0] ?? hookLines[0] ?? sourceLines[0],
    skeleton.minimum_unique_verse_lines,
    verseFallbackPool,
    [...hookLines],
  ), verseTarget, verseFallbackPool, hookLines), hookLines)
  const verseTwo = balanceVerseSection(ensureVerseDensity(ensureVerseHighlight(
    skeleton.verse_two_lines,
    skeleton.highlight_bars[1] ?? skeleton.highlight_bars[0] ?? hookLines[0] ?? sourceLines[0],
    skeleton.minimum_unique_verse_lines,
    [...verseFallbackPool.slice().reverse(), ...verseFallbackPool],
    [...hookLines, ...verseOne],
  ), verseTarget, verseFallbackPool, [...hookLines, ...verseOne]), hookLines)
  const preHookLines = takeDistinctLines(
    [
      ...skeleton.highlight_bars,
      ...compositePool,
      ...verseExpansionPool,
      ...sourceLines,
    ],
    2,
    [...hookLines, ...verseOne, ...verseTwo],
    4,
  )
  const bridgeLines = takeDistinctLines(
    [
      ...compositePool.slice().reverse(),
      ...verseExpansionPool.slice().reverse(),
      ...sourceLines.slice().reverse(),
      ...skeleton.verse_lines.slice().reverse(),
    ],
    2,
    [...hookLines, ...verseOne, ...verseTwo],
    4,
  )
  const outroLines = takeDistinctLines(
    [...bridgeLines.slice().reverse(), ...preHookLines.slice().reverse(), ...sourceLines.slice().reverse()],
    1,
    [...hookLines, ...verseOne, ...verseTwo, ...bridgeLines],
    4,
  )

  const sectionPools = {
    Hook: hookLines,
    'Verse 1': verseOne,
    'Verse 2': verseTwo,
    'Pre-Hook': preHookLines,
    Bridge: bridgeLines,
    Outro: outroLines,
  } as const
  const sectionTargets = planSectionTargets(skeleton, sectionPools)

  return skeleton.structure
    .flatMap((label) => {
      const pool = sectionPools[label as keyof typeof sectionPools] ?? []
      const target = sectionTargets[label] ?? pool.length
      return pool.slice(0, target).map((line) => `${label}: ${sanitizeLine(line)}`)
    })
    .filter(Boolean)
}

function planSectionTargets(
  skeleton: StructureSkeleton,
  sectionPools: {
    Hook: string[]
    'Verse 1': string[]
    'Verse 2': string[]
    'Pre-Hook': string[]
    Bridge: string[]
    Outro: string[]
  },
) {
  const sectionOccurrences = new Map<string, number>()
  for (const label of skeleton.structure) {
    sectionOccurrences.set(label, (sectionOccurrences.get(label) ?? 0) + 1)
  }

  const targets = new Map<string, number>([
    ['Hook', Math.min(sectionPools.Hook.length, sectionPools.Hook.length >= 3 && sectionOccurrences.get('Hook') === 1 ? 3 : 2)],
    ['Verse 1', Math.min(sectionPools['Verse 1'].length, Math.max(skeleton.minimum_unique_verse_lines, sectionPools['Verse 1'].length))],
    ['Verse 2', Math.min(sectionPools['Verse 2'].length, Math.max(skeleton.minimum_unique_verse_lines, sectionPools['Verse 2'].length))],
    ['Pre-Hook', Math.min(sectionPools['Pre-Hook'].length, 2)],
    ['Bridge', Math.min(sectionPools.Bridge.length, 2)],
    ['Outro', Math.min(sectionPools.Outro.length, 1)],
  ])

  const minimums = new Map<string, number>([
    ['Hook', sectionOccurrences.get('Hook') ? 2 : 0],
    ['Verse 1', sectionOccurrences.get('Verse 1') ? skeleton.minimum_unique_verse_lines : 0],
    ['Verse 2', sectionOccurrences.get('Verse 2') ? skeleton.minimum_unique_verse_lines : 0],
    ['Pre-Hook', sectionOccurrences.get('Pre-Hook') ? 1 : 0],
    ['Bridge', sectionOccurrences.get('Bridge') ? 1 : 0],
    ['Outro', sectionOccurrences.get('Outro') ? 1 : 0],
  ])

  const totalLines = () =>
    Array.from(sectionOccurrences.entries()).reduce(
      (sum, [label, count]) => sum + (targets.get(label) ?? 0) * count,
      0,
    )

  const shrinkOrder = ['Pre-Hook', 'Bridge', 'Verse 2', 'Verse 1', 'Hook']
  const growOrder = ['Verse 1', 'Verse 2', 'Bridge', 'Pre-Hook', 'Hook']
  const [, maximum] = skeleton.target_line_range
  const [minimum] = skeleton.target_line_range

  while (totalLines() > maximum) {
    const candidate = shrinkOrder.find((label) => (targets.get(label) ?? 0) > (minimums.get(label) ?? 0))
    if (!candidate) {
      break
    }
    targets.set(candidate, Math.max(minimums.get(candidate) ?? 0, (targets.get(candidate) ?? 0) - 1))
  }

  while (totalLines() < minimum) {
    const candidate = growOrder.find((label) => {
      const current = targets.get(label) ?? 0
      const poolLimit = sectionPools[label as keyof typeof sectionPools]?.length ?? 0
      return current < poolLimit
    })
    if (!candidate) {
      break
    }
    targets.set(candidate, (targets.get(candidate) ?? 0) + 1)
  }

  return Object.fromEntries(targets.entries())
}

function sanitizeLine(line: string) {
  return line
    .replace(/^locked extraction material:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitSourceClauses(line: string) {
  return fuzzyUnique(
    line
      .split(/\s*,\s*|\s*\/\s*|\s+-\s+|\s+and\s+|\s+but\s+|\s+before\s+|\s+after\s+|\s+while\s+|\s+with\s+/i)
      .map((clause) => clause.trim())
      .filter(Boolean),
  )
}

function expandArrangementFragments(line: string) {
  const words = line.split(/\s+/).filter(Boolean)
  if (words.length <= 6) {
    return isUsableFragment(line) ? [line] : []
  }

  const first = words.slice(0, Math.min(6, words.length)).join(' ')
  const middleStart = Math.max(0, Math.floor(words.length / 2) - 3)
  const middle = words.slice(middleStart, Math.min(words.length, middleStart + 6)).join(' ')
  const last = words.slice(Math.max(0, words.length - 6)).join(' ')

  return fuzzyUnique([line, first, middle, last].filter((fragment) => isUsableFragment(fragment)))
}

function canRecoverWithDeterministicArrangement(errors: string[]) {
  return errors.some((error) =>
    /Too many invented connective lines|Arrangement too thin|Versions too similar|Hook reuse too weak|Compression too high|Structural richness too low|Section repetition too high|Source coverage too low|Repetition density too high|Verse duplication too high/i.test(error),
  )
}

function isUsableFragment(line: string) {
  const words = line.split(/\s+/).filter(Boolean)
  const firstWord = words[0]?.toLowerCase() ?? ''
  const lastWord = words.at(-1)?.toLowerCase() ?? ''
  if (words.length < 4) {
    return false
  }

  return (
    !/^(to|into|with|and|but|before|after|while|trying)$/i.test(firstWord) &&
    !/^(to|into|with|and|but|before|after|while|trying|make|turn|when|had|hold)$/i.test(lastWord)
  )
}

function isRecordableVerseLine(line: string) {
  const sanitized = sanitizeLine(line)
  const words = sanitized.split(/\s+/).filter(Boolean)
  const firstWord = words[0]?.toLowerCase() ?? ''
  const lastWord = words.at(-1)?.toLowerCase() ?? ''

  if (words.length < 4 || words.length > 12) {
    return false
  }

  if (/^(and|but|with|to|into|while|because|cause)$/i.test(firstWord)) {
    return false
  }

  if (/^(to|into|with|and|but|before|after|while|trying|make|turn|when|had|hold)$/i.test(lastWord)) {
    return false
  }

  return /[aeiouy]/i.test(lastWord)
}

function scoreArrangementLine(line: string) {
  const wordCount = countWords(line)
  const anchorBoost = /pain|motion|pressure|pay off|heart|dream|money|love|shadow|legacy|sauce|focused|city|warning|lesson/i.test(line) ? 4 : 0
  const contextBoost = /night|grind|broke|chest|city|future|name|rent|fit|whip/i.test(line) ? 2 : 0
  const compactBoost = wordCount >= 4 && wordCount <= 8 ? 3 : wordCount <= 12 ? 1 : 0
  const firstPersonBoost = /\b(i|my|me)\b/i.test(line) ? 1 : 0
  const endingPenalty = isUsableFragment(line) ? 0 : 3
  return anchorBoost + contextBoost + compactBoost + firstPersonBoost - endingPenalty
}

function fuzzyUnique(values: string[], threshold = 0.82) {
  const deduped: string[] = []

  for (const rawValue of values) {
    const value = rawValue.trim()
    if (!value) {
      continue
    }
    const comparable = stripSectionLabels(value).toLowerCase()
    if (!comparable) {
      continue
    }
    if (deduped.some((existing) => similarity(stripSectionLabels(existing).toLowerCase(), comparable) >= threshold)) {
      continue
    }
    deduped.push(value)
  }

  return deduped
}

function normalizeFreestyleCategory(output: JsonObject, transcript: string) {
  if (!output || typeof output !== 'object') {
    return
  }

  output.category = inferCategory(transcript)
}

function inferCategory(transcript: string) {
  if (/girl|love|heart|miss|shadow|eyes|fire|toxic/i.test(transcript)) return 'love'
  if (/money|chain|whip|fit|flash|sauce|designer|city/i.test(transcript)) return 'flex'
  if (/grind|dream|legacy|work|build|future|owed|prove/i.test(transcript)) return 'grind'
  if (/switch|scar|smoke|hate|room|slick|warning|circle/i.test(transcript)) return 'street'
  return 'pain'
}

function comparableLineSet(lyrics: string) {
  return new Set(comparableLineSequence(lyrics))
}

function stripSectionLabels(line: string) {
  return line.replace(/^[a-z][a-z0-9 -]{0,24}:\s*/i, '').trim()
}

function comparableLineSequence(lyrics: string) {
  return normalizeLyricLines(lyrics)
    .map((line) => stripSectionLabels(line).toLowerCase())
    .filter(Boolean)
}

function deriveTargetWordsPerVersion(transcriptWordCount: number, sourceRichness: number) {
  if (transcriptWordCount >= 30 || sourceRichness >= 10) return 52
  if (transcriptWordCount >= 18 || sourceRichness >= 6) return 40
  return 28
}

function deriveTargetUniqueLinesPerVersion(sourceRichness: number, transcriptWordCount: number) {
  if (transcriptWordCount >= 30 || sourceRichness >= 10) return 10
  if (transcriptWordCount >= 18 || sourceRichness >= 6) return 8
  return 6
}

function deriveTargetLineCountRange(transcriptWordCount: number, sourceRichness: number): [number, number] {
  if (transcriptWordCount >= 30 || sourceRichness >= 10) return [12, 16]
  if (transcriptWordCount >= 18 || sourceRichness >= 6) return [10, 14]
  return [8, 12]
}

function computeStructuralRichness(lyrics: string, sourceRichness: number, transcriptWordCount = 0) {
  const targetUniqueLines = deriveTargetUniqueLinesPerVersion(sourceRichness, transcriptWordCount)
  const uniqueComparableLines = new Set(comparableLineSequence(lyrics))
  return Math.min(1, uniqueComparableLines.size / targetUniqueLines)
}

function computeVersionRepetitionRatio(lyrics: string, hookPool: string[]) {
  const lines = normalizeLyricLines(lyrics)
  if (lines.length === 0) {
    return 0
  }

  const repeatedBodies: Array<{ body: string; count: number; hookAnchored: boolean }> = []
  for (const line of lines) {
    const body = stripSectionLabels(line).toLowerCase()
    if (!body) {
      continue
    }
    const existing = repeatedBodies.find((entry) => similarity(entry.body, body) >= 0.82)
    if (existing) {
      existing.count += 1
      existing.hookAnchored = existing.hookAnchored || hookPool.some((phrase) => body.includes(phrase.toLowerCase()))
      continue
    }
    repeatedBodies.push({
      body,
      count: 1,
      hookAnchored: hookPool.some((phrase) => body.includes(phrase.toLowerCase())),
    })
  }

  let repeatedUnits = 0
  for (const entry of repeatedBodies) {
    const allowance = entry.hookAnchored ? 1 : 0
    repeatedUnits += Math.max(0, entry.count - 1 - allowance)
  }

  return repeatedUnits / lines.length
}

function buildLineBigrams(lines: string[]) {
  const bigrams = new Set<string>()
  for (let index = 0; index < lines.length - 1; index += 1) {
    bigrams.add(`${lines[index]} >>> ${lines[index + 1]}`)
  }
  return bigrams
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

function extractTranscriptSlangTokens(text: string) {
  return unique(
    (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(isRecognizedSlangToken),
  )
}

function isRecognizedSlangToken(token: string) {
  return /^(?:ain't|ya|tryna|gon|gonna|wanna|nah|yeah|yo|shawty|bout|ima|finna|cause)$/i.test(token)
}

function buildNgrams(text: string, size: number) {
  const tokens = text.toLowerCase().match(/[a-z0-9']+/g) ?? []
  const grams = new Set<string>()
  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.add(tokens.slice(index, index + size).join(' '))
  }
  return grams
}

function computeTermOverlap(transcriptTerms: string[], lyrics: string) {
  if (transcriptTerms.length === 0) {
    return 1
  }
  const lyricTokens = new Set(lyrics.toLowerCase().match(/[a-z0-9']+/g) ?? [])
  const matched = transcriptTerms.filter((token) => lyricTokens.has(token)).length
  return matched / transcriptTerms.length
}

function inferTone(transcript: string) {
  if (/love|heart|girl|miss|shadow|tears/i.test(transcript)) return 'romantic pain'
  if (/money|chain|whip|fit|sauce|flex/i.test(transcript)) return 'confident flex'
  if (/pressure|pain|hurt|night|broke|scar/i.test(transcript)) return 'wounded pressure'
  if (/grind|dream|build|work|legacy/i.test(transcript)) return 'hungry ambition'
  return 'raw street confession'
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function stringArraySchema() {
  return {
    type: 'array',
    items: { type: 'string' },
  }
}

function parseJsonResponse(content: string) {
  const trimmed = content.trim()
  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed

  return JSON.parse(withoutFence)
}
