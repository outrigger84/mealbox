import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { meals as mealsApi } from '@/api/client'
import { todayStr, addDays, formatDisplay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
  Plus, Trash2, Check, X, Truck, Snowflake, Undo2,
  Package, Clock, CalendarCheck, ChevronUp, ChevronDown,
  Coffee, Sandwich, UtensilsCrossed,
} from 'lucide-react'

const FILTERS = [
  { key: 'all', label: 'All', query: 'eaten=0' },
  { key: 'unassigned', label: 'Unassigned', query: 'unassigned=1' },
  { key: 'assigned', label: 'Assigned', query: 'assigned=1' },
  { key: 'freezer', label: 'Freezer', query: 'frozen=1&eaten=0' },
  { key: 'eaten', label: 'Eaten', query: 'eaten=1' },
]

const MEAL_TYPE_ICONS = { breakfast: Coffee, lunch: Sandwich, dinner: UtensilsCrossed }
const MEAL_TYPE_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }

// Summary numbers for the currently-viewed tab, derived from the same list already
// fetched for it — no extra requests, mirroring the Calendar page's decision-stats panel.
function tabStats(filter, mealList) {
  const expiryCutoff = addDays(todayStr(), 3)
  const expiringSoon = (m) => !m.frozen_at && m.expiry_date <= expiryCutoff

  if (filter === 'all') {
    return [
      { key: 'total', label: 'Total', icon: Package, value: mealList.length },
      { key: 'expiring', label: 'Expiring ≤3d', icon: Clock, value: mealList.filter(expiringSoon).length, warn: true },
      { key: 'frozen', label: 'Frozen', icon: Snowflake, value: mealList.filter((m) => m.frozen_at).length },
      { key: 'assigned', label: 'Assigned', icon: CalendarCheck, value: mealList.filter((m) => m.assigned_slot_date).length },
    ]
  }
  if (filter === 'unassigned') {
    return [
      { key: 'total', label: 'Total', icon: Package, value: mealList.length },
      { key: 'expiring', label: 'Expiring ≤3d', icon: Clock, value: mealList.filter(expiringSoon).length, warn: true },
    ]
  }
  if (filter === 'assigned') {
    return [
      { key: 'total', label: 'Total', icon: CalendarCheck, value: mealList.length },
      ...['breakfast', 'lunch', 'dinner'].map((mt) => ({
        key: mt, label: MEAL_TYPE_LABELS[mt], icon: MEAL_TYPE_ICONS[mt],
        value: mealList.filter((m) => m.assigned_slot_meal_type === mt).length,
      })),
    ]
  }
  if (filter === 'freezer') {
    return [
      { key: 'light', label: 'Light freeze', icon: Snowflake, value: mealList.filter((m) => m.freeze_type === 'light').length },
      { key: 'deep', label: 'Deep freeze', icon: Snowflake, value: mealList.filter((m) => m.freeze_type === 'deep').length },
      { key: 'total', label: 'Total', icon: Package, value: mealList.length },
    ]
  }
  // eaten
  return [
    { key: 'total', label: 'Total eaten', icon: Check, value: mealList.length },
  ]
}

function TabStats({ filter, mealList, open, onToggle }) {
  const stats = tabStats(filter, mealList)
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground w-full"
      >
        Summary stats
        {open ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>
      {open && (
        <div className={cn(
          'grid gap-2',
          stats.length === 1 && 'grid-cols-1',
          stats.length === 2 && 'grid-cols-2',
          stats.length === 3 && 'grid-cols-3',
          stats.length >= 4 && 'grid-cols-4'
        )}>
          {stats.map((s) => {
            const Icon = s.icon
            return (
              <div
                key={s.key}
                className={cn(
                  'rounded-lg border p-3',
                  s.warn && s.value > 0 ? 'bg-destructive/10 border-destructive/30' : 'bg-card'
                )}
              >
                <p className={cn(
                  'flex items-center gap-1.5 text-xs font-medium',
                  s.warn && s.value > 0 ? 'text-destructive' : 'text-muted-foreground'
                )}>
                  <Icon className="w-3.5 h-3.5 shrink-0" /> {s.label}
                </p>
                <p className="mt-1 text-xl font-semibold">{s.value}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Inventory() {
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [statsOpen, setStatsOpen] = useState(true)
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
  const uneatMutation = useMutation({
    mutationFn: (id) => mealsApi.markUneaten(id),
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

      {!isLoading && (
        <TabStats filter={filter} mealList={mealList} open={statsOpen} onToggle={() => setStatsOpen((o) => !o)} />
      )}

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
      ) : filter === 'eaten' ? (
        <ul className="space-y-2">
          {mealList.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{m.name}</p>
                <p className="text-xs text-muted-foreground">Eaten {formatDisplay(m.eaten_date)}</p>
              </div>
              <button
                onClick={() => uneatMutation.mutate(m.id)}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shrink-0"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {mealList.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{m.name}</p>
                <p className="text-xs text-muted-foreground">
                  Expires {formatDisplay(m.expiry_date)}
                  {m.assigned_slot_date && (
                    <> · {MEAL_TYPE_LABELS[m.assigned_slot_meal_type]} {formatDisplay(m.assigned_slot_date)}</>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => eatMutation.mutate(m.id)}
                  className="flex items-center gap-1.5 rounded-md bg-accent text-accent-foreground px-2.5 py-1.5 text-xs font-medium"
                  aria-label="Mark eaten"
                >
                  <Check className="w-4 h-4" />
                  Eaten
                </button>
                <button
                  onClick={() => deleteMutation.mutate(m.id)}
                  className="flex items-center justify-center w-9 h-9 rounded-full bg-destructive/10 text-destructive"
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
                  className="flex items-center gap-1.5 rounded-md bg-accent text-accent-foreground px-2.5 py-1.5 text-xs font-medium"
                  aria-label="Mark eaten"
                >
                  <Check className="w-4 h-4" />
                  Eaten
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
