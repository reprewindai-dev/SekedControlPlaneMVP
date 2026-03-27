import type { NextFunction, Request, Response } from 'express'

import { env } from '../config/env'

function extractToken(req: Request) {
  const authorization = req.header('authorization')
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim()
  }

  return req.header('x-ecobe-internal-key')?.trim()
}

export function internalServiceGuard(req: Request, res: Response, next: NextFunction) {
  if (!env.ECOBE_INTERNAL_API_KEY) {
    return res.status(503).json({
      error: 'Engine internal authentication is not configured',
      code: 'ENGINE_INTERNAL_AUTH_NOT_CONFIGURED',
    })
  }

  const token = extractToken(req)
  if (!token || token !== env.ECOBE_INTERNAL_API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED_INTERNAL_CALL',
    })
  }

  return next()
}
