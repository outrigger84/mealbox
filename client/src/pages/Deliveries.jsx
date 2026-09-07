import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { orderPlans as orderPlansApi, schedule as scheduleApi } from '@/api/client'
import { todayStr, addDays, formatDisplay } from '@/lib/dates'
import { parseBoxPaste } from '@/lib/parseBoxPaste'
import { cn } from '@/lib/utils'
import { ClipboardPaste, PackageCheck, X, Check } from 'lucide-react'

const TABS = [
  { key: 'log', label: 'Log order' },
  { key: 'receive', label: 'Receive delivery' },
]

export default function Deliveries() {
  const [tab, setTab] = useState('log')

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex gap-1 rounded-md bg-muted p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded',
              tab === t.key ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'log' ? <LogOrder /> : <ReceiveDelivery />}
    </div>
  )
}

// Next occurrence of the weekly delivery weekday (starting tomorrow), skipping any date
// that already has an order plan logged against it.
function nextUnloggedDeliveryDate(deliveryWeekday, orderPlansList) {
  const loggedDates = new Set((orderPlansList ?? []).map((p) => p.delivery_date))
  let candidate = addDays(todayStr(), 1)
  while (new Date(candidate + 'T00:00:00Z').getUTCDay() !== deliveryWeekday) {
    candidate = addDays(candidate, 1)
  }
  while (loggedDates.has(candidate)) {
    candidate = addDays(candidate, 7)
  }
  return candidate
}

