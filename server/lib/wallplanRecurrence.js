// Ports wallplan's client-side recurrence expansion (wallplan/client/src/lib/recurringEventsUtil.js)
// so Mealbox's server can show real-world Wallplan events without re-fetching wallplan's own
// React bundle. Kept in plain YYYY-MM-DD string arithmetic (matching this app's date convention,
// see server/lib/dates.js) rather than pulling in date-fns just for this.

function addUnit(dateStr, type, interval) {
  const d = new Date(dateStr + 'T00:00:00Z')
  switch (type) {
    case 'daily': d.setUTCDate(d.getUTCDate() + interval); break
    case 'weekly': d.setUTCDate(d.getUTCDate() + interval * 7); break
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + interval); break
    case 'yearly': d.setUTCFullYear(d.getUTCFullYear() + interval); break
    default: d.setUTCDate(d.getUTCDate() + interval)
  }
  return d.toISOString().slice(0, 10)
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000)
}

function addDays(str, days) {
  const d = new Date(str + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Expands recurring events into concrete occurrences overlapping [rangeStart, rangeEnd]
// (both YYYY-MM-DD, inclusive) and returns them alongside non-recurring events that overlap
// the same range. Mirrors wallplan's own expansion so a recurring event (e.g. "away every
// other Friday") shows up here the same way it would on the Wallplan planner grid.
export function expandWallplanEvents(allEvents, rangeStart, rangeEnd) {
  const exceptions = allEvents.filter((e) => e.parent_recurring_event_id)
  const exceptionMap = new Map()
  for (const e of exceptions) {
    exceptionMap.set(`${e.parent_recurring_event_id}-${e.exception_date}`, e)
    if (e.start_date !== e.exception_date) {
      exceptionMap.set(`${e.parent_recurring_event_id}-${e.start_date}`, e)
    }
  }

  const parents = allEvents.filter((e) => e.is_recurring && !e.parent_recurring_event_id)
  const nonRecurring = allEvents.filter((e) => !e.is_recurring && !e.parent_recurring_event_id)
    .filter((e) => !e.is_deleted)
    .filter((e) => overlaps(e.start_date, e.end_date, rangeStart, rangeEnd))

  const expanded = []
  for (const parent of parents) {
    expanded.push(...generateInstances(parent, rangeStart, rangeEnd, exceptionMap))
  }

  return [...nonRecurring, ...expanded]
}

function overlaps(startDate, endDate, rangeStart, rangeEnd) {
  const end = endDate || startDate
  return startDate <= rangeEnd && end >= rangeStart
}

function generateInstances(event, rangeStart, rangeEnd, exceptionMap) {
  const instances = []
  const durationDays = event.end_date ? daysBetween(event.start_date, event.end_date) : 0
  const maxOccurrences = event.recurrence_end_type === 'after_occurrences'
    ? (event.recurrence_occurrences ?? 52)
    : 1000
  const absoluteEnd = event.recurrence_end_type === 'on_date' && event.recurrence_end_date
    ? event.recurrence_end_date
    : null

  let current = event.start_date
  let occurrence = 0

  while (occurrence < maxOccurrences) {
    if (absoluteEnd && current > absoluteEnd) break
    if (current > rangeEnd) break

    const currentEnd = durationDays > 0 ? addDays(current, durationDays) : null
    if (!currentEnd || currentEnd >= rangeStart) {
      const exKey = `${event.id}-${current}`
      const exception = exceptionMap.get(exKey)

      if (exception) {
        if (!exception.is_deleted) {
          instances.push({ ...exception, is_recurring_instance: true, original_id: event.id, occurrence_number: occurrence })
        }
      } else if (!event.is_deleted) {
        instances.push({
          ...event,
          id: `${event.id}_occ${occurrence}`,
          start_date: current,
          end_date: currentEnd,
          is_recurring_instance: true,
          original_id: event.id,
          occurrence_number: occurrence,
        })
      }
    }

    occurrence++
    current = addUnit(current, event.recurrence_type, event.recurrence_interval ?? 1)
  }

  return instances
}
