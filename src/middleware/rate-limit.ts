/* ============================================================
   Rate limiting middleware
   ============================================================ */

const rateLimitStore = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 100
const RATE_LIMIT_WINDOW_MS = 60 * 1000

/**
 * Per-IP rate limit backed by an in-memory map.
 * Note: on Workers this is per-isolate, so it slows abuse rather than
 * guaranteeing a global cap. Swap for D1/Durable Objects when needed.
 */
export function rateLimitMiddleware() {
  return async (c: any, next: any) => {
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('x-real-ip') ?? 'unknown'
    const now = Date.now()
    const entry = rateLimitStore.get(ip)

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    } else {
      entry.count++
      if (entry.count > RATE_LIMIT_MAX) {
        return c.json({ error: 'Too many requests', retry_after: Math.ceil((entry.resetAt - now) / 1000) }, 429)
      }
    }

    await next()
  }
}