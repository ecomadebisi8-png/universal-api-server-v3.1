/* ============================================================
   Profile module — per-user avatar via Backblaze B2 presigned URLs
   ─────────────────────────────────────────────────────────────
   Flow (bytes never touch the Worker):
     1. POST /api/v1/profile/avatar/upload-url  → { uploadUrl, publicUrl }
     2. browser: fetch(uploadUrl, { method: 'PUT', body: file })
     3. POST /api/v1/profile/avatar             → attach { publicUrl } to user
   GET /api/v1/profile/me always returns the stored avatar_url so
   every login (and every page) can render the picture.
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import {
  b2Configured,
  presignAvatarUpload,
  presignAvatarDownload,
  putAvatarObject,
  avatarTypeAllowed,
  AVATAR_MAX_BYTES,
} from '../lib/b2'
import { getUserProfile, setUserAvatar } from '../lib/db'
import { jwtAuth } from '../middleware/auth'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/** Everything in this module needs a valid user JWT. */
app.use('*', jwtAuth)

/** A short-lived signed READ url for the user's own avatar (private buckets). */
async function displayUrlFor(env: Bindings, avatarUrl: string | null) {
  if (!avatarUrl || !b2Configured(env)) return null
  try {
    return (await presignAvatarDownload(env, avatarUrl)).downloadUrl
  } catch {
    // A private bucket + stale/renamed object: fall back to no image
    return null
  }
}

/** Identity + current avatar for the logged-in user. */
app.get('/me', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Invalid or expired token' }, 401)
  const row = await getUserProfile(c.env.DB, user.sub)
  const avatar = row?.avatar_url ?? null
  return c.json({
    status: 'ok',
    user: { id: user.sub, email: user.email, role: user.role ?? 'user' },
    avatar_url: avatar,
    avatar_display_url: await displayUrlFor(c.env, avatar),
    created_at: row?.created_at ?? null,
  })
})

/** Fresh signed read url — call this when a previous display url expires. */
app.get('/avatar/display-url', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Invalid or expired token' }, 401)
  const row = await getUserProfile(c.env.DB, user.sub)
  const avatar = row?.avatar_url ?? null
  if (!avatar) return c.json({ status: 'ok', avatar_url: null, avatar_display_url: null })
  const displayUrl = await displayUrlFor(c.env, avatar)
  return c.json({ status: 'ok', avatar_url: avatar, avatar_display_url: displayUrl })
})

/** Step 1: mint a 5-minute presigned PUT URL for the user's avatar. */
app.post('/avatar/upload-url', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Invalid or expired token' }, 401)

  if (!b2Configured(c.env)) {
    return c.json({
      error: 'Storage not configured',
      message: 'B2_KEY_ID, B2_APP_KEY, B2_BUCKET and B2_ENDPOINT must be set on the worker (wrangler secret put).',
    }, 503)
  }

  const body = await c.req.json().catch(() => ({}) as any)
  const contentType: string = body?.content_type || 'image/jpeg'
  if (!avatarTypeAllowed(contentType)) {
    return c.json({
      error: 'Unsupported image type',
      allowed: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    }, 400)
  }
  if (body?.size_bytes && Number(body.size_bytes) > AVATAR_MAX_BYTES) {
    return c.json({ error: 'Image too large', max_bytes: AVATAR_MAX_BYTES }, 400)
  }

  const signed = await presignAvatarUpload(c.env, user.sub, contentType)
  return c.json({ status: 'ok', ...signed, max_bytes: AVATAR_MAX_BYTES })
})

/**
 * ONE-CALL upload: the browser POSTs the raw image here, the Worker signs a
 * PUT and streams it to B2 server-side, then attaches it to the user.
 * No browser CORS on the B2 side — the Worker talks to B2 directly.
 * (The presigned 3-step flow stays for big-file endpoints like video/PDF.)
 */
app.post('/avatar/upload', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Invalid or expired token' }, 401)
  if (!b2Configured(c.env)) {
    return c.json({
      error: 'Storage not configured',
      message: 'B2_KEY_ID, B2_APP_KEY, B2_BUCKET and B2_ENDPOINT must be set on the worker (wrangler secret put).',
    }, 503)
  }

  const contentType = (c.req.header('Content-Type') || 'image/jpeg').split(';')[0].trim()
  if (!avatarTypeAllowed(contentType)) {
    return c.json({ error: 'Unsupported image type', allowed: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] }, 400)
  }
  const declared = Number(c.req.header('Content-Length') || '0')
  if (declared > AVATAR_MAX_BYTES) {
    return c.json({ error: 'Image too large', max_bytes: AVATAR_MAX_BYTES }, 400)
  }

  const body = c.req.raw.body
  if (!body) return c.json({ error: 'Empty body — send the raw image bytes' }, 400)

  let result
  try {
    result = await putAvatarObject(c.env, user.sub, contentType, body, declared)
  } catch (e) {
    return c.json({ error: 'Upload to storage failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }

  await setUserAvatar(c.env.DB, user.sub, result.publicUrl)
  const displayUrl = await displayUrlFor(c.env, result.publicUrl)
  return c.json({ status: 'ok', avatar_url: result.publicUrl, avatar_display_url: displayUrl, key: result.key })
})

/** Step 3: attach the uploaded object's public URL to the user. */
app.post('/avatar', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Invalid or expired token' }, 401)

  const body = await c.req.json().catch(() => ({}) as any)
  const url: string = body?.avatar_url || body?.public_url || ''
  const bucket = c.env.B2_BUCKET || ''
  const endpoint = c.env.B2_ENDPOINT || ''
  // Only accept URLs that point at this deployment's own bucket
  const expectedPrefix = `https://${endpoint}/${bucket}/avatars/`
  if (!url.startsWith(expectedPrefix)) {
    return c.json({ error: 'Invalid avatar URL', expected_prefix: expectedPrefix }, 400)
  }

  await setUserAvatar(c.env.DB, user.sub, url)
  return c.json({ status: 'ok', avatar_url: url })
})

/** Remove the avatar (deletes the reference; the B2 object can outlive it). */
app.delete('/avatar', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Invalid or expired token' }, 401)
  await setUserAvatar(c.env.DB, user.sub, null)
  return c.json({ status: 'ok', avatar_url: null })
})

export default app