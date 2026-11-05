import { useQuery } from '@tanstack/react-query'
import { Lock, MoreHorizontal } from 'lucide-react'
import { useId, useState } from 'react'
import { api, call, type Schemas } from '@/api/client'
import { DateTime } from '@/components/date-time'
import { PageHeader } from '@/components/filters'
import { useHasRole } from '@/components/role-gate'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { useMe } from '@/features/auth/session'

type Operator = Schemas['Operator']
type Role = Operator['role']
type Issued = Schemas['IssuedOperatorAccess']

const ROLE_LABEL: Record<Role, string> = {
  viewer: 'viewer (suporte)',
  operator: 'operator (dev)',
}

type Pending =
  | { kind: 'create' }
  | { kind: 'role'; operator: Operator }
  | { kind: 'active'; operator: Operator }
  | { kind: 'reset'; operator: Operator }
  | null

/** Senha provisória e QR code do TOTP, mostrados uma vez e só aqui. */
const revealOf = (title: string, issued: Issued): SecretReveal => ({
  title,
  secrets: [{ label: 'Senha provisória', value: issued.temporaryPassword }],
  notes: [{ label: 'E-mail de acesso', value: issued.operator.email }],
  otpauthUri: issued.totpUri,
})

function CreateDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onIssued: (reveal: SecretReveal) => void
}) {
  const ids = { name: useId(), email: useId(), role: useId() }
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const valid = !!name.trim() && /^\S+@\S+\.\S+$/.test(email.trim())
  const create = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/operators', {
          body: { name: name.trim(), email: email.trim(), role },
          params: { header: reason ? { 'X-Admin-Reason': reason } : {} },
        }),
      ),
    invalidates: () => INVALIDATES.operators(),
    success: res => `Conta de ${res.operator.name} criada`,
  })
  return (
    <ActionDialog
      open={props.open}
      onOpenChange={next => {
        if (!next) {
          create.reset()
          setName('')
          setEmail('')
          setRole('viewer')
        }
        props.onOpenChange(next)
      }}
      title="Criar operador"
      target="Nova conta do backoffice"
      effect="Cria a conta com senha provisória e um TOTP novo. Os dois aparecem uma única vez, na próxima tela."
      confirmLabel="Criar conta"
      disabled={!valid}
      pending={create.pending}
      error={create.error}
      onConfirm={async reason => {
        const done = await create.execute(undefined, reason)
        if (!done) return
        create.reset()
        props.onOpenChange(false)
        props.onIssued(revealOf('Conta criada', done.result))
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={ids.name}>Nome</Label>
        <Input
          id={ids.name}
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.email}>E-mail</Label>
        <Input
          id={ids.email}
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.role}>Papel</Label>
        <select
          id={ids.role}
          value={role}
          onChange={event => setRole(event.target.value as Role)}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          {(Object.keys(ROLE_LABEL) as Role[]).map(value => (
            <option key={value} value={value}>
              {ROLE_LABEL[value]}
            </option>
          ))}
        </select>
      </div>
    </ActionDialog>
  )
}

function RoleDialog(props: { operator: Operator; onClose: () => void }) {
  const { operator } = props
  const next: Role = operator.role === 'operator' ? 'viewer' : 'operator'
  const update = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.PATCH('/admin/operators/{id}', {
          params: {
            path: { id: operator.id },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
          body: { role: next },
        }),
      ),
    invalidates: () => INVALIDATES.operators(),
    success: () => `${operator.name} agora é ${next}`,
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
      title="Trocar papel"
      target={`${operator.name} · ${operator.email}`}
      effect={`Muda de ${operator.role} para ${next}. As sessões abertas passam a valer com o papel novo.`}
      confirmLabel={`Tornar ${next}`}
      pending={update.pending}
      error={update.error}
      onConfirm={async reason => {
        if (await update.execute(undefined, reason)) props.onClose()
      }}
    />
  )
}

function ActiveDialog(props: { operator: Operator; onClose: () => void }) {
  const { operator } = props
  const activate = !operator.active
  const update = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.PATCH('/admin/operators/{id}', {
          params: {
            path: { id: operator.id },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
          body: { active: activate },
        }),
      ),
    invalidates: () => INVALIDATES.operators(),
    success: () => (activate ? 'Conta ativada' : 'Conta desativada'),
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
      title={activate ? 'Ativar conta' : 'Desativar conta'}
      target={`${operator.name} · ${operator.email}`}
      effect={
        activate
          ? 'A pessoa volta a poder entrar no backoffice.'
          : 'A pessoa perde o acesso e as sessões abertas são derrubadas.'
      }
      confirmLabel={activate ? 'Ativar' : 'Desativar'}
      destructive={!activate}
      pending={update.pending}
      error={update.error}
      onConfirm={async reason => {
        if (await update.execute(undefined, reason)) props.onClose()
      }}
    />
  )
}

