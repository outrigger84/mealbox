import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dashboard as dashboardApi, mealSlots as mealSlotsApi, meals as mealsApi, nonSubscriptionDays as nonSubscriptionDaysApi, schedule as scheduleApi } from '@/api/client'
import { addDays, formatDisplay, todayStr } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { UtensilsCrossed, X, Snowflake, Plus, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, AlertTriangle, Plane, Truck, TrendingUp, TrendingDown } from 'lucide-react'

const ALL_MEAL_TYPES = [
  { key: 'breakfast', label: 'Breakfast', enabledField: 'breakfast_enabled' },
  { key: 'lunch', label: 'Lunch', enabledField: 'lunch_enabled' },
  { key: 'dinner', label: 'Dinner', enabledField: 'dinner_enabled' },
]

// A slot with no row defaults to "subscription" (not "undecided") — you only tap to mark an
// exception. Tap cycles through: subscription (no row) -> not_subscription -> freezer -> back
// to subscription (deletes the row again).
const CYCLE = [null, 'not_subscription', 'freezer']

const STATUS_STYLE = {
  null: 'bg-accent text-accent-foreground',
  subscription: 'bg-accent text-accent-foreground',
  not_subscription: 'bg-secondary text-muted-foreground line-through',
  freezer: 'bg-sky-100 text-sky-800',
}

const STATUS_ICON = {
  null: UtensilsCrossed,
  subscription: UtensilsCrossed,
  not_subscription: X,
  freezer: Snowflake,
}

