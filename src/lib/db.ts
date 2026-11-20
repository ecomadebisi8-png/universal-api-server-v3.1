/* ============================================================
   Database helpers (D1)
   ============================================================ */

export async function ensureAuthTables(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run()

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id    TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run()

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email      TEXT NOT NULL COLLATE NOCASE,
      code_hash  TEXT NOT NULL DEFAULT '',
      attempts   INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run()

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id     TEXT,
      name        TEXT NOT NULL,
      key_hash    TEXT NOT NULL UNIQUE,
      permissions TEXT NOT NULL DEFAULT '[]',
      last_used   TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT
    )
  `).run()

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS api_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint   TEXT NOT NULL,
      method     TEXT NOT NULL,
      ip         TEXT NOT NULL,
      user_id    TEXT,
      api_key_id TEXT,
      status     INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run()

  // Items table (existing)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run()

  // v3 migration: api_keys gains an owning user (safe to re-run - error ignored if present)
  try {
    await db.prepare(`ALTER TABLE api_keys ADD COLUMN user_id TEXT`).run()
  } catch {
    // column already exists on a v3 database
  }

  // v3.1 migrations: OTP codes move from plaintext to salted hashes + attempt counter
  try {
    await db.prepare(`ALTER TABLE otp_codes ADD COLUMN code_hash TEXT NOT NULL DEFAULT ''`).run()
  } catch {
    // column already exists on a v3.1 database
  }
  try {
    await db.prepare(`ALTER TABLE otp_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`).run()
  } catch {
    // column already exists on a v3.1 database
  }
  // Drop the legacy plaintext column: it is NOT NULL with no default, which
  // breaks inserts once rows only carry code_hash. (Fresh DBs never create it.)
  try {
    await db.prepare(`ALTER TABLE otp_codes DROP COLUMN code`).run()
  } catch {
    // column already dropped (or never existed on a fresh v3.1 database)
  }

  // Rate limit counters (per-IP, per-minute window)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      ip           TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count        INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (ip, window_start)
    )
  `).run()

  // Indexes
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_otp_codes_expires ON otp_codes(expires_at)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_logs(created_at)`).run()
}

let bootstrapPromise: Promise<void> | null = null

/**
 * ensureAuthTables memoized per isolate. Every request previously ran ~13 D1
 * write statements before serving; now it's once per cold start. A failed
 * bootstrap resets the memo so the next request retries.
 */
export function ensureAuthTablesOnce(db: D1Database): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = ensureAuthTables(db).catch((e) => {
      bootstrapPromise = null
      throw e
    })
  }
  return bootstrapPromise
}

/* -- Row types -- */

export type UserRow = { id: string; email: string; password_hash: string; role: string }
export type RefreshTokenRow = { user_id: string; expires_at: string }
export type OtpRow = { id: string; expires_at: string; used: number; attempts: number }
export type ApiKeyRow = {
  id: string
  user_id: string | null
  name: string
  key_hash: string
  permissions: string | string[]
  expires_at: string | null
}

/* -- Users -- */

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return await db.prepare(`SELECT id, email, password_hash, role FROM users WHERE email = ?`).bind(email).first<UserRow>()
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return await db.prepare(`SELECT id, email, password_hash, role FROM users WHERE id = ?`).bind(id).first<UserRow>()
}

export async function createUser(db: D1Database, email: string, passwordHash: string, role = 'user'): Promise<string> {
  const res = await db.prepare(
    `INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?) RETURNING id`
  ).bind(email, passwordHash, role).first<{ id: string }>()
  return (res as { id: string }).id
}

export async function updateUserPassword(db: D1Database, userId: string, passwordHash: string) {
  await db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).bind(passwordHash, userId).run()
}

/* -- Refresh tokens -- */

export async function storeRefreshToken(db: D1Database, userId: string, tokenHash: string, expiresAt: string) {
  await db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
  ).bind(userId, tokenHash, expiresAt).run()
}

export async function getRefreshToken(db: D1Database, tokenHash: string): Promise<RefreshTokenRow | null> {
  return await db.prepare(`SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash = ?`).bind(tokenHash).first<RefreshTokenRow>()
}

export async function deleteRefreshToken(db: D1Database, tokenHash: string) {
  await db.prepare(`DELETE FROM refresh_tokens WHERE token_hash = ?`).bind(tokenHash).run()
}

export async function deleteAllUserRefreshTokens(db: D1Database, userId: string) {
  await db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).bind(userId).run()
}

/* -- OTP codes -- */

export async function storeOTP(db: D1Database, email: string, codeHash: string, expiresAt: string) {
  await db.prepare(`UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0`).bind(email).run()
  await db.prepare(
    `INSERT INTO otp_codes (email, code_hash, expires_at) VALUES (?, ?, ?)`
  ).bind(email, codeHash, expiresAt).run()
}

export async function verifyOTP(db: D1Database, email: string, codeHash: string): Promise<OtpRow | null> {
  return await db.prepare(
    `SELECT id, expires_at, used, attempts FROM otp_codes WHERE email = ? AND code_hash = ? AND used = 0 ORDER BY created_at DESC LIMIT 1`
  ).bind(email, codeHash).first<OtpRow>()
}

/** Count a failed verify attempt; after OTP_MAX_ATTEMPTS the code is dead. */
export async function bumpOtpAttempts(db: D1Database, email: string) {
  await db.prepare(
    `UPDATE otp_codes SET attempts = attempts + 1
     WHERE email = ? AND used = 0 AND id = (
       SELECT id FROM otp_codes WHERE email = ? AND used = 0 ORDER BY created_at DESC LIMIT 1
     )`
  ).bind(email, email).run()
  await db.prepare(
    `UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0 AND attempts >= 5`
  ).bind(email).run()
}

export async function markOTPUsed(db: D1Database, otpId: string) {
  await db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).bind(otpId).run()
}

/* -- API keys -- */

export async function createApiKeyRow(
  db: D1Database,
  userId: string,
  name: string,
  keyHash: string,
  permissions: string[],
  expiresAt?: string | null
) {
  const res = await db.prepare(
    `INSERT INTO api_keys (user_id, name, key_hash, permissions, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(userId, name, keyHash, JSON.stringify(permissions), expiresAt ?? null).run()
  return res.meta?.last_row_id
}

