/* ============================================================
   JWT utilities (Web Crypto API - Cloudflare Workers native)
   ============================================================ */

import { sign, verify } from 'hono/jwt'
import type { JWTPayload } from '../types'

export const JWT_ACCESS_TTL_MS = 15 * 60 * 1000            // 15 minutes
export const JWT_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

export function generateAccessToken(
  payload: { sub: string; email: string; role: string },
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign(
    {
      ...payload,
      iat: now,
      exp: now + JWT_ACCESS_TTL_MS / 1000,
      typ: 'access',
    },
    secret,
    'HS256'
  )
}

export function generateRefreshToken(
  payload: { sub: string; email: string },
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign(
    {
      ...payload,
      iat: now,
      exp: now + JWT_REFRESH_TTL_MS / 1000,
      typ: 'refresh',
    },
    secret,
    'HS256'
  )
}

export async function verifyJWT(
  token: string,
  secret: string,
  expectedType: 'access' | 'refresh'
): Promise<JWTPayload | null> {
  try {
    const payload = await verify(token, secret, 'HS256')
    if (payload.typ !== expectedType) return null
    return payload as JWTPayload
  } catch {
    return null
  }
}