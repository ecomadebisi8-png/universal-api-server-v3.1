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

    let row: { count: number } | null = null
    try {
      row = await c.env.DB.prepare(
        `INSERT INTO rate_limits (ip, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(ip, window_start) DO UPDATE SET count = count + 1
         RETURNING count`
      ).bind(ip, windowStart).first() as { count: number } | null
    } catch {
      // First-ever use on a fresh DB: table may not exist yet -> create + retry once
      try {
        await c.env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS rate_limits (
             ip           TEXT NOT NULL,
             window_start INTEGER NOT NULL,
             count        INTEGER NOT NULL DEFAULT 1,
             PRIMARY KEY (ip, window_start)
           )`
        ).run()
        row = await c.env.DB.prepare(
          `INSERT INTO rate_limits (ip, window_start, count) VALUES (?, ?, 1)
           ON CONFLICT(ip, window_start) DO UPDATE SET count = count + 1
           RETURNING count`
        ).bind(ip, windowStart).first() as { count: number } | null
      } catch {
        // D1 unavailable: fail open so requests still work
      }
    }

    if (row) {
      const count = row.count ?? 1
      if (count > RATE_LIMIT_MAX) {
        const retryAfter = Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000)
        return c.json({ error: 'Too many requests', retry_after: retryAfter }, 429)
      }

      // Opportunistic cleanup of stale windows (~1% of requests)
      if (Math.random() < 0.01) {
        try {
          await c.env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
            .bind(now - WINDOW_KEEP).run()
        } catch {
          // cleanup is best-effort
        }
      }
    }

    await next()
  }
}