function LogOrder() {
  const queryClient = useQueryClient()
  const { data: scheduleConfig } = useQuery({ queryKey: ['schedule'], queryFn: scheduleApi.get })
  const { data: orderPlansList } = useQuery({ queryKey: ['order-plans'], queryFn: orderPlansApi.list })

  const [deliveryDate, setDeliveryDate] = useState(addDays(todayStr(), 1))
  const [dateTouched, setDateTouched] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [parsedNames, setParsedNames] = useState(null)

  useEffect(() => {
    if (dateTouched || !scheduleConfig || !orderPlansList) return
    setDeliveryDate(nextUnloggedDeliveryDate(scheduleConfig.delivery_weekday, orderPlansList))
  }, [scheduleConfig, orderPlansList, dateTouched])

  const logMutation = useMutation({
    mutationFn: () => orderPlansApi.logOrder(deliveryDate, parsedNames),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-plans'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setPasteText('')
      setParsedNames(null)
      setDateTouched(false)
    },
  })

  function handleParse() {
    setParsedNames(parseBoxPaste(pasteText))
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 font-semibold">
        <ClipboardPaste className="w-5 h-5 text-primary" />
        Log an order
      </div>
      <p className="text-sm text-muted-foreground">
        Paste the "your box" summary from the ordering site, then confirm the expected delivery date. This just records what you
        expect — meals aren't added to stock until you receipt the delivery when it arrives.
      </p>

      <label className="block text-sm">
        Expected delivery date
        <input
          type="date" required value={deliveryDate}
          onChange={(e) => { setDeliveryDate(e.target.value); setDateTouched(true) }}
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        />
      </label>

      <label className="block text-sm">
        Box contents (paste here)
        <textarea
          rows={4} value={pasteText}
          onChange={(e) => { setPasteText(e.target.value); setParsedNames(null) }}
          placeholder="Paste the box summary from the ordering site…"
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        />
      </label>

      {parsedNames === null ? (
        <button
          onClick={handleParse}
          disabled={!pasteText.trim()}
          className="w-full rounded-md border border-primary text-primary py-2 text-sm font-medium disabled:opacity-50"
        >
          Parse box contents
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">{parsedNames.length} meal{parsedNames.length === 1 ? '' : 's'} found:</p>
          {parsedNames.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Couldn't find any meals in that text — check the format matches "Meal Namex1NNN kcal / NN.Ng Protein", or add names manually below.
            </p>
          ) : (
            <ul className="text-sm space-y-1">
              {parsedNames.map((n, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md bg-accent text-accent-foreground px-3 py-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  {n}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setParsedNames(null)}
              className="flex-1 rounded-md border py-2 text-sm font-medium"
            >
              Re-parse
            </button>
            <button
              onClick={() => logMutation.mutate()}
              disabled={parsedNames.length === 0 || logMutation.isPending}
              className="flex-1 rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-60"
            >
              {logMutation.isPending ? 'Saving…' : 'Save order'}
            </button>
          </div>
        </div>
      )}

      {logMutation.isSuccess && <p className="text-xs text-center text-muted-foreground">Order logged — receipt it once it arrives.</p>}
    </div>
  )
}

function ReceiveDelivery() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState(null)

  const { data: pendingPlans, isLoading } = useQuery({
    queryKey: ['order-plans', 'pending'],
    queryFn: orderPlansApi.listPending,
  })

  const selectedPlan = (pendingPlans ?? []).find((p) => p.id === selectedId)

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['order-plans'] })
    queryClient.invalidateQueries({ queryKey: ['meals'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    setSelectedId(null)
  }

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>

  if (!pendingPlans || pendingPlans.length === 0) {
    return <p className="text-muted-foreground">No orders awaiting receipt.</p>
  }

  if (selectedPlan) {
    return <ReceiptForm plan={selectedPlan} onCancel={() => setSelectedId(null)} onDone={invalidateAll} />
  }

  return (
    <ul className="space-y-2">
      {pendingPlans.map((p) => (
        <li key={p.id}>
          <button
            onClick={() => setSelectedId(p.id)}
            className="w-full flex items-center justify-between rounded-lg border bg-card p-3 text-left"
          >
            <span>
              <span className="font-medium">{formatDisplay(p.delivery_date)}</span>
              <span className="block text-xs text-muted-foreground">{p.items.length} meal{p.items.length === 1 ? '' : 's'} expected</span>
            </span>
            <PackageCheck className="w-5 h-5 text-primary shrink-0" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function ReceiptForm({ plan, onCancel, onDone }) {
  const [defaultExpiry, setDefaultExpiry] = useState(addDays(todayStr(), 5))
  const [itemState, setItemState] = useState(() =>
    Object.fromEntries(plan.items.map((item) => [item.id, { received: true, expiry_date: '' }]))
  )

  const receiptMutation = useMutation({
    mutationFn: () => {
      const items = plan.items.map((item) => ({
        id: item.id,
        received: itemState[item.id].received,
        expiry_date: itemState[item.id].expiry_date || undefined,
      }))
      return orderPlansApi.receipt(plan.id, defaultExpiry, items)
    },
    onSuccess: onDone,
  })

  function toggleReceived(id) {
    setItemState((s) => ({ ...s, [id]: { ...s[id], received: !s[id].received } }))
  }
  function setItemExpiry(id, value) {
    setItemState((s) => ({ ...s, [id]: { ...s[id], expiry_date: value } }))
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Receiving delivery — {formatDisplay(plan.delivery_date)}</h3>
        <button onClick={onCancel} aria-label="Cancel"><X className="w-4 h-4 text-muted-foreground" /></button>
      </div>

      <label className="block text-sm">
        Default expiry date (applies to all unless overridden below)
        <input
          type="date" required value={defaultExpiry}
          onChange={(e) => setDefaultExpiry(e.target.value)}
          className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
        />
      </label>

      <ul className="space-y-2">
        {plan.items.map((item) => (
          <li key={item.id} className={cn('rounded-md border p-2', !itemState[item.id].received && 'opacity-50')}>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-medium min-w-0">
                <input
                  type="checkbox"
                  checked={itemState[item.id].received}
                  onChange={() => toggleReceived(item.id)}
                  className="shrink-0"
                />
                <span className="truncate">{item.name}</span>
              </label>
              {itemState[item.id].received && (
                <input
                  type="date"
                  value={itemState[item.id].expiry_date}
                  onChange={(e) => setItemExpiry(item.id, e.target.value)}
                  placeholder={defaultExpiry}
                  className="w-36 rounded-md border px-2 py-1 text-xs shrink-0"
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={() => receiptMutation.mutate()}
        disabled={receiptMutation.isPending}
        className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-60"
      >
        {receiptMutation.isPending ? 'Confirming…' : 'Confirm receipt'}
      </button>
    </div>
  )
}
