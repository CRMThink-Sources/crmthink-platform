import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { api, call } from '@/api/client'
import { JsonBlock, PageHeader } from '@/components/filters'
import { ErrorState, LoadingState } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="text-sm break-all">{props.children}</dd>
    </div>
  )
}

/**
 * Configuração do app. A API nunca devolve chave de API, segredo de webhook nem
 * `client_secret` aqui — eles só aparecem na criação/rotação (`backoffice-actions`).
 */
export function AppDetailPage() {
  const appCode = useParams().appCode ?? ''
  const app = useQuery({
    queryKey: ['app', appCode],
    queryFn: () =>
      call(api.GET('/admin/apps/{appCode}', { params: { path: { appCode } } })),
  })

  return (
    <>
      <PageHeader title={app.data?.name ?? appCode}>
        <div className="flex gap-3 text-sm">
          <Link
            className="hover:underline"
            to={`/installations?appCode=${encodeURIComponent(appCode)}`}
          >
            Instalações
          </Link>
          <Link
            className="hover:underline"
            to={`/audit?targetType=app&targetId=${encodeURIComponent(appCode)}`}
          >
            Auditoria
          </Link>
        </div>
      </PageHeader>
      {app.isPending ? (
        <LoadingState rows={4} />
      ) : app.isError ? (
        <ErrorState error={app.error} onRetry={() => void app.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Cadastro</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3">
                <Field label="appCode">
                  <code className="text-xs">{app.data.appCode}</code>
                </Field>
                <Field label="Estado">
                  <Badge variant={app.data.active ? 'secondary' : 'outline'}>
                    {app.data.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </Field>
                <Field label="client_id do Bitrix">
                  {app.data.bitrixClientId}
                </Field>
                <Field label="CODE no app.info">
                  {app.data.bitrixAppCode ?? '—'}
                </Field>
                <Field label="Escopos">
                  {app.data.scopes.join(', ') || '—'}
                </Field>
                <Field label="Produtos (SPA 1134)">
                  {app.data.productSpaIds.join(', ') || '—'}
                </Field>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Integração e trial</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3">
                <Field label="URL do instalador">
                  {app.data.installerUrl ?? '—'}
                </Field>
                <Field label="URL de webhook">
                  {app.data.webhookUrl ?? '—'}
                </Field>
                <Field label="Trial">
                  {app.data.trialDays
                    ? `${app.data.trialDays} dias, plano ${app.data.trialPlanId ?? '—'}`
                    : 'sem trial'}
                </Field>
                <Field label="Trial na instalação">
                  {app.data.trialOnInstall ? 'sim' : 'não'}
                </Field>
                <Field label="Logo">{app.data.logoUrl ?? '—'}</Field>
              </dl>
            </CardContent>
          </Card>
          {app.data.installTheme && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Tema da página de instalação</CardTitle>
              </CardHeader>
              <CardContent>
                <JsonBlock value={app.data.installTheme} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  )
}