export async function listApiKeyRows(db: D1Database, userId: string) {
  const { results } = await db.prepare(
    `SELECT id, name, permissions, last_used, created_at, expires_at
     FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(userId).all()
  return results ?? []
}

export async function getApiKeyByHash(db: D1Database, keyHash: string): Promise<ApiKeyRow | null> {
  return await db.prepare(`SELECT id, user_id, name, key_hash, permissions, expires_at FROM api_keys WHERE key_hash = ?`).bind(keyHash).first<ApiKeyRow>()
}

export async function updateApiKeyLastUsed(db: D1Database, keyId: string) {
  await db.prepare(`UPDATE api_keys SET last_used = datetime('now') WHERE id = ?`).bind(keyId).run()
}

export async function revokeApiKeyRow(db: D1Database, keyId: string, userId: string) {
  const res = await db.prepare(`DELETE FROM api_keys WHERE id = ? AND user_id = ?`).bind(keyId, userId).run()
  return res.meta?.changes ?? 0
}

/* -- Housekeeping (scheduled cleanup) -- */

export async function pruneOldData(db: D1Database, logRetentionDays = 30) {
  const logResult = await db.prepare(
    `DELETE FROM api_logs WHERE created_at < datetime('now', ?)`
  ).bind(`-${logRetentionDays} days`).run()

  const nowMs = Date.now()
  const rateResult = await db.prepare(
    `DELETE FROM rate_limits WHERE window_start < ?`
  ).bind(nowMs - 24 * 60 * 60 * 1000).run()

  const otpResult = await db.prepare(
    `DELETE FROM otp_codes WHERE created_at < datetime('now', '-1 day')`
  ).run()

  return {
    api_logs_deleted: logResult.meta?.changes ?? 0,
    rate_limits_deleted: rateResult.meta?.changes ?? 0,
    otp_codes_deleted: otpResult.meta?.changes ?? 0,
  }
}

/* -- Request log -- */

export async function logRequest(db: D1Database, endpoint: string, method: string, ip: string, status: number, userId?: string, apiKeyId?: string) {
  try {
    await db.prepare(
      `INSERT INTO api_logs (endpoint, method, ip, user_id, api_key_id, status) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(endpoint, method, ip, userId ?? null, apiKeyId ?? null, status).run()
  } catch {
    // Logging should never break the request
  }
}