import { useState } from 'react'
import { api, call } from '@/api/client'
import { RoleGate } from '@/components/role-gate'
import { Button } from '@/components/ui/button'
import { ActionDialog } from '@/features/actions/action-dialog'
import {
  SecretRevealDialog,
  useSecretReveal,
} from '@/features/actions/secret-reveal-dialog'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'

/**
 * Segredo de webhook do app: só um trecho fixo na tela e, a pedido, o valor completo
 * para copiar. A consulta pede o motivo e fica na auditoria. Só `operator` vê.
 *
 * A chave de API não tem equivalente: ela só existe como hash, então quem a perde
 * rotaciona.
 */
export function WebhookSecretField({ appCode }: { appCode: string }) {
  const [open, setOpen] = useState(false)
  const secret = useSecretReveal()
  const reveal = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/apps/{appCode}/reveal-webhook-secret', {
          params: {
            path: { appCode },
            header: { 'X-Admin-Reason': reason ?? '' },
          },
        }),
      ),
    // Só a auditoria muda: o app em si não.
    invalidates: () => INVALIDATES.system(),
    success: () => 'Consulta registrada na auditoria',
  })

  return (
    <RoleGate role="operator">
      <div className="flex items-center gap-2">
        <code className="rounded-md bg-muted px-2 py-1 text-xs select-none">
          whsec_{'•'.repeat(16)}
        </code>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Mostrar e copiar
        </Button>
      </div>

      <ActionDialog
        open={open}
        onOpenChange={next => {
          if (!next) reveal.reset()
          setOpen(next)
        }}
        title="Consultar segredo de webhook"
        target={appCode}
        effect="Mostra o segredo de webhook em uso para você copiar. A consulta fica na auditoria com o seu nome e o motivo."
        confirmLabel="Mostrar segredo"
        reasonRequired
        pending={reveal.pending}
        error={reveal.error}
        onConfirm={async reason => {
          const done = await reveal.execute(undefined, reason)
          if (!done) return
          reveal.reset()
          setOpen(false)
          secret.show({
            title: 'Segredo de webhook',
            secrets: [
              { label: 'Segredo de webhook', value: done.result.webhookSecret },
            ],
            repeatable: true,
          })
        }}
      />
      <SecretRevealDialog reveal={secret.reveal} onDismiss={secret.dismiss} />
    </RoleGate>
  )
}
