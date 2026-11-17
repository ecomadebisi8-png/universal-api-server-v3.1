/* ============================================================
   Request logging middleware
   ============================================================ */

import { logRequest } from '../lib/db'

export async function requestLogMiddleware(c: any, next: any) {
  await next()
  const status = c.res.status
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('x-real-ip') ?? 'unknown'
  const endpoint = c.req.path
  const method = c.req.method
  const user = c.get('user')
  const apiKey = c.get('apiKey')

  try {
    await logRequest(c.env.DB, endpoint, method, ip, status, user?.sub, apiKey?.id)
  } catch {
    // Logging failures are non-fatal
  }
}