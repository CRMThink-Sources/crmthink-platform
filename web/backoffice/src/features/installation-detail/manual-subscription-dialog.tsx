import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { ApiError, api, call, type Schemas } from '@/api/client'
import type { InstallationDetail } from '@/api/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ActionDialog } from '@/features/actions/action-dialog'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'
import { catalogQuery } from '@/features/catalog/catalog-queries'
import { TIME_ZONE, formatMoney } from '@/lib/format'

type Interval = NonNullable<Schemas['CatalogPlan']['interval']>
type Kind = Schemas['CreateManualSubscription']['kind']

const MAX_MONTHS = 24

const INTERVAL_LABELS: Record<Interval, string> = {
  monthly: 'mensal',
  quarterly: 'trimestral',
  semiannual: 'semestral',
  yearly: 'anual',
}

const selectClass =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm'

/** Hoje no horário de Brasília, como `AAAA-MM-DD`. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now)
}

/** `AAAA-MM-DD` + meses, no mesmo dia (ou no último dia do mês, se não existir). */
function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(date, lastDay))
  return target.toISOString().slice(0, 10)
}

/** Mesmas regras (e mensagens) da API: fim depois do início e até 24 meses. */
export function validatePeriod(start: string, end: string): string | null {
  if (!start || !end) return null
  if (end <= start) return 'O fim deve ser depois do início.'
  if (end > addMonths(start, MAX_MONTHS))
    return `O período pode ter no máximo ${MAX_MONTHS} meses.`
  return null
}

const brDate = (day: string) => day.split('-').reverse().join('/')

type PlanOption = { id: number; label: string; name: string }

/** Planos ativos, pagos e de assinatura dos produtos vinculados ao app da instalação. */
function planOptions(
  catalog: Schemas['CatalogView'] | undefined,
  appCode: string,
): PlanOption[] {
  const options: PlanOption[] = []
  for (const product of catalog?.products ?? []) {
    if (
      !product.active ||
      !product.valid ||
      product.kind !== 'subscription' ||
      !product.apps.includes(appCode)
    )
      continue
    for (const plan of product.plans) {
      if (!plan.active || !plan.valid || plan.isTrial || plan.interval === null)
        continue
      options.push({
        id: plan.id,
        name: plan.name,
        label: `${product.name} — ${plan.name} (${INTERVAL_LABELS[plan.interval]}, ${formatMoney(plan.amount)})`,
      })
    }
  }
  return options
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  installation: InstallationDetail
}

export function ManualSubscriptionDialog(props: Props) {
  if (!props.open) return null
  return <Body {...props} />
}

function Body({ onOpenChange, installation }: Props) {
  const ids = {
    plan: useId(),
    start: useId(),
    end: useId(),
    approvedBy: useId(),
  }
  const catalog = useQuery(catalogQuery)
  const options = useMemo(
    () => planOptions(catalog.data, installation.appCode),
    [catalog.data, installation.appCode],
  )
  const [planId, setPlanId] = useState('')
  const [kind, setKind] = useState<Kind>('manual')
  const [start, setStart] = useState(() => todayInSaoPaulo())
  const [end, setEnd] = useState('')
  const [approvedBy, setApprovedBy] = useState('')

  const periodError = validatePeriod(start, end)
  const bonus = kind === 'bonus'

  const save = useAdminAction({
    run: (body: Schemas['CreateManualSubscription'], reason) =>
      call(
        api.POST('/admin/installations/{id}/subscriptions', {
          body,
          params: {
            path: { id: installation.id },
            header: { 'X-Admin-Reason': reason ?? '' },
          },
        }),
      ),
    invalidates: () => INVALIDATES.installation(installation.id),
    success: (_, body) =>
      `Assinatura criada: ${
        options.find(option => option.id === body.planId)?.name ?? 'plano'
      } até ${brDate(body.periodEnd)}`,
  })

  // `INVALID_PERIOD` fica junto ao campo; os demais erros no alerta do diálogo.
  const periodServerError =
    save.error instanceof ApiError && save.error.code === 'INVALID_PERIOD'
      ? save.error.message
      : null
  const endError = periodError ?? periodServerError

  const disabled =
    !planId || !end || !!periodError || (bonus && !approvedBy.trim())

  return (
    <ActionDialog
      open
      onOpenChange={next => {
        if (!next) save.reset()
        onOpenChange(next)
      }}
      title="Nova assinatura"
      target={`#${installation.id} · ${installation.domain}`}
      effect="Cria a assinatura no SPA, avisa o app e encerra o trial vigente, se houver. A instalação não pode ter outra assinatura ativa ou em atraso."
      confirmLabel="Criar assinatura"
      reasonRequired
      pending={save.pending}
      error={periodServerError ? null : save.error}
      disabled={disabled}
      onConfirm={async reason => {
        const done = await save.execute(
          {
            planId: Number(planId),
            kind,
            periodStart: start || undefined,
            periodEnd: end,
            ...(bonus ? { approvedBy: approvedBy.trim() } : {}),
          },
          reason,
        )
        if (done) onOpenChange(false)
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={ids.plan}>Plano</Label>
        <select
          id={ids.plan}
          className={selectClass}
          value={planId}
          onChange={event => setPlanId(event.target.value)}
        >
          <option value="">
            {catalog.isPending ? 'Carregando planos…' : 'Escolha o plano'}
          </option>
          {options.map(option => (
            <option key={option.id} value={String(option.id)}>
              {option.label}
            </option>
          ))}
        </select>
        {catalog.isError && (
          <p role="alert" className="text-xs text-destructive">
            Não foi possível carregar os planos.
          </p>
        )}
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">Tipo</legend>
        <div className="flex gap-4">
          {(
            [
              ['manual', 'Cobrança manual'],
              ['bonus', 'Bonificação'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="subscription-kind"
                className="size-4 accent-primary"
                checked={kind === value}
                onChange={() => setKind(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.start}>Início</Label>
          <Input
            id={ids.start}
            type="date"
            value={start}
            onChange={event => setStart(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.end}>Fim</Label>
          <Input
            id={ids.end}
            type="date"
            value={end}
            aria-invalid={!!endError}
            onChange={event => setEnd(event.target.value)}
          />
        </div>
      </div>
      {endError && (
        <p role="alert" className="-mt-2 text-xs text-destructive">
          {endError}
        </p>
      )}

      {bonus && (
        <div className="grid gap-1.5">
          <Label htmlFor={ids.approvedBy}>Responsável pela bonificação</Label>
          <Input
            id={ids.approvedBy}
            autoComplete="off"
            maxLength={200}
            value={approvedBy}
            onChange={event => setApprovedBy(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Quem autorizou. Fica no comentário da assinatura e na auditoria.
          </p>
        </div>
      )}
    </ActionDialog>
  )
}
