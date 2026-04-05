import { prisma } from '@/lib/prisma'
import { json } from '@/lib/http'
import { getEngineHealth } from '@/lib/engine'
import { getSekedHealth } from '@/lib/seked'
import { getConvergeosHealth } from '@/lib/convergeos'
import { getExecutionHealth } from '@/lib/execution'
import { governanceFallbackAllowed } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  let database = false

  try {
    await prisma.$queryRaw`SELECT 1`
    database = true
  } catch {
    database = false
  }

  const [engine, seked, convergeos, execution] = await Promise.all([
    getEngineHealth(),
    getSekedHealth(),
    getConvergeosHealth(),
    Promise.resolve(getExecutionHealth()),
  ])

  const ready =
    database &&
    ['healthy', 'not_configured'].includes(engine.status) &&
    execution.status === 'healthy' &&
    (seked.status === 'healthy' ||
      (seked.status === 'not_configured' && governanceFallbackAllowed())) &&
    (convergeos.status === 'healthy' ||
      (convergeos.status === 'not_configured' && governanceFallbackAllowed()))

  return json({
    status: ready ? 'ready' : 'degraded',
    checks: {
      database,
      engine,
      execution,
      seked,
      convergeos,
    },
  }, { status: ready ? 200 : 503 })
}