function ResetDialog(props: {
  operator: Operator
  onClose: () => void
  onIssued: (reveal: SecretReveal) => void
}) {
  const { operator } = props
  const reset = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/operators/{id}/reset-access', {
          params: {
            path: { id: operator.id },
            header: { 'X-Admin-Reason': reason ?? '' },
          },
        }),
      ),
    invalidates: () => INVALIDATES.operators(),
    success: () => `Acesso de ${operator.name} redefinido`,
  })
  return (
    <ActionDialog
      open
      onOpenChange={open => {
        if (!open) {
          reset.reset()
          props.onClose()
        }
      }}
      title="Redefinir acesso"
      target={operator.email}
      effect="Gera uma senha provisória e um TOTP novos, derruba as sessões abertas da conta e desfaz o bloqueio. Os dados novos aparecem uma única vez."
      confirmLabel="Redefinir acesso"
      destructive
      confirmText={operator.email}
      reasonRequired
      pending={reset.pending}
      error={reset.error}
      onConfirm={async reason => {
        const done = await reset.execute(undefined, reason)
        if (!done) return
        reset.reset()
        props.onClose()
        props.onIssued(revealOf('Acesso redefinido', done.result))
      }}
    />
  )
}

function lockedUntil(operator: Operator): string | null {
  return operator.lockedUntil && new Date(operator.lockedUntil) > new Date()
    ? operator.lockedUntil
    : null
}

/** Tela "Operadores": contas do backoffice. Só `operator`. */
export function OperatorsPage() {
  const me = useMe()
  const allowed = useHasRole('operator')
  const [pending, setPending] = useState<Pending>(null)
  const secret = useSecretReveal()
  const list = useQuery({
    queryKey: ['operators'],
    queryFn: () => call(api.GET('/admin/operators')),
    enabled: allowed,
  })
  const myId = me.data?.kind === 'operator' ? me.data.operator.id : null
  const close = () => setPending(null)

  return (
    <>
      <PageHeader title="Operadores">
        {allowed && (
          <Button onClick={() => setPending({ kind: 'create' })}>
            Criar operador
          </Button>
        )}
      </PageHeader>

      {me.isPending ? (
        <LoadingState />
      ) : !allowed ? (
        <Alert>
          <Lock />
          <AlertTitle>Sem permissão</AlertTitle>
          <AlertDescription>
            A gestão de operadores é só para o papel operator.
          </AlertDescription>
        </Alert>
      ) : list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState message="Nenhuma conta cadastrada." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Bloqueio</TableHead>
              <TableHead>Último acesso</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.items.map(operator => {
              const mine = operator.id === myId
              const locked = lockedUntil(operator)
              return (
                <TableRow key={operator.id}>
                  <TableCell className="font-medium">
                    {operator.name}
                    {mine && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (você)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{operator.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{operator.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={operator.active ? 'secondary' : 'outline'}>
                      {operator.active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {locked ? (
                      <span className="text-destructive">
                        até <DateTime value={locked} relative={false} />
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <DateTime value={operator.lastLoginAt} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ações de ${operator.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* Na própria conta não há desativar nem trocar papel. */}
                        {!mine && (
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({ kind: 'role', operator })
                            }
                          >
                            Trocar papel
                          </DropdownMenuItem>
                        )}
                        {!mine && (
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({ kind: 'active', operator })
                            }
                          >
                            {operator.active ? 'Desativar' : 'Ativar'}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({ kind: 'reset', operator })
                          }
                        >
                          Redefinir acesso
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <CreateDialog
        open={pending?.kind === 'create'}
        onOpenChange={open => !open && close()}
        onIssued={secret.show}
      />
      {pending?.kind === 'role' && (
        <RoleDialog operator={pending.operator} onClose={close} />
      )}
      {pending?.kind === 'active' && (
        <ActiveDialog operator={pending.operator} onClose={close} />
      )}
      {pending?.kind === 'reset' && (
        <ResetDialog
          operator={pending.operator}
          onClose={close}
          onIssued={secret.show}
        />
      )}
      <SecretRevealDialog reveal={secret.reveal} onDismiss={secret.dismiss} />
    </>
  )
}
