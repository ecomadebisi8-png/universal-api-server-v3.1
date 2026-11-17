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
import { ensureAuthTables } from './lib/db'

import health from './routes/health'
import auth from './routes/auth'
import apiKeys from './routes/api-keys'
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
app.use('*', prettyJSON())
app.use('*', rateLimitMiddleware())
app.use('*', requestLogMiddleware)

// Idempotent table bootstrap on cold start (endpoints also self-heal)
app.use('*', async (c, next) => {
  try {
    await ensureAuthTables(c.env.DB)
  } catch {
    // best effort only
  }
  await next()
})

app.onError((err, c) => {
  console.error('[API ERROR]', err)
  return c.json({ error: 'Internal Server Error', message: err instanceof Error ? err.message : String(err) }, 500)
})

app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404))

// Route mounting
app.route('/', health)
app.route('/api/v1/auth', auth)
app.route('/api/v1/auth/api-keys', apiKeys)
app.route('/api/v1/project-alpha', projectAlpha)
app.route('/api/v1/project-beta', projectBeta)
app.route('/api/v1/db', database)

export default app