export default function Calendar() {
  const [cycleOffset, setCycleOffset] = useState(0)
  const [openSlotKey, setOpenSlotKey] = useState(null)
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [rangeFormOpen, setRangeFormOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(cycleOffset !== 0)
  const [expandedPastDates, setExpandedPastDates] = useState(() => new Set())
  const queryClient = useQueryClient()

  // The stat boxes matter most while a cycle's order decision is still being made — once
  // you're mid-way through the current week that decision is already locked in, so default
  // them collapsed there (still one tap away, to check things went as planned). Any other
  // cycle (future planning, past review) defaults open.
  useEffect(() => {
    setStatsOpen(cycleOffset !== 0)
  }, [cycleOffset])

  const { data: cycle, isLoading: cycleLoading } = useQuery({
    queryKey: ['calendar-cycle', cycleOffset],
    queryFn: () => scheduleApi.getCycle(cycleOffset),
  })
  const { data: scheduleConfig, isLoading: scheduleLoading } = useQuery({
    queryKey: ['schedule'],
    queryFn: scheduleApi.get,
  })

  const { data: slots, isLoading: slotsLoading } = useQuery({
    queryKey: ['meal-slots', cycle?.cycleStart, cycle?.cycleEnd],
    queryFn: () => mealSlotsApi.listRange(cycle.cycleStart, addDays(cycle.cycleEnd, 1)),
    enabled: !!cycle,
  })
  const { data: unassignedMeals } = useQuery({
    queryKey: ['meals', 'unassigned'],
    queryFn: () => mealsApi.list('unassigned=1'),
  })
  const { data: awayDays } = useQuery({
    queryKey: ['non-subscription-days', cycle?.cycleStart, cycle?.cycleEnd],
    queryFn: () => nonSubscriptionDaysApi.listRange(cycle.cycleStart, addDays(cycle.cycleEnd, 1)),
    enabled: !!cycle,
  })
  const { data: frozenMeals, isLoading: frozenMealsLoading } = useQuery({
    queryKey: ['meals', 'frozen', 'uneaten'],
    queryFn: () => mealsApi.list('frozen=1&eaten=0'),
  })
  // The rolling Demand/Supply/Surplus projection only runs forward from today (each period's
  // freezer supply is chained from the previous one's leftover) — only fetched for the
  // current cycle or a future one, sized to reach whichever cycle is being viewed.
  const { data: projection, isLoading: projectionLoading } = useQuery({
    queryKey: ['dashboard-projection', cycleOffset],
    queryFn: () => dashboardApi.getProjection(cycleOffset + 1),
    enabled: cycleOffset >= 0,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['meal-slots'] })
    queryClient.invalidateQueries({ queryKey: ['meals'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard-projection'] })
    queryClient.invalidateQueries({ queryKey: ['non-subscription-days'] })
  }

  const setStatusMutation = useMutation({
    mutationFn: ({ date, meal_type, status }) => mealSlotsApi.setStatus(date, meal_type, status),
    onSuccess: invalidateAll,
  })
  const assignMutation = useMutation({
    mutationFn: ({ date, meal_type, meal_id }) => mealSlotsApi.assignMeal(date, meal_type, meal_id),
    onSuccess: () => { invalidateAll(); setOpenSlotKey(null) },
  })
  // Marking a day away flags it (excluded from the Home order-need count) and also cycles
  // every enabled meal-type slot on that day to not_subscription, so the slot planner and
  // freezer-candidate matching (both slot-level) agree with the day-level flag rather than
  // needing every slot cleared by hand. Un-marking only removes the flag — it deliberately
  // leaves the slots as not_subscription rather than guessing what they were before.
  const markAwayMutation = useMutation({
    mutationFn: async ({ date, mealTypeKeys }) => {
      await nonSubscriptionDaysApi.create({ date, reason: 'other' })
      await Promise.all(mealTypeKeys.map((key) => mealSlotsApi.setStatus(date, key, 'not_subscription')))
    },
    onSuccess: invalidateAll,
  })
  const unmarkAwayMutation = useMutation({
    mutationFn: (id) => nonSubscriptionDaysApi.delete(id),
    onSuccess: invalidateAll,
  })
  // Bulk version of markAwayMutation for a whole trip: applies the same day-flag +
  // slot-sync to every date in [start, end] inclusive, not just the currently viewed
  // cycle — a two-week holiday will usually span more than one. A date already flagged
  // (409 from the create call) is skipped for the flag but still gets its slots synced,
  // so re-running the range after tweaking the end date is safe.
  const markRangeMutation = useMutation({
    mutationFn: async ({ start, end, mealTypeKeys }) => {
      const dates = []
      for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d)
      for (const date of dates) {
        try {
          await nonSubscriptionDaysApi.create({ date, reason: 'other' })
        } catch {
          // already flagged — fall through to slot sync below
        }
        await Promise.all(mealTypeKeys.map((key) => mealSlotsApi.setStatus(date, key, 'not_subscription')))
      }
      return dates.length
    },
    onSuccess: () => { invalidateAll(); setRangeStart(''); setRangeEnd(''); setRangeFormOpen(false) },
  })

  if (cycleLoading || slotsLoading || scheduleLoading || frozenMealsLoading || (cycleOffset >= 0 && projectionLoading) || !cycle || !scheduleConfig) {
    return <p className="text-muted-foreground">Loading…</p>
  }

  const MEAL_TYPES = ALL_MEAL_TYPES.filter((mt) => scheduleConfig[mt.enabledField])
  const slotByKey = Object.fromEntries((slots ?? []).map((s) => [`${s.date}|${s.meal_type}`, s]))
  const awayByDate = Object.fromEntries((awayDays ?? []).map((d) => [d.date, d]))
  // A cycle is always exactly 7 days (delivery is a fixed weekday) — cycleStart..cycleEnd inclusive.
  const days = Array.from({ length: 7 }, (_, i) => addDays(cycle.cycleStart, i))

  // Stat-box math for the viewed cycle: Demand (every enabled slot except explicit
  // not_subscription ones — a freezer-status slot still counts as demand, it's just sourced
  // from the freezer rather than a fresh order, and which meal fills which slot can be
  // decided later so the split doesn't matter here), Supply (meals delivered + freezer stock
  // available), and Surplus/Deficit (Supply − Demand). For the current cycle or a future one,
  // this comes from GET /dashboard/projection — a rolling calculation where each period's
  // leftover surplus becomes the next period's starting freezer stock, since you can order
  // several periods ahead and a future period's freezer supply depends on every period
  // between now and then, not just today's actual stock (a deficit period clamps its
  // carry-forward to 0 — no negative physical stock). A past cycle can't run that projection
  // backward, so it falls back to a simpler same-cycle-only estimate using current actual
  // freezer stock, which won't reflect what the freezer really held back then.
  const today = todayStr()
  const enabledTypeKeys = new Set(MEAL_TYPES.map((mt) => mt.key))
  const enabledSlots = (slots ?? []).filter((s) => enabledTypeKeys.has(s.meal_type))
  let demand, mealsDelivered, freezerStock, surplus
  if (cycleOffset >= 0 && projection) {
    const period = projection.periods[cycleOffset]
    demand = period.demand
    mealsDelivered = period.mealsDelivered
    freezerStock = period.freezerStockAtStart
    surplus = period.surplus
  } else {
    const notSubscriptionCount = enabledSlots.filter((s) => s.status === 'not_subscription').length
    demand = days.length * MEAL_TYPES.length - notSubscriptionCount
    mealsDelivered = scheduleConfig.default_order_qty
    freezerStock = (frozenMeals ?? []).filter((m) => m.freeze_type === 'deep').length
    surplus = mealsDelivered + freezerStock - demand
  }
  // A freezer slot with no meal picked yet is still just an intention — it's only really
  // backed by stock if there's enough projected freezer supply left to cover it. A slot that
  // already has a specific deep-frozen meal assigned is unaffected by this: that physical meal
  // either already exists or will once frozen, independent of the aggregate projection.
  const unassignedFreezerSlotCount = enabledSlots.filter((s) => s.status === 'freezer' && !s.meal_id).length
  const freezerShortfall = Math.max(0, unassignedFreezerSlotCount - freezerStock)

  function handleCycle(date, meal_type, currentStatus) {
    const nextIndex = (CYCLE.indexOf(currentStatus) + 1) % CYCLE.length
    setStatusMutation.mutate({ date, meal_type, status: CYCLE[nextIndex] })
    setOpenSlotKey(null)
  }

  function toggleAway(date) {
    const existing = awayByDate[date]
    if (existing) {
      unmarkAwayMutation.mutate(existing.id)
    } else {
      markAwayMutation.mutate({ date, mealTypeKeys: MEAL_TYPES.map((mt) => mt.key) })
    }
    setOpenSlotKey(null)
  }

  function togglePastDay(date) {
    setExpandedPastDates((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function handleMarkRange(e) {
    e.preventDefault()
    if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) return
    markRangeMutation.mutate({ start: rangeStart, end: rangeEnd, mealTypeKeys: MEAL_TYPES.map((mt) => mt.key) })
  }

  // Picking a meal that'll already be expired by the slot's date offers to freeze it first
  // (light — it's going into a subscription slot, which only takes fresh/light-frozen stock)
  // so it stays safe to eat instead of just being assigned as-is.
  async function handlePick(date, meal_type, meal) {
    const willBeExpired = !meal.frozen_at && meal.expiry_date < date
    if (willBeExpired) {
      const shouldFreeze = window.confirm(
        `${meal.name} will already be expired by ${formatDisplay(date)}. Freeze it now so it's still safe to use?`
      )
      if (shouldFreeze) {
        await mealsApi.freeze(meal.id, 'light')
      }
    }
    assignMutation.mutate({ date, meal_type, meal_id: meal.id })
  }

  return (
    <div className="space-y-2 max-w-2xl">
      <div className="rounded-lg border bg-card p-3 space-y-1">
        <div className="flex items-center justify-between">
          <button onClick={() => setCycleOffset((o) => o - 1)} className="p-1 rounded-md hover:bg-muted" aria-label="Previous cycle">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <p className="font-semibold text-sm">{formatDisplay(cycle.cycleStart)} – {formatDisplay(cycle.cycleEnd)}</p>
          <button onClick={() => setCycleOffset((o) => o + 1)} className="p-1 rounded-md hover:bg-muted" aria-label="Next cycle">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          Delivered: {formatDisplay(cycle.deliveryDate)} · Order by: {formatDisplay(cycle.orderByDate)} (for {formatDisplay(cycle.nextDeliveryDate)}'s delivery)
        </p>
        {cycleOffset !== 0 && (
          <button
            onClick={() => setCycleOffset(0)}
            className="w-full text-center text-xs font-medium text-accent-foreground hover:underline"
          >
            Jump to today
          </button>
        )}
      </div>

      <div className={cn('rounded-lg border bg-card p-3 space-y-2', cycleOffset >= 4 && 'opacity-50')}>
        <button
          onClick={() => setStatsOpen((o) => !o)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground w-full"
        >
          Order-decision stats
          {statsOpen ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
        </button>
        {cycleOffset >= 4 && (
          <p className="text-xs text-muted-foreground">
            Beyond the ~3 periods you can order ahead for — the further out, the more this projection is just compounding the same default order-qty assumption.
          </p>
        )}
        {statsOpen && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-card p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <UtensilsCrossed className="w-3.5 h-3.5" /> Demand
              </p>
              <p className="mt-1 text-xl font-semibold">{demand}</p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Truck className="w-3.5 h-3.5" /> Delivered
              </p>
              <p className="mt-1 text-xl font-semibold">{mealsDelivered}</p>
            </div>
            <div className="rounded-lg border bg-sky-50 border-sky-200 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-sky-900">
                <Snowflake className="w-3.5 h-3.5" /> Freezer stock
              </p>
              <p className="mt-1 text-xl font-semibold text-sky-900">{freezerStock}</p>
              {cycleOffset > 0 && <p className="text-[10px] text-sky-800">projected</p>}
            </div>
            <div className={cn(
              'rounded-lg border p-3',
              surplus >= 0 ? 'bg-accent/40 border-accent' : 'bg-destructive/10 border-destructive/30'
            )}>
              <p className={cn(
                'flex items-center gap-1.5 text-xs font-medium',
                surplus >= 0 ? 'text-accent-foreground' : 'text-destructive'
              )}>
                {surplus >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {surplus >= 0 ? 'Surplus' : 'Deficit'}
              </p>
              <p className="mt-1 text-xl font-semibold">{surplus >= 0 ? `+${surplus}` : surplus}</p>
            </div>
          </div>
        )}
      </div>

      {days.map((date) => {
        const isAway = !!awayByDate[date]
        const isPast = date < today
        const isPastCollapsed = isPast && !expandedPastDates.has(date)

        if (isPastCollapsed) {
          return (
            <button
              key={date}
              onClick={() => togglePastDay(date)}
              className="flex items-center justify-between w-full rounded-lg border bg-card p-3 opacity-50 text-sm"
            >
              <span>{formatDisplay(date)}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                Past <ChevronDown className="w-3.5 h-3.5" />
              </span>
            </button>
          )
        }

        return (
        <div key={date} className={cn('rounded-lg border bg-card p-3 space-y-2', isPast && 'opacity-60')}>
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">{formatDisplay(date)}</p>
            <div className="flex items-center gap-1.5">
              {isPast && (
                <button
                  onClick={() => togglePastDay(date)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground"
                  aria-label="Collapse past day"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => toggleAway(date)}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
                  isAway ? 'bg-destructive/10 text-destructive' : 'border border-dashed text-muted-foreground'
                )}
              >
                <Plane className="w-3 h-3" />
                {isAway ? 'Away' : 'Mark away'}
              </button>
            </div>
          </div>
          {MEAL_TYPES.map(({ key, label }) => {
            const slotKey = `${date}|${key}`
            const slot = slotByKey[slotKey]
            const status = slot?.status ?? null
            const Icon = STATUS_ICON[status]
            const isOpen = openSlotKey === slotKey
            // setStatusMutation is shared by every slot's button — without this guard, a
            // second tap on the same slot before the first request's refetch lands would read
            // the still-stale `status` and can compute the exact same "next" transition,
            // silently no-opping instead of advancing. Disabling the tapped slot while its own
            // request is in flight (matched by date+meal_type, not just "any mutation pending")
            // avoids that without blocking taps on other slots.
            const isSlotPending = setStatusMutation.isPending
              && setStatusMutation.variables?.date === date
              && setStatusMutation.variables?.meal_type === key

            return (
              <div key={key} className={cn('flex items-center gap-2', status === 'not_subscription' && 'opacity-60')}>
                <button
                  onClick={() => handleCycle(date, key, status)}
                  disabled={isSlotPending}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0 w-28 disabled:opacity-50',
                    STATUS_STYLE[status]
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {label}
                </button>

                {status === 'freezer' && !slot?.meal_id && freezerShortfall > 0 && (
                  <AlertTriangle
                    className="w-3.5 h-3.5 text-destructive shrink-0"
                    title={`Only ${freezerStock} meal${freezerStock === 1 ? '' : 's'} projected in the freezer this period, but ${unassignedFreezerSlotCount} freezer slot${unassignedFreezerSlotCount === 1 ? '' : 's'} planned with no meal picked yet — ${freezerShortfall} won't have stock to back ${freezerShortfall === 1 ? 'it' : 'them'}.`}
                  />
                )}

                {(status === null || status === 'subscription' || status === 'freezer') && (
                  <div className="flex-1 min-w-0">
                    {slot?.meal_id ? (
                      <button
                        onClick={() => setOpenSlotKey(isOpen ? null : slotKey)}
                        className={cn(
                          'flex items-center justify-between w-full gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium',
                          slot.meal_freeze_type ? 'bg-sky-100 text-sky-800' : 'bg-accent text-accent-foreground'
                        )}
                      >
                        <span className="flex items-center gap-1 min-w-0 truncate">
                          {slot.meal_freeze_type && <Snowflake className="w-3 h-3 shrink-0" />}
                          {slot.meal_name}
                        </span>
                        <X
                          className="w-3.5 h-3.5 shrink-0"
                          onClick={(e) => { e.stopPropagation(); assignMutation.mutate({ date, meal_type: key, meal_id: null }) }}
                        />
                      </button>
                    ) : (
                      <button
                        onClick={() => setOpenSlotKey(isOpen ? null : slotKey)}
                        className="flex items-center gap-1 rounded-md border border-dashed px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Pick meal
                      </button>
                    )}

                    {isOpen && (() => {
                      // A subscription slot takes fresh or light-frozen stock; a freezer slot can
                      // only take something already deep-frozen — see server/routes/meal-slots.js.
                      const pickable = (unassignedMeals ?? []).filter((m) =>
                        status === 'freezer' ? m.freeze_type === 'deep' : m.freeze_type !== 'deep'
                      )
                      return (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {pickable.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              {status === 'freezer' ? 'No deep-frozen meals available.' : 'No unassigned meals in stock.'}
                            </p>
                          ) : (
                            pickable.map((m) => {
                              // Frozen meals (light or deep) have no meaningful expiry pressure —
                              // freezing is what pauses it, same as Home's expiry warnings.
                              const willBeExpired = !m.frozen_at && m.expiry_date < date
                              return (
                                <button
                                  key={m.id}
                                  onClick={() => handlePick(date, key, m)}
                                  className={cn(
                                    'flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent',
                                    willBeExpired && 'border-destructive/40'
                                  )}
                                  title={willBeExpired ? `Expires ${formatDisplay(m.expiry_date)} — will already be expired by ${formatDisplay(date)}` : undefined}
                                >
                                  {willBeExpired && <AlertTriangle className="w-3 h-3 text-destructive" />}
                                  {m.frozen_at && <Snowflake className="w-3 h-3 text-sky-600" />}
                                  {m.name}
                                </button>
                              )
                            })
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        )
      })}

      <div className="rounded-lg border bg-card p-3 space-y-2">
        <button
          onClick={() => setRangeFormOpen((o) => !o)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground w-full"
        >
          <Plane className="w-3.5 h-3.5" /> Mark a trip away
          {rangeFormOpen ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
        </button>
        {rangeFormOpen && (
          <form onSubmit={handleMarkRange} className="space-y-2">
            <p className="text-xs text-muted-foreground">
              For a holiday or work trip — flags every date in the range and sets its meal slots to
              not subscription, same as the per-day toggle above, in one go. Not limited to the cycle shown at the top.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date" required value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                className="rounded-md border px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date" required value={rangeEnd} min={rangeStart || undefined}
                onChange={(e) => setRangeEnd(e.target.value)}
                className="rounded-md border px-2 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={!rangeStart || !rangeEnd || rangeEnd < rangeStart || markRangeMutation.isPending}
                className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              >
                {markRangeMutation.isPending ? 'Marking…' : 'Mark away'}
              </button>
            </div>
            {markRangeMutation.isSuccess && (
              <p className="text-xs text-muted-foreground">Marked {markRangeMutation.data} day{markRangeMutation.data === 1 ? '' : 's'} away.</p>
            )}
          </form>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Every slot defaults to subscription — tap to cycle: subscription → not subscription →
        freezer → back to subscription. For a subscription or freezer slot, you can also pick
        which specific meal — optional and separate. Subscription picks from fresh/light-frozen
        stock, freezer picks from deep-frozen stock only.
        <AlertTriangle className="inline w-3 h-3 text-destructive align-text-bottom" /> next to a
        meal in the picker means that meal will already be expired by that day; next to a
        freezer slot with no meal picked yet, it means the period's projected freezer stock
        won't cover every freezer slot planned.
      </p>
    </div>
  )
}
