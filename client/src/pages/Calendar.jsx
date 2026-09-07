import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mealSlots as mealSlotsApi, meals as mealsApi } from '@/api/client'
import { todayStr, addDays, formatDisplay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { UtensilsCrossed, X, Snowflake, Circle, Plus } from 'lucide-react'

const RANGE_DAYS = 14
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
  const [openSlotKey, setOpenSlotKey] = useState(null)
  const start = todayStr()
  const end = addDays(start, RANGE_DAYS)
  const queryClient = useQueryClient()

  const { data: slots, isLoading } = useQuery({
    queryKey: ['meal-slots', start, end],
    queryFn: () => mealSlotsApi.listRange(start, end),
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

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>

  const slotByKey = Object.fromEntries((slots ?? []).map((s) => [`${s.date}|${s.meal_type}`, s]))
  const days = Array.from({ length: RANGE_DAYS }, (_, i) => addDays(start, i))

  function handleCycle(date, meal_type, currentStatus) {
    const nextIndex = (CYCLE.indexOf(currentStatus) + 1) % CYCLE.length
    setStatusMutation.mutate({ date, meal_type, status: CYCLE[nextIndex] })
    setOpenSlotKey(null)
  }

  return (
    <div className="space-y-2 max-w-2xl">
      <p className="text-xs text-muted-foreground">
        Tap a meal to cycle: undecided → subscription meal → not subscription → freezer. If it's a
        subscription meal, you can also pick which one from stock — that's optional and separate.
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

                {status === 'subscription' && (
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

                    {isOpen && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(unassignedMeals ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground">No unassigned meals in stock.</p>
                        ) : (
                          unassignedMeals.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => assignMutation.mutate({ date, meal_type: key, meal_id: m.id })}
                              className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent"
                            >
                              {m.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
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
