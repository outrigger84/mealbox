import express from 'express'
import db from '../db.js'

export const mealSlotsRouter = express.Router()

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']
const STATUSES = ['subscription', 'not_subscription', 'freezer']

mealSlotsRouter.get('/', (req, res) => {
  const { start, end } = req.query
  if (!start || !end) return res.status(400).json({ error: 'start and end query params required' })
  res.json(db.prepare(`
    SELECT ms.*, m.name AS meal_name, m.expiry_date AS meal_expiry_date
    FROM meal_slots ms
    LEFT JOIN meals m ON m.id = ms.meal_id
    WHERE ms.date >= ? AND ms.date < ?
  `).all(start, end))
})

// Upsert a slot's status, or delete it (status: null) to reset back to "undecided",
// which is represented by the absence of a row rather than a stored value. Moving a
// slot away from 'subscription' clears any meal assignment it had.
mealSlotsRouter.put('/', (req, res) => {
  const { date, meal_type, status } = req.body
  if (!date || !MEAL_TYPES.includes(meal_type)) {
    return res.status(400).json({ error: 'valid date and meal_type are required' })
  }

  if (status === null || status === undefined) {
    db.prepare('DELETE FROM meal_slots WHERE date = ? AND meal_type = ?').run(date, meal_type)
    return res.json({ date, meal_type, status: null })
  }

  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' })

  const existing = db.prepare('SELECT * FROM meal_slots WHERE date = ? AND meal_type = ?').get(date, meal_type)
  const clearMealId = status !== 'subscription'
  if (existing) {
    db.prepare(`
      UPDATE meal_slots SET status = ?, meal_id = CASE WHEN ? THEN NULL ELSE meal_id END, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, clearMealId ? 1 : 0, existing.id)
  } else {
    db.prepare('INSERT INTO meal_slots (date, meal_type, status) VALUES (?, ?, ?)').run(date, meal_type, status)
  }
  res.json(db.prepare(`
    SELECT ms.*, m.name AS meal_name, m.expiry_date AS meal_expiry_date
    FROM meal_slots ms LEFT JOIN meals m ON m.id = ms.meal_id
    WHERE ms.date = ? AND ms.meal_type = ?
  `).get(date, meal_type))
})

// Assign (or clear, meal_id: null) a specific stock meal to an existing 'subscription' slot.
// Independent of the status cycle above — planning *that* a slot will use a subscription
// meal can happen before you even know which physical meal that'll be.
mealSlotsRouter.put('/meal', (req, res) => {
  const { date, meal_type, meal_id } = req.body
  if (!date || !MEAL_TYPES.includes(meal_type)) {
    return res.status(400).json({ error: 'valid date and meal_type are required' })
  }

  const slot = db.prepare('SELECT * FROM meal_slots WHERE date = ? AND meal_type = ?').get(date, meal_type)
  if (!slot || slot.status !== 'subscription') {
    return res.status(400).json({ error: 'slot must be set to subscription before assigning a meal' })
  }

  const assign = db.transaction(() => {
    if (meal_id !== null && meal_id !== undefined) {
      const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(meal_id)
      if (!meal) throw new Error('meal not found')
      // A physical meal can only fill one slot — clear it from wherever it was previously assigned.
      db.prepare(`UPDATE meal_slots SET meal_id = NULL, updated_at = datetime('now') WHERE meal_id = ?`).run(meal_id)
    }
    db.prepare(`UPDATE meal_slots SET meal_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(meal_id ?? null, slot.id)
  })

  try {
    assign()
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  res.json(db.prepare(`
    SELECT ms.*, m.name AS meal_name, m.expiry_date AS meal_expiry_date
    FROM meal_slots ms LEFT JOIN meals m ON m.id = ms.meal_id
    WHERE ms.date = ? AND ms.meal_type = ?
  `).get(date, meal_type))
})
