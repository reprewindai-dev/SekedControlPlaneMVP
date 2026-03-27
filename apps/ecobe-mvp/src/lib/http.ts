export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init)
}

export function badRequest(message: string, details?: unknown) {
  return json({ error: message, details }, { status: 400 })
}

export function unauthorized(message = 'Unauthorized') {
  return json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden') {
  return json({ error: message }, { status: 403 })
}

export function notFound(message = 'Not found') {
  return json({ error: message }, { status: 404 })
}
