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
  /** Backblaze B2 (S3-compatible) credentials — all are worker secrets */
  B2_KEY_ID?: string
  B2_APP_KEY?: string
  B2_BUCKET?: string
  /** S3 endpoint host, e.g. s3.us-west-004.backblazeb2.com */
  B2_ENDPOINT?: string
  /** Bucket region, e.g. us-west-004 */
  B2_REGION?: string
}

export type Variables = {
  user?: JWTPayload
  apiKey?: {
    id: string
    name: string
    permissions: string[]
  }
}