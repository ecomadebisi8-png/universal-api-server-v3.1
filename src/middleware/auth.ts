/* ============================================================
   Auth middleware (JWT and API key)
   ============================================================ */

import { verifyJWT } from '../lib/jwt'
import { hashApiKey } from '../lib/random'
import { getApiKeyByHash, updateApiKeyLastUsed } from '../lib/db'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Does this key's permission set allow the request method? */
export function keyAllowsMethod(permissions: string[], method: string): boolean {
  const m = method.toUpperCase()
  if (permissions.includes('admin') || permissions.includes('write')) return true
  if (permissions.includes('read')) return !WRITE_METHODS.has(m)
  return false
}

/** Sets c.set('user', payload) when a valid access token is present, then continues. */
export async function jwtAuth(c: any, next: any) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    await next()
    return
  }

  const token = authHeader.slice(7)
  const payload = await verifyJWT(token, c.env.JWT_SECRET, 'access')
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  c.set('user', payload)
  await next()
}

/** Sets c.set('apiKey', ...) when a valid X-API-Key header is present, then continues. */
export async function apiKeyAuth(c: any, next: any) {
  const keyHeader = c.req.header('X-API-Key')
  if (!keyHeader) {
    await next()
    return
  }

  const keyHash = await hashApiKey(keyHeader)
  const row = await getApiKeyByHash(c.env.DB, keyHash)
  if (!row) {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  const expiresAt = row.expires_at ? new Date(row.expires_at as string) : null
  if (expiresAt && expiresAt <= new Date()) {
    return c.json({ error: 'API key expired' }, 401)
  }

  const permissions = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions as string[])

  c.set('apiKey', {
    id: row.id,
    name: row.name,
    permissions,
  })

  await updateApiKeyLastUsed(c.env.DB, row.id)
  await next()
}

/** Requires either a valid access token OR a valid API key; 401 otherwise. */
export async function authOrApiKey(c: any, next: any) {
  const authHeader = c.req.header('Authorization')
  const keyHeader = c.req.header('X-API-Key')

  if (!authHeader?.startsWith('Bearer ') && !keyHeader) {
    return c.json({ error: 'Missing Authorization header or X-API-Key' }, 401)
  }

  // Try JWT first
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const payload = await verifyJWT(token, c.env.JWT_SECRET, 'access')
    if (payload) {
      c.set('user', payload)
      await next()
      return
    }
  }

  // Try API key
  if (keyHeader) {
    const keyHash = await hashApiKey(keyHeader)
    const row = await getApiKeyByHash(c.env.DB, keyHash)
    if (!row) {
      return c.json({ error: 'Invalid API key' }, 401)
    }
    const expiresAt = row.expires_at ? new Date(row.expires_at as string) : null
    if (expiresAt && expiresAt <= new Date()) {
      return c.json({ error: 'API key expired' }, 401)
    }
    const permissions = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions as string[])

    // Enforce the key's permissions against the request method
    if (!keyAllowsMethod(permissions, c.req.method)) {
      return c.json({ error: 'Forbidden: API key lacks permission', method: c.req.method, permissions }, 403)
    }

    c.set('apiKey', { id: row.id, name: row.name, permissions })
    await updateApiKeyLastUsed(c.env.DB, row.id)
    await next()
    return
  }

  return c.json({ error: 'Unauthorized' }, 401)
}