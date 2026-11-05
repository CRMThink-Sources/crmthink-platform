import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { api, call } from '@/api/client'
import type { Overview } from '@/api/types'
import { DateTime } from '@/components/date-time'
import { PageHeader } from '@/components/filters'
import { ErrorState, LoadingState } from '@/components/states'
import { StatusBadge } from '@/components/status-badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const overviewQuery = {
  queryKey: ['overview'],
  queryFn: () => call(api.GET('/admin/overview')),
}

function Stat(props: {
  title: string
  value: ReactNode
  to?: string
  hint?: ReactNode
}) {
  const value = props.to ? (
    <Link to={props.to} className="hover:underline">
      {props.value}
    </Link>
  ) : (
    props.value
  )
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{props.title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {props.hint && (
        <CardContent className="text-xs text-muted-foreground">
          {props.hint}
        </CardContent>
      )}
    </Card>
  )
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export function OverviewPage() {
  const overview = useQuery(overviewQuery)
  return (
    <>
      <PageHeader title="Painel">
        {overview.data && (
          <span className="text-xs text-muted-foreground">
            Calculado <DateTime value={overview.data.computedAt} />
          </span>
        )}
      </PageHeader>
      {overview.isPending ? (
        <LoadingState rows={6} />
      ) : overview.isError ? (
        <ErrorState
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      ) : (
        <OverviewContent data={overview.data} />
      )}
    </>
  )
}

function OverviewContent({ data }: { data: Overview }) {
  const dead = data.events.byApp.reduce((sum, app) => sum + app.dead, 0)
  const pending = data.events.byApp.reduce((sum, app) => sum + app.pending, 0)
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat title="Eventos mortos" value={dead} to="/events?status=dead" />
        <Stat
          title="Eventos pendentes"
          value={pending}
          to="/events?status=pending"
          hint={
            data.events.oldestPendingAt && (
              <>
                Mais antigo <DateTime value={data.events.oldestPendingAt} />
              </>
            )
          }
        />
        <Stat
          title="Eventos Stripe com falha"
          value={data.stripeEvents.failed + data.stripeEvents.dead}
          to="/stripe-events?status=dead"
          hint={`${data.stripeEvents.failed} falhando, ${data.stripeEvents.dead} mortos`}
        />
        <Stat
          title="Tokens com renovação falhando"
          value={data.credentialsRefreshFailing}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Eventos por app</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead className="text-right">Pendentes</TableHead>
                  <TableHead className="text-right">Mortos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.events.byApp.map(app => (
                  <TableRow key={app.appCode}>
                    <TableCell>{app.appCode}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        className="hover:underline"
                        to={`/events?appCode=${encodeURIComponent(app.appCode)}&status=pending`}
                      >
                        {plural(
                          app.pending,
                          'evento pendente',
                          'eventos pendentes',
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        className="hover:underline"
                        to={`/events?appCode=${encodeURIComponent(app.appCode)}&status=dead`}
                      >
                        {plural(app.dead, 'evento morto', 'eventos mortos')}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {!data.events.byApp.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      Nenhum evento pendente ou morto.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instalações por app e status</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.installations.map(group => (
                  <TableRow key={`${group.appCode}-${group.status}`}>
                    <TableCell>{group.appCode}</TableCell>
                    <TableCell>
                      <StatusBadge kind="installation" value={group.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        className="hover:underline"
                        to={`/installations?appCode=${encodeURIComponent(group.appCode)}&status=${group.status}`}
                      >
                        {group.count}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trials que terminam em 7 dias</CardTitle>
            <CardDescription>
              {plural(data.trialsEndingSoon.count, 'instalação', 'instalações')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {data.trialsEndingSoon.items.map(trial => (
                <li
                  key={trial.installationId}
                  className="flex justify-between gap-2"
                >
                  <Link
                    className="hover:underline"
                    to={`/installations/${trial.installationId}`}
                  >
                    #{trial.installationId} · {trial.appCode}
                  </Link>
                  <DateTime value={trial.trialEndsAt} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Últimas varreduras</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {data.sweeps.map(sweep => (
                <li key={sweep.kind} className="flex justify-between gap-2">
                  <span>
                    {sweep.kind === 'stripe' ? 'Stripe' : 'SPAs'} ·{' '}
                    {sweep.finishedAt
                      ? `${sweep.fixed} corrigidas, ${sweep.errors} erros`
                      : 'em andamento ou interrompida'}
                  </span>
                  <DateTime value={sweep.startedAt} />
                </li>
              ))}
              {!data.sweeps.length && (
                <li className="text-muted-foreground">
                  Nenhuma execução registrada.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
