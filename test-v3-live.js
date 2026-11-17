/* v3 live test suite - run against the deployed worker */
const BASE = process.argv[2] || 'https://universal-api-server-v3.ecomadebisi8-94e.workers.dev'
const email = `v3test_${Date.now()}@example.com`
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
  return { status: res.status, json }
}

async function main() {
  console.log(`Testing v3 at ${BASE}\n`)

  // 1. Health
  const health = await req('GET', '/')
  log('GET / health', health.status === 200 && health.json?.version === '3.0.0', `v${health.json?.version} env=${health.json?.environment}`)

  // 2. Register
  const reg = await req('POST', '/api/v1/auth/register', { email, password })
  log('POST register', reg.status === 201 && reg.json?.access_token, reg.json?.user?.email ?? reg.json?.error)
  const accessToken = reg.json?.access_token
  const refreshToken = reg.json?.refresh_token

  // 3. Register duplicate -> 409
  const dup = await req('POST', '/api/v1/auth/register', { email, password })
  log('POST register duplicate -> 409', dup.status === 409, `status=${dup.status}`)

  // 4. Login
  const login = await req('POST', '/api/v1/auth/login', { email, password })
  log('POST login', login.status === 200 && login.json?.access_token, login.json?.user?.email ?? login.json?.error)

  // 5. Login wrong password -> 401
  const bad = await req('POST', '/api/v1/auth/login', { email, password: 'wrong' })
  log('POST login bad password -> 401', bad.status === 401, `status=${bad.status}`)

  // 6. /me with token
  const me = await req('GET', '/api/v1/auth/me', null, { Authorization: `Bearer ${accessToken}` })
  log('GET /me with JWT', me.status === 200 && me.json?.user?.email === email, me.json?.user?.email ?? me.json?.error)

  // 7. /me without token -> 401
  const meNo = await req('GET', '/api/v1/auth/me')
  log('GET /me no token -> 401', meNo.status === 401, `status=${meNo.status}`)

  // 8. Refresh rotates
  const ref = await req('POST', '/api/v1/auth/refresh', { refresh_token: refreshToken })
  log('POST refresh rotates', ref.status === 200 && ref.json?.access_token, ref.json?.error)

  // 9. Old refresh token is dead after rotation
  const refOld = await req('POST', '/api/v1/auth/refresh', { refresh_token: refreshToken })
  log('POST refresh old token -> 401', refOld.status === 401, `status=${refOld.status}`)

  // 10. OTP flow
  const otp = await req('POST', '/api/v1/auth/send-otp', { email })
  const code = otp.json?.otp_code
  log('POST send-otp', otp.status === 200 && !!code, `code=${code}`)
  const badOtp = await req('POST', '/api/v1/auth/verify-otp', { email, code: '000000' })
  log('POST verify-otp wrong code -> 401', badOtp.status === 401, `status=${badOtp.status}`)
  const goodOtp = code ? await req('POST', '/api/v1/auth/verify-otp', { email, code }) : { status: 0 }
  log('POST verify-otp good code', goodOtp.status === 200 && goodOtp.json?.access_token, goodOtp.json?.error)

  // 11. API keys: create, list (real), revoke
  const created = await req('POST', '/api/v1/auth/api-keys', { name: 'v3-test-key', permissions: ['read', 'write'] }, { Authorization: `Bearer ${accessToken}` })
  const plainKey = created.json?.key
  log('POST api-keys create', created.status === 201 && !!plainKey, plainKey?.slice(0, 14) + '...')
  const list = await req('GET', '/api/v1/auth/api-keys', null, { Authorization: `Bearer ${accessToken}` })
  const listed = list.json?.keys ?? []
  const found = listed.find(k => k.name === 'v3-test-key')
  log('GET api-keys list real', list.status === 200 && found && !JSON.stringify(listed).includes(plainKey ?? 'zzz'), `${listed.length} key(s), hash not leaked`)
  const rev = await req('DELETE', `/api/v1/auth/api-keys/${found?.id}`, null, { Authorization: `Bearer ${accessToken}` })
  log('DELETE api-keys revoke', rev.status === 200 && rev.json?.revoked === true, `id=${found?.id}`)
  const revAgain = await req('DELETE', `/api/v1/auth/api-keys/${found?.id}`, null, { Authorization: `Bearer ${accessToken}` })
  log('DELETE api-keys again -> 404', revAgain.status === 404, `status=${revAgain.status}`)

  // 12. Sandbox auth gating
  const alphaNo = await req('GET', '/api/v1/project-alpha')
  log('GET project-alpha no auth -> 401', alphaNo.status === 401, `status=${alphaNo.status}`)
  const alphaYes = await req('GET', '/api/v1/project-alpha', null, { Authorization: `Bearer ${accessToken}` })
  log('GET project-alpha with JWT', alphaYes.status === 200 && alphaYes.json?.project === 'alpha', alphaYes.json?.error)

  // using the revoked key should 401
  const betaRevoked = await req('GET', '/api/v1/project-beta', null, { 'X-API-Key': plainKey })
  log('GET project-beta revoked key -> 401', betaRevoked.status === 401, `status=${betaRevoked.status}`)

  // 13. DB items CRUD
  const item = await req('POST', '/api/v1/db/items', { name: `v3-item-${Date.now()}` })
  log('POST db/items', item.status === 201 && item.json?.created === true, `id=${item.json?.id}`)
  const items = await req('GET', '/api/v1/db/items')
  log('GET db/items', items.status === 200 && items.json?.count > 0, `count=${items.json?.count}`)
  const del = await req('DELETE', `/api/v1/db/items/${item.json?.id}`)
  log('DELETE db/items', del.status === 200 && del.json?.deleted === true, `id=${item.json?.id}`)

  // 14. 404 handler
  const nf = await req('GET', '/nope')
  log('GET unknown path -> 404', nf.status === 404, nf.json?.path)

  // 15. Rate limit: parallel burst of 120 in one window -> some 429.
  //     Sequential requests span multiple minute windows (slow network),
  //     so a burst is the only way to exceed 100 in a single window.
  const burst = await Promise.all(
    Array.from({ length: 120 }, () => fetch(BASE + '/api/v1/db/items').then(r => r.status).catch(() => 'ERR'))
  )
  const limited = burst.filter(s => s === 429).length
  const ok = burst.filter(s => s === 200).length
  log('rate limit trips at >100/min', limited > 0 && ok <= 100, `${ok} passed, ${limited} throttled`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1) })