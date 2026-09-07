import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { dashboard, meals as mealsApi } from '@/api/client'
import { formatDisplay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { AlertTriangle, Clock, PackageCheck, Truck, Snowflake } from 'lucide-react'

const STATUS_STYLE = {
  order_now: 'bg-destructive/10 text-destructive border-destructive/30',
  order_soon: 'bg-amber-100 text-amber-800 border-amber-300',
  ok: 'bg-accent text-accent-foreground border-accent',
}

const STATUS_LABEL = {
  order_now: 'Order now',
  order_soon: 'Order soon',
  ok: "You're on track",
}

const EXPIRY_STYLE = {
  expired: 'bg-destructive/10 text-destructive',
  expires_today: 'bg-amber-100 text-amber-800',
  expiring_soon: 'bg-accent text-accent-foreground',
}

export default function Home() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: dashboard.get })

  const freezeMutation = useMutation({
    mutationFn: ({ id, freeze_type }) => mealsApi.freeze(id, freeze_type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['meals'] })
    },
  })

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (!data) return null

  const { delivery, orderNeed, expiryWarnings, pendingReceipts, freezerCandidates } = data

  return (
    <div className="space-y-4 max-w-2xl">
      {pendingReceipts?.length > 0 && (
        <Link
          to="/deliveries"
          className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 p-4"
        >
          <span className="flex items-center gap-2 font-semibold text-sm">
            <Truck className="w-5 h-5 text-primary" />
            {pendingReceipts.length} delivery{pendingReceipts.length === 1 ? '' : 'ies'} awaiting receipt
          </span>
          <span className="text-xs font-medium text-primary shrink-0">Receipt now →</span>
        </Link>
      )}

      <div className={cn('rounded-lg border p-4', STATUS_STYLE[delivery.status])}>
        <div className="flex items-center gap-2 font-semibold">
          <PackageCheck className="w-5 h-5" />
          {STATUS_LABEL[delivery.status]}
        </div>
        <p className="mt-1 text-sm">
          Next delivery <strong>{formatDisplay(delivery.nextDeliveryDate)}</strong> — order by{' '}
          <strong>{formatDisplay(delivery.orderByDate)}</strong> ({delivery.daysUntilOrderBy <= 0 ? 'today or overdue' : `${delivery.daysUntilOrderBy} day${delivery.daysUntilOrderBy === 1 ? '' : 's'} left`})
        </p>
        <p className="mt-2 text-sm">
          You have <strong>{orderNeed.stockAvailable}</strong> meal{orderNeed.stockAvailable === 1 ? '' : 's'} in stock,
          need <strong>{orderNeed.eatingDaysUntilDelivery}</strong> before delivery.{' '}
          {orderNeed.needToOrder ? (
            <>Suggest ordering around <strong>{orderNeed.suggestedOrderQty}</strong> for next cycle.</>
          ) : (
            <>No need to order this cycle.</>
          )}
        </p>
      </div>

      {freezerCandidates?.length > 0 && (
        <div className="rounded-lg border bg-sky-50 border-sky-200 p-4">
          <div className="flex items-center gap-2 font-semibold text-sky-900">
            <Snowflake className="w-5 h-5" />
            {freezerCandidates.length} meal{freezerCandidates.length === 1 ? '' : 's'} should go in the freezer
          </div>
          <p className="mt-1 text-sm text-sky-800">
            Based on your Calendar plan, these won't be eaten before they expire:
          </p>
          <ul className="mt-2 space-y-2">
            {freezerCandidates.map((m) => (
              <FreezeRow
                key={m.id}
                meal={m}
                onFreeze={(freeze_type) => freezeMutation.mutate({ id: m.id, freeze_type })}
                isPending={freezeMutation.isPending}
              />
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 font-semibold text-card-foreground">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          Expiring meals
        </div>
        {expiryWarnings.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing expiring soon.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {expiryWarnings.map((m) => (
              <li key={m.id} className={cn('flex items-center justify-between rounded-md px-3 py-2 text-sm', EXPIRY_STYLE[m.status])}>
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>{m.name}</span>
                </span>
                <span className="font-medium shrink-0">
                  {m.status === 'expired' ? 'Expired' : m.status === 'expires_today' ? 'Today' : `${m.daysUntilExpiry}d left`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function FreezeRow({ meal, onFreeze, isPending }) {
  const [freezeType, setFreezeType] = useState(meal.suggestedFreezeType ?? 'deep')

  return (
    <li className="rounded-md bg-white/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{meal.name}</span>
        <span className="text-xs font-medium shrink-0">expires {formatDisplay(meal.expiry_date)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex gap-1 rounded-md bg-sky-100 p-0.5">
          {['light', 'deep'].map((type) => (
            <button
              key={type}
              onClick={() => setFreezeType(type)}
              className={cn(
                'px-2 py-1 text-xs font-medium rounded capitalize',
                freezeType === type ? 'bg-white shadow-sm text-sky-900' : 'text-sky-700'
              )}
            >
              {type} freeze
            </button>
          ))}
        </div>
        <button
          onClick={() => onFreeze(freezeType)}
          disabled={isPending}
          className="ml-auto rounded-md bg-sky-700 text-white px-3 py-1 text-xs font-medium disabled:opacity-60"
        >
          Freeze
        </button>
      </div>
    </li>
  )
}
