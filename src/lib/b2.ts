/* ============================================================
   Backblaze B2 (S3-compatible) — presigned upload URLs
   ------------------------------------------------------------
   Video/PDF/avatar bytes NEVER pass through the Worker. The
   browser PUTs straight to B2 with a short-lived signed URL,
   then tells the API which object key to attach to its user.
   ============================================================ */

import { AwsClient } from 'aws4fetch'

export type B2Env = {
  B2_KEY_ID?: string
  B2_APP_KEY?: string
  B2_BUCKET?: string
  B2_ENDPOINT?: string
  B2_REGION?: string
}

/** True when every credential needed to talk to B2 is present. */
export function b2Configured(env: B2Env): boolean {
  return Boolean(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET && env.B2_ENDPOINT)
}

function clientFor(env: B2Env): AwsClient {
  return new AwsClient({
    accessKeyId: env.B2_KEY_ID!,
    secretAccessKey: env.B2_APP_KEY!,
    service: 's3',
    region: env.B2_REGION || 'us-west-004',
  })
}

/** Public https URL for an object key (bucket must allow public reads or a CDN rule). */
export function b2PublicUrl(env: B2Env, key: string): string {
  return `https://${env.B2_ENDPOINT}/${env.B2_BUCKET}/${key}`
}

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024 // 5 MB — avatars only
/** How long a presigned upload URL stays valid (seconds). */
export const AVATAR_URL_EXPIRY_SECONDS = 300
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export function avatarTypeAllowed(contentType: string): boolean {
  return ALLOWED_AVATAR_TYPES.has((contentType || '').split(';')[0].trim())
}

export function avatarExtFor(contentType: string): string {
  switch ((contentType || '').split(';')[0].trim()) {
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    case 'image/avif': return 'avif'
    default: return 'jpg'
  }
}

/**
 * Short-lived presigned PUT URL for one object under avatars/<userId>/.
 * The browser uploads the raw file bytes with a plain fetch(url, {PUT}).
 */
export async function presignAvatarUpload(
  env: B2Env,
  userId: string,
  contentType: string
): Promise<{ uploadUrl: string; publicUrl: string; key: string; expiresIn: number }> {
  const ext = avatarExtFor(contentType)
  const key = `avatars/${userId}-${crypto.randomUUID()}.${ext}`
  const objectUrl = b2PublicUrl(env, key)
  // aws4fetch only honours a pre-set X-Amz-Expires query parameter — a request
  // header of that name is silently dropped, leaving the default 24h window.
  const presignTarget = new URL(objectUrl)
  presignTarget.searchParams.set('X-Amz-Expires', String(AVATAR_URL_EXPIRY_SECONDS))
  const signed = await clientFor(env).sign(
    new Request(presignTarget.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    }),
    { aws: { signQuery: true } }
  )
  return { uploadUrl: signed.url, publicUrl: objectUrl, key, expiresIn: AVATAR_URL_EXPIRY_SECONDS }
}

/**
 * Short-lived presigned GET URL — the ONLY way a private bucket serves reads.
 * The UI must refresh this when it expires (track expiresIn / expires_at);
 * a bare object URL 403s on a private bucket.
 */
export async function presignAvatarDownload(
  env: B2Env,
  publicUrl: string
): Promise<{ downloadUrl: string; expiresIn: number; expiresAtMs: number }> {
  const target = new URL(publicUrl)
  // Same rule as uploads: the expiry must live in the query string.
  target.searchParams.set('X-Amz-Expires', String(AVATAR_URL_EXPIRY_SECONDS))
  const signed = await clientFor(env).sign(
    new Request(target.toString(), { method: 'GET' }),
    { aws: { signQuery: true } }
  )
  return {
    downloadUrl: signed.url,
    expiresIn: AVATAR_URL_EXPIRY_SECONDS,
    expiresAtMs: Date.now() + AVATAR_URL_EXPIRY_SECONDS * 1000,
  }
}

/** Object key for a stored public URL (asserts it belongs to this bucket). */
export function keyFromPublicUrl(env: B2Env, publicUrl: string): string | null {
  const prefix = `https://${env.B2_ENDPOINT}/${env.B2_BUCKET}/`
  return publicUrl.startsWith(prefix) ? publicUrl.slice(prefix.length) : null
}

/**
 * PUT object bytes to B2 from inside the Worker (server-side, no CORS).
 * Used for small payloads like avatars — the bytes stream through instead of
 * being buffered, so the 128 MB isolate limit is never a concern here.
 */
export async function putAvatarObject(
  env: B2Env,
  userId: string,
  contentType: string,
  body: ReadableStream | ArrayBuffer | string,
  contentLength: number
): Promise<{ publicUrl: string; key: string }> {
  const ext = avatarExtFor(contentType)
  const key = `avatars/${userId}-${crypto.randomUUID()}.${ext}`
  const objectUrl = b2PublicUrl(env, key)
  const signed = await clientFor(env).sign(
    new Request(objectUrl, { method: 'PUT' }),
    { aws: { signQuery: true } }
  )
  const res = await fetch(signed.url, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType, 'Content-Length': String(contentLength) },
    // @ts-expect-error duplex is required when streaming a request body
    duplex: 'half',
  })
  if (!res.ok) {
    throw new Error(`B2 PUT failed: ${res.status} ${await res.text().catch(() => '')}`)
  }
  return { publicUrl: objectUrl, key }
}