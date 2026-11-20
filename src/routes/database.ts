/* ============================================================
   Database (D1 items) routes
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { ensureAuthTablesOnce } from '../lib/db'
import { parseJson } from '../lib/request'
import { authOrApiKey } from '../middleware/auth'

const database = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Items are a shared resource: reading and writing requires a JWT or API key.
database.use('*', authOrApiKey)

database.get('/_init', async (c) => {
  await ensureAuthTablesOnce(c.env.DB)
  return c.json({ status: 'tables_ready' })
})

database.get('/items', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM items ORDER BY id DESC').all()
  return c.json({ items: results, count: results?.length || 0 })
})

database.post('/items', async (c) => {
  const body = await parseJson<{ name?: string }>(c)
  const name = body?.name ?? 'untitled'
  if (typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'name must be a non-empty string' }, 400)
  }
  if (name.length > 200) {
    return c.json({ error: 'name must be 200 characters or fewer' }, 400)
  }
  const result = await c.env.DB.prepare(`INSERT INTO items (name) VALUES (?)`).bind(name).run()
  return c.json({
    id: result.meta?.last_row_id,
    name,
    created: true,
  }, 201)
})

database.get('/items/:id', async (c) => {
  const id = c.req.param('id')
  const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first()
  if (!item) {
    return c.json({ error: 'Item not found' }, 404)
  }
  return c.json({ item })
})

database.delete('/items/:id', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run()
  if (!result.meta?.changes) {
    return c.json({ error: 'Item not found', id }, 404)
  }
  return c.json({ deleted: true, id })
})

export default database