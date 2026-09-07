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

  // A frozen meal is preserved past its original expiry_date, so it still counts as
  // available stock even once that date has passed.
  const stockAvailable = meals.filter((m) => !m.eaten && (m.frozen_at || m.expiry_date >= today)).length

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

// A meal already assigned (meal_id) to a subscription slot is checked against its own real
// slot date, not the shared pool — otherwise the greedy pass below (which knows nothing about
// actual assignments) can match a *different* meal to that same date first, arbitrarily
// declaring an already-safely-assigned meal a "candidate" while missing the meal that's truly
// unaccounted for. Only meals with no assignment at all compete for the remaining open dates.
// A meal can't be assigned to a slot on its own delivery day — arrival time isn't known
// reliably, so consumption starts the day after delivery. Slot dates are not deduplicated: a
// day with two open subscription slots (e.g. lunch and dinner) is two units of capacity, not one.
export function computeFreezerCandidates(meals, subscriptionSlots, today = todayStr()) {
  const stock = [...meals]
    .filter((m) => !m.eaten && !m.frozen_at && m.expiry_date >= today)
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.id - b.id)

  const futureSlots = subscriptionSlots.filter((s) => s.date >= today)
  const assignedDateByMealId = new Map(futureSlots.filter((s) => s.meal_id != null).map((s) => [s.meal_id, s.date]))
  const availableSlots = futureSlots.filter((s) => s.meal_id == null).map((s) => s.date).sort()

  const freezerCandidates = []
  for (const meal of stock) {
    const earliestUsable = addDays(meal.delivery_date, 1)
    const assignedDate = assignedDateByMealId.get(meal.id)
    if (assignedDate !== undefined) {
      if (assignedDate < earliestUsable || assignedDate > meal.expiry_date) freezerCandidates.push(meal)
      continue
    }
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
    .filter((m) => !m.eaten && !m.frozen_at)
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
