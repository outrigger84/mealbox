import express from 'express'
import db from '../db.js'

export const nonSubscriptionDaysRouter = express.Router()

nonSubscriptionDaysRouter.get('/', (req, res) => {
  const { start, end } = req.query
  if (start && end) {
    res.json(db.prepare('SELECT * FROM non_subscription_days WHERE date >= ? AND date < ? ORDER BY date ASC').all(start, end))
  } else {
    res.json(db.prepare('SELECT * FROM non_subscription_days ORDER BY date ASC').all())
  }
})

nonSubscriptionDaysRouter.post('/', (req, res) => {
  const { date, reason, notes } = req.body
  const existing = db.prepare('SELECT * FROM non_subscription_days WHERE date = ?').get(date)
  if (existing) return res.status(409).json({ error: 'Day already flagged' })
  const result = db.prepare(`
    INSERT INTO non_subscription_days (date, reason, notes)
    VALUES (?, ?, ?)
  `).run(date, reason ?? 'other', notes ?? null)
  res.status(201).json(db.prepare('SELECT * FROM non_subscription_days WHERE id = ?').get(result.lastInsertRowid))
})

nonSubscriptionDaysRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM non_subscription_days WHERE id = ?').run(req.params.id)
  res.status(204).end()
})
