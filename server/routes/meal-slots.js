import express from 'express'
import db from '../db.js'

export const mealSlotsRouter = express.Router()

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']
const STATUSES = ['subscription', 'not_subscription', 'freezer']

mealSlotsRouter.get('/', (req, res) => {
  const { start, end } = req.query
  if (!start || !end) return res.status(400).json({ error: 'start and end query params required' })
  res.json(db.prepare('SELECT * FROM meal_slots WHERE date >= ? AND date < ?').all(start, end))
})

// Upsert a slot's status, or delete it (status: null) to reset back to "undecided",
// which is represented by the absence of a row rather than a stored value.
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
  if (existing) {
    db.prepare(`UPDATE meal_slots SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, existing.id)
  } else {
    db.prepare('INSERT INTO meal_slots (date, meal_type, status) VALUES (?, ?, ?)').run(date, meal_type, status)
  }
  res.json(db.prepare('SELECT * FROM meal_slots WHERE date = ? AND meal_type = ?').get(date, meal_type))
})
