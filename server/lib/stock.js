import { addDays, daysBetween, toDateOnly, todayStr } from './dates.js'
import { nextDeliveryInfo } from './schedule.js'

// Number of calendar days in [startDate, endDate) that are NOT flagged as non-subscription days.
function countEatingDays(startDate, endDate, nonSubscriptionDays) {
  const flagged = new Set(nonSubscriptionDays.map((d) => d.date))
  const totalDays = daysBetween(toDateOnly(startDate), toDateOnly(endDate))
  let eating = 0
  for (let i = 0; i < totalDays; i++) {
    const day = addDays(startDate, i)
    if (!flagged.has(day)) eating++
  }
  return eating
}

export function computeOrderNeed(meals, nonSubscriptionDays, scheduleConfig, today = todayStr()) {
  const { nextDeliveryDate } = nextDeliveryInfo(scheduleConfig, today)
  const followingDeliveryDate = addDays(nextDeliveryDate, 7)

  const eatingDaysUntilDelivery = countEatingDays(today, nextDeliveryDate, nonSubscriptionDays)
  const eatingDaysNextCycle = countEatingDays(nextDeliveryDate, followingDeliveryDate, nonSubscriptionDays)

  const stockAvailable = meals.filter((m) => !m.eaten && m.expiry_date >= today).length

  const shortfallBeforeDelivery = Math.max(0, eatingDaysUntilDelivery - stockAvailable)
  const leftoverAtDelivery = Math.max(0, stockAvailable - eatingDaysUntilDelivery)
  const suggestedOrderQty = Math.max(0, eatingDaysNextCycle - leftoverAtDelivery)

  return {
    eatingDaysUntilDelivery,
    eatingDaysNextCycle,
    stockAvailable,
    shortfallBeforeDelivery,
    leftoverAtDelivery,
    suggestedOrderQty,
    needToOrder: suggestedOrderQty > 0,
  }
}

export function computeExpiryWarnings(meals, today = todayStr(), warningDays = 3) {
  return meals
    .filter((m) => !m.eaten)
    .map((m) => ({
      ...m,
      daysUntilExpiry: daysBetween(toDateOnly(today), toDateOnly(m.expiry_date)),
    }))
    .filter((m) => m.daysUntilExpiry <= warningDays)
    .map((m) => ({
      ...m,
      status: m.daysUntilExpiry < 0 ? 'expired' : m.daysUntilExpiry === 0 ? 'expires_today' : 'expiring_soon',
      unplanned: !m.assigned_date,
    }))
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
}
