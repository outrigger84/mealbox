import { addDays, daysBetween, toDateOnly, todayStr } from './dates.js'
import { nextDeliveryInfo } from './schedule.js'

// Number of (date, enabled meal_type) slots in [startDate, endDate) that still need a *fresh
// order* — one unit per enabled meal type per day, minus any explicitly not_subscription AND
// minus any freezer slot. Unlike the Calendar projection panel's demand figure (which counts
// freezer slots too, since it separately nets them against tracked freezer-stock supply), this
// is specifically "how much do I need to order" — a freezer slot is by definition meant to be
// filled from stock already set aside, not from placing an order, so it doesn't belong in this
// count at all. This replaced an earlier one-unit-per-day count that silently assumed a single
// subscription meal a day regardless of how many meal types were enabled — inconsistent with
// every other demand calculation in this app once more than one meal type is on subscription.
// mealSlotsByDate maps date -> { meal_type: status }, sparse — a day/meal_type with no entry
// defaults to 'subscription', same convention as everywhere else this is read.
function countDemand(startDate, endDate, mealSlotsByDate, enabledMealTypes) {
  const totalDays = daysBetween(toDateOnly(startDate), toDateOnly(endDate))
  let demand = 0
  for (let i = 0; i < totalDays; i++) {
    const day = addDays(startDate, i)
    const daySlots = mealSlotsByDate[day] ?? {}
    for (const mealType of enabledMealTypes) {
      if (!['not_subscription', 'freezer'].includes(daySlots[mealType])) demand++
    }
  }
  return demand
}

// Same shape as countDemand, but counts slots explicitly at a given status — used to surface
// how many freezer slots were excluded from the demand count above, for the order-need breakdown.
function countByStatus(startDate, endDate, mealSlotsByDate, enabledMealTypes, status) {
  const totalDays = daysBetween(toDateOnly(startDate), toDateOnly(endDate))
  let count = 0
  for (let i = 0; i < totalDays; i++) {
    const day = addDays(startDate, i)
    const daySlots = mealSlotsByDate[day] ?? {}
    for (const mealType of enabledMealTypes) {
      if (daySlots[mealType] === status) count++
    }
  }
  return count
}

