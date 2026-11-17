/* ============================================================
   Project Beta routes (protected sandbox)
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { authOrApiKey } from '../middleware/auth'

const projectBeta = new Hono<{ Bindings: Bindings; Variables: Variables }>()
projectBeta.use('*', authOrApiKey)

projectBeta.get('/', async (c) => {
  const user = c.get('user')
  const apiKey = c.get('apiKey')
  return c.json({
    project: 'beta',
    status: 'sandbox',
    version: 'v3',
    authenticated: !!user || !!apiKey,
    user: user ? { id: user.sub, email: user.email } : null,
    service: apiKey ? { name: apiKey.name, permissions: apiKey.permissions } : null,
  })
})

projectBeta.get('/items', async (c) => {
  const user = c.get('user')
  const apiKey = c.get('apiKey')
  if (!user && !apiKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return c.json({ project: 'beta', items: [], count: 0 })
})

projectBeta.post('/items', async (c) => {
  const user = c.get('user')
  const apiKey = c.get('apiKey')
  if (!user && !apiKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const body = await c.req.json<{ name?: string }>()
  return c.json(
    { project: 'beta', item: { id: Date.now(), name: body.name ?? 'untitled' }, created: true },
    201
  )
})

export default projectBeta