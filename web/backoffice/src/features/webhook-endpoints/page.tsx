import { useQuery } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { api, call, type Schemas } from '@/api/client'
import { PageHeader } from '@/components/filters'
import { useHasRole } from '@/components/role-gate'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  SecretRevealDialog,
  useSecretReveal,
  type SecretReveal,
} from '@/features/actions/secret-reveal-dialog'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'
import { formatDateTime } from '@/lib/format'
import { EndpointFormDialog } from './endpoint-form-dialog'
import { typesLabel } from './event-types'

type Endpoint = Schemas['WebhookEndpointList']['items'][number]

type Pending =
  | { kind: 'create' }
  | { kind: 'edit'; endpoint: Endpoint }
  | { kind: 'rotate'; endpoint: Endpoint }
  | { kind: 'active'; endpoint: Endpoint }
  | null

const targetOf = (endpoint: Endpoint) => `#${endpoint.id} · ${endpoint.name}`

function RotateDialog(props: {
  endpoint: Endpoint
  onClose: () => void
  onIssued: (reveal: SecretReveal) => void
}) {
  const { endpoint } = props
  const rotate = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/webhook-endpoints/{id}/rotate-secret', {
          params: {
            path: { id: endpoint.id },
            header: { 'X-Admin-Reason': reason ?? '' },
          },
        }),
      ),
    invalidates: () => INVALIDATES.webhookEndpoints(),
    success: () => `Segredo de ${endpoint.name} rotacionado`,
  })
  return (
    <ActionDialog
      open
      onOpenChange={open => {
        if (!open) {
          rotate.reset()
          props.onClose()
        }
      }}
      title="Rotacionar segredo"
      target={targetOf(endpoint)}
      effect="Gera um segredo novo. O anterior continua assinando em paralelo durante o período de convivência, para o destinatário trocar sem perder eventos. O segredo novo aparece uma única vez."
      confirmLabel="Rotacionar segredo"
      destructive
      reasonRequired
      pending={rotate.pending}
      error={rotate.error}
      onConfirm={async reason => {
        const done = await rotate.execute(undefined, reason)
        if (!done) return
        rotate.reset()
        props.onClose()
        props.onIssued({
          title: 'Segredo rotacionado',
          secrets: [
            { label: 'Segredo de assinatura', value: done.result.secret },
          ],
          notes: [
            { label: 'Destinatário', value: endpoint.name },
            {
              label: 'Segredo anterior vale até',
              value: formatDateTime(done.result.previousValidUntil),
            },
          ],
        })
      }}
    />
  )
}

function ActiveDialog(props: { endpoint: Endpoint; onClose: () => void }) {
  const { endpoint } = props
  const activate = !endpoint.active
  const update = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.PATCH('/admin/webhook-endpoints/{id}', {
          body: { active: activate },
          params: {
            path: { id: endpoint.id },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
        }),
      ),
    invalidates: () => INVALIDATES.webhookEndpoints(),
    success: () =>
      activate ? 'Destinatário reativado' : 'Destinatário desativado',
  })
  return (
    <ActionDialog
      open
      onOpenChange={open => {
        if (!open) {
          update.reset()
          props.onClose()
        }
      }}
      title={activate ? 'Reativar destinatário' : 'Desativar destinatário'}
      target={targetOf(endpoint)}
      effect={
        activate
          ? 'Volta a receber os eventos. As entregas pendentes retomam, dentro da janela de reenvio.'
          : 'Para as tentativas de entrega. As pendentes esperam e retomam na reativação, mas passada a janela de 24 h viram dead (reenviáveis).'
      }
      confirmLabel={activate ? 'Reativar' : 'Desativar'}
      destructive={!activate}
      reasonRequired={!activate}
      pending={update.pending}
      error={update.error}
      onConfirm={async reason => {
        if (await update.execute(undefined, reason)) props.onClose()
      }}
    />
  )
}

/** Tela "Destinatários de eventos": URLs que recebem os eventos da plataforma. `viewer` só lê. */
export function WebhookEndpointsPage() {
  const canManage = useHasRole('operator')
  const [pending, setPending] = useState<Pending>(null)
  const secret = useSecretReveal()
  const list = useQuery({
    queryKey: ['webhook-endpoints'],
    queryFn: () => call(api.GET('/admin/webhook-endpoints')),
  })
  const close = () => setPending(null)

  return (
    <>
      <PageHeader
        title="Destinatários de eventos"
        description="URLs que recebem os eventos da plataforma, como ERP e financeiro."
      >
        {canManage && (
          <Button onClick={() => setPending({ kind: 'create' })}>
            Novo destinatário
          </Button>
        )}
      </PageHeader>

      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState message="Nenhum destinatário cadastrado." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Eventos</TableHead>
              <TableHead>Apps</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Pendentes</TableHead>
              <TableHead>Mortas</TableHead>
              {canManage && (
                <TableHead className="w-12">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.items.map(endpoint => (
              <TableRow key={endpoint.id}>
                <TableCell className="font-medium">
                  <Link
                    to={`/webhook-endpoints/${endpoint.id}`}
                    className="hover:underline"
                  >
                    {endpoint.name}
                  </Link>
                </TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs">
                  {endpoint.url}
                </TableCell>
                <TableCell>{typesLabel(endpoint.eventTypes.length)}</TableCell>
                <TableCell className="text-xs">
                  {endpoint.appCodes.length
                    ? endpoint.appCodes.join(', ')
                    : 'Todos os apps'}
                </TableCell>
                <TableCell>
                  <Badge variant={endpoint.active ? 'secondary' : 'outline'}>
                    {endpoint.active ? 'Ativo' : 'Desativado'}
                  </Badge>
                </TableCell>
                <TableCell>{endpoint.pendingDeliveries}</TableCell>
                <TableCell
                  className={endpoint.deadDeliveries ? 'text-destructive' : ''}
                >
                  {endpoint.deadDeliveries}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ações de ${endpoint.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({ kind: 'edit', endpoint })
                          }
                        >
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({ kind: 'rotate', endpoint })
                          }
                        >
                          Rotacionar segredo
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({ kind: 'active', endpoint })
                          }
                        >
                          {endpoint.active ? 'Desativar' : 'Reativar'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <EndpointFormDialog
        open={pending?.kind === 'create'}
        onOpenChange={open => !open && close()}
        onIssued={secret.show}
      />
      {pending?.kind === 'edit' && (
        <EndpointFormDialog
          open
          endpoint={pending.endpoint}
          onOpenChange={open => !open && close()}
        />
      )}
      {pending?.kind === 'rotate' && (
        <RotateDialog
          endpoint={pending.endpoint}
          onClose={close}
          onIssued={secret.show}
        />
      )}
      {pending?.kind === 'active' && (
        <ActiveDialog endpoint={pending.endpoint} onClose={close} />
      )}
      <SecretRevealDialog reveal={secret.reveal} onDismiss={secret.dismiss} />
    </>
  )
}
