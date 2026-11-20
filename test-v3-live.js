/* v3.1 live test suite - run against the deployed worker */
const BASE = process.argv[2] || 'https://universal-api-server-v3.ecomadebisi8-94e.workers.dev'
const email = `v31test_${Date.now()}@example.com`
const password = 'TestPass123!'

let pass = 0, fail = 0
const results = []

function log(name, ok, detail) {
  results.push({ name, ok, detail })
  if (ok) pass++; else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* non-json */ }
  return { status: res.status, json, headers: res.headers }
}

async function main() {
  console.log(`Testing v3.1 at ${BASE}\n`)

  // 1. Health (rich payload: version, pretty date, uptime, db ping)
  const health = await req('GET', '/')
  log('GET / health', health.status === 200 && health.json?.version === '3.1.0', `v${health.json?.version} env=${health.json?.environment}`)
  log('health has pretty date/time', !!health.json?.date && !!health.json?.time, `${health.json?.date} ${health.json?.time} (${health.json?.timezone})`)
  log('health has uptime', typeof health.json?.uptime_seconds === 'number', `${health.json?.uptime}`)
  log('health db ping', health.json?.db === 'connected', `db=${health.json?.db}`)

  // 2. Register validation
  const weak = await req('POST', '/api/v1/auth/register', { email, password: 'short' })
  log('POST register weak password -> 400', weak.status === 400, `status=${weak.status}`)
  const badEmail = await req('POST', '/api/v1/auth/register', { email: 'not-an-email', password })
  log('POST register bad email -> 400', badEmail.status === 400, `status=${badEmail.status}`)

  // 3. Register
  const reg = await req('POST', '/api/v1/auth/register', { email, password })
  log('POST register', reg.status === 201 && reg.json?.access_token, reg.json?.user?.email ?? reg.json?.error)
  const accessToken = reg.json?.access_token
  const refreshToken = reg.json?.refresh_token
  const AUTH = { Authorization: `Bearer ${accessToken}` }

  // 4. Register duplicate -> 409
  const dup = await req('POST', '/api/v1/auth/register', { email, password })
  log('POST register duplicate -> 409', dup.status === 409, `status=${dup.status}`)

  // 5. Login
  const login = await req('POST', '/api/v1/auth/login', { email, password })
  log('POST login', login.status === 200 && login.json?.access_token, login.json?.user?.email ?? login.json?.error)

  // 6. Login wrong password -> 401
  const bad = await req('POST', '/api/v1/auth/login', { email, password: 'wrong' })
  log('POST login bad password -> 401', bad.status === 401, `status=${bad.status}`)

  // 7. /me with token
  const me = await req('GET', '/api/v1/auth/me', null, AUTH)
  log('GET /me with JWT', me.status === 200 && me.json?.user?.email === email, me.json?.user?.email ?? me.json?.error)

  // 8. /me without token -> 401
  const meNo = await req('GET', '/api/v1/auth/me')
  log('GET /me no token -> 401', meNo.status === 401, `status=${meNo.status}`)

  // 9. Refresh rotates
  const ref = await req('POST', '/api/v1/auth/refresh', { refresh_token: refreshToken })
  log('POST refresh rotates', ref.status === 200 && ref.json?.access_token, ref.json?.error)

  // 10. Old refresh token is dead after rotation
  const refOld = await req('POST', '/api/v1/auth/refresh', { refresh_token: refreshToken })
  log('POST refresh old token -> 401', refOld.status === 401, `status=${refOld.status}`)

  // 11. OTP flow. Production never echoes the code; if echoed, run the full flow.
  const otp = await req('POST', '/api/v1/auth/send-otp', { email })
  const code = otp.json?.otp_code
  log('POST send-otp', otp.status === 200, code ? `code echoed (dev mode)` : 'no code echo (production-safe)')
  if (code) {
    const badOtp = await req('POST', '/api/v1/auth/verify-otp', { email, code: '000000' })
    log('POST verify-otp wrong code -> 401', badOtp.status === 401, `status=${badOtp.status}`)
    const goodOtp = await req('POST', '/api/v1/auth/verify-otp', { email, code })
    log('POST verify-otp good code', goodOtp.status === 200 && goodOtp.json?.access_token, goodOtp.json?.error)
  } else {
    const badOtp = await req('POST', '/api/v1/auth/verify-otp', { email, code: '000000' })
    log('POST verify-otp wrong code -> 401 (no leak)', badOtp.status === 401, `status=${badOtp.status}`)
    log('verify-otp positive path skipped (code not echoed in production)', true)
  }

  // 12. API keys: create, validate, list (real), revoke
  const created = await req('POST', '/api/v1/auth/api-keys', { name: 'v31-test-key', permissions: ['read', 'write'] }, AUTH)
  const plainKey = created.json?.key
  log('POST api-keys create', created.status === 201 && !!plainKey, plainKey?.slice(0, 14) + '...')

  const badPerms = await req('POST', '/api/v1/auth/api-keys', { name: 'bad', permissions: ['superuser'] }, AUTH)
  log('POST api-keys bad permissions -> 400', badPerms.status === 400, `status=${badPerms.status}`)

  const list = await req('GET', '/api/v1/auth/api-keys', null, AUTH)
  const listed = list.json?.keys ?? []
  const found = listed.find(k => k.name === 'v31-test-key')
  log('GET api-keys list real', list.status === 200 && found && !JSON.stringify(listed).includes(plainKey ?? 'zzz'), `${listed.length} key(s), hash not leaked`)

  const rev = await req('DELETE', `/api/v1/auth/api-keys/${found?.id}`, null, AUTH)
  log('DELETE api-keys revoke', rev.status === 200 && rev.json?.revoked === true, `id=${found?.id}`)
  const revAgain = await req('DELETE', `/api/v1/auth/api-keys/${found?.id}`, null, AUTH)
  log('DELETE api-keys again -> 404', revAgain.status === 404, `status=${revAgain.status}`)

  // 13. Sandbox auth gating
  const alphaNo = await req('GET', '/api/v1/project-alpha')
  log('GET project-alpha no auth -> 401', alphaNo.status === 401, `status=${alphaNo.status}`)
  const alphaYes = await req('GET', '/api/v1/project-alpha', null, AUTH)
  log('GET project-alpha with JWT', alphaYes.status === 200 && alphaYes.json?.project === 'alpha', alphaYes.json?.error)

  // 14. DB items CRUD (now auth-protected)
  const itemNoAuth = await req('GET', '/api/v1/db/items')
  log('GET db/items no auth -> 401', itemNoAuth.status === 401, `status=${itemNoAuth.status}`)
  const item = await req('POST', '/api/v1/db/items', { name: `v31-item-${Date.now()}` }, AUTH)
  log('POST db/items', item.status === 201 && item.json?.created === true, `id=${item.json?.id}`)
  const badName = await req('POST', '/api/v1/db/items', { name: '' }, AUTH)
  log('POST db/items empty name -> 400', badName.status === 400, `status=${badName.status}`)
  const items = await req('GET', '/api/v1/db/items', null, AUTH)
  log('GET db/items', items.status === 200 && items.json?.count > 0, `count=${items.json?.count}`)
  const oneItem = await req('GET', `/api/v1/db/items/${item.json?.id}`, null, AUTH)
  log('GET db/items/:id', oneItem.status === 200 && oneItem.json?.item?.id, `id=${item.json?.id}`)
  const del = await req('DELETE', `/api/v1/db/items/${item.json?.id}`, null, AUTH)
  log('DELETE db/items', del.status === 200 && del.json?.deleted === true, `id=${item.json?.id}`)
  const delAgain = await req('DELETE', `/api/v1/db/items/${item.json?.id}`, null, AUTH)
  log('DELETE db/items again -> 404', delAgain.status === 404, `status=${delAgain.status}`)

  // 15. Admin module gating (owner-only)
  const adminNo = await req('GET', '/api/v1/admin/stats')
  log('GET admin/stats no token -> 401', adminNo.status === 401, `status=${adminNo.status}`)
  const adminNonOwner = await req('GET', '/api/v1/admin/stats', null, AUTH)
  log('GET admin/stats non-admin user -> 403', adminNonOwner.status === 403, `status=${adminNonOwner.status}`)
  const adminBadRole = await req('POST', '/api/v1/admin/users/x/role', { role: 'superuser' }, AUTH)
  log('POST admin role change without owner -> blocked', adminBadRole.status === 403 || adminBadRole.status === 400, `status=${adminBadRole.status}`)

  // 16. 404 handler
  const nf = await req('GET', '/nope')
  log('GET unknown path -> 404', nf.status === 404, nf.json?.path)

  // 17. Malformed JSON -> clean 400 (not a 500)
  const badJson = await fetch(BASE + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'this-is-not-json{',
  })
  log('POST malformed JSON -> 400', badJson.status === 400, `status=${badJson.status}`)

  // 18. Security headers
  const hdr = await req('GET', '/')
  log('security headers present', hdr.headers?.get('x-content-type-options') === 'nosniff' && hdr.headers?.get('x-frame-options') === 'DENY', `x-content-type-options=${hdr.headers?.get('x-content-type-options')}`)
  log('no-store on API responses', hdr.headers?.get('cache-control') === 'no-store', `cache-control=${hdr.headers?.get('cache-control')}`)

  // 19. change-password + logout-all + permission enforcement
  const wrongPw = await req('POST', '/api/v1/auth/change-password', { current_password: 'nope', new_password: 'NewPass123!' }, AUTH)
  log('POST change-password wrong current -> 401', wrongPw.status === 401, `status=${wrongPw.status}`)

  const samePw = await req('POST', '/api/v1/auth/change-password', { current_password: password, new_password: password }, AUTH)
  log('POST change-password same password -> 400', samePw.status === 400, `status=${samePw.status}`)

  const shortPw = await req('POST', '/api/v1/auth/change-password', { current_password: password, new_password: '123' }, AUTH)
  log('POST change-password too short -> 400', shortPw.status === 400, `status=${shortPw.status}`)

  const changed = await req('POST', '/api/v1/auth/change-password', { current_password: password, new_password: 'BrandNewPass1!' }, AUTH)
  const changedOk = changed.status === 200 && changed.json?.status === 'password_changed'
  log('POST change-password', changedOk, changed.json?.note ?? changed.json?.error)
  if (changedOk) {
    // old password must fail now
    const oldLogin = await req('POST', '/api/v1/auth/login', { email, password })
    log('login with old password -> 401', oldLogin.status === 401, `status=${oldLogin.status}`)
    // refresh tokens were revoked by the password change
    const refAfterChange = await req('POST', '/api/v1/auth/refresh', { refresh_token: refreshToken })
    log('refresh after password change -> 401', refAfterChange.status === 401, `status=${refAfterChange.status}`)
  }

  const logoutAll = await req('POST', '/api/v1/auth/logout-all', null, AUTH)
  log('POST logout-all', logoutAll.status === 200 && logoutAll.json?.status === 'logged_out_everywhere', logoutAll.json?.status)

  // Readonly key: GET ok, POST forbidden
  const roKeyCreated = await req('POST', '/api/v1/auth/api-keys', { name: 'readonly-key', permissions: ['read'] }, AUTH)
  const roKey = roKeyCreated.json?.key
  log('POST api-keys create readonly', roKeyCreated.status === 201, roKey?.slice(0, 14))
  if (roKey) {
    const roGet = await req('GET', '/api/v1/project-alpha', null, { 'X-API-Key': roKey })
    log('readonly key GET -> 200', roGet.status === 200, `status=${roGet.status}`)
    const roPost = await req('POST', '/api/v1/project-alpha/items', { name: 'x' }, { 'X-API-Key': roKey })
    log('readonly key POST -> 403', roPost.status === 403, `status=${roPost.status}`)
    // clean up: the create response has no id, so look it up in the list
    const listAfter = await req('GET', '/api/v1/auth/api-keys', null, AUTH)
    const roRow = (listAfter.json?.keys ?? []).find(k => k.name === 'readonly-key')
    if (roRow?.id) await req('DELETE', `/api/v1/auth/api-keys/${roRow.id}`, null, AUTH)
  }

  // 20. Rate limit: parallel burst of 120 in one window -> some 429.
  //     Uses the public health endpoint (db items require auth now).
  const burst = await Promise.all(
    Array.from({ length: 120 }, () => fetch(BASE + '/').then(r => r.status).catch(() => 'ERR'))
  )
  const limited = burst.filter(s => s === 429).length
  const ok = burst.filter(s => s === 200).length
  log('rate limit trips at >100/min', limited > 0 && ok <= 100, `${ok} passed, ${limited} throttled`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1) })