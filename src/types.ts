/* ============================================================
   Shared types
   ============================================================ */

export type JWTPayload = {
  sub: string
  email: string
  role?: string
  iat?: number
  exp?: number
  typ?: string
  [key: string]: unknown
}

export type Bindings = {
  DB: D1Database
  JWT_SECRET: string
  ENVIRONMENT: string
  CORS_ORIGINS?: string
  /** Explicit opt-in for leaking dev OTP codes in API responses (never set in production) */
  DEV_OTP_ECHO?: string
  /** Comma-separated owner emails allowed into /api/v1/admin */
  ADMIN_EMAILS?: string
  /** Timezone for pretty timestamps (health endpoint etc.) */
  DISPLAY_TIMEZONE?: string
}

export type Variables = {
  user?: JWTPayload
  apiKey?: {
    id: string
    name: string
    permissions: string[]
  }
}