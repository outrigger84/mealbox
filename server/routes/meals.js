import express from 'express'
import db from '../db.js'
import { todayStr } from '../lib/dates.js'

export const mealsRouter = express.Router()

mealsRouter.get('/', (req, res) => {
  // Always joined (not just for ?assigned=1) so any filter's results can show which slot a
  // meal is in, if any — a meal_id is referenced by at most one meal_slots row (enforced in
  // meal-slots.js), so this is a safe one-to-zero-or-one join, never row multiplication.
  let sql = `
    SELECT m.*, ms.date AS assigned_slot_date, ms.meal_type AS assigned_slot_meal_type
    FROM meals m
    LEFT JOIN meal_slots ms ON ms.meal_id = m.id
    WHERE 1=1
  `
  const params = []
  if (req.query.eaten === '0') sql += ' AND m.eaten = 0'
  if (req.query.eaten === '1') sql += ' AND m.eaten = 1'
  if (req.query.unassigned === '1') {
    sql += ` AND m.eaten = 0 AND m.id NOT IN (SELECT meal_id FROM meal_slots WHERE meal_id IS NOT NULL)`
  }
  if (req.query.assigned === '1') {
    sql += ` AND m.eaten = 0 AND m.id IN (SELECT meal_id FROM meal_slots WHERE meal_id IS NOT NULL)`
  }
  if (req.query.frozen === '1') sql += ' AND m.frozen_at IS NOT NULL'
  sql += ' ORDER BY m.expiry_date ASC'
  res.json(db.prepare(sql).all(...params))
})

mealsRouter.post('/', (req, res) => {
  const { name, delivery_date, expiry_date, notes } = req.body
  const result = db.prepare(`
    INSERT INTO meals (name, delivery_date, expiry_date, notes)
    VALUES (?, ?, ?, ?)
  `).run(name, delivery_date, expiry_date, notes ?? null)
  res.status(201).json(db.prepare('SELECT * FROM meals WHERE id = ?').get(result.lastInsertRowid))
})

mealsRouter.post('/batch', (req, res) => {
  const { delivery_date, items } = req.body
  const insert = db.prepare(`
    INSERT INTO meals (name, delivery_date, expiry_date)
    VALUES (?, ?, ?)
  `)
  const insertMany = db.transaction((rows) => {
    const ids = []
    for (const item of rows) {
      const result = insert.run(item.name, delivery_date, item.expiry_date)
      ids.push(result.lastInsertRowid)
    }
    return ids
  })
  const ids = insertMany(items)
  const placeholders = ids.map(() => '?').join(',')
  res.status(201).json(db.prepare(`SELECT * FROM meals WHERE id IN (${placeholders})`).all(...ids))
})

mealsRouter.patch('/:id', (req, res) => {
  const current = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id)
  if (!current) return res.status(404).json({ error: 'Not found' })
  const updated = { ...current, ...req.body }
  db.prepare(`
    UPDATE meals
    SET name = @name, delivery_date = @delivery_date, expiry_date = @expiry_date,
        assigned_date = @assigned_date, eaten = @eaten, eaten_date = @eaten_date, notes = @notes,
        updated_at = datetime('now')
    WHERE id = @id
  `).run(updated)
  res.json(db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id))
})

mealsRouter.post('/:id/eat', (req, res) => {
  const current = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id)
  if (!current) return res.status(404).json({ error: 'Not found' })
  db.prepare(`
    UPDATE meals SET eaten = 1, eaten_date = ?, updated_at = datetime('now') WHERE id = ?
  `).run(req.body?.eaten_date ?? todayStr(), req.params.id)
  res.json(db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id))
})

mealsRouter.post('/:id/uneat', (req, res) => {
  const current = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id)
  if (!current) return res.status(404).json({ error: 'Not found' })
  db.prepare(`
    UPDATE meals SET eaten = 0, eaten_date = NULL, updated_at = datetime('now') WHERE id = ?
  `).run(req.params.id)
  res.json(db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id))
})

mealsRouter.post('/:id/freeze', (req, res) => {
  const current = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id)
  if (!current) return res.status(404).json({ error: 'Not found' })
  const { freeze_type } = req.body
  if (!['light', 'deep'].includes(freeze_type)) {
    return res.status(400).json({ error: 'freeze_type must be light or deep' })
  }
  db.prepare(`
    UPDATE meals SET frozen_at = ?, freeze_type = ?, updated_at = datetime('now') WHERE id = ?
  `).run(todayStr(), freeze_type, req.params.id)
  res.json(db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id))
})

mealsRouter.post('/:id/unfreeze', (req, res) => {
  const current = db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id)
  if (!current) return res.status(404).json({ error: 'Not found' })
  db.prepare(`
    UPDATE meals SET frozen_at = NULL, freeze_type = NULL, updated_at = datetime('now') WHERE id = ?
  `).run(req.params.id)
  res.json(db.prepare('SELECT * FROM meals WHERE id = ?').get(req.params.id))
})

mealsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM meals WHERE id = ?').run(req.params.id)
  res.status(204).end()
})
