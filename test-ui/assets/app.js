/* ============================================================
   Universal API Server v3.1 — Test UI shared engine
   Token store (localStorage), request helper, response console,
   toasts, JSON syntax highlighting. Injected on every page.
   ============================================================ */

const API_DEFAULT = 'https://universal-api-server-v3.ecomadebisi8-94e.workers.dev'

const Store = {
  get base() { return localStorage.getItem('uas_base') || API_DEFAULT },
  set base(v) { localStorage.setItem('uas_base', v.replace(/\/+$/, '')) },
  get token() { return localStorage.getItem('uas_token') || '' },
  set token(v) { localStorage.setItem('uas_token', v) },
  get refresh() { return localStorage.getItem('uas_refresh') || '' },
  set refresh(v) { localStorage.setItem('uas_refresh', v) },
  get email() { return localStorage.getItem('uas_email') || '' },
  set email(v) { localStorage.setItem('uas_email', v) },
  get apiKey() { return localStorage.getItem('uas_api_key') || '' },
  set apiKey(v) { localStorage.setItem('uas_api_key', v) },
  get avatar() { return localStorage.getItem('uas_avatar') || '' },
  set avatar(v) {
    if (v) localStorage.setItem('uas_avatar', v)
    else localStorage.removeItem('uas_avatar')
  },
  clearSession() {
    localStorage.removeItem('uas_token')
    localStorage.removeItem('uas_refresh')
    localStorage.removeItem('uas_email')
  },
}

/** Escape HTML for safe injection into the console (numeric entities). */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (m) => '&#' + m.charCodeAt(0) + ';')
}

/**
 * Pretty-print JSON with syntax colours.
 * Tokens are escaped individually (never pre-escape the whole string:
 * that would double-encode quotes and break the highlighter).
 */
function jsonHTML(value) {
  let obj = value
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj) } catch { return esc(obj) }
  }
  const s = JSON.stringify(obj, null, 2)
  return s.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-num'
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-str'
      } else if (/^(true|false|null)$/.test(match)) {
        cls = 'json-bool'
      }
      return '<span class="' + cls + '">' + esc(match) + '</span>'
    }
  )
}

/**
 * Core request helper. Auth headers attach automatically when a token
 * or API key is present. Returns { status, data, ms, raw }.
 */
async function api(method, path, body, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json'
  if (Store.token && !opts.noAuth) headers['Authorization'] = `Bearer ${Store.token}`
  if (Store.apiKey && opts.useApiKey) headers['X-API-Key'] = Store.apiKey

  const started = performance.now()
  let res
  try {
    res = await fetch(`${Store.base}${path}`, {
      method,
      headers,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    return { status: 0, data: { error: 'Network error', message: String(e) }, ms: 0, raw: null, netError: true }
  }
  const ms = Math.round(performance.now() - started)
  let data = null
  const text = await res.text()
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data, ms, raw: text }
}

/** Append an entry to a page console element. */
function consoleLog(elId, method, path, result) {
  const box = document.getElementById(elId)
  if (!box) return
  const empty = box.querySelector('.console-empty')
  if (empty) empty.remove()

  const line = document.createElement('div')
  line.className = 'console-line'
  const cls = result.netError || result.status >= 500 ? 'status-5xx'
    : result.status >= 400 ? 'status-4xx' : 'status-2xx'
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
  line.innerHTML = `<span class="t-time">${time}</span><span class="status-pill ${cls}">${result.netError ? 'ERR' : result.status}</span><b>${esc(method)}</b> ${esc(path)}<span class="t-ms">${result.ms}ms</span>`
  box.appendChild(line)

  if (result.data !== null && result.data !== undefined && result.data !== '') {
    const pre = document.createElement('div')
    pre.style.padding = '2px 0 8px 16px'
    pre.innerHTML = jsonHTML(result.data)
    box.appendChild(pre)
  }
  box.scrollTop = box.scrollHeight
}

/** Lightweight toast. */
function toast(kind, title, body) {
  const wrap = document.querySelector('.toasts') || (() => {
    const d = document.createElement('div')
    d.className = 'toasts'
    document.body.appendChild(d)
    return d
  })()
  const t = document.createElement('div')
  t.className = `toast ${kind}`
  t.innerHTML = `<div><div class="t-title">${esc(title)}</div><div class="t-body">${esc(body || '')}</div></div>`
  wrap.appendChild(t)
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s'
    t.style.opacity = '0'
    t.style.transform = 'translateY(8px)'
    setTimeout(() => t.remove(), 320)
  }, kind === 'err' ? 5200 : 3200)
}

