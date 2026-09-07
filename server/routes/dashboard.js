import express from 'express'
import db from '../db.js'
import { addDays, todayStr } from '../lib/dates.js'
import { nextDeliveryInfo, cycleBounds } from '../lib/schedule.js'
import { computeOrderNeed, computeExpiryWarnings, computeFreezerCandidates } from '../lib/stock.js'

export const dashboardRouter = express.Router()

dashboardRouter.get('/', (req, res) => {
  const today = todayStr()
  const scheduleConfig = db.prepare('SELECT * FROM schedule_config WHERE id = 1').get()
  const meals = db.prepare('SELECT * FROM meals').all()
  const nonSubscriptionDays = db.prepare('SELECT * FROM non_subscription_days WHERE date >= ?').all(today)

  const delivery = nextDeliveryInfo(scheduleConfig, today)
  const orderNeed = computeOrderNeed(meals, nonSubscriptionDays, scheduleConfig, today)
  const expiryWarnings = computeExpiryWarnings(meals, today)

  const pendingReceipts = db.prepare(`
    SELECT * FROM order_plans WHERE received_at IS NULL AND delivery_date <= ? ORDER BY delivery_date ASC
  `).all(today)

  // A meal_slots row with no status stored at all defaults to "subscription" (see
  // server/routes/meal-slots.js) — so demand isn't just explicit 'subscription' rows, it's
  // every (date, enabled meal_type) combo that isn't explicitly 'not_subscription'/'freezer'.
  // Bounded to [today, furthest relevant expiry date] since no slot beyond that could ever
  // matter for matching anyway — avoids generating an unbounded future.
  const enabledMealTypes = ['breakfast', 'lunch', 'dinner'].filter((t) => scheduleConfig[`${t}_enabled`])
  const relevantExpiries = meals
    .filter((m) => !m.eaten && !m.frozen_at && m.expiry_date >= today)
    .map((m) => m.expiry_date)
  const horizon = relevantExpiries.length ? relevantExpiries.reduce((a, b) => (a > b ? a : b)) : today

  const subscriptionSlots = []
  if (enabledMealTypes.length) {
    const existingRows = db.prepare(`
      SELECT date, meal_type, status, meal_id FROM meal_slots
      WHERE date >= ? AND date <= ? AND meal_type IN (${enabledMealTypes.map(() => '?').join(',')})
    `).all(today, horizon, ...enabledMealTypes)
    const existingKeys = new Set(existingRows.map((r) => `${r.date}|${r.meal_type}`))
    for (const r of existingRows) {
      if (r.status === 'subscription') subscriptionSlots.push({ date: r.date, meal_id: r.meal_id })
    }
    for (let d = today; d <= horizon; d = addDays(d, 1)) {
      for (const mealType of enabledMealTypes) {
        if (!existingKeys.has(`${d}|${mealType}`)) subscriptionSlots.push({ date: d, meal_id: null })
      }
    }
  }
  const rawFreezerCandidates = computeFreezerCandidates(meals, subscriptionSlots, today)

  const { cycleEnd } = cycleBounds(scheduleConfig, today, 0)
  const findAssignedDate = db.prepare('SELECT date FROM meal_slots WHERE meal_id = ?')
  const freezerCandidates = rawFreezerCandidates.map((m) => {
    const assignedSlot = findAssignedDate.get(m.id)
    const suggestedFreezeType = assignedSlot && assignedSlot.date <= cycleEnd ? 'light' : 'deep'
    return { ...m, assignedSlotDate: assignedSlot?.date ?? null, suggestedFreezeType }
  })

  res.json({ today, delivery, orderNeed, expiryWarnings, pendingReceipts, freezerCandidates })
})
