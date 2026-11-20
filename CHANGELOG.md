# Changelog — Universal API Server

All notable changes live here, newest first. Each released version is also pushed
to its own GitHub repository named by version (`universal-api-server-v3`, `…-v3.1`, …).

---

## [3.1.0] — 2026-11-20

Milestone "hardening + admin" — security fixes, big performance win, owner-only admin panel, rich health endpoint.

### Security
- **OTP codes are now hashed at rest** (salted SHA-256 per email) instead of stored in plaintext.
- **OTP codes are never echoed in production** — the dev-only `otp_code` response field is gated behind `ENVIRONMENT !== 'production'` or an explicit `DEV_OTP_ECHO` opt-in. (Previously anyone could request a code for any email and receive it in the response — a full account-takeover vector.)
- **OTP brute-force guard** — codes die after 5 failed verify attempts.
- **Production-safe error handler** — internal error messages (SQL, stack text) no longer leak in responses; full detail stays in worker logs.
- **Input validation everywhere** — email format + min-8-char password on register, permission allow-lists (`read|write|admin`) and expiry bounds on API-key creation, non-empty ≤200-char names on items.
- **`/api/v1/db/items` now requires auth** (JWT or API key) — D1 writes were previously open to the public.
- Security headers on every response: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- `.dev.vars` added to `.gitignore`; local dev secrets can no longer be committed.

### Performance
- **Table bootstrap runs once per isolate instead of on every request.** Every request previously executed ~13 `CREATE TABLE IF NOT EXISTS` + index statements against D1 before serving; now memoized per isolate with a self-healing retry on failure. Large latency and D1-billing win.

### Admin (owner-only)
- New module `src/routes/admin.ts` mounted at `/api/v1/admin`, guarded by `ADMIN_EMAILS` (currently `ecomadebisi8@gmail.com, adebisitemiloluwa8@gmail.com` — see wrangler.toml).
  - `GET /api/v1/admin/me` — admin identity.
  - `GET /api/v1/admin/stats` — users, keys, live sessions, 24h requests, items, pending OTPs, throttled IPs, version.
  - `GET /api/v1/admin/logs?limit=N` — recent request log (capped at 500).
  - `GET /api/v1/admin/users` — user list.
  - `POST /api/v1/admin/users/:id/role` — promote/demote (`admin`|`user`).
  - Non-owner tokens get **403**; no token gets **401**.

### Health
- `GET /` now returns version, environment, ISO timestamp, **pretty local date/time** (e.g. "Friday, 20 November 2026", "05:30:43 am", `Africa/Lagos`), **uptime** (e.g. `2h 14m 31s` + raw seconds), and a **D1 ping** (`db: connected|unreachable`).

### API behavior
- `DELETE /api/v1/db/items/:id` returns a real **404** when nothing was deleted.
- `POST /api/v1/auth/change-password` rejects reusing the old password (400).
- Daily cron also prunes dead OTP rows older than 1 day.
- Dead `apiKeyAuth` middleware removed; `authOrApiKey` is the single auth path.

### Ops & tooling
- `wrangler.toml`: compatibility date → 2026-01-01, observability logging enabled, `ADMIN_EMAILS` + `DISPLAY_TIMEZONE` vars.
- Version constant lives in `src/version.ts` (single source of truth).
- Test suite (`test-v3-live.js`) extended to 49 checks: validation paths, auth-gated items, admin 401/403, security headers, OTP no-leak, real 404s.

### Test results
- **49/49 passing** against production (`universal-api-server-v3.ecomadebisi8-94e.workers.dev`).
- OTP happy path + admin happy path additionally verified on a local dev server.

### Test UI (new)
- `test-ui/` folder: `index`, `status`, `auth`, `api-keys`, `sandbox`, `database`, `admin` pages + shared `assets/style.css` + `assets/app.js`.
- Dark glass theme, Chelsea-blue accents, Space Grotesk/Inter/JetBrains Mono, token session bar, live-ticking uptime, syntax-highlighted JSON console, toasts, copy/sign-out actions.
- Note: serve over http (GitHub Pages) for the session token to persist across pages; `file://` origins drop localStorage.

### Migration notes (existing D1 database)
- `ALTER TABLE otp_codes ADD COLUMN code_hash` + `attempts` — applied automatically, idempotent.
- `ALTER TABLE otp_codes DROP COLUMN code` — the legacy plaintext column is dropped (it is NOT NULL with no default and breaks inserts when rows carry only the hash).
- Existing users, refresh tokens, and API keys are untouched.

---

## [3.0.0] — 2025-11 (v3 baseline)

Modular refactor of the monolith (`index.ts` split into `lib/`, `middleware/`, `routes/`):
real API-key listing with ownership-scoped revoke, D1-backed global rate limiting,
edge-cache bypass (`no-store`), malformed-body 400s, change-password + logout-all,
API-key permission enforcement (403), daily cron housekeeping.

## [2.x] — v1/v2 lineage

Single-file Hono worker: register/login/me, JWT access+refresh rotation,
PBKDF2 password hashing, OTP endpoints, API keys, project-alpha/beta sandboxes,
D1 items CRUD, rate limiting, `test-ui.html` served via GitHub Pages.