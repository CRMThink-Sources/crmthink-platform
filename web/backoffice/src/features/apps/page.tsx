import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { RoleGate } from '@/components/role-gate'
import { Button } from '@/components/ui/button'
import { api, call } from '@/api/client'
import { PageHeader } from '@/components/filters'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const appsQuery = {
  queryKey: ['apps'],
  queryFn: () => call(api.GET('/admin/apps')),
  staleTime: 5 * 60_000,
}

export function AppsPage() {
  const apps = useQuery(appsQuery)
  return (
    <>
      <PageHeader
        title="Apps"
        description="Apps cadastrados na plataforma: estado, trial e escopos."
      >
        <RoleGate role="operator">
          <Button asChild>
            <Link to="/apps/new">Cadastrar app</Link>
          </Button>
        </RoleGate>
      </PageHeader>
      {apps.isPending ? (
        <LoadingState />
      ) : apps.isError ? (
        <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />
      ) : !apps.data.items.length ? (
        <EmptyState message="Nenhum app cadastrado." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>App</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Trial</TableHead>
              <TableHead>Escopos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apps.data.items.map(app => (
              <TableRow key={app.appCode}>
                <TableCell>
                  <Link
                    to={`/apps/${encodeURIComponent(app.appCode)}`}
                    className="font-medium break-all hover:underline"
                  >
                    {app.name}
                  </Link>
                  <p>
                    <code className="text-xs text-muted-foreground">
                      {app.appCode}
                    </code>
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant={app.active ? 'secondary' : 'outline'}>
                    {app.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {app.trialDays
                    ? `${app.trialDays} dias${app.trialOnInstall ? ' (na instalação)' : ''}`
                    : '—'}
                </TableCell>
                <TableCell className="text-xs">
                  {app.scopes.join(', ')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}
