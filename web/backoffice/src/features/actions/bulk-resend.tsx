import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { ApiError, api, call } from '@/api/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ActionDialog } from './action-dialog'
import { INVALIDATES, useAdminAction } from './use-admin-action'

/** Limite do reenvio em lote na API (`RESEND_TOO_LARGE` acima disto). */
export const RESEND_LIMIT = 5000

/** Seletor por filtro do reenvio (sem `dryRun`). */
export type ResendFilter = {
  appCode?: string
  installationId?: number
  from: string
  to: string
  onlyDead?: boolean
  type?: string
}

/**
 * Período do filtro da tela para o reenvio (a API exige `from` e `to`): sem datas vale
 * "desde sempre até agora"; `to` só com a data inclui o dia inteiro, como nas listagens.
 */
export function resendPeriod(
  from?: string,
  to?: string,
): { from: string; to: string } {
  return {
    from: from ? new Date(from).toISOString() : new Date(0).toISOString(),
    to: to
      ? /^\d{4}-\d{2}-\d{2}$/.test(to)
        ? `${to}T23:59:59.999Z`
        : to
      : new Date().toISOString(),
  }
}

type Preview = { matched: number; sample: string[] }

async function previewResend(filter: ResendFilter): Promise<Preview> {
  const result = await call(
    api.POST('/admin/events/resend', { body: { ...filter, dryRun: true } }),
  )
  if (!('matched' in result)) throw new Error('Resposta inesperada do reenvio')
  return result
}

/**
 * Reenvio em lote: primeiro a prévia (`dryRun`: quantidade e amostra), depois a
 * confirmação digitando `REENVIAR <quantidade>` e o motivo. Acima do limite da API o
 * botão nem libera e o diálogo sugere reduzir o período.
 */
export function BulkResendDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filter: ResendFilter
  /** Descrição do alvo para o diálogo (ex.: o app e o filtro aplicado). */
  target: string
}) {
  const { filter } = props
  const preview = useQuery({
    queryKey: ['resend-preview', filter],
    queryFn: () => previewResend(filter),
    enabled: props.open,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  })
  const resend = useAdminAction({
    run: async (_: void, reason) => {
      const result = await call(
        api.POST('/admin/events/resend', {
          body: filter,
          params: { header: { 'X-Admin-Reason': reason } },
        }),
      )
      if (!('requeued' in result))
        throw new Error('Resposta inesperada do reenvio')
      return result
    },
    invalidates: () => INVALIDATES.events(filter.installationId),
    success: result =>
      `${result.requeued} ${result.requeued === 1 ? 'evento reenviado' : 'eventos reenviados'}`,
  })

  const matched = preview.data?.matched
  const tooLarge = matched !== undefined && matched > RESEND_LIMIT
  const tooLargeByApi =
    resend.error instanceof ApiError && resend.error.code === 'RESEND_TOO_LARGE'

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={next => {
        if (!next) resend.reset()
        props.onOpenChange(next)
      }}
      title="Reenviar eventos em lote"
      target={props.target}
      effect={
        matched === undefined
          ? 'Calculando quantos eventos serão reenviados…'
          : tooLarge
            ? `O filtro encontrou ${matched} eventos, mais do que o limite de ${RESEND_LIMIT} por reenvio. Nada será reenviado.`
            : `${matched} ${matched === 1 ? 'evento será reenviado' : 'eventos serão reenviados'} ao app, com a janela de 24 h reaberta.`
      }
      confirmLabel="Reenviar"
      confirmText={matched ? `REENVIAR ${matched}` : 'REENVIAR'}
      reasonRequired
      pending={resend.pending}
      error={resend.error}
      disabled={!matched || tooLarge || preview.isError}
      onConfirm={async reason => {
        const done = await resend.execute(undefined, reason)
        if (done) props.onOpenChange(false)
      }}
    >
      {preview.isError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Não foi possível calcular o impacto</AlertTitle>
          <AlertDescription>{preview.error.message}</AlertDescription>
        </Alert>
      )}
      {matched === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum evento corresponde ao filtro. Nada a reenviar.
        </p>
      )}
      {(tooLarge || tooLargeByApi) && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Acima do limite de {RESEND_LIMIT} eventos</AlertTitle>
          <AlertDescription>
            Reduza o período ou filtre por instalação e tente de novo.
          </AlertDescription>
        </Alert>
      )}
      {!!preview.data?.sample.length && (
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Amostra (até 5)</span>
          <ul className="grid gap-0.5 font-mono text-xs">
            {preview.data.sample.map(eventId => (
              <li key={eventId}>{eventId}</li>
            ))}
          </ul>
        </div>
      )}
    </ActionDialog>
  )
}
