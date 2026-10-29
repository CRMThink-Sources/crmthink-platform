import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router'
import z from 'zod'
import { api, call } from '@/api/client'
import type { InstallationDetail } from '@/api/types'
import { DateTime } from '@/components/date-time'
import { JsonBlock, PageHeader } from '@/components/filters'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EventsTable } from '@/features/events/page'
import { useSearchState } from '@/lib/search-state'
import { formatMoney } from '@/lib/format'
import { Timeline } from './timeline'

const TABS = ['timeline', 'events', 'attempts'] as const

const searchSchema = z.object({
  tab: z.enum(TABS).optional().catch(undefined),
  kind: z.string().optional(),
})

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="text-sm">{props.children}</dd>
    </div>
  )
}

function Summary({ data }: { data: InstallationDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumo</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3">
          <Field label="App">
            {data.app ? `${data.app.name} (${data.app.appCode})` : data.appCode}
          </Field>
          <Field label="Status">
            <StatusBadge kind="installation" value={data.status} />
          </Field>
          <Field label="Domínio">{data.domain}</Field>
          <Field label="memberId">
            <code className="text-xs">{data.memberId}</code>
          </Field>
          <Field label="Instalada">
            <DateTime value={data.installedAt} />
          </Field>
          <Field label="Ativada">
            <DateTime value={data.activatedAt} />
          </Field>
          <Field label="Desinstalada">
            <DateTime value={data.uninstalledAt} />
          </Field>
          <Field label="Item do SPA 1060">
            {data.spaItemId ?? 'desvinculado'}
          </Field>
          <Field label="Trial usado">{data.trialUsed ? 'sim' : 'não'}</Field>
          <Field label="Reinstalação pendente">
            {data.pendingReinstall ? 'sim' : 'não'}
          </Field>
          <Field label="Eventos">
            {data.events.pending} pendentes · {data.events.delivered} entregues
            · {data.events.dead} mortos
          </Field>
        </dl>
      </CardContent>
    </Card>
  )
}

function TokenCard({ token }: { token: InstallationDetail['token'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Token do Bitrix</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3">
          <Field label="Saúde">
            <StatusBadge kind="token" value={token.health} />
          </Field>
          {'expiresAt' in token && (
            <>
              <Field label="Expira">
                <DateTime value={token.expiresAt} />
              </Field>
              <Field label="Falhas de renovação seguidas">
                {token.refreshFailures}
              </Field>
              {token.lastRefreshError && (
                <Field label="Último erro">
                  <span className="text-destructive">
                    {token.lastRefreshError}
                  </span>
                </Field>
              )}
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  )
}

function SubscriptionCard({
  subscription,
}: {
  subscription: InstallationDetail['subscription']
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assinatura</CardTitle>
      </CardHeader>
      <CardContent>
        {!subscription.available ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Assinatura indisponível no momento</AlertTitle>
            <AlertDescription>{subscription.reason}</AlertDescription>
          </Alert>
        ) : !subscription.current ? (
          <p className="text-sm text-muted-foreground">
            Sem assinatura vigente.
          </p>
        ) : (
          <dl className="grid gap-3">
            <Field label="Status">{subscription.current.status}</Field>
            <Field label="Plano">
              {'name' in subscription.current.plan
                ? `${subscription.current.plan.name} · ${formatMoney(subscription.current.plan.amount)}`
                : `#${subscription.current.plan.id}`}
            </Field>
            <Field label="Período">
              <DateTime
                value={subscription.current.periodStart}
                relative={false}
              />{' '}
              até{' '}
              <DateTime
                value={subscription.current.periodEnd}
                relative={false}
              />
            </Field>
            {subscription.current.trial.endsAt && (
              <Field label="Trial termina">
                <DateTime value={subscription.current.trial.endsAt} />
              </Field>
            )}
            {subscription.current.cancelAtPeriodEnd && (
              <Field label="Cancelamento">no fim do período</Field>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function Attempts({ installationId }: { installationId: number }) {
  const attempts = useQuery({
    queryKey: ['installation', installationId, 'attempts'],
    queryFn: () =>
      call(
        api.GET('/admin/installations/{id}/attempts', {
          params: { path: { id: installationId } },
        }),
      ),
  })
  if (attempts.isPending) return <LoadingState />
  if (attempts.isError)
    return (
      <ErrorState
        error={attempts.error}
        onRetry={() => void attempts.refetch()}
      />
    )
  if (!attempts.data.items.length)
    return <EmptyState message="Nenhuma tentativa de instalação registrada." />
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Etapa</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Erro</TableHead>
          <TableHead>Quando</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {attempts.data.items.map(attempt => (
          <TableRow key={attempt.id}>
            <TableCell>{attempt.step}</TableCell>
            <TableCell>{attempt.status}</TableCell>
            <TableCell className="text-destructive">{attempt.error}</TableCell>
            <TableCell>
              <DateTime value={attempt.createdAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function InstallationDetailPage() {
  const id = Number(useParams().id)
  const [state, update] = useSearchState(searchSchema)
  const tab = state.tab ?? 'timeline'
  const detail = useQuery({
    queryKey: ['installation', id],
    queryFn: () =>
      call(api.GET('/admin/installations/{id}', { params: { path: { id } } })),
    enabled: Number.isInteger(id) && id > 0,
  })

  if (!Number.isInteger(id) || id <= 0)
    return <EmptyState message="Instalação inválida." />

  return (
    <>
      <PageHeader
        title={
          detail.data ? `#${id} · ${detail.data.domain}` : `Instalação #${id}`
        }
      />
      {detail.isPending ? (
        <LoadingState rows={4} />
      ) : detail.isError ? (
        <ErrorState
          error={detail.error}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Summary data={detail.data} />
          </div>
          <div className="grid gap-4">
            <TokenCard token={detail.data.token} />
            <SubscriptionCard subscription={detail.data.subscription} />
          </div>
          {detail.data.contact !== null && (
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Contato</CardTitle>
              </CardHeader>
              <CardContent>
                <JsonBlock value={detail.data.contact} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={value =>
          update({
            tab: value === 'timeline' ? undefined : value,
            kind: undefined,
          })
        }
        className="pt-6"
      >
        <TabsList>
          <TabsTrigger value="timeline">Linha do tempo</TabsTrigger>
          <TabsTrigger value="events">Eventos</TabsTrigger>
          <TabsTrigger value="attempts">Tentativas de instalação</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline" className="pt-4">
          <Timeline
            installationId={id}
            kind={state.kind}
            onKind={kind => update({ kind, tab: state.tab })}
          />
        </TabsContent>
        <TabsContent value="events" className="pt-4">
          <EventsTable filters={{ installationId: id }} />
        </TabsContent>
        <TabsContent value="attempts" className="pt-4">
          <Attempts installationId={id} />
        </TabsContent>
      </Tabs>
    </>
  )
}
