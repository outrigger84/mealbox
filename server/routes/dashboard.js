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
  const enabledMealTypes = ['breakfast', 'lunch', 'dinner'].filter((t) => scheduleConfig[`${t}_enabled`])

  const delivery = nextDeliveryInfo(scheduleConfig, today)

  // computeOrderNeed needs to know which days are fully "away" (see stock.js) across both the
  // partial cycle up to the next delivery and the full cycle after it — sourced from the
  // Calendar slot planner, not the old non_subscription_days table nothing writes to anymore.
  const followingDeliveryDate = addDays(delivery.nextDeliveryDate, 7)
  const orderNeedSlotRows = db.prepare(`
    SELECT date, meal_type, status FROM meal_slots WHERE date >= ? AND date < ?
  `).all(today, followingDeliveryDate)
  const mealSlotsByDate = {}
  for (const r of orderNeedSlotRows) {
    (mealSlotsByDate[r.date] ??= {})[r.meal_type] = r.status
  }

  const orderNeed = computeOrderNeed(meals, mealSlotsByDate, enabledMealTypes, scheduleConfig, today)

  const assignedDateByMealId = new Map(
    db.prepare('SELECT meal_id, date FROM meal_slots WHERE meal_id IS NOT NULL').all()
      .map((r) => [r.meal_id, r.date])
  )
  const expiryWarnings = computeExpiryWarnings(meals, assignedDateByMealId, today)

  const pendingReceipts = db.prepare(`
    SELECT * FROM order_plans WHERE received_at IS NULL AND delivery_date <= ? ORDER BY delivery_date ASC
  `).all(today)

  // computeOrderNeed above only looks at stock/eating-days — it has no idea an order for the
  // upcoming delivery has already been logged (Deliveries → Log order), so its "suggest
  // ordering N" is still shown even once that's moot. Surfacing the matching pending order
  // plan (if any) separately lets the Home banner say "already ordered" instead.
  const pendingOrder = db.prepare(`
    SELECT * FROM order_plans WHERE delivery_date = ? AND received_at IS NULL
  `).get(delivery.nextDeliveryDate) ?? null

  // A meal_slots row with no status stored at all defaults to "subscription" (see
  // server/routes/meal-slots.js) — so demand isn't just explicit 'subscription' rows, it's
  // every (date, enabled meal_type) combo that isn't explicitly 'not_subscription'/'freezer'.
  // Bounded to [today, furthest relevant expiry date] since no slot beyond that could ever
  // matter for matching anyway — avoids generating an unbounded future.
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
  const withFreezeType = (m) => {
    const assignedSlot = findAssignedDate.get(m.id)
    const suggestedFreezeType = assignedSlot && assignedSlot.date <= cycleEnd ? 'light' : 'deep'
    return { ...m, assignedSlotDate: assignedSlot?.date ?? null, suggestedFreezeType }
  }

  // A candidate that IS assigned to a real slot (but that slot falls outside its usable
  // window) is a specific, real problem — name it. A candidate with no assignment at all came
  // out of the generic capacity pool in computeFreezerCandidates, which only knows a *count*
  // must be frozen, not *which* — any of the unassigned stock could equally be "the one" that
  // ends up unmatched depending on what you actually pick later. Naming an arbitrary N of them
  // (by id order) would misrepresent that as a real decision already made, so instead surface
  // the whole unassigned pool plus how many of it need freezing, and let the user choose.
  const freezerCandidates = rawFreezerCandidates.filter((m) => findAssignedDate.get(m.id)).map(withFreezeType)
  const needFreezingCount = rawFreezerCandidates.length - freezerCandidates.length
  const unallocatedFreezerPool = meals
    .filter((m) => !m.eaten && !m.frozen_at && m.expiry_date >= today && !findAssignedDate.get(m.id))
    .map(withFreezeType)

  res.json({
    today, delivery, orderNeed, expiryWarnings, pendingReceipts, pendingOrder,
    freezerCandidates, unallocatedFreezerPool, needFreezingCount,
  })
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
