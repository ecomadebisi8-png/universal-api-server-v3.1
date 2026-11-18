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