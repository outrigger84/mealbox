import express from 'express'
import db from '../db.js'
import { todayStr } from '../lib/dates.js'
import { nextDeliveryInfo } from '../lib/schedule.js'
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

  const subscriptionSlotDates = db.prepare(`
    SELECT date FROM meal_slots WHERE status = 'subscription' AND date >= ?
  `).all(today).map((r) => r.date)
  const freezerCandidates = computeFreezerCandidates(meals, subscriptionSlotDates, today)

  res.json({ today, delivery, orderNeed, expiryWarnings, pendingReceipts, freezerCandidates })
})
