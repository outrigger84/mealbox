import express from 'express'
import db from '../db.js'

export const orderPlansRouter = express.Router()

orderPlansRouter.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM order_plans ORDER BY delivery_date ASC').all())
})

orderPlansRouter.post('/', (req, res) => {
  const { delivery_date, ordered, planned_qty, notes } = req.body
  const existing = db.prepare('SELECT * FROM order_plans WHERE delivery_date = ?').get(delivery_date)
  if (existing) {
    db.prepare(`
      UPDATE order_plans
      SET ordered = ?, planned_qty = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(ordered ? 1 : 0, planned_qty ?? null, notes ?? null, existing.id)
    return res.json(db.prepare('SELECT * FROM order_plans WHERE id = ?').get(existing.id))
  }
  const result = db.prepare(`
    INSERT INTO order_plans (delivery_date, ordered, planned_qty, notes)
    VALUES (?, ?, ?, ?)
  `).run(delivery_date, ordered ? 1 : 0, planned_qty ?? null, notes ?? null)
  res.status(201).json(db.prepare('SELECT * FROM order_plans WHERE id = ?').get(result.lastInsertRowid))
})

orderPlansRouter.patch('/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM order_plans WHERE id = ?').get(req.params.id)
  if (!current) return res.status(404).json({ error: 'Not found' })
  const updated = { ...current, ...req.body }
  db.prepare(`
    UPDATE order_plans
    SET delivery_date = @delivery_date, ordered = @ordered, planned_qty = @planned_qty,
        notes = @notes, updated_at = datetime('now')
    WHERE id = @id
  `).run(updated)
  res.json(db.prepare('SELECT * FROM order_plans WHERE id = ?').get(req.params.id))
})
