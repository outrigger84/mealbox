import express from 'express'
import db from '../db.js'
import { todayStr } from '../lib/dates.js'

export const orderPlansRouter = express.Router()

function withItems(orderPlan) {
  if (!orderPlan) return null
  const items = db.prepare('SELECT * FROM order_plan_items WHERE order_plan_id = ? ORDER BY id ASC').all(orderPlan.id)
  return { ...orderPlan, items }
}

orderPlansRouter.get('/', (req, res) => {
  let sql = 'SELECT * FROM order_plans'
  if (req.query.pending === '1') sql += ' WHERE received_at IS NULL'
  sql += ' ORDER BY delivery_date ASC'
  const plans = db.prepare(sql).all()
  res.json(plans.map(withItems))
})

orderPlansRouter.get('/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM order_plans WHERE id = ?').get(req.params.id)
  if (!plan) return res.status(404).json({ error: 'Not found' })
  res.json(withItems(plan))
})

// Log an order at order time: paste-parsed meal names + expected delivery date.
orderPlansRouter.post('/paste', (req, res) => {
  const { delivery_date, names } = req.body
  if (!delivery_date || !Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'delivery_date and a non-empty names array are required' })
  }

  const existing = db.prepare('SELECT * FROM order_plans WHERE delivery_date = ?').get(delivery_date)

  const upsertPlan = db.transaction(() => {
    let planId
    if (existing) {
      planId = existing.id
      db.prepare(`
        UPDATE order_plans SET ordered = 1, planned_qty = ?, updated_at = datetime('now') WHERE id = ?
      `).run(names.length, planId)
    } else {
      const result = db.prepare(`
        INSERT INTO order_plans (delivery_date, ordered, planned_qty) VALUES (?, 1, ?)
      `).run(delivery_date, names.length)
      planId = result.lastInsertRowid
    }
    const insertItem = db.prepare('INSERT INTO order_plan_items (order_plan_id, name) VALUES (?, ?)')
    for (const name of names) insertItem.run(planId, name)
    return planId
  })

  const planId = upsertPlan()
  res.status(201).json(withItems(db.prepare('SELECT * FROM order_plans WHERE id = ?').get(planId)))
})

// Receipt at delivery time: confirm which expected items arrived and set expiry dates.
orderPlansRouter.post('/:id/receipt', (req, res) => {
  const plan = db.prepare('SELECT * FROM order_plans WHERE id = ?').get(req.params.id)
  if (!plan) return res.status(404).json({ error: 'Not found' })

  const { default_expiry_date, items } = req.body
  if (!default_expiry_date || !Array.isArray(items)) {
    return res.status(400).json({ error: 'default_expiry_date and items array are required' })
  }

  const receive = db.transaction(() => {
    const insertMeal = db.prepare(`
      INSERT INTO meals (name, delivery_date, expiry_date) VALUES (?, ?, ?)
    `)
    const markItem = db.prepare('UPDATE order_plan_items SET received = ?, meal_id = ? WHERE id = ?')

    for (const item of items) {
      const orderItem = db.prepare('SELECT * FROM order_plan_items WHERE id = ? AND order_plan_id = ?').get(item.id, plan.id)
      if (!orderItem) continue
      if (item.received) {
        const expiryDate = item.expiry_date || default_expiry_date
        const result = insertMeal.run(orderItem.name, plan.delivery_date, expiryDate)
        markItem.run(1, result.lastInsertRowid, orderItem.id)
      } else {
        markItem.run(0, null, orderItem.id)
      }
    }

    db.prepare(`
      UPDATE order_plans SET received_at = ?, updated_at = datetime('now') WHERE id = ?
    `).run(todayStr(), plan.id)
  })

  receive()
  res.json(withItems(db.prepare('SELECT * FROM order_plans WHERE id = ?').get(plan.id)))
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
    return res.json(withItems(db.prepare('SELECT * FROM order_plans WHERE id = ?').get(existing.id)))
  }
  const result = db.prepare(`
    INSERT INTO order_plans (delivery_date, ordered, planned_qty, notes)
    VALUES (?, ?, ?, ?)
  `).run(delivery_date, ordered ? 1 : 0, planned_qty ?? null, notes ?? null)
  res.status(201).json(withItems(db.prepare('SELECT * FROM order_plans WHERE id = ?').get(result.lastInsertRowid)))
})

orderPlansRouter.patch('/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM order_plans WHERE id = ?').get(req.params.id)
  if (!current) return res.status(404).json({ error: 'Not found' })
  const updated = { ...current, ...req.body }
  db.prepare(`
    UPDATE order_plans
    SET delivery_date = @delivery_date, ordered = @ordered, planned_qty = @planned_qty,
        notes = @notes, received_at = @received_at, updated_at = datetime('now')
    WHERE id = @id
  `).run(updated)
  res.json(withItems(db.prepare('SELECT * FROM order_plans WHERE id = ?').get(req.params.id)))
})
