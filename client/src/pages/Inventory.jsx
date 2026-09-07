import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { meals as mealsApi } from '@/api/client'
import { todayStr, addDays, formatDisplay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Plus, Trash2, Check, X } from 'lucide-react'

const FILTERS = [
  { key: 'all', label: 'All', query: 'eaten=0' },
  { key: 'unassigned', label: 'Unassigned', query: 'unassigned=1' },
]

export default function Inventory() {
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const queryClient = useQueryClient()

  const activeQuery = FILTERS.find((f) => f.key === filter).query
  const { data: mealList, isLoading } = useQuery({
    queryKey: ['meals', filter],
    queryFn: () => mealsApi.list(activeQuery),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['meals'] })
  const invalidateDashboard = () => queryClient.invalidateQueries({ queryKey: ['dashboard'] })

  const eatMutation = useMutation({
    mutationFn: (id) => mealsApi.markEaten(id),
    onSuccess: () => { invalidate(); invalidateDashboard() },
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => mealsApi.delete(id),
    onSuccess: () => { invalidate(); invalidateDashboard() },
  })

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-md bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded',
                filter === f.key ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Add delivery
        </button>
      </div>

      {showForm && <AddBatchForm onDone={() => { setShowForm(false); invalidate(); invalidateDashboard() }} />}

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : mealList.length === 0 ? (
        <p className="text-muted-foreground">No meals here.</p>
      ) : (
        <ul className="space-y-2">
          {mealList.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{m.name}</p>
                <p className="text-xs text-muted-foreground">
                  Expires {formatDisplay(m.expiry_date)}
                  {m.assigned_date && <> · Planned for {formatDisplay(m.assigned_date)}</>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => eatMutation.mutate(m.id)}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-accent text-accent-foreground"
                  aria-label="Mark eaten"
                >
                  <Check className="w-5 h-5" />
                </button>
                <button
                  onClick={() => deleteMutation.mutate(m.id)}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10 text-destructive"
                  aria-label="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddBatchForm({ onDone }) {
  const [deliveryDate, setDeliveryDate] = useState(todayStr())
  const [expiryDate, setExpiryDate] = useState(addDays(todayStr(), 5))
  const [names, setNames] = useState('')

  const batchMutation = useMutation({
    mutationFn: () => {
      const items = names
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean)
        .map((name) => ({ name, expiry_date: expiryDate }))
      return mealsApi.batchCreate({ delivery_date: deliveryDate, items })
    },
    onSuccess: onDone,
  })

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); batchMutation.mutate() }}
      className="rounded-lg border bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Add delivery batch</h3>
        <button type="button" onClick={onDone} aria-label="Close">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Delivery date
          <input
            type="date" required value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          Expiry date
          <input
            type="date" required value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <label className="block text-sm">
        Meal names (one per line)
        <textarea
          required rows={4} value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder={'Chicken Tikka Masala\nBeef Lasagne'}
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={batchMutation.isPending}
        className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-60"
      >
        {batchMutation.isPending ? 'Adding…' : 'Add meals'}
      </button>
    </form>
  )
}
