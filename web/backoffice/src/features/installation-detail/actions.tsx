import { useState } from 'react'
import { api, call } from '@/api/client'
import type { InstallationDetail } from '@/api/types'
import { RoleGate } from '@/components/role-gate'
import { Button } from '@/components/ui/button'
import { ActionDialog } from '@/features/actions/action-dialog'
import {
  BulkResendDialog,
  type ResendFilter,
} from '@/features/actions/bulk-resend'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'
import { formatDateTime } from '@/lib/format'

type Open = 'trial' | 'token' | 'resend' | null

/**
 * Ações do operador no detalhe da instalação. Só `operator` as vê (`RoleGate`); a API
 * continua sendo a barreira (403 `FORBIDDEN_ROLE`).
 */
export function InstallationActions({ data }: { data: InstallationDetail }) {
  const [open, setOpen] = useState<Open>(null)
  const [resendFilter, setResendFilter] = useState<ResendFilter | null>(null)
  const target = `#${data.id} · ${data.domain}`
  const close = (next: boolean) => {
    if (!next) setOpen(null)
  }

  const trial = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/installations/{id}/trial', {
          params: {
            path: { id: data.id },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
        }),
      ),
    invalidates: () => INVALIDATES.installation(data.id),
    success: result =>
      `Trial concedido até ${formatDateTime(result.trialEndsAt)}`,
  })

  const refresh = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/installations/{id}/token/refresh', {
          params: {
            path: { id: data.id },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
        }),
      ),
    invalidates: () => INVALIDATES.installation(data.id),
    success: result =>
      `Token renovado; vale até ${formatDateTime(result.expiresAt)}`,
  })

  return (
    <RoleGate role="operator">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setOpen('trial')}>
          Conceder trial
        </Button>
        {data.status === 'ACTIVE' && (
          <Button variant="outline" onClick={() => setOpen('token')}>
            Renovar token
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => {
            setResendFilter({
              installationId: data.id,
              from: data.installedAt,
              to: new Date().toISOString(),
              onlyDead: true,
            })
            setOpen('resend')
          }}
        >
          Reenviar eventos desta instalação
        </Button>
      </div>

      <ActionDialog
        open={open === 'trial'}
        onOpenChange={next => {
          if (!next) trial.reset()
          close(next)
        }}
        title="Conceder trial"
        target={target}
        effect="Inicia um trial para esta instalação, conforme a configuração do app. Se já houver trial vigente, a API recusa."
        confirmLabel="Conceder trial"
        pending={trial.pending}
        error={trial.error}
        onConfirm={async reason => {
          if (await trial.execute(undefined, reason)) setOpen(null)
        }}
      />

      <ActionDialog
        open={open === 'token'}
        onOpenChange={next => {
          if (!next) refresh.reset()
          close(next)
        }}
        title="Renovar token do Bitrix"
        target={target}
        effect="Pede ao Bitrix um token novo agora, com a mesma trava da renovação automática. O token não é exibido."
        confirmLabel="Renovar token"
        pending={refresh.pending}
        error={refresh.error}
        onConfirm={async reason => {
          if (await refresh.execute(undefined, reason)) setOpen(null)
        }}
      />

      {resendFilter && (
        <BulkResendDialog
          open={open === 'resend'}
          onOpenChange={close}
          filter={resendFilter}
          target={`eventos mortos de ${target}`}
        />
      )}
    </RoleGate>
  )
}
