/* ============================================================
   Rate limiting middleware (D1-backed, global across isolates)
   ============================================================ */

const RATE_LIMIT_MAX = 100
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const WINDOW_KEEP = 5 * 60 * 1000 // keep rows for 5 minutes for cleanup

/**
 * True global rate limit: per-IP counter in D1 keyed by minute window.
 * In-memory maps are per-isolate on Workers (Cloudflare spreads requests
 * across isolates), so they slow abuse but can't enforce a real cap.
 */
export function rateLimitMiddleware() {
  return async (c: any, next: any) => {
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('x-real-ip') ?? 'unknown'
    const now = Date.now()
    const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS

    try {
      const row = await c.env.DB.prepare(
        `INSERT INTO rate_limits (ip, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(ip, window_start) DO UPDATE SET count = count + 1
         RETURNING count`
      ).bind(ip, windowStart).first() as { count: number } | null

      const count = row?.count ?? 1
      if (count > RATE_LIMIT_MAX) {
        const retryAfter = Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000)
        return c.json({ error: 'Too many requests', retry_after: retryAfter }, 429)
      }

      // Opportunistic cleanup of stale windows (~1% of requests)
      if (Math.random() < 0.01) {
        await c.env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
          .bind(now - WINDOW_KEEP).run()
      }
    } catch {
      // If D1 hiccups, fail open: rate limiting must not break the API
    }

    await next()
  }
}