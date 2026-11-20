/* ============================================================
   Admin routes — OWNER-ONLY (the server owner and nobody else)

   Access requires a valid JWT access token whose email is listed in
   the ADMIN_EMAILS environment variable (comma-separated). Everyone
   else gets 401 (bad token) or 403 (valid user, not an admin).
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { verifyJWT } from '../lib/jwt'
import { ensureAuthTablesOnce, logRequest } from '../lib/db'
import { VERSION } from '../version'

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/** Parse ADMIN_EMAILS into a lowercase set. */
function adminEmails(c: any): Set<string> {
  return new Set(
    (c.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e: string) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

/** Owner guard: valid JWT access token AND email in ADMIN_EMAILS. */
async function ownerGuard(c: any, next: any) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }
  const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET, 'access')
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
  if (!adminEmails(c).has(String(payload.email).toLowerCase())) {
    await logRequest(c.env.DB, '/api/v1/admin', c.req.method, c.req.header('CF-Connecting-IP') ?? 'unknown', 403, payload.sub)
    return c.json({ error: 'Forbidden: admin access only' }, 403)
  }
  c.set('user', payload)
  await next()
}

admin.use('*', ownerGuard)

/* -- Module map -- */
admin.get('/', (c) => {
  return c.json({
    module: 'admin',
    version: `v${VERSION}`,
    status: 'owner-only',
    endpoints: [
      'GET    /api/v1/admin/me',
      'GET    /api/v1/admin/stats',
      'GET    /api/v1/admin/logs?limit=50',
      'GET    /api/v1/admin/users',
      'POST   /api/v1/admin/users/:id/role',
    ],
  })
})

/* -- Who am I (admin identity) -- */
admin.get('/me', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  return c.json({ status: 'ok', admin: { id: user.sub, email: user.email, role: user.role } })
})

/* -- Live server stats -- */
admin.get('/stats', async (c) => {
  await ensureAuthTablesOnce(c.env.DB)
  const one = (q: string) => c.env.DB.prepare(q).first<{ n: number }>()
  try {
    const [users, apiKeys, liveSessions, logs24h, items, pendingOtp, rateLimitedIps] = await Promise.all([
      one('SELECT COUNT(*) AS n FROM users'),
      one('SELECT COUNT(*) AS n FROM api_keys'),
      one("SELECT COUNT(*) AS n FROM refresh_tokens WHERE expires_at > datetime('now')"),
      one("SELECT COUNT(*) AS n FROM api_logs WHERE created_at > datetime('now', '-1 day')"),
      one('SELECT COUNT(*) AS n FROM items'),
      one("SELECT COUNT(*) AS n FROM otp_codes WHERE used = 0 AND expires_at > datetime('now')"),
      one('SELECT COUNT(DISTINCT ip) AS n FROM rate_limits'),
    ])
    return c.json({
      status: 'ok',
      server: { version: VERSION },
      counts: {
        users: users?.n ?? 0,
        api_keys: apiKeys?.n ?? 0,
        live_sessions: liveSessions?.n ?? 0,
        requests_24h: logs24h?.n ?? 0,
        items: items?.n ?? 0,
        pending_otp: pendingOtp?.n ?? 0,
        rate_limited_ips: rateLimitedIps?.n ?? 0,
      },
    })
  } catch (e) {
    return c.json({ error: 'Stats query failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})

/* -- Recent request logs -- */
admin.get('/logs', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 500)
  const { results } = await c.env.DB.prepare(
    `SELECT id, endpoint, method, ip, user_id, api_key_id, status, created_at
     FROM api_logs ORDER BY id DESC LIMIT ?`
  ).bind(limit).all()
  return c.json({ status: 'ok', logs: results ?? [], count: (results ?? []).length })
})

/* -- User list -- */
admin.get('/users', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 500)
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, role, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all()
  return c.json({ status: 'ok', users: results ?? [], count: (results ?? []).length })
})

/* -- Promote / demote a user -- */
admin.post('/users/:id/role', async (c) => {
  const id = c.req.param('id')
  let body: { role?: string } | null = null
  try {
    body = await c.req.json()
  } catch {
    /* handled below */
  }
  const role = body?.role
  if (role !== 'admin' && role !== 'user') {
    return c.json({ error: "role must be 'admin' or 'user'" }, 400)
  }

  const before = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(id).first<{ role: string }>()
  if (!before) {
    return c.json({ error: 'User not found' }, 404)
  }
  await c.env.DB.prepare('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(role, id).run()

  const actor = c.get('user')
  await logRequest(c.env.DB, '/api/v1/admin/users/:id/role', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 200, actor?.sub)

  return c.json({ status: 'role_updated', id, previous_role: before.role, role })
})

export default admin