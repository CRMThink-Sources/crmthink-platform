import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import z from 'zod'
import { api, call } from '@/api/client'
import { DateTime } from '@/components/date-time'
import {
  AppFilter,
  describeFilters,
  FilterBar,
  PageHeader,
  SelectFilter,
  TextFilter,
} from '@/components/filters'
import { Pager } from '@/components/pager'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { StatusBadge } from '@/components/status-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useSearchState } from '@/lib/search-state'

export const INSTALLATION_STATUSES = [
  { value: 'ACTIVE', label: 'Ativa' },
  { value: 'INSTALL_PENDING', label: 'Instalação pendente' },
  { value: 'AUTH_ERROR', label: 'Erro de autenticação' },
  { value: 'UNINSTALLED', label: 'Desinstalada' },
]

const searchSchema = z.object({
  q: z.string().optional(),
  appCode: z.string().optional(),
  status: z.string().optional(),
  cursor: z.string().optional(),
})

export function InstallationsPage() {
  const [state, update] = useSearchState(searchSchema)
  const list = useQuery({
    queryKey: ['installations', state],
    queryFn: () =>
      call(api.GET('/admin/installations', { params: { query: state } })),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader title="Instalações" />
      <FilterBar>
        <TextFilter
          id="filter-q"
          label="Buscar"
          placeholder="Domínio, memberId ou id"
          value={state.q}
          onSubmit={q => update({ q })}
          className="w-72"
        />
        <AppFilter
          value={state.appCode}
          onChange={appCode => update({ appCode })}
        />
        <SelectFilter
          id="filter-status"
          label="Status"
          value={state.status}
          options={INSTALLATION_STATUSES}
          onChange={status => update({ status })}
        />
      </FilterBar>

      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState
          message={`Nenhuma instalação${describeFilters({
            busca: state.q,
            app: state.appCode,
            status: state.status,
          })}.`}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Id</TableHead>
                <TableHead>Domínio</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Instalada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map(item => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      to={`/installations/${item.id}`}
                      className="font-medium hover:underline"
                    >
                      #{item.id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/installations/${item.id}`}
                      className="hover:underline"
                    >
                      {item.domain}
                    </Link>
                  </TableCell>
                  <TableCell>{item.appCode}</TableCell>
                  <TableCell>
                    <StatusBadge kind="installation" value={item.status} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="token" value={item.tokenHealth} />
                  </TableCell>
                  <TableCell>
                    <DateTime value={item.installedAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            cursor={state.cursor}
            nextCursor={list.data.nextCursor}
            onCursor={cursor => update({ cursor })}
          />
        </>
      )}
    </>
  )
}
