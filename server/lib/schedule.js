import { addDays, daysBetween, toDateOnly, todayStr, weekdayOf } from './dates.js'

// Next date >= fromDateStr that falls on the given weekday (0=Sun..6=Sat)
function nextOccurrence(fromDateStr, weekday) {
  const from = weekdayOf(fromDateStr)
  const delta = (weekday - from + 7) % 7
  return addDays(fromDateStr, delta)
}

export function nextDeliveryInfo(scheduleConfig, today = todayStr()) {
  const { delivery_weekday, order_by_weekday } = scheduleConfig

  let nextDeliveryDate = nextOccurrence(today, delivery_weekday)
  const offsetDays = (delivery_weekday - order_by_weekday + 7) % 7
  let orderByDate = addDays(nextDeliveryDate, -offsetDays)

  if (orderByDate < today) {
    nextDeliveryDate = addDays(nextDeliveryDate, 7)
    orderByDate = addDays(nextDeliveryDate, -offsetDays)
  }

  const daysUntilOrderBy = daysBetween(toDateOnly(today), toDateOnly(orderByDate))
  const daysUntilDelivery = daysBetween(toDateOnly(today), toDateOnly(nextDeliveryDate))

  let status
  if (daysUntilOrderBy <= 0) status = 'order_now'
  else if (daysUntilOrderBy <= 2) status = 'order_soon'
  else status = 'ok'

  return { nextDeliveryDate, orderByDate, daysUntilOrderBy, daysUntilDelivery, status }
}

// A subscription cycle's *usable* window runs from the day after a delivery (nothing can
// be eaten the day it arrives, per computeFreezerCandidates' same rule) through the next
// delivery date inclusive — always exactly 7 days since delivery is a fixed weekday.
// offset 0 is the cycle containing `today`; negative/positive offsets step whole cycles.
export function cycleBounds(scheduleConfig, today = todayStr(), offset = 0) {
  const { delivery_weekday, order_by_weekday } = scheduleConfig

  const todayWeekday = weekdayOf(today)
  const daysSinceDelivery = (todayWeekday - delivery_weekday + 7) % 7
  const currentDeliveryDate = addDays(today, -daysSinceDelivery)

  const deliveryDate = addDays(currentDeliveryDate, 7 * offset)
  const nextDeliveryDate = addDays(deliveryDate, 7)
  const cycleStart = addDays(deliveryDate, 1)
  const cycleEnd = nextDeliveryDate

  const offsetDays = (delivery_weekday - order_by_weekday + 7) % 7
  const orderByDate = addDays(nextDeliveryDate, -offsetDays)

  return { cycleStart, cycleEnd, deliveryDate, nextDeliveryDate, orderByDate }
}
