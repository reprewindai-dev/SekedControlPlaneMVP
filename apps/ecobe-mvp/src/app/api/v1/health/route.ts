import { json } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  return json({
    status: 'healthy',
    service: 'ecobe-mvp',
    timestamp: new Date().toISOString(),
  })
}
