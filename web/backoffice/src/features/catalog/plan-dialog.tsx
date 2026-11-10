import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import z from 'zod'
import { api, call, type Schemas } from '@/api/client'
import { Input } from '@/components/ui/input'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'
import { centsToReais, reaisToCents } from '@/lib/money'
import {
  applyFieldErrors,
  CheckField,
  DialogFrame,
  FormField,
  ReasonField,
  selectClass,
  ServerErrorAlert,
  useReason,
} from './product-dialog'

type Product = Schemas['CatalogProduct']
type Plan = Schemas['CatalogPlan']
type Interval = NonNullable<Plan['interval']>

const INTERVAL_LABELS: Record<Interval, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  yearly: 'Anual',
}
const INTERVALS = Object.keys(INTERVAL_LABELS) as Interval[]

const PRICE = /^price_[A-Za-z0-9]+$/
// O formato só vale com o campo à vista: no trial os preços ficam ocultos e são ignorados.
const priceField = z.string().trim()

function planSchema(oneTime: boolean) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Informe o nome')
        .max(200, 'Até 200 caracteres'),
      amount: z
        .string()
        .refine(
          value => reaisToCents(value) !== null,
          'Valor inválido (ex.: 199,00)',
        ),
      interval: oneTime ? z.string() : z.enum(INTERVALS, 'Escolha o intervalo'),
      trial: z.boolean(),
      priceHomolog: priceField,
      priceProduction: priceField,
      active: z.boolean(),
    })
    .superRefine((values, ctx) => {
      // Plano pago sem nenhum preço seria lido como trial grátis: a API recusa (422).
      if (values.trial) return
      for (const path of ['priceHomolog', 'priceProduction'] as const)
        if (values[path] && !PRICE.test(values[path]))
          ctx.addIssue({
            code: 'custom',
            path: [path],
            message:
              'Use o formato price_ seguido de letras e números (ex.: price_1Abc23)',
          })
      if (!values.priceHomolog && !values.priceProduction)
        ctx.addIssue({
          code: 'custom',
          path: ['priceHomolog'],
          message:
            'Informe ao menos um preço (homologação ou produção) ou marque o plano como trial.',
        })
    })
}
type Values = z.infer<ReturnType<typeof planSchema>>

const FIELDS = [
  'name',
  'amount',
  'interval',
  'trial',
  'priceHomolog',
  'priceProduction',
  'active',
]

type Payload = Schemas['CatalogPlanRequest']

/** Valores do formulário → corpo da API (preço some no trial; sem intervalo em compra única). */
function toPayload(values: Values, oneTime: boolean): Payload {
  const price = (value: string) => (values.trial ? null : value.trim() || null)
  return {
    name: values.name.trim(),
    amount: reaisToCents(values.amount) ?? 0,
    interval: oneTime ? null : (values.interval as Interval),
    trial: values.trial,
    priceHomolog: price(values.priceHomolog),
    priceProduction: price(values.priceProduction),
    active: values.active,
  }
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: Product
  plan?: Plan
}

