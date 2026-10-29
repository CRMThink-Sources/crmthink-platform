import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import z from 'zod'
import { api, call } from '@/api/client'
import type { OutboxEvent } from '@/api/types'
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

export const EVENT_STATUSES = [
  { value: 'pending', label: 'Pendente' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'dead', label: 'Morto' },
]

type EventFilters = {
  appCode?: string
  status?: 'pending' | 'delivered' | 'dead'
  type?: string
  installationId?: number
  from?: string
  to?: string
}

const searchSchema = z.object({
  appCode: z.string().optional(),
  status: z.enum(['pending', 'delivered', 'dead']).optional().catch(undefined),
  type: z.string().optional(),
  installationId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .catch(undefined),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
})

const createdAt = (event: OutboxEvent) =>
  typeof event.createdAt === 'string' ? event.createdAt : null

function EventSheet(props: { event: OutboxEvent | null; onClose: () => void }) {
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
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge kind="event" value={event.status} />
                <Link
                  to={`/installations/${event.installationId}`}
                  className="hover:underline"
                >
                  Instalação #{event.installationId}
                </Link>
                <span>{event.appCode}</span>
                <span className="text-muted-foreground">
                  {event.attempts} tentativa(s)
                </span>
              </div>
              <section className="grid gap-2">
                <h3 className="font-medium">Tentativas de entrega recentes</h3>
                {event.deliveries.length ? (
                  <ul className="grid gap-1" aria-label="Tentativas de entrega">
                    {event.deliveries.map(delivery => (
                      <li
                        key={delivery.attempt}
                        className="flex flex-wrap gap-x-2"
                      >
                        <span className="font-medium">#{delivery.attempt}</span>
                        <span>HTTP {delivery.statusCode ?? '—'}</span>
                        {delivery.error && (
                          <span className="text-destructive">
                            {delivery.error}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    Nenhuma tentativa ainda.
                  </p>
                )}
              </section>
              <section className="grid gap-2">
                <h3 className="font-medium">Envelope entregue ao app</h3>
                <JsonBlock value={event.payload} />
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/**
 * Tabela de eventos enviados aos apps. Na tela de eventos o cursor vai na URL; na aba
 * da instalação fica local (a URL já é da instalação).
 */
export function EventsTable(props: {
  filters: EventFilters
  cursor?: string
  onCursor?: (cursor: string | undefined) => void
}) {
  const [localCursor, setLocalCursor] = useState<string | undefined>()
  const cursor = props.onCursor ? props.cursor : localCursor
  const onCursor = props.onCursor ?? setLocalCursor
  const [open, setOpen] = useState<OutboxEvent | null>(null)
  const query = { ...props.filters, cursor }
  const list = useQuery({
    queryKey: ['events', query],
    queryFn: () => call(api.GET('/admin/events', { params: { query } })),
    placeholderData: keepPreviousData,
  })

  if (list.isPending) return <LoadingState />
  if (list.isError)
    return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (!list.data.items.length)
    return (
      <EmptyState
        message={`Nenhum evento${describeFilters({
          app: props.filters.appCode,
          status: props.filters.status,
          tipo: props.filters.type,
          instalação: props.filters.installationId,
          de: props.filters.from,
          até: props.filters.to,
        })}.`}
      />
    )
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>App</TableHead>
            <TableHead>Instalação</TableHead>
            <TableHead className="text-right">Tentativas</TableHead>
            <TableHead>Criado</TableHead>
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
                <StatusBadge kind="event" value={event.status} />
              </TableCell>
              <TableCell>{event.appCode}</TableCell>
              <TableCell>#{event.installationId}</TableCell>
              <TableCell className="text-right">{event.attempts}</TableCell>
              <TableCell>
                <DateTime value={createdAt(event)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager
        cursor={cursor}
        nextCursor={list.data.nextCursor}
        onCursor={onCursor}
      />
      <EventSheet event={open} onClose={() => setOpen(null)} />
    </>
  )
}

export function EventsPage() {
  const [state, update] = useSearchState(searchSchema)
  const { cursor, ...filters } = state
  return (
    <>
      <PageHeader title="Eventos enviados aos apps" />
      <FilterBar>
        <AppFilter
          value={state.appCode}
          onChange={appCode => update({ appCode })}
        />
        <SelectFilter
          id="filter-status"
          label="Status"
          value={state.status}
          options={EVENT_STATUSES}
          onChange={status => update({ status })}
        />
        <TextFilter
          id="filter-type"
          label="Tipo"
          placeholder="subscription.renewed"
          value={state.type}
          onSubmit={type => update({ type })}
        />
        <TextFilter
          id="filter-installation"
          label="Instalação"
          placeholder="id"
          value={state.installationId?.toString()}
          onSubmit={installationId => update({ installationId })}
          className="w-36"
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
      <EventsTable
        filters={filters}
        cursor={cursor}
        onCursor={c => update({ cursor: c })}
      />
    </>
  )
}
