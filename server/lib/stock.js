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

// Greedily matches uneaten stock (earliest-expiring first) to planned subscription-slot
// dates (earliest first). A meal can't be assigned to a slot on its own delivery day —
// arrival time isn't known reliably, so consumption starts the day after delivery. A meal
// that can't be matched to any remaining slot on or before its own expiry date will expire
// before it's eaten under the current plan — flag it for the freezer. Slot dates are not
// deduplicated: a day with two subscription slots (e.g. lunch and dinner) is two units of
// capacity, not one.
export function computeFreezerCandidates(meals, subscriptionSlotDates, today = todayStr()) {
  const stock = [...meals]
    .filter((m) => !m.eaten && m.expiry_date >= today)
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.id - b.id)

  const availableSlots = subscriptionSlotDates.filter((d) => d >= today).sort()

  const freezerCandidates = []
  for (const meal of stock) {
    const earliestUsable = addDays(meal.delivery_date, 1)
    const slotIndex = availableSlots.findIndex((d) => d >= earliestUsable && d <= meal.expiry_date)
    if (slotIndex === -1) {
      freezerCandidates.push(meal)
    } else {
      availableSlots.splice(slotIndex, 1)
    }
  }
  return freezerCandidates
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
