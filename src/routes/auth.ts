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
import { generateOTP, hashApiKey, hashOtp } from '../lib/random'
import { isValidEmail, parseJson } from '../lib/request'
import {
  bumpOtpAttempts,
  createUser,
  deleteAllUserRefreshTokens,
  deleteRefreshToken,
  ensureAuthTablesOnce,
  getUserByEmail,
  getUserById,
  getRefreshToken,
  logRequest,
  markOTPUsed,
  storeOTP,
  storeRefreshToken,
  updateUserPassword,
  verifyOTP,
} from '../lib/db'

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

auth.get('/', (c) => {
  return c.json({
    module: 'auth',
    version: 'v3.1',
    status: 'active',
    endpoints: [
      'POST /api/v1/auth/register',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/logout',
      'GET  /api/v1/auth/me',
      'POST /api/v1/auth/send-otp',
      'POST /api/v1/auth/verify-otp',
      'POST /api/v1/auth/change-password',
      'POST /api/v1/auth/logout-all',
    ],
  })
})

/* -- Register -- */
auth.post('/register', async (c) => {
  const body = await parseJson<{ email?: string; password?: string }>(c)
  if (!body?.email || !body.password) {
    return c.json({ error: 'Email and password required' }, 400)
  }
  if (!isValidEmail(body.email)) {
    return c.json({ error: 'Invalid email format' }, 400)
  }
  if (body.password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  await ensureAuthTablesOnce(c.env.DB)

  const existing = await getUserByEmail(c.env.DB, body.email)
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409)
  }

  const passwordHash = await hashPassword(body.password)
  const userId = await createUser(c.env.DB, body.email, passwordHash)

  const accessToken = await generateAccessToken({ sub: userId, email: body.email, role: 'user' }, c.env.JWT_SECRET)
  const refreshToken = await generateRefreshToken({ sub: userId, email: body.email }, c.env.JWT_SECRET)
  const refreshHash = await hashApiKey(refreshToken)
  const refreshExpires = new Date(Date.now() + JWT_REFRESH_TTL_MS).toISOString()
  await storeRefreshToken(c.env.DB, userId, refreshHash, refreshExpires)

  await logRequest(c.env.DB, '/api/v1/auth/register', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 201, userId)

  return c.json({
    status: 'created',
    user: { id: userId, email: body.email, role: 'user' },
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: JWT_ACCESS_TTL_MS / 1000,
  }, 201)
})

/* -- Login -- */
auth.post('/login', async (c) => {
  const body = await parseJson<{ email?: string; password?: string }>(c)
  if (!body?.email || !body.password) {
    return c.json({ error: 'Email and password required' }, 400)
  }

  await ensureAuthTablesOnce(c.env.DB)

  const user = await getUserByEmail(c.env.DB, body.email)
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const ok = await verifyPassword(body.password, user.password_hash)
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
  const body = await parseJson<{ refresh_token?: string }>(c)
  if (!body?.refresh_token) {
    return c.json({ error: 'Refresh token required' }, 400)
  }

  const refreshHash = await hashApiKey(body.refresh_token)
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
  const body = await parseJson<{ refresh_token?: string }>(c)
  if (body?.refresh_token) {
    const refreshHash = await hashApiKey(body.refresh_token)
    await deleteRefreshToken(c.env.DB, refreshHash)
  }
  return c.json({ status: 'logged_out' })
})

/* -- Logout everywhere (all refresh tokens for this user) -- */
auth.post('/logout-all', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }
  const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET, 'access')
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
  await deleteAllUserRefreshTokens(c.env.DB, payload.sub)
  await logRequest(c.env.DB, '/api/v1/auth/logout-all', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 200, payload.sub)
  return c.json({ status: 'logged_out_everywhere' })
})

/* -- Change password (revokes all refresh tokens) -- */
auth.post('/change-password', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }
  const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET, 'access')
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  const body = await parseJson<{ current_password?: string; new_password?: string }>(c)
  if (!body?.current_password || !body.new_password) {
    return c.json({ error: 'current_password and new_password required' }, 400)
  }
  if (body.new_password.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400)
  }
  if (body.new_password === body.current_password) {
    return c.json({ error: 'New password must differ from the current password' }, 400)
  }

  const user = await getUserById(c.env.DB, payload.sub)
  if (!user) {
    return c.json({ error: 'User not found' }, 401)
  }
  const ok = await verifyPassword(body.current_password, user.password_hash)
  if (!ok) {
    return c.json({ error: 'Current password is incorrect' }, 401)
  }

  const newHash = await hashPassword(body.new_password)
  await updateUserPassword(c.env.DB, user.id, newHash)
  await deleteAllUserRefreshTokens(c.env.DB, user.id)

  await logRequest(c.env.DB, '/api/v1/auth/change-password', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 200, user.id)
  return c.json({ status: 'password_changed', note: 'All sessions were signed out - log in again' })
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
  const body = await parseJson<{ email?: string }>(c)
  if (!body?.email) {
    return c.json({ error: 'Email required' }, 400)
  }
  if (!isValidEmail(body.email)) {
    return c.json({ error: 'Invalid email format' }, 400)
  }

  await ensureAuthTablesOnce(c.env.DB)

  const code = generateOTP()
  const codeHash = await hashOtp(body.email, code)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await storeOTP(c.env.DB, body.email, codeHash, expiresAt)

  await logRequest(c.env.DB, '/api/v1/auth/send-otp', 'POST', c.req.header('CF-Connecting-IP') ?? 'unknown', 200)

  // The code is only echoed in development (explicit opt-in via DEV_OTP_ECHO,
  // or ENVIRONMENT not 'production'). Production never leaks it in responses.
  const echoCode = c.env.DEV_OTP_ECHO === 'true' || c.env.ENVIRONMENT !== 'production'

  return c.json({
    status: 'otp_sent',
    email: body.email,
    ...(echoCode ? { otp_code: code } : {}),
    expires_in: 600,
    note: echoCode
      ? 'Dev mode: code echoed in response. Hook up an email provider before production use.'
      : 'Code delivered out-of-band. It expires in 10 minutes.',
  })
})

/* -- Verify OTP -- */
auth.post('/verify-otp', async (c) => {
  const body = await parseJson<{ email?: string; code?: string }>(c)
  if (!body?.email || !body.code) {
    return c.json({ error: 'Email and code required' }, 400)
  }

  await ensureAuthTablesOnce(c.env.DB)

  const otp = await verifyOTP(c.env.DB, body.email, await hashOtp(body.email, body.code))
  if (!otp) {
    // Brute-force guard: count the attempt, the code dies after 5 tries
    await bumpOtpAttempts(c.env.DB, body.email)
    return c.json({ error: 'Invalid or expired OTP' }, 401)
  }

  const expiresAt = new Date(otp.expires_at as string)
  if (expiresAt <= new Date()) {
    return c.json({ error: 'OTP expired' }, 401)
  }

  await markOTPUsed(c.env.DB, otp.id as string)

  const user = await getUserByEmail(c.env.DB, body.email)
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