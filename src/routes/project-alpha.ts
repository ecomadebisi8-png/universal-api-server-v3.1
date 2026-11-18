/* ============================================================
   Project Alpha routes (protected sandbox)
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { authOrApiKey } from '../middleware/auth'
import { parseJson } from '../lib/request'

const projectAlpha = new Hono<{ Bindings: Bindings; Variables: Variables }>()
projectAlpha.use('*', authOrApiKey)

projectAlpha.get('/', async (c) => {
  const user = c.get('user')
  const apiKey = c.get('apiKey')
  return c.json({
    project: 'alpha',
    status: 'sandbox',
    version: 'v3',
    authenticated: !!user || !!apiKey,
    user: user ? { id: user.sub, email: user.email } : null,
    service: apiKey ? { name: apiKey.name, permissions: apiKey.permissions } : null,
  })
})

projectAlpha.get('/items', async (c) => {
  const user = c.get('user')
  const apiKey = c.get('apiKey')
  if (!user && !apiKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return c.json({ project: 'alpha', items: [], count: 0 })
})

projectAlpha.post('/items', async (c) => {
  const user = c.get('user')
  const apiKey = c.get('apiKey')
  if (!user && !apiKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const body = await parseJson<{ name?: string }>(c)
  return c.json(
    { project: 'alpha', item: { id: Date.now(), name: (body?.name ?? 'untitled') }, created: true },
    201
  )
})

export default projectAlpha