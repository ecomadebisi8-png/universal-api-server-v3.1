/* ============================================================
   Universal API Server v3 — integration file
   Only wires modules together. All logic lives in:
     src/types.ts        shared types
     src/lib/            jwt, password, random, db
     src/middleware/     rate-limit, logging, auth
     src/routes/         health, auth, api-keys, project-alpha,
                         project-beta, database
   ============================================================ */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'

import type { Bindings, Variables } from './types'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { requestLogMiddleware } from './middleware/logging'
import { ensureAuthTablesOnce, pruneOldData } from './lib/db'

import health from './routes/health'
import auth from './routes/auth'
import apiKeys from './routes/api-keys'
import admin from './routes/admin'
import projectAlpha from './routes/project-alpha'
import projectBeta from './routes/project-beta'
import database from './routes/database'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// CORS: open by default (test UI needs it), lock down with CORS_ORIGINS env.
// Access-Control-Allow-Origin carries one value, so echo the request origin
// when it matches the allow-list.
app.use('*', cors({
  origin: (origin: string, c) => {
    const list: string[] = (c.env.CORS_ORIGINS ?? '').split(',').map((o: string) => o.trim()).filter(Boolean)
    if (list.length === 0) return '*'
    return list.includes(origin) ? origin : list[0]
  },
}))

app.use('*', logger())

// Never let the edge cache a dynamic API response (auth, tokens, items...).
// Caching here silently bypasses middleware like the rate limiter.
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('Cache-Control', 'no-store')
})
app.use('*', prettyJSON())
app.use('*', rateLimitMiddleware())
app.use('*', requestLogMiddleware)

// Idempotent table bootstrap, once per isolate (endpoints also self-heal)
app.use('*', async (c, next) => {
  try {
    await ensureAuthTablesOnce(c.env.DB)
  } catch {
    // best effort only; the memo resets so the next request retries
  }
  await next()
})

// Baseline security headers for a dynamic JSON API
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Referrer-Policy', 'no-referrer')
})

app.onError((err, c) => {
  console.error('[API ERROR]', err)
  // Never leak internals in production; the full error is in the worker logs
  const detail = c.env.ENVIRONMENT === 'production' ? undefined : (err instanceof Error ? err.message : String(err))
  return c.json({ error: 'Internal Server Error', ...(detail ? { message: detail } : {}) }, 500)
})

app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404))

// Route mounting
app.route('/', health)
app.route('/api/v1/auth', auth)
app.route('/api/v1/auth/api-keys', apiKeys)
app.route('/api/v1/admin', admin)
app.route('/api/v1/project-alpha', projectAlpha)
app.route('/api/v1/project-beta', projectBeta)
app.route('/api/v1/db', database)

// Scheduled housekeeping: prune old api_logs (30d) and stale rate-limit rows.
// Configured via [triggers] in wrangler.toml.
export default {
  fetch: app.fetch,
  async scheduled(event: any, env: Bindings, ctx: any) {
    ctx.waitUntil(
      pruneOldData(env.DB)
        .then((r) => console.log('[CRON] pruned:', JSON.stringify(r)))
        .catch((e) => console.error('[CRON] prune failed:', e instanceof Error ? e.message : String(e)))
    )
  },
}