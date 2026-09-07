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
