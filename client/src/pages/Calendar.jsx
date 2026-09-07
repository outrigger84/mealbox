import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { calendar as calendarApi, meals as mealsApi, nonSubscriptionDays as nonSubApi } from '@/api/client'
import { todayStr, addDays, formatDisplay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { UtensilsCrossed, CircleOff, X } from 'lucide-react'

const RANGE_DAYS = 14

export default function Calendar() {
  const [openDay, setOpenDay] = useState(null)
  const start = todayStr()
  const end = addDays(start, RANGE_DAYS)
  const queryClient = useQueryClient()

  const { data: days, isLoading } = useQuery({
    queryKey: ['calendar', start, end],
    queryFn: () => calendarApi.getRange(start, end),
  })
  const { data: unassignedMeals } = useQuery({
    queryKey: ['meals', 'unassigned'],
    queryFn: () => mealsApi.list('unassigned=1'),
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
    queryClient.invalidateQueries({ queryKey: ['meals'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const assignMutation = useMutation({
    mutationFn: ({ mealId, date }) => mealsApi.update(mealId, { assigned_date: date }),
    onSuccess: () => { invalidateAll(); setOpenDay(null) },
  })
  const unassignMutation = useMutation({
    mutationFn: (mealId) => mealsApi.update(mealId, { assigned_date: null }),
    onSuccess: invalidateAll,
  })
  const flagMutation = useMutation({
    mutationFn: (date) => nonSubApi.create({ date, reason: 'other' }),
    onSuccess: () => { invalidateAll(); setOpenDay(null) },
  })
  const unflagMutation = useMutation({
    mutationFn: (id) => nonSubApi.delete(id),
    onSuccess: invalidateAll,
  })

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-2 max-w-2xl">
      {days.map((day) => (
        <div key={day.date} className="rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">{formatDisplay(day.date)}</span>
            {!day.assignedMeal && !day.isNonSubscriptionDay && (
              <button
                onClick={() => setOpenDay(openDay === day.date ? null : day.date)}
                className="text-xs font-medium text-primary"
              >
                Assign
              </button>
            )}
          </div>

          {day.assignedMeal && (
            <div className="mt-2 flex items-center justify-between rounded-md bg-accent text-accent-foreground px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <UtensilsCrossed className="w-4 h-4" />
                {day.assignedMeal.name}
              </span>
              <button onClick={() => unassignMutation.mutate(day.assignedMeal.id)} aria-label="Unassign">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {day.isNonSubscriptionDay && (
            <div className="mt-2 flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <CircleOff className="w-4 h-4" />
                Not eating from subscription
              </span>
              <button onClick={() => unflagMutation.mutate(day.nonSubscriptionDay.id)} aria-label="Clear">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {openDay === day.date && !day.assignedMeal && !day.isNonSubscriptionDay && (
            <div className="mt-3 space-y-2 border-t pt-3">
              {(unassignedMeals ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No unassigned meals in stock.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {unassignedMeals.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => assignMutation.mutate({ mealId: m.id, date: day.date })}
                      className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent"
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => flagMutation.mutate(day.date)}
                className={cn('flex items-center gap-1.5 text-xs font-medium text-muted-foreground')}
              >
                <CircleOff className="w-3.5 h-3.5" />
                Mark as not eating from subscription
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
