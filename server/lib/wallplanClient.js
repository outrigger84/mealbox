import { expandWallplanEvents } from './wallplanRecurrence.js'

// Wallplan is a sibling app in the fleet (port 3003, see /root/CLAUDE.md) — this is a plain
// server-to-server HTTP call, not a shared DB or package. It's a nice-to-have context panel,
// not a hard dependency: if Wallplan is down or slow, callers should treat `unavailable: true`
// as "just don't show the panel," not an error that breaks the rest of the Mealbox page.
const WALLPLAN_BASE = 'http://localhost:3003/wallplan/api'
const FETCH_TIMEOUT_MS = 3000

async function fetchJson(path) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${WALLPLAN_BASE}${path}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`Wallplan responded ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

// Returns Wallplan events overlapping [start, end] (both YYYY-MM-DD, inclusive), recurrence
// already expanded into concrete occurrences, each annotated with its category/status color
// and emoji for display. Never throws — a fetch failure comes back as `unavailable: true`
// with an empty event list.
export async function getWallplanEvents(start, end) {
  try {
    const [events, categories, statuses] = await Promise.all([
      fetchJson('/events'),
      fetchJson('/categories'),
      fetchJson('/statuses'),
    ])

    const categoryById = new Map(categories.map((c) => [c.id, c]))
    const statusByName = new Map(statuses.map((s) => [s.name, s]))

    const occurrences = expandWallplanEvents(events, start, end)
      .filter((e) => !e.is_deleted)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .map((e) => {
        const category = e.category_id ? categoryById.get(e.category_id) : null
        const status = e.status ? statusByName.get(e.status) : null
        return {
          id: e.id,
          title: e.title,
          start_date: e.start_date,
          end_date: e.end_date,
          emoji: e.emoji || category?.emoji || null,
          category_name: category?.name ?? null,
          color: category?.color ?? status?.color ?? null,
        }
      })

    return { unavailable: false, events: occurrences }
  } catch {
    return { unavailable: true, events: [] }
  }
}
