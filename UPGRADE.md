# UPGRADE.md — Universal API Server roadmap

Ideas are grouped by target version and marked by effort/impact.
Check off items as they ship; each shipped version gets its own GitHub
repository named by the version (v3.1 → `universal-api-server-v3.1`, …)
and a CHANGELOG.md entry.

Legend: 🟢 quick win · 🟡 medium · 🔴 project · 💰 costs money (needs card/plan)
⭐ = recommended next

---

## v3.2 — Auth & emails (next)

⭐ 1. **Real OTP delivery** — wire `send-otp` to an email provider so codes
  actually reach users (currently only echoed in dev mode).
  Options: MailChannels ( Workers-native, generous free tier) · Resend · Brevo.
  🟡 + 💰 for the domain part; MailChannels itself is free.

⭐ 2. **Password reset flow** — `POST /auth/forgot` (send OTP/reset link) +
  `POST /auth/reset` (OTP + new password). Natural extension of OTP work. 🟡

3. **Email verification** — mark `email_verified` on users; block OTP login for
  unverified addresses after a grace period. 🟡

4. **Login throttling per account** — count failed logins per user (not just
  per IP); exponential backoff / CAPTCHA after 10. 🟡

5. **Session management UI data** — `GET /auth/sessions` lists live refresh
  tokens (device, created, last used); `DELETE /auth/sessions/:id` revokes one. 🟢

6. **HttpOnly cookie option** — offer cookie-based auth (CSRF-token protected)
  for browser apps that shouldn't hold tokens in JS-reachable storage. 🟡

## v3.3 — API surface & DX

7. ⭐ **OpenAPI 3.1 spec + Swagger UI** — document every endpoint, generate from
  route definitions, serve `/docs` on the worker. 🟡 huge DX win.

8. **Request/response validation with Zod** — replace hand-rolled checks with
  schemas; automatic 400s with field-level errors. 🟡

9. **Cursor pagination** — items and logs endpoints (offset pagination dies on
  D1 at scale). 🟢

10. **Filtering & sorting** — `/db/items?sort=created_at&order=desc`,
  `/admin/logs?status=429&path=…`. 🟢

11. **Rate-limit headers** — `X-RateLimit-Limit/Remaining/Reset` + `Retry-After`
  on 429s (retry_after already exists in the body). 🟢

12. **Per-route rate limits** — stricter limits on auth endpoints (10/min),
  looser on health (300/min). 🟢

13. **Idempotency keys** — `Idempotency-Key` header on POST endpoints, stored in
  D1 for 24h, replay the original response. 🟡

14. **Bulk operations** — `POST /db/items/batch` (≤100 creates in one call). 🟢

## v3.4 — Data & multi-tenancy

15. ⭐ **Per-user items** — tag items with `user_id`, scope reads/writes to the
  owner; `GET /db/items?mine=true` for admins to see all. 🟡

16. **Soft delete** — `deleted_at` column + tombstone queries for items and users. 🟢

17. **User profile endpoints** — `GET/PATCH /auth/profile` (display name, avatar,
  metadata JSON). 🟢

18. **Audit trail** — who-changed-what table for admin actions (role changes,
  revocations). 🟡

19. **Analytics rollups** — daily counters table fed by the cron; admin dashboard
  charts from `/admin/stats?range=7d`. 🟡

20. **Data export** — `GET /admin/export?type=users|items|logs` → CSV/JSON in D1. 🟢

## v3.5 — Admin superpowers

21. ⭐ **Admin dashboard HTML** — dedicated `admin.html` on GitHub Pages (or a
  `ADMIN_UI=on` route on the worker) rendering stats/logs/users live. 🟡

22. **Maintenance mode** — `ADMIN_MAINTENANCE=true` var → all writes 503 with a
  friendly body; admin endpoints stay up. 🟢

23. **Announcements/banners** — admin sets a message served at `/banner`,
  rendered by the test UI. 🟢

24. **Impersonation** — admin mints a short-lived read-only token for a user to
  debug their issues; hard-logged, self-expiring. 🟡

25. **Webhook outbox** — register webhooks (user.created, key.revoked), deliver
  with retries + signing secret. 🔴

26. **Feature flags** — per-user/per-key boolean flags from D1, checked in
  middleware. 🟡

## v4.0 — Platform thinking

27. **Multi-tenant workspaces** — orgs, members, invitations, roles
  (owner/admin/member/guest). 🔴 big schema change.

28. **OAuth2 provider** — turn the server into an identity provider:
  `/oauth/authorize`, `/oauth/token`, PKCE, client registration. 🔴

29. **Realtime** — Durable Object rooms for chat/notifications; WebSocket hub
  behind `/ws`. 🔴 (natural fit for a future messaging product.)

30. **Background jobs** — Cloudflare Queues for email sends, webhook delivery,
  exports; cron → queue → consumer split. 🟡

31. **Caching layer** — KV or Cache API for hot reads (items lists, stats),
  purged on writes. 🟡

32. **Custom domain + TLS** — put the API on a real domain (`api.yourdomain.dev`)
  instead of `*.workers.dev`. 💰 domain registration.

33. **Cloudflare Zero Trust in front** — email/OTP login gate on the worker URL
  for owner-only infra. 💰 needs a card; revisit if payments become possible.

34. **Multi-region D1 read replicas + location hints** — only worth it at scale.

---

## Cross-cutting chores (any version)

- 🟢 `CI: typecheck + test suite on push` (GitHub Actions, free for public repos).
- 🟢 `npm audit` + Dependabot.
- 🟡 Unit tests (Vitest + @cloudflare/vitest-pool-workers) — the live suite
  covers e2e; unit tests would cover pure logic (jwt, password, keyAllowsMethod).
- 🟡 Structured JSON logging (replace hono/logger) for log searchability.
- 🟡 Error tracking — Sentry or Cloudflare's Logpush to R2.
- 🟢 `GET /version` + `GET /healthz` aliases for monitoring tools.
- 🟡 Staging environment — `[env.staging]` in wrangler.toml, deploy previews
  before production.
- 🟢 `README.md` rewrite — architecture diagram, quickstart, scripts, links.

---

## Repo naming convention for releases

| Version | Repository | What it holds |
|---------|------------|---------------|
| v3 (baseline) | `universal-api-server-v3` | full source at 3.0.0 + newer |
| v3.1 | `universal-api-server-v3.1` | this release, tagged snapshot |
| v3.2 | `universal-api-server-v3.2` | next release snapshot |
| … | … | … |

Rule: the local project folder is always the newest code; when a version ships,
push a tagged snapshot to that version's repo and add the CHANGELOG entry.