function Body({ product, plan, onOpenChange }: Omit<Props, 'open'>) {
  const edit = !!plan
  const oneTime =
    product.kind === 'one_time' || product.billingModelKey === 'one_time'
  const schema = planSchema(oneTime)
  const initial: Values = {
    name: plan?.name ?? '',
    amount: plan ? centsToReais(plan.amount) : '',
    interval: plan?.interval ?? (oneTime ? '' : 'monthly'),
    trial: plan?.isTrial ?? false,
    priceHomolog: plan?.priceHomolog ?? '',
    priceProduction: plan?.priceProduction ?? '',
    active: plan?.active ?? true,
  }
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  })
  const [serverError, setServerError] = useState<Error | null>(null)
  const trial = form.watch('trial')
  const active = form.watch('active')
  const reason = useReason(edit && initial.active && !active)

  const save = useAdminAction({
    run: (values: Values, why) => {
      const header = why ? { 'X-Admin-Reason': why } : {}
      const body = toPayload(values, oneTime)
      if (!plan)
        return call(
          api.POST('/admin/catalog/products/{id}/plans', {
            body,
            params: { path: { id: product.id }, header },
          }),
        )
      const before = toPayload(initial, oneTime)
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(body) as (keyof Payload)[])
        if (body[key] !== before[key]) patch[key] = body[key]
      return call(
        api.PATCH('/admin/catalog/plans/{id}', {
          body: patch as Schemas['CatalogPlanPatchRequest'],
          params: { path: { id: plan.id }, header },
        }),
      )
    },
    invalidates: () => INVALIDATES.catalog(),
    success: result =>
      edit ? 'Plano atualizado' : `Plano ${result.name} criado`,
    onError: error => {
      if (!applyFieldErrors(form, error, FIELDS)) setServerError(error)
    },
  })

  const submit = form.handleSubmit(async values => {
    setServerError(null)
    if (!reason.check()) return
    const done = await save.execute(values, reason.header)
    if (done) onOpenChange(false)
  })

  const errors = form.formState.errors
  return (
    <DialogFrame
      open
      onOpenChange={onOpenChange}
      title={edit ? 'Editar plano' : 'Novo plano'}
      description={
        edit
          ? `Plano #${plan.id} de ${product.name}. Só o que você mudar é enviado.`
          : `Plano do produto ${product.name}.`
      }
      onSubmit={() => void submit()}
      pending={save.pending}
    >
      <FormField label="Nome" error={errors.name?.message}>
        {(id, invalid) => (
          <Input
            id={id}
            autoComplete="off"
            aria-invalid={invalid}
            {...form.register('name')}
          />
        )}
      </FormField>
      <FormField
        label="Valor de referência (R$)"
        error={errors.amount?.message}
        hint="Só referência: quem cobra é o preço do Stripe. Ex.: 199,00."
      >
        {(id, invalid) => (
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={invalid}
            {...form.register('amount')}
          />
        )}
      </FormField>
      {!oneTime && (
        <FormField label="Intervalo" error={errors.interval?.message}>
          {id => (
            <select
              id={id}
              className={selectClass}
              {...form.register('interval')}
            >
              {INTERVALS.map(value => (
                <option key={value} value={value}>
                  {INTERVAL_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
      <CheckField
        label="Plano de trial (sem cobrança)"
        checked={trial}
        onChange={checked => form.setValue('trial', checked)}
      />
      {!trial && (
        <>
          <FormField
            label="ID do preço no Stripe: homologação"
            error={errors.priceHomolog?.message}
            hint="Informe ao menos um preço (homologação ou produção). Um plano sem o preço do ambiente em uso não é oferecido."
          >
            {(id, invalid) => (
              <Input
                id={id}
                autoComplete="off"
                spellCheck={false}
                placeholder="price_..."
                aria-invalid={invalid}
                {...form.register('priceHomolog')}
              />
            )}
          </FormField>
          <FormField
            label="ID do preço no Stripe: produção"
            error={errors.priceProduction?.message}
          >
            {(id, invalid) => (
              <Input
                id={id}
                autoComplete="off"
                spellCheck={false}
                placeholder="price_..."
                aria-invalid={invalid}
                {...form.register('priceProduction')}
              />
            )}
          </FormField>
        </>
      )}
      {edit && (
        <p className="text-xs text-muted-foreground">
          Plano em uso não troca preço, trial nem intervalo (assinaturas ou
          trial de app): crie um plano novo e desative este.
        </p>
      )}
      <CheckField
        label="Ativo"
        checked={active}
        onChange={checked => form.setValue('active', checked)}
      />
      {reason.error !== null || (edit && initial.active && !active) ? (
        <ReasonField
          value={reason.reason}
          onChange={reason.setReason}
          error={reason.error}
        />
      ) : null}
      {serverError && <ServerErrorAlert error={serverError} />}
    </DialogFrame>
  )
}

export function PlanDialog(props: Props) {
  if (!props.open) return null
  return <Body {...props} />
}
