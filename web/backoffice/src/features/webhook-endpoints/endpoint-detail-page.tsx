import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import z from 'zod'
import { api, call, type Schemas } from '@/api/client'
import { DateTime } from '@/components/date-time'
import { FilterBar, PageHeader, SelectFilter } from '@/components/filters'
import { Pager } from '@/components/pager'
import { useHasRole } from '@/components/role-gate'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ActionDialog } from '@/features/actions/action-dialog'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'
import { EVENT_STATUSES } from '@/features/events/page'
import { useSearchState } from '@/lib/search-state'

type Delivery = Schemas['WebhookDeliveryList']['items'][number]

const searchSchema = z.object({
  status: z.enum(['pending', 'delivered', 'dead']).optional().catch(undefined),
  cursor: z.string().optional(),
})

function Attempts({ delivery }: { delivery: Delivery }) {
  if (!delivery.attemptLog.length)
    return <span className="text-muted-foreground">Nenhuma</span>
  return (
    <ul className="grid gap-0.5 text-xs" aria-label="Tentativas">
      {delivery.attemptLog.map(attempt => {
        const http = `HTTP ${attempt.statusCode ?? '—'}`
        return (
          <li key={attempt.attempt} className="flex flex-wrap gap-x-2">
            <span className="font-medium">#{attempt.attempt}</span>
            <span>{http}</span>
            {attempt.error && attempt.error !== http && (
              <span className="text-destructive">{attempt.error}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ResendOneButton(props: { endpointId: number; delivery: Delivery }) {
  const resend = useAdminAction({
    run: () =>
      call(
        api.POST('/admin/webhook-deliveries/{id}/resend', {
          params: { path: { id: props.delivery.id } },
        }),
      ),
    invalidates: () => INVALIDATES.webhookDeliveries(props.endpointId),
    success: () => 'Entrega reenfileirada',
  })
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={resend.pending}
      onClick={() => void resend.execute(undefined)}
    >
      Reenviar
    </Button>
  )
}

/** Reenvio das mortas do destinatário: prévia da quantidade (`dryRun`), depois o motivo. */
function ResendDeadDialog(props: {
  endpointId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  target: string
}) {
  const { endpointId } = props
  const preview = useQuery({
    queryKey: ['webhook-resend-preview', endpointId],
    queryFn: () =>
      call(
        api.POST('/admin/webhook-endpoints/{id}/resend-dead', {
          params: { path: { id: endpointId } },
          body: { dryRun: true },
        }),
      ),
    enabled: props.open,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  })
  const resend = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/webhook-endpoints/{id}/resend-dead', {
          params: {
            path: { id: endpointId },
            header: { 'X-Admin-Reason': reason ?? '' },
          },
          body: {},
        }),
      ),
    invalidates: () => INVALIDATES.webhookDeliveries(endpointId),
    success: result =>
      `${result.requeued} ${result.requeued === 1 ? 'entrega reenviada' : 'entregas reenviadas'}`,
  })
  const matched = preview.data?.matched
  return (
    <ActionDialog
      open={props.open}
      onOpenChange={next => {
        if (!next) resend.reset()
        props.onOpenChange(next)
      }}
      title="Reenviar entregas mortas"
      target={props.target}
      effect={
        preview.isError
          ? 'Não foi possível calcular quantas entregas serão reenviadas.'
          : matched === undefined
            ? 'Calculando quantas entregas serão reenviadas…'
            : matched === 0
              ? 'Nenhuma entrega morta para reenviar.'
              : `${matched} ${matched === 1 ? 'entrega morta será reenviada' : 'entregas mortas serão reenviadas'} a este destinatário, com a janela de reenvio reaberta.`
      }
      confirmLabel="Reenviar"
      reasonRequired
      pending={resend.pending}
      error={resend.error ?? (preview.isError ? preview.error : null)}
      disabled={!matched}
      onConfirm={async reason => {
        if (await resend.execute(undefined, reason)) props.onOpenChange(false)
      }}
    />
  )
}

/** Detalhe de um destinatário: as entregas, com tentativas, filtro por estado e reenvio. */
export function WebhookEndpointDetailPage() {
  const id = Number(useParams().id)
  const canManage = useHasRole('operator')
  const [state, update] = useSearchState(searchSchema)
  const [resendOpen, setResendOpen] = useState(false)

  const endpoints = useQuery({
    queryKey: ['webhook-endpoints'],
    queryFn: () => call(api.GET('/admin/webhook-endpoints')),
  })
  const endpoint = endpoints.data?.items.find(item => item.id === id)
  const query = { status: state.status, cursor: state.cursor }
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', id, query],
    queryFn: () =>
      call(
        api.GET('/admin/webhook-endpoints/{id}/deliveries', {
          params: { path: { id }, query },
        }),
      ),
    placeholderData: keepPreviousData,
  })

  if (endpoints.isPending) return <LoadingState />
  if (endpoints.isError)
    return (
      <ErrorState
        error={endpoints.error}
        onRetry={() => void endpoints.refetch()}
      />
    )
  if (!endpoint) return <EmptyState message="Destinatário não encontrado." />

  return (
    <>
      <PageHeader title={endpoint.name} description={endpoint.url}>
        <div className="flex items-center gap-2">
          <Badge variant={endpoint.active ? 'secondary' : 'outline'}>
            {endpoint.active ? 'Ativo' : 'Desativado'}
          </Badge>
          {canManage && (
            <Button variant="outline" onClick={() => setResendOpen(true)}>
              Reenviar mortas
            </Button>
          )}
        </div>
      </PageHeader>

      <FilterBar>
        <SelectFilter
          id="filter-status"
          label="Estado"
          value={state.status}
          options={EVENT_STATUSES}
          onChange={status => update({ status })}
        />
      </FilterBar>

      {deliveries.isPending ? (
        <LoadingState />
      ) : deliveries.isError ? (
        <ErrorState
          error={deliveries.error}
          onRetry={() => void deliveries.refetch()}
        />
      ) : !deliveries.data.items.length ? (
        <EmptyState
          message={`Nenhuma entrega${state.status ? ` com estado ${state.status}` : ''}.`}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Instalação</TableHead>
                <TableHead>Tentativas</TableHead>
                <TableHead>Criada</TableHead>
                {canManage && (
                  <TableHead className="w-24">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.data.items.map(delivery => (
                <TableRow key={delivery.id}>
                  <TableCell className="font-medium">
                    {delivery.eventType}
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="event" value={delivery.status} />
                  </TableCell>
                  <TableCell>{delivery.appCode}</TableCell>
                  <TableCell>
                    <Link
                      to={`/installations/${delivery.installationId}`}
                      className="hover:underline"
                    >
                      #{delivery.installationId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Attempts delivery={delivery} />
                  </TableCell>
                  <TableCell>
                    <DateTime value={delivery.createdAt} />
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <ResendOneButton endpointId={id} delivery={delivery} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            cursor={state.cursor}
            nextCursor={deliveries.data.nextCursor}
            onCursor={cursor => update({ cursor })}
          />
        </>
      )}

      <ResendDeadDialog
        endpointId={id}
        open={resendOpen}
        onOpenChange={setResendOpen}
        target={`#${endpoint.id} · ${endpoint.name}`}
      />
    </>
  )
}