export function computeOrderNeed(meals, mealSlotsByDate, enabledMealTypes, scheduleConfig, today = todayStr(), freezerSlotInfo = { unassignedSlotCount: 0, availableDeepFrozen: 0 }) {
  const { nextDeliveryDate } = nextDeliveryInfo(scheduleConfig, today)
  const followingDeliveryDate = addDays(nextDeliveryDate, 7)

  // Window boundaries follow the same day-after-delivery-through-next-delivery-inclusive
  // convention as cycleBounds() (schedule.js) / the Calendar projection panel: nothing that
  // arrives on a delivery day is usable yet, so that day is still consumed from existing stock
  // and belongs to the outgoing window, not the incoming one. (cycleBounds() itself isn't
  // called here because its offset is purely calendar-based, while nextDeliveryDate/
  // followingDeliveryDate can roll forward a week when this week's order-by cutoff has
  // already passed — the two would disagree on which delivery is "next" in that case.)
  const untilDeliveryStart = today
  const untilDeliveryEnd = addDays(nextDeliveryDate, 1)
  const nextCycleStart = addDays(nextDeliveryDate, 1)
  const nextCycleEnd = addDays(followingDeliveryDate, 1)

  const mealsNeededUntilDelivery = countDemand(untilDeliveryStart, untilDeliveryEnd, mealSlotsByDate, enabledMealTypes)
  const mealsNeededNextCycle = countDemand(nextCycleStart, nextCycleEnd, mealSlotsByDate, enabledMealTypes)

  // A frozen meal is preserved past its original expiry_date, so it still counts as
  // available stock even once that date has passed. Deep-frozen stock is excluded here: it can
  // only ever fill a freezer slot (same pairing rule PUT /meal-slots/meal enforces), never a
  // subscription one, so — now that freezer-slot demand is excluded above too — counting it
  // would create a phantom "leftover" that isn't actually free to offset fresh-order demand;
  // it's already spoken for by whichever freezer slot it's earmarked for.
  const stockAvailable = meals.filter((m) => !m.eaten && m.freeze_type !== 'deep' && (m.frozen_at || m.expiry_date >= today)).length

  const shortfallBeforeDelivery = Math.max(0, mealsNeededUntilDelivery - stockAvailable)
  const leftoverAtDelivery = Math.max(0, stockAvailable - mealsNeededUntilDelivery)
  const subscriptionOrderQty = Math.max(0, mealsNeededNextCycle - leftoverAtDelivery)

  // Freezer slots are excluded from demand above because they're meant to be filled from stock
  // already set aside — but if there isn't enough deep-frozen stock on hand (unassigned to any
  // other freezer slot) to cover every freezer slot still needing a meal, that reserve has to
  // come from somewhere: an extra meal ordered now and frozen deep for later. So unlike the
  // exclusion itself, a genuine shortfall here DOES belong in the order suggestion.
  const freezerStockShortfall = Math.max(0, freezerSlotInfo.unassignedSlotCount - freezerSlotInfo.availableDeepFrozen)
  const suggestedOrderQty = subscriptionOrderQty + freezerStockShortfall

  // Breakdown of how suggestedOrderQty was reached, for display: the full slot mix for next
  // cycle (subscription/freezer/other), how much of the subscription portion is already spoken
  // for by stock left over from before delivery, and how many freezer slots still need an
  // extra meal ordered (and later frozen) because there's no spare freezer stock to draw on.
  const nextCycleFreezerSlots = countByStatus(nextCycleStart, nextCycleEnd, mealSlotsByDate, enabledMealTypes, 'freezer')
  const nextCycleOtherSlots = countByStatus(nextCycleStart, nextCycleEnd, mealSlotsByDate, enabledMealTypes, 'not_subscription')
  const nextCycleBreakdown = {
    totalSlots: mealsNeededNextCycle + nextCycleFreezerSlots + nextCycleOtherSlots,
    subscriptionSlots: mealsNeededNextCycle,
    freezerSlots: nextCycleFreezerSlots,
    otherSlots: nextCycleOtherSlots,
    coveredByLeftoverStock: Math.min(mealsNeededNextCycle, leftoverAtDelivery),
    subscriptionOrderQty,
    freezerStockShortfall,
    needsFreshOrder: suggestedOrderQty,
  }

  return {
    mealsNeededUntilDelivery,
    mealsNeededNextCycle,
    stockAvailable,
    shortfallBeforeDelivery,
    leftoverAtDelivery,
    suggestedOrderQty,
    needToOrder: suggestedOrderQty > 0,
    nextCycleBreakdown,
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

// assignedDateByMealId maps meal_id -> its meal_slots date, for meals linked to a real
// Calendar slot. A meal assigned to eat on or before its own expiry is already safely planned
// to be eaten in time — flagging it here too would just be noise on top of the Calendar's own
// plan, so it's excluded rather than warned about (mirrors the "usable window" check
// computeFreezerCandidates already does for the same assigned-meal-vs-expiry comparison).
export function computeExpiryWarnings(meals, assignedDateByMealId, today = todayStr(), warningDays = 3) {
  return meals
    .filter((m) => !m.eaten && !m.frozen_at)
    .map((m) => ({
      ...m,
      daysUntilExpiry: daysBetween(toDateOnly(today), toDateOnly(m.expiry_date)),
    }))
    .filter((m) => m.daysUntilExpiry <= warningDays)
    .filter((m) => {
      const assignedDate = assignedDateByMealId.get(m.id)
      return !(assignedDate !== undefined && assignedDate <= m.expiry_date)
    })
    .map((m) => ({
      ...m,
      status: m.daysUntilExpiry < 0 ? 'expired' : m.daysUntilExpiry === 0 ? 'expires_today' : 'expiring_soon',
    }))
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
}
