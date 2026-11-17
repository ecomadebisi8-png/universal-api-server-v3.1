/* ============================================================
   Health routes
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings } from '../types'

const health = new Hono<{ Bindings: Bindings }>()

health.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'universal-api-server',
    version: '3.0.0',
    environment: c.env.ENVIRONMENT || 'cloudflare-workers',
    timestamp: new Date().toISOString(),
  })
})

export default health