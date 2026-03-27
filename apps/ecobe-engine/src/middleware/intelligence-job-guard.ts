import type { NextFunction, Request, Response } from 'express'
import { Receiver } from '@upstash/qstash'

import { env } from '../config/env'

const receiver =
  env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY
    ? new Receiver({
        currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
      })
    : null

export function intelligenceJobGuard(req: Request, res: Response, next: NextFunction) {
  const token =
    req.header('x-intelligence-job-token') ||
    req.header('x-ecobe-intel-token') ||
    req.header('authorization')?.replace(/Bearer\s+/i, '')

  if (env.INTELLIGENCE_JOB_TOKEN && token === env.INTELLIGENCE_JOB_TOKEN) {
    return next()
  }

  const signature = req.header('upstash-signature')
  const rawBody = (req as any).rawBody as string | undefined
  if (receiver && signature && rawBody) {
    try {
      receiver.verify({ signature, body: rawBody })
      return next()
    } catch (error) {
      console.warn('QStash signature verification failed', error)
    }
  }

  return res.status(401).json({
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid job authorization',
    },
  })
}
