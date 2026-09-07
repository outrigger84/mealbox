import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { schedule as scheduleApi } from '@/api/client'
import { WEEKDAY_NAMES } from '@/lib/dates'

const MEAL_TYPE_FIELDS = [
  { key: 'breakfast_enabled', label: 'Breakfast' },
  { key: 'lunch_enabled', label: 'Lunch' },
  { key: 'dinner_enabled', label: 'Dinner' },
]

export default function Settings() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['schedule'], queryFn: scheduleApi.get })
  const [form, setForm] = useState(null)

  useEffect(() => { if (data) setForm(data) }, [data])

  const saveMutation = useMutation({
    mutationFn: () => scheduleApi.update(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  if (isLoading || !form) return <p className="text-muted-foreground">Loading…</p>

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); saveMutation.mutate() }}
      className="max-w-md space-y-4 rounded-lg border bg-card p-4"
    >
      <h2 className="font-semibold">Weekly schedule</h2>

      <label className="block text-sm">
        Delivery day
        <select
          value={form.delivery_weekday}
          onChange={(e) => setForm({ ...form, delivery_weekday: Number(e.target.value) })}
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        >
          {WEEKDAY_NAMES.map((name, i) => (
            <option key={i} value={i}>{name}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        Order-by day
        <select
          value={form.order_by_weekday}
          onChange={(e) => setForm({ ...form, order_by_weekday: Number(e.target.value) })}
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        >
          {WEEKDAY_NAMES.map((name, i) => (
            <option key={i} value={i}>{name}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        Order-by time (display only)
        <input
          type="time"
          value={form.order_by_time ?? ''}
          onChange={(e) => setForm({ ...form, order_by_time: e.target.value })}
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        />
      </label>

      <label className="block text-sm">
        Default order quantity
        <input
          type="number" min={1}
          value={form.default_order_qty}
          onChange={(e) => setForm({ ...form, default_order_qty: Number(e.target.value) })}
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        />
      </label>

      <div className="space-y-2">
        <p className="text-sm">Meal slots in plan</p>
        <p className="text-xs text-muted-foreground">
          Which meal-of-day slots show up in the Calendar planner. Turn a slot off if you don't
          currently order it from the subscription — turn it back on any time.
        </p>
        {MEAL_TYPE_FIELDS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.checked ? 1 : 0 })}
            />
            {label}
          </label>
        ))}
      </div>

      <button
        type="submit"
        disabled={saveMutation.isPending}
        className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-60"
      >
        {saveMutation.isPending ? 'Saving…' : 'Save'}
      </button>
      {saveMutation.isSuccess && <p className="text-xs text-center text-muted-foreground">Saved.</p>}
    </form>
  )
}
