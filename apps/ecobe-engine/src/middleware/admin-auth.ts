import type { Request, Response, NextFunction } from 'express'

import { env } from '../config/env'

export function adminGuard(req: Request, res: Response, next: NextFunction) {
  if (!env.UI_TOKEN) {
    return next()
  }

  const token = req.header('x-ecobe-admin-token') || req.header('x-admin-token')
  if (token !== env.UI_TOKEN) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid admin token',
      },
    })
  }

  return next()
}
