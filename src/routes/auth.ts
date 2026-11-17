/* ============================================================
   Auth routes (register, login, refresh, logout, me, OTP)
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import {
  JWT_ACCESS_TTL_MS,
  JWT_REFRESH_TTL_MS,
  generateAccessToken,
  generateRefreshToken,
  verifyJWT,
} from '../lib/jwt'
import { hashPassword, verifyPassword } from '../lib/password'
import { generateOTP, hashApiKey } from '../lib/random'
import {
  createUser,
  deleteRefreshToken,
  ensureAuthTables,
  getUserByEmail,
  getUserById,
  getRefreshToken,
  logRequest,
  markOTPUsed,
  storeOTP,
  storeRefreshToken,
  verifyOTP,
} from '../lib/db'

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

auth.get('/', (c) => {
  return c.json({
    module: 'auth',
    version: 'v3',
    status: 'active',
    endpoints: [
      'POST /api/v1/auth/register',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/logout',
      'GET  /api/v1/auth/me',
      'POST /api/v1/auth/send-otp',
      'POST /api/v1/auth/verify-otp',
    ],
  })
})

/* -- Register -- */
auth.post('/register', async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>()
  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400)
  }

  await ensureAuthTables(c.env.DB)

  const existing = await getUserByEmail(c.env.DB, email)
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409)
  }

  const passwordHash = await hashPassword(password)
  const userId = await createUser(c.env.DB, email, passwordHash)

  const accessToken = await generateAccessToken({ sub: userId, email, role: 'user' }, c.env.JWT_SECRET)
  const refreshToken = await generateRefreshToken({ sub: userId, email }, c.env.JWT_SECRET)
  const refreshHash = await hashApiKey(refreshToken)
  const refreshExpires = new Date(Date.now() + JWT_REFRESH_TTL_MS).toISOString()
  await storeRefreshToken(c.env.DB, userId, refreshHash, refreshExpires)

  await logRequest(c.env.DB, '/api/v1/auth/register', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 201, userId)

  return c.json({
    status: 'created',
    user: { id: userId, email, role: 'user' },
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: JWT_ACCESS_TTL_MS / 1000,
  }, 201)
})

/* -- Login -- */
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>()
  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400)
  }

  await ensureAuthTables(c.env.DB)

  const user = await getUserByEmail(c.env.DB, email)
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const accessToken = await generateAccessToken({ sub: user.id, email: user.email, role: user.role }, c.env.JWT_SECRET)
  const refreshToken = await generateRefreshToken({ sub: user.id, email: user.email }, c.env.JWT_SECRET)
  const refreshHash = await hashApiKey(refreshToken)
  const refreshExpires = new Date(Date.now() + JWT_REFRESH_TTL_MS).toISOString()
  await storeRefreshToken(c.env.DB, user.id, refreshHash, refreshExpires)

  await logRequest(c.env.DB, '/api/v1/auth/login', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 200, user.id)

  return c.json({
    status: 'ok',
    user: { id: user.id, email: user.email, role: user.role },
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: JWT_ACCESS_TTL_MS / 1000,
  })
})

/* -- Refresh (rotates the refresh token) -- */
auth.post('/refresh', async (c) => {
  const { refresh_token } = await c.req.json<{ refresh_token?: string }>()
  if (!refresh_token) {
    return c.json({ error: 'Refresh token required' }, 400)
  }

  const refreshHash = await hashApiKey(refresh_token)
  const row = await getRefreshToken(c.env.DB, refreshHash)
  if (!row) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401)
  }

  const expiresAt = new Date(row.expires_at as string)
  if (expiresAt <= new Date()) {
    await deleteRefreshToken(c.env.DB, refreshHash)
    return c.json({ error: 'Refresh token expired' }, 401)
  }

  const user = await getUserById(c.env.DB, row.user_id as string)
  if (!user) {
    return c.json({ error: 'User not found' }, 401)
  }

  // Rotate refresh token
  await deleteRefreshToken(c.env.DB, refreshHash)
  const newRefreshToken = await generateRefreshToken({ sub: user.id, email: user.email }, c.env.JWT_SECRET)
  const newRefreshHash = await hashApiKey(newRefreshToken)
  const newRefreshExpires = new Date(Date.now() + JWT_REFRESH_TTL_MS).toISOString()
  await storeRefreshToken(c.env.DB, user.id, newRefreshHash, newRefreshExpires)

  const accessToken = await generateAccessToken({ sub: user.id, email: user.email, role: user.role }, c.env.JWT_SECRET)

  await logRequest(c.env.DB, '/api/v1/auth/refresh', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 200, user.id)

  return c.json({
    status: 'ok',
    access_token: accessToken,
    refresh_token: newRefreshToken,
    expires_in: JWT_ACCESS_TTL_MS / 1000,
  })
})

/* -- Logout -- */
auth.post('/logout', async (c) => {
  const { refresh_token } = await c.req.json<{ refresh_token?: string }>()
  if (refresh_token) {
    const refreshHash = await hashApiKey(refresh_token)
    await deleteRefreshToken(c.env.DB, refreshHash)
  }
  return c.json({ status: 'logged_out' })
})

/* -- Me (protected) -- */
auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  const payload = await verifyJWT(token, c.env.JWT_SECRET, 'access')
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  return c.json({
    status: 'ok',
    user: {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    },
  })
})

/* -- Send OTP -- */
auth.post('/send-otp', async (c) => {
  const { email } = await c.req.json<{ email?: string }>()
  if (!email) {
    return c.json({ error: 'Email required' }, 400)
  }

  await ensureAuthTables(c.env.DB)

  const code = generateOTP()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await storeOTP(c.env.DB, email, code, expiresAt)

  await logRequest(c.env.DB, '/api/v1/auth/send-otp', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 200)

  return c.json({
    status: 'otp_sent',
    email,
    otp_code: code, // Development only - remove in production
    expires_in: 600,
  })
})

/* -- Verify OTP -- */
auth.post('/verify-otp', async (c) => {
  const { email, code } = await c.req.json<{ email?: string; code?: string }>()
  if (!email || !code) {
    return c.json({ error: 'Email and code required' }, 400)
  }

  await ensureAuthTables(c.env.DB)

  const otp = await verifyOTP(c.env.DB, email, code)
  if (!otp) {
    return c.json({ error: 'Invalid or expired OTP' }, 401)
  }

  const expiresAt = new Date(otp.expires_at as string)
  if (expiresAt <= new Date()) {
    return c.json({ error: 'OTP expired' }, 401)
  }

  await markOTPUsed(c.env.DB, otp.id as string)

  const user = await getUserByEmail(c.env.DB, email)
  if (!user) {
    return c.json({ error: 'User not found' }, 401)
  }

  const accessToken = await generateAccessToken({ sub: user.id, email: user.email, role: user.role }, c.env.JWT_SECRET)
  const refreshToken = await generateRefreshToken({ sub: user.id, email: user.email }, c.env.JWT_SECRET)
  const refreshHash = await hashApiKey(refreshToken)
  const refreshExpires = new Date(Date.now() + JWT_REFRESH_TTL_MS).toISOString()
  await storeRefreshToken(c.env.DB, user.id, refreshHash, refreshExpires)

  await logRequest(c.env.DB, '/api/v1/auth/verify-otp', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 200, user.id)

  return c.json({
    status: 'ok',
    user: { id: user.id, email: user.email, role: user.role },
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: JWT_ACCESS_TTL_MS / 1000,
  })
})

export default auth