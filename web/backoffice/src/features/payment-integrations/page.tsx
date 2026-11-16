import { useQuery } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useId, useState } from 'react'
import { api, call, type Schemas } from '@/api/client'
import { DateTime } from '@/components/date-time'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

type Integration = Schemas['PaymentIntegration']
type Issued = Schemas['PaymentIntegrationKey']

type Pending =
  | { kind: 'create' }
  | { kind: 'rename'; integration: Integration }
  | { kind: 'rotate'; integration: Integration }
  | { kind: 'active'; integration: Integration }
  | null

/** A chave só existe aqui: no estado do diálogo, nunca no cache de consultas. */
const revealOf = (title: string, issued: Issued): SecretReveal => ({
  title,
  secrets: [{ label: 'Chave de integração', value: issued.apiKey }],
  notes: [{ label: 'Integração', value: issued.integration.name }],
})

function CreateDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onIssued: (reveal: SecretReveal) => void
}) {
  const id = useId()
  const [name, setName] = useState('')
  const create = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/payment-integrations', {
          body: { name: name.trim() },
          params: { header: { 'X-Admin-Reason': reason ?? '' } },
        }),
      ),
    invalidates: () => INVALIDATES.paymentIntegrations(),
    success: res => `Integração ${res.integration.name} criada`,
  })
  return (
    <ActionDialog
      open={props.open}
      onOpenChange={next => {
        if (!next) {
          create.reset()
          setName('')
        }
        props.onOpenChange(next)
      }}
      title="Nova integração de pagamento"
      target="Novo remetente de avisos de pagamento"
      effect="Cria a integração e gera a chave que o sistema de cobrança usa em POST /webhooks/payments. A chave aparece uma única vez, na próxima tela."
      confirmLabel="Criar integração"
      reasonRequired
      disabled={!name.trim()}
      pending={create.pending}
      error={create.error}
      onConfirm={async reason => {
        const done = await create.execute(undefined, reason)
        if (!done) return
        create.reset()
        props.onOpenChange(false)
        props.onIssued(revealOf('Chave criada', done.result))
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Nome</Label>
        <Input
          id={id}
          autoComplete="off"
          maxLength={200}
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </div>
    </ActionDialog>
  )
}

function RenameDialog(props: {
  integration: Integration
  onClose: () => void
}) {
  const { integration } = props
  const id = useId()
  const [name, setName] = useState(integration.name)
  const rename = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.PATCH('/admin/payment-integrations/{id}', {
          body: { name: name.trim() },
          params: {
            path: { id: integration.id },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
        }),
      ),
    invalidates: () => INVALIDATES.paymentIntegrations(),
    success: () => 'Integração renomeada',
  })
  return (
    <ActionDialog
      open
      onOpenChange={open => {
        if (!open) {
          rename.reset()
          props.onClose()
        }
      }}
      title="Renomear integração"
      target={`${integration.name} · ${integration.keyPrefix}…`}
      effect="Só muda o nome exibido; a chave e o estado continuam os mesmos."
      confirmLabel="Renomear"
      disabled={!name.trim() || name.trim() === integration.name}
      pending={rename.pending}
      error={rename.error}
      onConfirm={async reason => {
        if (await rename.execute(undefined, reason)) props.onClose()
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Nome</Label>
        <Input
          id={id}
          autoComplete="off"
          maxLength={200}
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </div>
    </ActionDialog>
  )
}

function RotateDialog(props: {
  integration: Integration
  onClose: () => void
  onIssued: (reveal: SecretReveal) => void
}) {
  const { integration } = props
  const rotate = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/payment-integrations/{id}/rotate-key', {
          params: {
            path: { id: integration.id },
            header: { 'X-Admin-Reason': reason ?? '' },
          },
        }),
      ),
    invalidates: () => INVALIDATES.paymentIntegrations(),
    success: () => `Chave de ${integration.name} rotacionada`,
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
      title="Rotacionar chave"
      target={`${integration.name} · ${integration.keyPrefix}…`}
      effect="Gera uma chave nova e invalida a atual na hora: o sistema remetente precisa ser atualizado em seguida. A chave nova aparece uma única vez."
      confirmLabel="Rotacionar chave"
      destructive
      reasonRequired
      pending={rotate.pending}
      error={rotate.error}
      onConfirm={async reason => {
        const done = await rotate.execute(undefined, reason)
        if (!done) return
        rotate.reset()
        props.onClose()
        props.onIssued(revealOf('Chave rotacionada', done.result))
      }}
    />
  )
}

