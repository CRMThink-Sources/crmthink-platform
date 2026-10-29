import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api, call } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function FilterBar(props: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 pb-4" role="search">
      {props.children}
    </div>
  )
}

const selectClass =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'

/** Filtro de lista (`<select>` nativo: acessível e simples de testar). */
export function SelectFilter(props: {
  id: string
  label: string
  value: string | undefined
  options: Array<{ value: string; label: string }>
  onChange: (value: string | undefined) => void
  allLabel?: string
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">
        {props.label}
      </Label>
      <select
        id={props.id}
        className={selectClass}
        value={props.value ?? ''}
        onChange={e => props.onChange(e.target.value || undefined)}
      >
        <option value="">{props.allLabel ?? 'Todos'}</option>
        {props.options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Apps cadastrados como opções de filtro. */
export function AppFilter(props: {
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  const apps = useQuery({
    queryKey: ['apps'],
    queryFn: () => call(api.GET('/admin/apps')),
    staleTime: 5 * 60_000,
  })
  const options = (apps.data?.items ?? []).map(app => ({
    value: app.appCode,
    label: app.name,
  }))
  // O valor da URL aparece mesmo antes de a lista carregar (ou se o app sumiu).
  if (props.value && !options.some(o => o.value === props.value))
    options.unshift({ value: props.value, label: props.value })
  return (
    <SelectFilter
      id="filter-app"
      label="App"
      value={props.value}
      options={options}
      onChange={props.onChange}
    />
  )
}

/** Texto aplicado ao enviar (Enter ou botão), não a cada tecla. */
export function TextFilter(props: {
  id: string
  label: string
  value: string | undefined
  placeholder?: string
  onSubmit: (value: string | undefined) => void
  className?: string
}) {
  const [text, setText] = useState(props.value ?? '')
  useEffect(() => setText(props.value ?? ''), [props.value])
  return (
    <form
      className={cn('grid gap-1', props.className)}
      onSubmit={e => {
        e.preventDefault()
        props.onSubmit(text.trim() || undefined)
      }}
    >
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">
        {props.label}
      </Label>
      <div className="flex gap-1">
        <Input
          id={props.id}
          value={text}
          placeholder={props.placeholder}
          onChange={e => setText(e.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label={`Aplicar ${props.label}`}
        >
          <Search />
        </Button>
      </div>
    </form>
  )
}

export function DateFilter(props: {
  id: string
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">
        {props.label}
      </Label>
      <Input
        id={props.id}
        type="date"
        className="w-40"
        value={props.value ?? ''}
        onChange={e => props.onChange(e.target.value || undefined)}
      />
    </div>
  )
}

/** Descrição dos filtros ativos para o estado vazio ("com status dead, app x"). */
export function describeFilters(
  filters: Record<string, string | number | undefined>,
): string {
  const parts = Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key} = ${value}`)
  return parts.length ? ` com ${parts.join(', ')}` : ''
}

export function PageHeader(props: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 pb-4">
      <h1 className="text-xl font-semibold">{props.title}</h1>
      {props.children}
    </div>
  )
}

/** JSON legível (envelopes, payloads, contato). */
export function JsonBlock(props: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(props.value, null, 2)}
    </pre>
  )
}
