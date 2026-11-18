/* ============================================================
   Database (D1 items) routes
   ============================================================ */

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { ensureAuthTables } from '../lib/db'
import { parseJson } from '../lib/request'

const database = new Hono<{ Bindings: Bindings }>()

database.get('/_init', async (c) => {
  await ensureAuthTables(c.env.DB)
  return c.json({ status: 'tables_ready' })
})

database.get('/items', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM items ORDER BY id DESC').all()
  return c.json({ items: results, count: results?.length || 0 })
})

database.post('/items', async (c) => {
  const body = await parseJson<{ name?: string }>(c)
  const name = body?.name ?? 'untitled'
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
  await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run()
  return c.json({ deleted: true, id })
})

export default database