function ActiveDialog(props: {
  integration: Integration
  onClose: () => void
}) {
  const { integration } = props
  const activate = !integration.active
  const update = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.PATCH('/admin/payment-integrations/{id}', {
          body: { active: activate },
          params: {
            path: { id: integration.id },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
        }),
      ),
    invalidates: () => INVALIDATES.paymentIntegrations(),
    success: () =>
      activate ? 'Integração reativada' : 'Integração desativada',
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
      title={activate ? 'Reativar integração' : 'Desativar integração'}
      target={`${integration.name} · ${integration.keyPrefix}…`}
      effect={
        activate
          ? 'A integração volta a aceitar avisos de pagamento com a mesma chave.'
          : 'A integração deixa de aceitar avisos (403 INTEGRATION_INACTIVE) até ser reativada. O histórico é mantido.'
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

/** Tela "Integrações de pagamento": chaves de quem avisa pagamentos. `viewer` só lê. */
export function PaymentIntegrationsPage() {
  const canManage = useHasRole('operator')
  const [pending, setPending] = useState<Pending>(null)
  const secret = useSecretReveal()
  const list = useQuery({
    queryKey: ['payment-integrations'],
    queryFn: () => call(api.GET('/admin/payment-integrations')),
  })
  const close = () => setPending(null)

  return (
    <>
      <PageHeader
        title="Integrações de pagamento"
        description="Sistemas que avisam pagamentos de boleto e as chaves de cada um."
      >
        {canManage && (
          <Button onClick={() => setPending({ kind: 'create' })}>
            Nova integração
          </Button>
        )}
      </PageHeader>

      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState message="Nenhuma integração cadastrada." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Último uso</TableHead>
              <TableHead>Criada</TableHead>
              {canManage && (
                <TableHead className="w-12">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.items.map(integration => (
              <TableRow key={integration.id}>
                <TableCell className="font-medium">
                  {integration.name}
                </TableCell>
                <TableCell>
                  <code className="text-xs">{integration.keyPrefix}…</code>
                </TableCell>
                <TableCell>
                  <Badge variant={integration.active ? 'secondary' : 'outline'}>
                    {integration.active ? 'Ativa' : 'Desativada'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {integration.lastUsedAt ? (
                    <DateTime value={integration.lastUsedAt} />
                  ) : (
                    <span className="text-muted-foreground">Nunca usada</span>
                  )}
                </TableCell>
                <TableCell>
                  <DateTime value={integration.createdAt} />
                </TableCell>
                {canManage && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ações de ${integration.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({ kind: 'rename', integration })
                          }
                        >
                          Renomear
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({ kind: 'rotate', integration })
                          }
                        >
                          Rotacionar chave
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({ kind: 'active', integration })
                          }
                        >
                          {integration.active ? 'Desativar' : 'Reativar'}
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

      <CreateDialog
        open={pending?.kind === 'create'}
        onOpenChange={open => !open && close()}
        onIssued={secret.show}
      />
      {pending?.kind === 'rename' && (
        <RenameDialog integration={pending.integration} onClose={close} />
      )}
      {pending?.kind === 'rotate' && (
        <RotateDialog
          integration={pending.integration}
          onClose={close}
          onIssued={secret.show}
        />
      )}
      {pending?.kind === 'active' && (
        <ActiveDialog integration={pending.integration} onClose={close} />
      )}
      <SecretRevealDialog reveal={secret.reveal} onDismiss={secret.dismiss} />
    </>
  )
}
