import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { meals as mealsApi } from '@/api/client'
import { todayStr, addDays, formatDisplay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Plus, Trash2, Check, X, Truck, Snowflake } from 'lucide-react'

const FILTERS = [
  { key: 'all', label: 'All', query: 'eaten=0' },
  { key: 'unassigned', label: 'Unassigned', query: 'unassigned=1' },
  { key: 'freezer', label: 'Freezer', query: 'frozen=1&eaten=0' },
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
  const unfreezeMutation = useMutation({
    mutationFn: (id) => mealsApi.unfreeze(id),
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
        <div className="flex items-center gap-2">
          <Link
            to="/deliveries"
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium"
          >
            <Truck className="w-4 h-4" />
            Receive delivery
          </Link>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add meal
          </button>
        </div>
      </div>

      {showForm && <AddMealForm onDone={() => { setShowForm(false); invalidate(); invalidateDashboard() }} />}

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : mealList.length === 0 ? (
        <p className="text-muted-foreground">No meals here.</p>
      ) : filter === 'freezer' ? (
        <div className="space-y-4">
          <FreezerGroup
            label="Light freeze"
            hint="Planned to be eaten within this subscription cycle."
            meals={mealList.filter((m) => m.freeze_type === 'light')}
            onEat={eatMutation.mutate}
            onUnfreeze={unfreezeMutation.mutate}
          />
          <FreezerGroup
            label="Deep freeze"
            hint="Not planned within this cycle — carries over."
            meals={mealList.filter((m) => m.freeze_type === 'deep')}
            onEat={eatMutation.mutate}
            onUnfreeze={unfreezeMutation.mutate}
          />
        </div>
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

function FreezerGroup({ label, hint, meals, onEat, onUnfreeze }) {
  return (
    <div>
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Snowflake className="w-4 h-4 text-sky-600" />
        {label} <span className="text-muted-foreground font-normal">({meals.length})</span>
      </p>
      <p className="text-xs text-muted-foreground mb-2">{hint}</p>
      {meals.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <ul className="space-y-2">
          {meals.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{m.name}</p>
                <p className="text-xs text-muted-foreground">Frozen {formatDisplay(m.frozen_at)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onEat(m.id)}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-accent text-accent-foreground"
                  aria-label="Mark eaten"
                >
                  <Check className="w-5 h-5" />
                </button>
                <button
                  onClick={() => onUnfreeze(m.id)}
                  className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
                >
                  Remove from freezer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddMealForm({ onDone }) {
  const [name, setName] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(todayStr())
  const [expiryDate, setExpiryDate] = useState(addDays(todayStr(), 5))

  const addMutation = useMutation({
    mutationFn: () => mealsApi.create({ name, delivery_date: deliveryDate, expiry_date: expiryDate }),
    onSuccess: onDone,
  })

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); addMutation.mutate() }}
      className="rounded-lg border bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Add a meal manually</h3>
        <button type="button" onClick={onDone} aria-label="Close">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        For a meal that isn't from a logged subscription delivery. Whole deliveries should go through
        Deliveries → Receive delivery instead.
      </p>
      <label className="block text-sm">
        Meal name
        <input
          type="text" required value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        />
      </label>
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
      <button
        type="submit"
        disabled={addMutation.isPending}
        className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-60"
      >
        {addMutation.isPending ? 'Adding…' : 'Add meal'}
      </button>
    </form>
  )
}
