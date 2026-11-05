import { useInfiniteQuery } from '@tanstack/react-query'
import { CreditCard, Send, ShieldCheck, Wrench } from 'lucide-react'
import { api, call } from '@/api/client'
import type { TimelineItem } from '@/api/types'
import { DateTime } from '@/components/date-time'
import { SelectFilter } from '@/components/filters'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const KINDS = {
  install_attempt: {
    label: 'Instalação',
    icon: Wrench,
    color: 'text-sky-600 bg-sky-500/10',
  },
  event: {
    label: 'Evento enviado ao app',
    icon: Send,
    color: 'text-violet-600 bg-violet-500/10',
  },
  purchase: {
    label: 'Compra avulsa',
    icon: CreditCard,
    color: 'text-emerald-600 bg-emerald-500/10',
  },
  admin_action: {
    label: 'Ação de operador',
    icon: ShieldCheck,
    color: 'text-amber-600 bg-amber-500/10',
  },
} as const

type Delivery = {
  attempt: number
  statusCode: number | null
  error: string | null
  createdAt: string
}

function Deliveries({ deliveries }: { deliveries: Delivery[] }) {
  if (!deliveries.length)
    return (
      <p className="text-xs text-muted-foreground">
        Nenhuma tentativa de entrega ainda.
      </p>
    )
  return (
    <ul className="grid gap-0.5 text-xs" aria-label="Tentativas de entrega">
      {deliveries.map(delivery => (
        <li key={delivery.attempt} className="flex flex-wrap gap-x-2">
          <span className="font-medium">#{delivery.attempt}</span>
          <span>HTTP {delivery.statusCode ?? '—'}</span>
          {delivery.error && (
            <span className="text-destructive">{delivery.error}</span>
          )}
          <span className="text-muted-foreground">
            <DateTime value={delivery.createdAt} />
          </span>
        </li>
      ))}
    </ul>
  )
}

function Entry({ item }: { item: TimelineItem }) {
  const kind = KINDS[item.kind]
  const data = item.data as Record<string, unknown>
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
          kind.color,
        )}
        title={kind.label}
      >
        <kind.icon className="size-4" />
      </span>
      <div className="grid min-w-0 flex-1 gap-1 border-b pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.summary}</span>
          {item.kind === 'event' && typeof data.status === 'string' && (
            <StatusBadge kind="event" value={data.status} />
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            <DateTime value={item.occurredAt} />
          </span>
        </div>
        {item.kind === 'install_attempt' && typeof data.error === 'string' && (
          <p className="text-xs text-destructive">{data.error}</p>
        )}
        {item.kind === 'event' && (
          <Deliveries
            deliveries={(data.deliveries as Delivery[] | undefined) ?? []}
          />
        )}
        {item.kind === 'admin_action' && (
          <p className="text-xs text-muted-foreground">
            Status {String(data.statusCode ?? '—')}
            {data.errorCode ? ` · ${String(data.errorCode)}` : ''}
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * Linha do tempo da instalação: tentativas de instalação, eventos com as entregas,
 * compras e ações de operador, do mais recente para o mais antigo. Erro aqui não
 * esconde o resto do detalhe.
 */
export function Timeline(props: {
  installationId: number
  kind: string | undefined
  onKind: (kind: string | undefined) => void
}) {
  const timeline = useInfiniteQuery({
    queryKey: ['installation', props.installationId, 'timeline', props.kind],
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/admin/installations/{id}/timeline', {
          params: {
            path: { id: props.installationId },
            query: { kind: props.kind, cursor: pageParam },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
  })

  const items = timeline.data?.pages.flatMap(page => page.items) ?? []
  return (
    <div className="grid gap-4">
      <SelectFilter
        id="filter-kind"
        label="Tipo"
        value={props.kind}
        options={Object.entries(KINDS).map(([value, kind]) => ({
          value,
          label: kind.label,
        }))}
        onChange={props.onKind}
      />
      {timeline.isPending ? (
        <LoadingState />
      ) : timeline.isError ? (
        <ErrorState
          error={timeline.error}
          onRetry={() => void timeline.refetch()}
        />
      ) : !items.length ? (
        <EmptyState message="Nada na linha do tempo com este filtro." />
      ) : (
        <>
          <ol className="grid gap-3" aria-label="Linha do tempo">
            {items.map(item => (
              <Entry key={`${item.ref.type}:${item.ref.id}`} item={item} />
            ))}
          </ol>
          {timeline.hasNextPage && (
            <Button
              variant="outline"
              className="justify-self-center"
              disabled={timeline.isFetchingNextPage}
              onClick={() => void timeline.fetchNextPage()}
            >
              {timeline.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
