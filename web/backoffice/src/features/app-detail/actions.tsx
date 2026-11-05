import { useState } from 'react'
import { Link } from 'react-router'
import { api, call } from '@/api/client'
import type { App } from '@/api/types'
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
import { formatDateTime } from '@/lib/format'

type Open = 'api-key' | 'webhook-secret' | 'toggle' | null

/**
 * Ações do operador no detalhe do app: editar, ativar ou desativar e rotacionar a chave
 * de API e o segredo de webhook. As ações de alto impacto (desativar e rotações) exigem
 * digitar o `appCode` e informar o motivo; os segredos novos aparecem uma vez.
 */
export function AppActions({ app }: { app: App }) {
  const [open, setOpen] = useState<Open>(null)
  const secret = useSecretReveal()
  const target = app.appCode
  const close = (next: boolean) => {
    if (!next) setOpen(null)
  }

  const rotateKey = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/apps/{appCode}/rotate-api-key', {
          params: {
            path: { appCode: app.appCode },
            header: { 'X-Admin-Reason': reason ?? '' },
          },
        }),
      ),
    invalidates: () => INVALIDATES.apps(app.appCode),
    success: () => 'Chave de API rotacionada',
  })
  const rotateSecret = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/apps/{appCode}/rotate-webhook-secret', {
          params: {
            path: { appCode: app.appCode },
            header: { 'X-Admin-Reason': reason ?? '' },
          },
        }),
      ),
    invalidates: () => INVALIDATES.apps(app.appCode),
    success: () => 'Segredo de webhook rotacionado',
  })
  const toggle = useAdminAction({
    run: (active: boolean, reason) =>
      call(
        api.PATCH('/admin/apps/{appCode}', {
          params: {
            path: { appCode: app.appCode },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
          body: { active },
        }),
      ),
    invalidates: () => INVALIDATES.apps(app.appCode),
    success: (_, active) => (active ? 'App ativado' : 'App desativado'),
  })

  return (
    <RoleGate role="operator">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link to={`/apps/${encodeURIComponent(app.appCode)}/edit`}>
            Editar
          </Link>
        </Button>
        <Button variant="outline" onClick={() => setOpen('toggle')}>
          {app.active ? 'Desativar' : 'Ativar'}
        </Button>
        <Button variant="outline" onClick={() => setOpen('api-key')}>
          Rotacionar chave
        </Button>
        <Button variant="outline" onClick={() => setOpen('webhook-secret')}>
          Rotacionar segredo
        </Button>
      </div>

      <ActionDialog
        open={open === 'api-key'}
        onOpenChange={next => {
          if (!next) rotateKey.reset()
          close(next)
        }}
        title="Rotacionar chave de API"
        target={target}
        effect="Gera uma chave nova. A atual continua valendo por 24 horas para o app trocar a variável sem ficar fora do ar."
        confirmLabel="Rotacionar chave"
        destructive
        confirmText={app.appCode}
        reasonRequired
        pending={rotateKey.pending}
        error={rotateKey.error}
        onConfirm={async reason => {
          const done = await rotateKey.execute(undefined, reason)
          if (!done) return
          rotateKey.reset()
          setOpen(null)
          secret.show({
            title: 'Nova chave de API',
            secrets: [
              { label: 'Chave de API', value: done.result.apiKey },
              {
                label: 'A chave anterior vale até',
                value: formatDateTime(done.result.previousValidUntil),
              },
            ],
          })
        }}
      />

      <ActionDialog
        open={open === 'webhook-secret'}
        onOpenChange={next => {
          if (!next) rotateSecret.reset()
          close(next)
        }}
        title="Rotacionar segredo de webhook"
        target={target}
        effect="Gera um segredo novo. Durante 24 horas os webhooks levam as duas assinaturas, depois só a nova."
        confirmLabel="Rotacionar segredo"
        destructive
        confirmText={app.appCode}
        reasonRequired
        pending={rotateSecret.pending}
        error={rotateSecret.error}
        onConfirm={async reason => {
          const done = await rotateSecret.execute(undefined, reason)
          if (!done) return
          rotateSecret.reset()
          setOpen(null)
          secret.show({
            title: 'Novo segredo de webhook',
            secrets: [
              { label: 'Segredo de webhook', value: done.result.webhookSecret },
              {
                label: 'O anterior vale até',
                value: formatDateTime(done.result.previousValidUntil),
              },
            ],
          })
        }}
      />

      <ActionDialog
        open={open === 'toggle'}
        onOpenChange={next => {
          if (!next) toggle.reset()
          close(next)
        }}
        title={app.active ? 'Desativar app' : 'Ativar app'}
        target={target}
        effect={
          app.active
            ? 'O app deixa de poder chamar a plataforma (APP_INACTIVE) e novas instalações são recusadas.'
            : 'O app volta a poder chamar a plataforma e a receber instalações.'
        }
        confirmLabel={app.active ? 'Desativar' : 'Ativar'}
        destructive={app.active}
        confirmText={app.active ? app.appCode : undefined}
        reasonRequired={app.active}
        pending={toggle.pending}
        error={toggle.error}
        onConfirm={async reason => {
          if (await toggle.execute(!app.active, reason)) setOpen(null)
        }}
      />

      <SecretRevealDialog reveal={secret.reveal} onDismiss={secret.dismiss} />
    </RoleGate>
  )
}
