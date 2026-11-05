import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import z from 'zod'
import { api, call } from '@/api/client'
import type { AuditItem } from '@/api/types'
import { DateTime } from '@/components/date-time'
import {
  DateFilter,
  describeFilters,
  FilterBar,
  PageHeader,
  SelectFilter,
  TextFilter,
} from '@/components/filters'
import { Pager } from '@/components/pager'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useSearchState } from '@/lib/search-state'

const searchSchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  result: z.enum(['success', 'failure']).optional().catch(undefined),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
})

/** Alvo com link quando é instalação ou app. */
function Target({ item }: { item: AuditItem }) {
  if (!item.targetType) return <span className="text-muted-foreground">—</span>
  const label = `${item.targetType}:${item.targetId ?? ''}`
  if (item.targetType === 'installation' && item.targetId)
    return (
      <Link to={`/installations/${item.targetId}`} className="hover:underline">
        {label}
      </Link>
    )
  if (item.targetType === 'app' && item.targetId)
    return (
      <Link
        to={`/apps/${encodeURIComponent(item.targetId)}`}
        className="hover:underline"
      >
        {label}
      </Link>
    )
  return <span>{label}</span>
}

function Result({ item }: { item: AuditItem }) {
  const failed = (item.statusCode ?? 0) >= 400 || !!item.errorCode
  return (
    <span className={failed ? 'text-destructive' : undefined}>
      {item.statusCode ?? '—'}
      {item.errorCode ? ` ${item.errorCode}` : ''}
    </span>
  )
}

export function AuditPage() {
  const [state, update] = useSearchState(searchSchema)
  const list = useQuery({
    queryKey: ['audit', state],
    queryFn: () => call(api.GET('/admin/audit', { params: { query: state } })),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader title="Auditoria" />
      <FilterBar>
        <TextFilter
          id="filter-actor"
          label="Ator"
          placeholder="operator:1 ou token:abc"
          value={state.actor}
          onSubmit={actor => update({ actor })}
        />
        <TextFilter
          id="filter-action"
          label="Ação"
          placeholder="auth.login_failed"
          value={state.action}
          onSubmit={action => update({ action })}
        />
        <SelectFilter
          id="filter-target-type"
          label="Alvo"
          value={state.targetType}
          options={[
            { value: 'installation', label: 'Instalação' },
            { value: 'app', label: 'App' },
            { value: 'operator', label: 'Operador' },
          ]}
          onChange={targetType => update({ targetType })}
        />
        <TextFilter
          id="filter-target-id"
          label="Id do alvo"
          value={state.targetId}
          onSubmit={targetId => update({ targetId })}
          className="w-44"
        />
        <SelectFilter
          id="filter-result"
          label="Resultado"
          value={state.result}
          options={[
            { value: 'success', label: 'Sucesso' },
            { value: 'failure', label: 'Falha' },
          ]}
          onChange={result => update({ result })}
        />
        <DateFilter
          id="filter-from"
          label="De"
          value={state.from}
          onChange={from => update({ from })}
        />
        <DateFilter
          id="filter-to"
          label="Até"
          value={state.to}
          onChange={to => update({ to })}
        />
      </FilterBar>
      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState
          message={`Nenhum registro${describeFilters({
            ator: state.actor,
            ação: state.action,
            alvo: state.targetType,
            id: state.targetId,
            resultado: state.result,
          })}.`}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Ator</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Alvo</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map(item => (
                <TableRow key={item.id}>
                  <TableCell>
                    <DateTime value={item.createdAt} />
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{item.actor}</code>
                    {item.actorRole && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({item.actorRole})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{item.action}</TableCell>
                  <TableCell>
                    <Target item={item} />
                  </TableCell>
                  <TableCell>
                    <Result item={item} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.ip ?? '—'}
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
