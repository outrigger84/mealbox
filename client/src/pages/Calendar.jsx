import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mealSlots as mealSlotsApi } from '@/api/client'
import { todayStr, addDays, formatDisplay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { UtensilsCrossed, X, Snowflake, Circle } from 'lucide-react'

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
  const start = todayStr()
  const end = addDays(start, RANGE_DAYS)
  const queryClient = useQueryClient()

  const { data: slots, isLoading } = useQuery({
    queryKey: ['meal-slots', start, end],
    queryFn: () => mealSlotsApi.listRange(start, end),
  })

  const setStatusMutation = useMutation({
    mutationFn: ({ date, meal_type, status }) => mealSlotsApi.setStatus(date, meal_type, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-slots'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>

  const statusByKey = Object.fromEntries((slots ?? []).map((s) => [`${s.date}|${s.meal_type}`, s.status]))

  const days = Array.from({ length: RANGE_DAYS }, (_, i) => addDays(start, i))

  function handleTap(date, meal_type, currentStatus) {
    const nextIndex = (CYCLE.indexOf(currentStatus) + 1) % CYCLE.length
    setStatusMutation.mutate({ date, meal_type, status: CYCLE[nextIndex] })
  }

  return (
    <div className="space-y-2 max-w-2xl">
      <p className="text-xs text-muted-foreground">
        Tap a meal to cycle: undecided → subscription meal → not subscription → freezer.
      </p>
      {days.map((date) => (
        <div key={date} className="rounded-lg border bg-card p-3">
          <p className="font-medium text-sm mb-2">{formatDisplay(date)}</p>
          <div className="grid grid-cols-3 gap-2">
            {MEAL_TYPES.map(({ key, label }) => {
              const status = statusByKey[`${date}|${key}`] ?? null
              const Icon = STATUS_ICON[status]
              return (
                <button
                  key={key}
                  onClick={() => handleTap(date, key, status)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md py-2 text-xs font-medium transition-colors',
                    STATUS_STYLE[status]
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
