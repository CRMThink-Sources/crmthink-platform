import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, api, call } from '@/api/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ActionDialog } from '@/features/actions/action-dialog'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'
import { ServerErrorAlert, plural } from './product-dialog'

type Kind = 'product' | 'plan'
type Item = { id: number; name: string }

const NOUN: Record<Kind, string> = { product: 'produto', plan: 'plano' }

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/** O que usa o item; vazio = livre para excluir. Campos de tipo inesperado contam como ausentes. */
export function usageSummary(kind: Kind, details: unknown): string[] {
  const d = (details && typeof details === 'object' ? details : {}) as Record<
    string,
    unknown
  >
  const lines: string[] = []
  if (kind === 'plan') {
    const subs = (d.subscriptions ?? {}) as Record<string, unknown>
    if (count(subs.total))
      lines.push(
        `${plural(count(subs.total), 'assinatura', 'assinaturas')} (${plural(
          count(subs.active),
          'ativa',
          'ativas',
        )})`,
      )
    const trialOfApps = strings(d.trialOfApps)
    if (trialOfApps.length)
      lines.push(`plano de trial de ${trialOfApps.join(', ')}`)
  } else {
    const apps = strings(d.apps)
    if (apps.length) lines.push(`apps vinculados: ${apps.join(', ')}`)
    if (count(d.plans))
      lines.push(
        `tem ${plural(count(d.plans), 'plano', 'planos')}: exclua-os primeiro`,
      )
  }
  return lines
}

function usageQuery(kind: Kind, id: number) {
  return {
    queryKey: ['catalog-usage', kind, id],
    queryFn: (): Promise<unknown> =>
      kind === 'product'
        ? call(
            api.GET('/admin/catalog/products/{id}/usage', {
              params: { path: { id } },
            }),
          )
        : call(
            api.GET('/admin/catalog/plans/{id}/usage', {
              params: { path: { id } },
            }),
          ),
    gcTime: 0,
    retry: false,
  }
}

function deactivate(
  kind: Kind,
  id: number,
  reason: string | undefined,
): Promise<unknown> {
  const params = {
    path: { id },
    header: { 'X-Admin-Reason': reason ?? '' },
  }
  return kind === 'product'
    ? call(
        api.PATCH('/admin/catalog/products/{id}', {
          body: { active: false },
          params,
        }),
      )
    : call(
        api.PATCH('/admin/catalog/plans/{id}', {
          body: { active: false },
          params,
        }),
      )
}

function useDeactivate(kind: Kind, item: Item, onClose: () => void) {
  const action = useAdminAction({
    run: (_: void, reason) => deactivate(kind, item.id, reason),
    invalidates: () => INVALIDATES.catalog(),
    success: () => `${NOUN[kind] === 'plano' ? 'Plano' : 'Produto'} desativado`,
  })
  return {
    ...action,
    async submit(reason: string | undefined) {
      if (await action.execute(undefined, reason)) onClose()
    },
  }
}

function deactivateProps(kind: Kind, item: Item) {
  return {
    title: `Desativar ${NOUN[kind]}`,
    target: item.name,
    confirmLabel: 'Desativar',
    reasonRequired: true,
  }
}

/** Desativar direto da linha: alto impacto, com motivo. */
export function DeactivateDialog(props: {
  kind: Kind
  item: Item
  onClose: () => void
}) {
  const { kind, item, onClose } = props
  const action = useDeactivate(kind, item, onClose)
  return (
    <ActionDialog
      open
      onOpenChange={open => !open && onClose()}
      {...deactivateProps(kind, item)}
      effect={`O ${NOUN[kind]} deixa de poder ser contratado; o que já usa continua como está.`}
      pending={action.pending}
      error={action.error}
      onConfirm={reason => void action.submit(reason)}
    />
  )
}

/**
 * Excluir: consulta o uso antes. Em uso, só oferece desativar; sem uso, exige digitar o
 * nome e o motivo. O servidor decide: um 409 no `DELETE` volta ao aviso de uso.
 */
export function DeleteDialog(props: {
  kind: Kind
  item: Item
  onClose: () => void
}) {
  const { kind, item, onClose } = props
  const usage = useQuery(usageQuery(kind, item.id))
  const [raced, setRaced] = useState<unknown>(undefined)
  const [raceHappened, setRaceHappened] = useState(false)

  const remove = useAdminAction({
    run: async (_: void, reason) => {
      await call(
        api.DELETE(
          kind === 'product'
            ? '/admin/catalog/products/{id}'
            : '/admin/catalog/plans/{id}',
          {
            params: {
              path: { id: item.id },
              header: { 'X-Admin-Reason': reason ?? '' },
            },
          },
        ),
      )
    },
    invalidates: () => INVALIDATES.catalog(),
    success: () => `${NOUN[kind] === 'plano' ? 'Plano' : 'Produto'} excluído`,
    onError: error => {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        (error.code === 'PRODUCT_IN_USE' || error.code === 'PLAN_IN_USE')
      ) {
        setRaced(error.details)
        setRaceHappened(true)
      }
    },
  })
  const off = useDeactivate(kind, item, onClose)

  if (usage.isPending)
    return (
      <Dialog open onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{`Excluir ${NOUN[kind]}`}</DialogTitle>
            <DialogDescription>
              Verificando o que usa {item.name}…
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )

  if (usage.isError && !raceHappened)
    return (
      <Dialog open onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{`Excluir ${NOUN[kind]}`}</DialogTitle>
            <DialogDescription>
              Não foi possível verificar o uso de {item.name}.
            </DialogDescription>
          </DialogHeader>
          <ServerErrorAlert error={usage.error} />
        </DialogContent>
      </Dialog>
    )

  const lines = usageSummary(kind, raceHappened ? raced : usage.data)
  if (lines.length > 0 || raceHappened)
    return (
      <ActionDialog
        key="in-use"
        open
        onOpenChange={open => !open && onClose()}
        {...deactivateProps(kind, item)}
        title={`${NOUN[kind] === 'plano' ? 'Plano' : 'Produto'} em uso: não pode ser excluído`}
        effect={
          <>
            Em uso por:{' '}
            {lines.length
              ? lines.join('; ')
              : 'registros que o servidor não detalhou'}
            . Para tirá-lo de circulação, desative-o: o que já usa continua como
            está.
          </>
        }
        pending={off.pending}
        error={off.error}
        onConfirm={reason => void off.submit(reason)}
      />
    )

  return (
    <ActionDialog
      key="delete"
      open
      onOpenChange={open => !open && onClose()}
      title={`Excluir ${NOUN[kind]}`}
      target={item.name}
      effect={`O ${NOUN[kind]} é removido do catálogo. Não há como desfazer.`}
      confirmLabel="Excluir"
      destructive
      confirmText={item.name}
      reasonRequired
      pending={remove.pending}
      error={remove.error}
      onConfirm={reason =>
        void remove.execute(undefined, reason).then(done => done && onClose())
      }
    />
  )
}
