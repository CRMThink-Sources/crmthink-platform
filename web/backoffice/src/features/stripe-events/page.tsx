import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import z from 'zod'
import { api, call } from '@/api/client'
import type { StripeEvent } from '@/api/types'
import { DateTime } from '@/components/date-time'
import {
  AppFilter,
  DateFilter,
  describeFilters,
  FilterBar,
  JsonBlock,
  PageHeader,
  SelectFilter,
  TextFilter,
} from '@/components/filters'
import { Pager } from '@/components/pager'
import { useHasRole } from '@/components/role-gate'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { StatusBadge } from '@/components/status-badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useSearchState } from '@/lib/search-state'

const STATUSES = [
  { value: 'received', label: 'Recebido' },
  { value: 'processed', label: 'Processado' },
  { value: 'ignored', label: 'Ignorado' },
  { value: 'failed', label: 'Falhou' },
  { value: 'dead', label: 'Morto' },
]

const searchSchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  appCode: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
})

/** Payload cru do Stripe: só `operator` (a API também recusa `viewer`). */
function Payload({ eventId }: { eventId: string }) {
  const detail = useQuery({
    queryKey: ['stripe-event', eventId],
    queryFn: () =>
      call(
        api.GET('/admin/stripe-events/{eventId}', {
          params: { path: { eventId } },
        }),
      ),
  })
  if (detail.isPending) return <LoadingState rows={3} />
  if (detail.isError)
    return (
      <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
    )
  return <JsonBlock value={detail.data.payload} />
}

function StripeSheet(props: {
  event: StripeEvent | null
  onClose: () => void
}) {
  const isOperator = useHasRole('operator')
  const event = props.event
  return (
    <Sheet open={!!event} onOpenChange={open => !open && props.onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {event && (
          <>
            <SheetHeader>
              <SheetTitle>{event.type}</SheetTitle>
              <SheetDescription>
                <code className="text-xs">{event.eventId}</code>
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-4 px-4 pb-6 text-sm">
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd>
                    <StatusBadge kind="stripe" value={event.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">App</dt>
                  <dd>{event.appCode ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Tentativas</dt>
                  <dd>{event.attempts}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Recebido</dt>
                  <dd>
                    <DateTime value={event.receivedAt} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Processado</dt>
                  <dd>
                    <DateTime value={event.processedAt} />
                  </dd>
                </div>
              </dl>
              {event.error && (
                <section className="grid gap-1">
                  <h3 className="font-medium">Erro</h3>
                  <p className="text-destructive">{event.error}</p>
                </section>
              )}
              {isOperator && (
                <section className="grid gap-2">
                  <h3 className="font-medium">Payload</h3>
                  <Payload eventId={event.eventId} />
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function StripeEventsPage() {
  const [state, update] = useSearchState(searchSchema)
  const [open, setOpen] = useState<StripeEvent | null>(null)
  const list = useQuery({
    queryKey: ['stripe-events', state],
    queryFn: () =>
      call(api.GET('/admin/stripe-events', { params: { query: state } })),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader title="Eventos Stripe" />
      <FilterBar>
        <SelectFilter
          id="filter-status"
          label="Status"
          value={state.status}
          options={STATUSES}
          onChange={status => update({ status })}
        />
        <TextFilter
          id="filter-type"
          label="Tipo"
          placeholder="invoice.paid"
          value={state.type}
          onSubmit={type => update({ type })}
        />
        <AppFilter
          value={state.appCode}
          onChange={appCode => update({ appCode })}
        />
        <DateFilter
          id="filter-from"
          label="De"
          value={state.from}
          onChange={from => update({ from })}
        />
        <DateFilter
          id="filter-to"
          label="Até"
          value={state.to}
          onChange={to => update({ to })}
        />
      </FilterBar>
      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState
          message={`Nenhum evento Stripe${describeFilters({
            status: state.status,
            tipo: state.type,
            app: state.appCode,
            de: state.from,
            até: state.to,
          })}.`}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>App</TableHead>
                <TableHead className="text-right">Tentativas</TableHead>
                <TableHead>Recebido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map(event => (
                <TableRow
                  key={event.eventId}
                  className="cursor-pointer"
                  onClick={() => setOpen(event)}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => setOpen(event)}
                    >
                      {event.type}
                    </button>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="stripe" value={event.status} />
                  </TableCell>
                  <TableCell>{event.appCode ?? '—'}</TableCell>
                  <TableCell className="text-right">{event.attempts}</TableCell>
                  <TableCell>
                    <DateTime value={event.receivedAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            cursor={state.cursor}
            nextCursor={list.data.nextCursor}
            onCursor={cursor => update({ cursor })}
          />
        </>
      )}
      <StripeSheet event={open} onClose={() => setOpen(null)} />
    </>
  )
}
