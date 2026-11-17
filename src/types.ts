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
}

export type Variables = {
  user?: JWTPayload
  apiKey?: {
    id: string
    name: string
    permissions: string[]
  }
}