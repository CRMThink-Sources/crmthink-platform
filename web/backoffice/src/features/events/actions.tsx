import { useState } from 'react'
import { api, call } from '@/api/client'
import type { OutboxEvent } from '@/api/types'
import { RoleGate } from '@/components/role-gate'
import { Button } from '@/components/ui/button'
import { ActionDialog } from '@/features/actions/action-dialog'
import { BulkResendDialog, resendPeriod } from '@/features/actions/bulk-resend'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'

/** "Reenviar este": um evento, no painel lateral. Só `operator`. */
export function ResendOneButton(props: {
  event: OutboxEvent
  /** Chamado depois de reenviar (o painel fecha: o evento mudou de estado). */
  onDone: () => void
}) {
  const { event } = props
  const [open, setOpen] = useState(false)
  const resend = useAdminAction({
    run: async (_: void, reason) => {
      const result = await call(
        api.POST('/admin/events/resend', {
          body: { eventId: event.eventId },
          params: { header: reason ? { 'X-Admin-Reason': reason } : {} },
        }),
      )
      if (!('requeued' in result))
        throw new Error('Resposta inesperada do reenvio')
      return result
    },
    invalidates: () => INVALIDATES.events(event.installationId),
    success: result =>
      result.requeued
        ? 'Evento reenviado: volta à fila de entrega'
        : 'Nenhum evento foi reenviado',
  })

  // Evento pendente já está na fila: não há o que reenviar.
  if (event.status === 'pending') return null
  return (
    <RoleGate role="operator">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Reenviar este
      </Button>
      <ActionDialog
        open={open}
        onOpenChange={next => {
          if (!next) resend.reset()
          setOpen(next)
        }}
        title="Reenviar evento"
        target={`${event.type} · ${event.eventId}`}
        effect="Volta o evento para a fila de entrega, com a janela de 24 h reaberta. O app recebe o mesmo eventId."
        confirmLabel="Reenviar"
        pending={resend.pending}
        error={resend.error}
        onConfirm={async reason => {
          if (await resend.execute(undefined, reason)) {
            setOpen(false)
            props.onDone()
          }
        }}
      />
    </RoleGate>
  )
}

type Filters = {
  appCode?: string
  status?: 'pending' | 'delivered' | 'dead'
  type?: string
  installationId?: number
  from?: string
  to?: string
}

/**
 * "Reenviar todos do filtro": só com `status=dead` e um app ou uma instalação no filtro
 * (a API exige um dos dois e a ação em lote é para os mortos).
 */
export function ResendAllButton({ filters }: { filters: Filters }) {
  const [open, setOpen] = useState(false)
  const ready =
    filters.status === 'dead' && !!(filters.appCode || filters.installationId)
  const alvo = [
    filters.appCode ?? `instalação #${filters.installationId}`,
    filters.type,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <RoleGate role="operator">
      <Button
        variant="outline"
        disabled={!ready}
        title={
          ready
            ? undefined
            : 'Filtre por status Morto e por um app (ou instalação) para reenviar em lote'
        }
        onClick={() => setOpen(true)}
      >
        Reenviar todos do filtro
      </Button>
      {open && (
        <BulkResendDialog
          open
          onOpenChange={setOpen}
          filter={{
            appCode: filters.appCode,
            installationId: filters.installationId,
            type: filters.type,
            onlyDead: true,
            ...resendPeriod(filters.from, filters.to),
          }}
          target={`eventos mortos de ${alvo}`}
        />
      )}
    </RoleGate>
  )
}
