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

// Rolling order-decision projection for cycles 0..periods-1 (offset 0 = current cycle).
// You can order up to a few periods ahead, so a future period's freezer supply depends on
// every period between now and then, not just today's actual stock — chained rather than
// computed independently per period. Demand = every enabled slot minus explicit
// not_subscription ones (freezer-status slots count as demand too: they still need a meal,
// just sourced from the freezer rather than a fresh order — which meal fills which slot can
// be decided later, so the split doesn't matter for this count). Supply = mealsDelivered
// (assumed as Settings' default_order_qty for every period, since a future period hasn't
// been ordered yet) + freezerStockAtStart (real current deep-frozen stock for period 0, then
// chained from the previous period's surplus). A deficit period clamps to 0 rather than
// carrying a negative balance into the freezer — you can't have negative physical stock.
dashboardRouter.get('/projection', (req, res) => {
  const periods = Math.max(1, Math.min(12, parseInt(req.query.periods, 10) || 4))
  const today = todayStr()
  const scheduleConfig = db.prepare('SELECT * FROM schedule_config WHERE id = 1').get()
  const enabledMealTypes = ['breakfast', 'lunch', 'dinner'].filter((t) => scheduleConfig[`${t}_enabled`])

  let freezerStockAtStart = db.prepare(`
    SELECT COUNT(*) AS count FROM meals WHERE eaten = 0 AND frozen_at IS NOT NULL AND freeze_type = 'deep'
  `).get().count

  const periodStmt = enabledMealTypes.length
    ? db.prepare(`
        SELECT status FROM meal_slots
        WHERE date >= ? AND date <= ? AND meal_type IN (${enabledMealTypes.map(() => '?').join(',')})
      `)
    : null

  const results = []
  for (let offset = 0; offset < periods; offset++) {
    const cycle = cycleBounds(scheduleConfig, today, offset)
    const notSubscriptionCount = periodStmt
      ? periodStmt.all(cycle.cycleStart, cycle.cycleEnd, ...enabledMealTypes).filter((r) => r.status === 'not_subscription').length
      : 0
    const demand = 7 * enabledMealTypes.length - notSubscriptionCount
    const mealsDelivered = scheduleConfig.default_order_qty
    const supply = mealsDelivered + freezerStockAtStart
    const surplus = supply - demand
    results.push({
      offset,
      cycleStart: cycle.cycleStart,
      cycleEnd: cycle.cycleEnd,
      demand,
      mealsDelivered,
      freezerStockAtStart,
      supply,
      surplus,
    })
    freezerStockAtStart = Math.max(0, surplus)
  }

  res.json({ today, periods: results })
})
