import express from 'express'
import db from '../db.js'
import { addDays, daysBetween, toDateOnly } from '../lib/dates.js'

export const calendarRouter = express.Router()

calendarRouter.get('/', (req, res) => {
  const { start, end } = req.query
  if (!start || !end) return res.status(400).json({ error: 'start and end query params required' })

  const meals = db.prepare('SELECT * FROM meals WHERE assigned_date >= ? AND assigned_date < ?').all(start, end)
  const nonSubscriptionDays = db.prepare('SELECT * FROM non_subscription_days WHERE date >= ? AND date < ?').all(start, end)
  const nonSubSet = new Set(nonSubscriptionDays.map((d) => d.date))
  const nonSubByDate = Object.fromEntries(nonSubscriptionDays.map((d) => [d.date, d]))

  const totalDays = daysBetween(toDateOnly(start), toDateOnly(end))
  const days = []
  for (let i = 0; i < totalDays; i++) {
    const date = addDays(start, i)
    days.push({
      date,
      assignedMeal: meals.find((m) => m.assigned_date === date) ?? null,
      isNonSubscriptionDay: nonSubSet.has(date),
      nonSubscriptionDay: nonSubByDate[date] ?? null,
    })
  }
  res.json(days)
})
