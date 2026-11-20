/* ============================================================
   Health routes
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { VERSION, uptimeSeconds, formatUptime } from '../version'

const health = new Hono<{ Bindings: Bindings }>()

/** Pretty, human-readable timestamp in the configured timezone. */
function prettyNow(tz: string): { date: string; time: string; timezone: string } {
  const now = new Date()
  const dateOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }
  const timeOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }
  let date: string
  let time: string
  try {
    date = new Intl.DateTimeFormat('en-GB', dateOpts).format(now)
    time = new Intl.DateTimeFormat('en-GB', timeOpts).format(now)
  } catch {
    date = now.toISOString()
    time = now.toISOString()
  }
  return { date, time, timezone: tz }
}

health.get('/', async (c) => {
  const tz = c.env.DISPLAY_TIMEZONE ?? 'Africa/Lagos'
  const pretty = prettyNow(tz)

  // Cheap DB ping - confirms D1 is reachable
  let db = 'unknown'
  try {
    await c.env.DB.prepare('SELECT 1').first()
    db = 'connected'
  } catch {
    db = 'unreachable'
  }

  return c.json({
    status: 'ok',
    service: 'universal-api-server',
    version: VERSION,
    environment: c.env.ENVIRONMENT || 'cloudflare-workers',
    timestamp: new Date().toISOString(),
    date: pretty.date,
    time: pretty.time,
    timezone: pretty.timezone,
    uptime: formatUptime(),
    uptime_seconds: uptimeSeconds(),
    db,
  })
})

export default health