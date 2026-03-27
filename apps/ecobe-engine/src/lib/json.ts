import { Prisma } from '@prisma/client'
import type { InputJsonValue, JsonValue } from '@prisma/client/runtime/library'

type PrismaJsonNull = (typeof Prisma.JsonNullValueInput)['JsonNull']

const JSON_NULL: PrismaJsonNull = Prisma.JsonNullValueInput.JsonNull

export type JsonInput = InputJsonValue | PrismaJsonNull

export const toInputJson = (value: unknown): JsonInput => {
  if (value === undefined || value === null) {
    return JSON_NULL
  }

  return JSON.parse(JSON.stringify(value)) as InputJsonValue
}

export const parseJsonRecord = <T extends Record<string, unknown>>(
  value: JsonValue | PrismaJsonNull | null | undefined,
  fallback: T = {} as T
): T => {
  if (value && value !== JSON_NULL && typeof value === 'object' && !Array.isArray(value)) {
    return value as T
  }

  return fallback
}
