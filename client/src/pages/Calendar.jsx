import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mealSlots as mealSlotsApi, meals as mealsApi, schedule as scheduleApi } from '@/api/client'
import { addDays, formatDisplay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { UtensilsCrossed, X, Snowflake, Circle, Plus, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'

const MEAL_TYPES = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
]

// Tap cycles through: undecided (no row) -> subscription -> not_subscription -> freezer -> undecided
const CYCLE = [null, 'subscription', 'not_subscription', 'freezer']

const STATUS_STYLE = {
  null: 'bg-muted text-muted-foreground',
  subscription: 'bg-accent text-accent-foreground',
  not_subscription: 'bg-secondary text-muted-foreground line-through',
  freezer: 'bg-sky-100 text-sky-800',
}

const STATUS_ICON = {
  null: Circle,
  subscription: UtensilsCrossed,
  not_subscription: X,
  freezer: Snowflake,
}

export default function Calendar() {
  const [cycleOffset, setCycleOffset] = useState(0)
  const [openSlotKey, setOpenSlotKey] = useState(null)
  const queryClient = useQueryClient()

  const { data: cycle, isLoading: cycleLoading } = useQuery({
    queryKey: ['calendar-cycle', cycleOffset],
    queryFn: () => scheduleApi.getCycle(cycleOffset),
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

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['meal-slots'] })
    queryClient.invalidateQueries({ queryKey: ['meals'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const setStatusMutation = useMutation({
    mutationFn: ({ date, meal_type, status }) => mealSlotsApi.setStatus(date, meal_type, status),
    onSuccess: invalidateAll,
  })
  const assignMutation = useMutation({
    mutationFn: ({ date, meal_type, meal_id }) => mealSlotsApi.assignMeal(date, meal_type, meal_id),
    onSuccess: () => { invalidateAll(); setOpenSlotKey(null) },
  })

  if (cycleLoading || slotsLoading || !cycle) return <p className="text-muted-foreground">Loading…</p>

  const slotByKey = Object.fromEntries((slots ?? []).map((s) => [`${s.date}|${s.meal_type}`, s]))
  // A cycle is always exactly 7 days (delivery is a fixed weekday) — cycleStart..cycleEnd inclusive.
  const days = Array.from({ length: 7 }, (_, i) => addDays(cycle.cycleStart, i))

  function handleCycle(date, meal_type, currentStatus) {
    const nextIndex = (CYCLE.indexOf(currentStatus) + 1) % CYCLE.length
    setStatusMutation.mutate({ date, meal_type, status: CYCLE[nextIndex] })
    setOpenSlotKey(null)
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
      </div>

      <p className="text-xs text-muted-foreground">
        Tap a meal to cycle: undecided → subscription meal → not subscription → freezer. For a
        subscription or freezer slot, you can also pick which specific meal — optional and separate.
        Subscription picks from fresh/light-frozen stock, freezer picks from deep-frozen stock only.
        <AlertTriangle className="inline w-3 h-3 text-destructive align-text-bottom" /> means that meal
        will already be expired by that day.
      </p>
      {days.map((date) => (
        <div key={date} className="rounded-lg border bg-card p-3 space-y-2">
          <p className="font-medium text-sm">{formatDisplay(date)}</p>
          {MEAL_TYPES.map(({ key, label }) => {
            const slotKey = `${date}|${key}`
            const slot = slotByKey[slotKey]
            const status = slot?.status ?? null
            const Icon = STATUS_ICON[status]
            const isOpen = openSlotKey === slotKey

            return (
              <div key={key} className="flex items-center gap-2">
                <button
                  onClick={() => handleCycle(date, key, status)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0 w-28',
                    STATUS_STYLE[status]
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {label}
                </button>

                {(status === 'subscription' || status === 'freezer') && (
                  <div className="flex-1 min-w-0">
                    {slot?.meal_id ? (
                      <button
                        onClick={() => setOpenSlotKey(isOpen ? null : slotKey)}
                        className="flex items-center justify-between w-full gap-2 rounded-md bg-accent text-accent-foreground px-2.5 py-1.5 text-xs font-medium"
                      >
                        <span className="truncate">{slot.meal_name}</span>
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
                                  onClick={() => assignMutation.mutate({ date, meal_type: key, meal_id: m.id })}
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
      ))}
    </div>
  )
}
