/* ============================================================
   Version + process metadata
   Keep in sync with package.json and CHANGELOG.md
   ============================================================ */

export const VERSION = '3.1.0'

/**
 * Isolate boot time, captured lazily on first use.
 * NOTE: a module-scope `Date.now()` constant evaluates to 0 on the
 * Workers runtime, so the timestamp is taken inside request context.
 */
let bootMs: number | null = null

export function bootTimeMs(): number {
  if (bootMs === null) bootMs = Date.now()
  return bootMs
}

/** Seconds since this isolate first served a request. */
export function uptimeSeconds(): number {
  return Math.max(0, Math.floor((Date.now() - bootTimeMs()) / 1000))
}

/** Human-friendly uptime like "2h 14m 31s". */
export function formatUptime(): string {
  const s = uptimeSeconds()
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}