/** Remember tokens from a login/register/verify-otp/refresh response. */
function captureTokens(data) {
  if (!data) return
  if (data.access_token) {
    Store.token = data.access_token
    if (data.refresh_token) Store.refresh = data.refresh_token
    if (data.user?.email) Store.email = data.user.email
    renderTokenBar()
    loadProfile() // pulls the stored avatar so every page can show it
    toast('ok', 'Session captured', `Signed in as ${data.user?.email || 'user'} — token stored locally`)
  }
}

/** Fetch the signed-in user's profile (avatar) from the API. */
async function loadProfile() {
  if (!Store.token) { Store.avatar = ''; renderTokenBar(); return null }
  const r = await api('GET', '/api/v1/profile/me')
  if (r.status === 200) {
    Store.avatar = r.data?.avatar_url || ''
    if (r.data?.user?.email) Store.email = r.data.user.email
  }
  renderTokenBar()
  return r
}

/** Initials fallback for the avatar circle: "adebisi..." → "AD" */
function initialsOf(email) {
  const parts = String(email || '?').split('@')[0].split(/[._-]+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase()
}

/** The little avatar circle shown in the token bar on every page. */
function avatarHTML(size = 22) {
  const avatarUrl = Store.avatar
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`
  if (avatarUrl) return `<img class="avatar-img" src="${esc(avatarUrl)}" alt="" style="${style}" onerror="this.replaceWith(initialsSpan())">`
  return `<span class="avatar-fallback" style="${style}">${esc(initialsOf(Store.email))}</span>`
}
function initialsSpan() {
  const s = document.createElement('span')
  s.className = 'avatar-fallback'
  s.textContent = initialsOf(Store.email)
  return s
}

/** Re-render the sticky token bar (present on every page). */
function renderTokenBar() {
  const chip = document.getElementById('token-chip')
  const dot = document.getElementById('token-dot')
  const who = document.getElementById('token-who')
  const av = document.getElementById('token-avatar')
  if (!chip) return
  if (Store.token) {
    chip.textContent = Store.token
    chip.classList.remove('empty')
    dot?.classList.add('on')
    if (who) who.textContent = Store.email || 'signed in'
    if (av) { av.innerHTML = avatarHTML(22); av.style.display = '' }
  } else {
    chip.textContent = 'no token — login or register to capture one'
    chip.classList.add('empty')
    dot?.classList.remove('on')
    if (who) who.textContent = 'guest'
    if (av) { av.innerHTML = ''; av.style.display = 'none' }
  }
}

/** Build the standard sticky topbar + token bar; call on DOMContentLoaded. */
function renderChrome(active) {
  const links = [
    ['index.html', 'Dashboard'],
    ['status.html', 'Status'],
    ['auth.html', 'Auth'],
    ['api-keys.html', 'API Keys'],
    ['sandbox.html', 'Sandbox'],
    ['database.html', 'Database'],
    ['profile.html', 'Profile'],
    ['admin.html', 'Admin'],
  ]
  const topbar = document.createElement('header')
  topbar.className = 'topbar'
  topbar.innerHTML = `
    <a class="brand" href="index.html">
      <div class="brand-mark">UAS</div>
      <div>
        <div class="brand-text">Universal API Server</div>
        <div class="brand-sub">v3.1 test console</div>
      </div>
    </a>
    <nav class="topnav">
      ${links.map(([href, label]) =>
        `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`).join('')}
    </nav>`
  document.body.prepend(topbar)

  const bar = document.createElement('div')
  bar.className = 'tokenbar'
  bar.innerHTML = `
    <span class="token-dot" id="token-dot"></span>
    <span class="label">Session</span>
    <span class="token-chip empty" id="token-chip"></span>
    <span id="token-avatar" style="display:none;flex:none"></span>
    <span class="small muted" id="token-who">guest</span>
    <span class="spacer"></span>
    <button class="btn small ghost" onclick="copyToken()">Copy token</button>
    <button class="btn small danger" onclick="clearSession()">Sign out</button>`
  const shell = document.querySelector('.shell')
  if (shell) shell.prepend(bar)

  // Favicon injected here so every console page gets it (local + GitHub Pages)
  if (!document.querySelector('link[rel="icon"]')) {
    const fav = document.createElement('link')
    fav.rel = 'icon'
    fav.type = 'image/svg+xml'
    fav.href = 'assets/favicon.svg'
    document.head.appendChild(fav)
    const favFallback = document.createElement('link')
    favFallback.rel = 'alternate icon'
    favFallback.href = 'favicon.ico'
    document.head.appendChild(favFallback)
  }

  const toasts = document.createElement('div')
  toasts.className = 'toasts'
  document.body.appendChild(toasts)

  const foot = document.createElement('footer')
  foot.innerHTML = `Built with <span class="heart">♥</span> for Temiloluwa — Universal API Server v3.1 · Hono + Cloudflare Workers + D1`
  document.body.appendChild(foot)

  renderTokenBar()
}

function copyToken() {
  if (!Store.token) return toast('err', 'No session', 'Login or register first')
  navigator.clipboard.writeText(Store.token)
    .then(() => toast('ok', 'Copied', 'Access token on clipboard'))
    .catch(() => toast('err', 'Copy failed', 'Clipboard blocked by browser'))
}

function clearSession() {
  Store.clearSession()
  renderTokenBar()
  toast('ok', 'Signed out', 'Local session cleared — server refresh tokens still live until logout')
}

/** Copy any text to clipboard with a toast. */
function copyValue(text, label) {
  navigator.clipboard.writeText(text)
    .then(() => toast('ok', 'Copied', (label || 'Value') + ' on clipboard'))
    .catch(() => toast('err', 'Copy failed', 'Clipboard blocked by browser'))
}

/**
 * Render records as cards that match the stats-grid card language.
 * fields: [{label, get(row)?, key?, mono?, color?: row => cssColor, copy?: true}]
 */
function renderCards(containerId, rows, fields) {
  const box = document.getElementById(containerId)
  if (!box) return
  if (!Array.isArray(rows) || rows.length === 0) {
    box.innerHTML = '<div class="console-empty">// nothing here yet</div>'
    return
  }
  box.innerHTML = rows.map((r) =>
    '<div class="record">' + fields.map((f) => {
      const v = f.get ? f.get(r) : r[f.key]
      const shown = (v === null || v === undefined || v === '') ? '—' : String(v)
      const style = f.color ? `color:${f.color(r)};` : ''
      const cls = f.mono ? 'mono' : ''
      const click = f.copy ? ` onclick="copyValue(this.textContent,'${esc(f.label)}')"` : ''
      return `<div class="rec-row"><span class="rec-k">${esc(f.label)}</span>` +
        `<span class="rec-v ${cls}" style="${style}"${click}>${esc(shown)}</span></div>`
    }).join('') + '</div>'
  ).join('')
}

/** Fill inputs from a JS object by id prefix. */
function fillForm(prefix, obj) {
  Object.entries(obj || {}).forEach(([k, v]) => {
    const el = document.getElementById(`${prefix}-${k}`)
    if (el) el.value = typeof v === 'object' ? JSON.stringify(v) : v
  })
}

/** Read a JSON textarea safely; returns {ok, value} / {ok:false, error}. */
function readJSON(id) {
  const raw = (document.getElementById(id)?.value || '').trim()
  if (!raw) return { ok: true, value: undefined }
  try { return { ok: true, value: JSON.parse(raw) } }
  catch (e) { return { ok: false, error: String(e) } }
}

document.addEventListener('DOMContentLoaded', () => {
  renderChrome(document.body.dataset.page || '')
  if (Store.token) loadProfile() // re-hydrate the avatar on every page load
})