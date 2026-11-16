import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { api, call, type Schemas } from '@/api/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ActionDialog } from '@/features/actions/action-dialog'
import type { SecretReveal } from '@/features/actions/secret-reveal-dialog'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'
import { appsQuery } from '@/features/apps/page'
import { EVENT_GROUPS, inCatalogOrder, type EventType } from './event-types'

type Endpoint = Schemas['WebhookEndpoint']

/** Mesma regra da API que o operador pode conferir antes de enviar (HTTPS); o resto é validado lá. */
export function validateUrl(value: string): string | null {
  const url = value.trim()
  if (!url) return null
  try {
    if (new URL(url).protocol !== 'https:')
      return 'A URL deve usar HTTPS (https://...).'
  } catch {
    return 'A URL não é válida.'
  }
  return null
}

const sameSet = <T,>(a: Iterable<T>, b: Iterable<T>) => {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every(item => right.has(item))
}

function Check(props: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-primary"
        checked={props.checked}
        onChange={event => props.onChange(event.target.checked)}
      />
      <Label htmlFor={id} className="font-mono text-xs">
        {props.label}
      </Label>
    </div>
  )
}

function toggle<T>(set: Set<T>, value: T, on: boolean): Set<T> {
  const next = new Set(set)
  if (on) next.add(value)
  else next.delete(value)
  return next
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Sem destinatário = criação; com ele, edição (só o que mudou é enviado). */
  endpoint?: Endpoint
  onIssued?: (reveal: SecretReveal) => void
}

export function EndpointFormDialog(props: Props) {
  if (!props.open) return null
  return <Body {...props} />
}

function Body({ onOpenChange, endpoint, onIssued }: Props) {
  const ids = { name: useId(), url: useId() }
  const edit = !!endpoint
  const apps = useQuery(appsQuery)
  const [name, setName] = useState(endpoint?.name ?? '')
  const [url, setUrl] = useState(endpoint?.url ?? '')
  const [types, setTypes] = useState<Set<EventType>>(
    () => new Set(endpoint?.eventTypes ?? []),
  )
  const [appCodes, setAppCodes] = useState<Set<string>>(
    () => new Set(endpoint?.appCodes ?? []),
  )

  // Apps cadastrados, mais os do filtro que a lista não traz (para não perdê-los na edição).
  const appOptions = useMemo(() => {
    const known = new Map(
      (apps.data?.items ?? []).map(app => [app.appCode, app.name]),
    )
    for (const code of endpoint?.appCodes ?? [])
      if (!known.has(code)) known.set(code, code)
    return [...known].map(([code, label]) => ({ code, label }))
  }, [apps.data, endpoint])

  const urlError = validateUrl(url)
  const orderedTypes = inCatalogOrder(types)

  const patch = useMemo(() => {
    if (!endpoint) return null
    const diff: Schemas['UpdateWebhookEndpointRequest'] = {}
    if (name.trim() !== endpoint.name) diff.name = name.trim()
    if (url.trim() !== endpoint.url) diff.url = url.trim()
    if (!sameSet(orderedTypes, endpoint.eventTypes))
      diff.eventTypes = orderedTypes
    if (!sameSet(appCodes, endpoint.appCodes)) diff.appCodes = [...appCodes]
    return diff
  }, [endpoint, name, url, orderedTypes, appCodes])

  const create = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/webhook-endpoints', {
          body: {
            name: name.trim(),
            url: url.trim(),
            eventTypes: orderedTypes,
            appCodes: [...appCodes],
          },
          params: { header: { 'X-Admin-Reason': reason ?? '' } },
        }),
      ),
    invalidates: () => INVALIDATES.webhookEndpoints(),
    success: result => `Destinatário ${result.endpoint.name} criado`,
  })

  const update = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.PATCH('/admin/webhook-endpoints/{id}', {
          body: patch ?? {},
          params: {
            path: { id: endpoint?.id ?? 0 },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
        }),
      ),
    invalidates: () => INVALIDATES.webhookEndpoints(),
    success: () => 'Destinatário atualizado',
  })

  const active = endpoint ? update : create

  const incomplete =
    !name.trim() || !url.trim() || orderedTypes.length === 0 || !!urlError
  const unchanged = edit && Object.keys(patch ?? {}).length === 0

  return (
    <ActionDialog
      open
      onOpenChange={next => {
        if (!next) active.reset()
        onOpenChange(next)
      }}
      title={edit ? 'Editar destinatário' : 'Novo destinatário de eventos'}
      target={
        endpoint
          ? `#${endpoint.id} · ${endpoint.name}`
          : 'Novo destinatário de eventos'
      }
      effect={
        edit
          ? 'Só o que você mudar é enviado. Mudar tipos ou apps vale para os próximos eventos.'
          : 'Passa a receber, na URL, os eventos gravados daqui em diante (sem histórico). O segredo de assinatura aparece uma única vez, na próxima tela.'
      }
      confirmLabel={edit ? 'Salvar' : 'Criar destinatário'}
      reasonRequired={!edit}
      disabled={incomplete || unchanged}
      pending={active.pending}
      error={active.error}
      onConfirm={async reason => {
        if (endpoint) {
          if (await update.execute(undefined, reason)) onOpenChange(false)
          return
        }
        const done = await create.execute(undefined, reason)
        if (!done) return
        onOpenChange(false)
        onIssued?.({
          title: 'Destinatário criado',
          secrets: [
            { label: 'Segredo de assinatura', value: done.result.secret },
          ],
          notes: [{ label: 'Destinatário', value: done.result.endpoint.name }],
        })
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={ids.name}>Nome</Label>
        <Input
          id={ids.name}
          autoComplete="off"
          maxLength={200}
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.url}>URL</Label>
        <Input
          id={ids.url}
          autoComplete="off"
          placeholder="https://erp.example.com/hooks"
          aria-invalid={!!urlError}
          value={url}
          onChange={event => setUrl(event.target.value)}
        />
        {urlError && (
          <p role="alert" className="text-xs text-destructive">
            {urlError}
          </p>
        )}
      </div>

      {EVENT_GROUPS.map(group => (
        <fieldset key={group.title} className="grid gap-1.5">
          <legend className="text-sm font-medium">{group.title}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {group.types.map(type => (
              <Check
                key={type}
                label={type}
                checked={types.has(type)}
                onChange={on => setTypes(current => toggle(current, type, on))}
              />
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">
          Apps (nenhum marcado = todos os apps)
        </legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {appOptions.map(app => (
            <Check
              key={app.code}
              label={app.label}
              checked={appCodes.has(app.code)}
              onChange={on =>
                setAppCodes(current => toggle(current, app.code, on))
              }
            />
          ))}
        </div>
      </fieldset>
    </ActionDialog>
  )
}
