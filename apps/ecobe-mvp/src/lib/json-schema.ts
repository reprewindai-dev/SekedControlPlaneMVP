type JsonSchema = {
  type?: string
  enum?: unknown[]
  required?: string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
}

type ValidationResult = {
  valid: boolean
  errors: string[]
}

export function validateAgainstSchema(value: unknown, schema: JsonSchema | undefined): ValidationResult {
  if (!schema) {
    return { valid: true, errors: [] }
  }

  const errors: string[] = []
  validateNode(value, schema, '$', errors)
  return {
    valid: errors.length === 0,
    errors,
  }
}

function validateNode(value: unknown, schema: JsonSchema, path: string, errors: string[]) {
  if (schema.enum && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    errors.push(`${path} must be one of: ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(', ')}`)
    return
  }

  if (schema.type) {
    const actualType = getJsonType(value)
    if (schema.type !== actualType) {
      errors.push(`${path} must be ${schema.type}, received ${actualType}`)
      return
    }
  }

  if (schema.type === 'object' && schema.properties) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in record)) {
        errors.push(`${path}.${key} is required`)
      }
    }

    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in record) {
        validateNode(record[key], childSchema, `${path}.${key}`, errors)
      }
    }
  }

  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      validateNode(item, schema.items as JsonSchema, `${path}[${index}]`, errors)
    })
  }
}

function getJsonType(value: unknown) {
  if (Array.isArray(value)) {
    return 'array'
  }

  if (value === null) {
    return 'null'
  }

  return typeof value
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (typeof left !== typeof right) {
    return false
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftEntries = Object.entries(left as Record<string, unknown>)
    const rightEntries = Object.entries(right as Record<string, unknown>)

    return (
      leftEntries.length === rightEntries.length &&
      leftEntries.every(([key, value]) => deepEqual(value, (right as Record<string, unknown>)[key]))
    )
  }

  return false
}
