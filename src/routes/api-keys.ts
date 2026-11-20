/* ============================================================
   API key routes (service-to-service)
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { jwtAuth } from '../middleware/auth'
import { generateApiKeyPlain, hashApiKey } from '../lib/random'
import { createApiKeyRow, ensureAuthTables, listApiKeyRows, logRequest, revokeApiKeyRow } from '../lib/db'
import { parseJson } from '../lib/request'

const apiKeys = new Hono<{ Bindings: Bindings; Variables: Variables }>()

apiKeys.use('*', jwtAuth)

/* -- List the caller's keys (masked - hashes never leave the DB) -- */
apiKeys.get('/', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await ensureAuthTables(c.env.DB)
  const keys = await listApiKeyRows(c.env.DB, user.sub)

  return c.json({
    status: 'ok',
    keys,
    count: keys.length,
    note: 'Plaintext keys are shown once at creation and never stored.',
  })
})

/* -- Create a key -- */
apiKeys.post('/', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await ensureAuthTables(c.env.DB)

  const body = await parseJson<{
    name?: string
    permissions?: string[]
    expires_in_days?: number
  }>(c)
  const { name, permissions, expires_in_days } = body ?? {}

    if (name !== undefined && (typeof name !== 'string' || name.length > 100)) {
      return c.json({ error: 'name must be a string of 100 characters or fewer' }, 400)
    }
    if (permissions !== undefined) {
      if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== 'string' || p.length > 32)) {
        return c.json({ error: 'permissions must be an array of short strings' }, 400)
      }
      if (!permissions.every((p) => ['read', 'write', 'admin'].includes(p))) {
        return c.json({ error: "permissions may only contain 'read', 'write', or 'admin'" }, 400)
      }
    }
    if (expires_in_days !== undefined && (!Number.isInteger(expires_in_days) || expires_in_days < 1 || expires_in_days > 365)) {
      return c.json({ error: 'expires_in_days must be an integer between 1 and 365' }, 400)
    }

    const plainKey = generateApiKeyPlain()
    const keyHash = await hashApiKey(plainKey)
    const perms = permissions ?? ['read']
    const expiresAt = expires_in_days ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000).toISOString() : null

  await createApiKeyRow(c.env.DB, user.sub, name ?? 'unnamed-key', keyHash, perms, expiresAt)

  await logRequest(c.env.DB, '/api/v1/auth/api-keys', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 201, user.sub)

  return c.json({
    status: 'created',
    name: name ?? 'unnamed-key',
    key: plainKey,
    permissions: perms,
    expires_at: expiresAt,
    warning: 'Save this key now. It cannot be recovered again.',
  }, 201)
})

/* -- Revoke a key (only the owner can revoke) -- */
apiKeys.delete('/:id', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const id = c.req.param('id')
  const changes = await revokeApiKeyRow(c.env.DB, id, user.sub)
  await logRequest(c.env.DB, '/api/v1/auth/api-keys/:id', 'DELETE', c.req.header('CF-Connecting-IP') ?? 'unknown', changes > 0 ? 200 : 404, user.sub)

  if (!changes) {
    return c.json({ status: 'not_found', id, revoked: false }, 404)
  }
  return c.json({ status: 'revoked', id, revoked: true })
})

export default apiKeys