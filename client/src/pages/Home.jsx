import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { dashboard } from '@/api/client'
import { formatDisplay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { AlertTriangle, Clock, PackageCheck, Truck } from 'lucide-react'

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
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: dashboard.get })

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (!data) return null

  const { delivery, orderNeed, expiryWarnings, pendingReceipts } = data

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
                  <span>
                    {m.name}
                    {m.unplanned && <span className="ml-2 text-xs font-semibold uppercase tracking-wide">unplanned</span>}
                  </span>
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
