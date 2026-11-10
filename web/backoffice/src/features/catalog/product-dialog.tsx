import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import {
  useForm,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form'
import z from 'zod'
import { ApiError, api, call, type Schemas } from '@/api/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { validateReason } from '@/features/actions/reason'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'

type Product = Schemas['CatalogProduct']
type BillingModel = NonNullable<Product['billingModelKey']>

export const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  standard: 'Padrão',
  per_unit: 'Por unidade',
  one_time: 'Compra única',
}

// ---- Peças compartilhadas com o formulário de plano --------------------------------

export const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** O que usa o item, a partir dos `details` de `PLAN_IN_USE` / `PRODUCT_IN_USE`. */
function usageLines(details: unknown): string[] {
  const d = (details && typeof details === 'object' ? details : {}) as Record<
    string,
    unknown
  >
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  const count = (value: unknown) => (typeof value === 'number' ? value : 0)
  const lines: string[] = []
  const subs = (d.subscriptions ?? {}) as Record<string, unknown>
  if (count(subs.total))
    lines.push(
      `${plural(count(subs.total), 'assinatura', 'assinaturas')}, ${plural(
        count(subs.active),
        'ativa',
        'ativas',
      )}`,
    )
  const trialOfApps = strings(d.trialOfApps)
  if (trialOfApps.length)
    lines.push(`plano de trial de ${trialOfApps.join(', ')}`)
  const apps = strings(d.apps)
  if (apps.length) lines.push(`apps vinculados: ${apps.join(', ')}`)
  if (count(d.plans)) lines.push(plural(count(d.plans), 'plano', 'planos'))
  return lines
}

/** Erro da API que não é de campo: o 409 de uso explica o que fazer. */
export function ServerErrorAlert({ error }: { error: Error }) {
  const code = error instanceof ApiError ? error.code : 'ERRO'
  const inUse = code === 'PLAN_IN_USE' || code === 'PRODUCT_IN_USE'
  const lines =
    inUse && error instanceof ApiError ? usageLines(error.details) : []
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>A ação não foi concluída</AlertTitle>
      <AlertDescription>
        <p>
          <code className="font-mono text-xs">{code}</code> — {error.message}
        </p>
        {lines.length > 0 && <p>Em uso por: {lines.join('; ')}.</p>}
        {inUse && (
          <p>
            Para mudar isso, crie um plano novo e desative este: item em uso não
            tem preço, trial, intervalo ou modelo alterado.
          </p>
        )}
      </AlertDescription>
    </Alert>
  )
}

/** Erros `VALIDATION_ERROR` por campo; `true` quando todos tinham campo no formulário. */
export function applyFieldErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: Error,
  fields: readonly string[],
): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR')
    return false
  const issues = error.fieldErrors
  if (!issues.length || issues.some(issue => !fields.includes(issue.path)))
    return false
  for (const issue of issues)
    form.setError(issue.path as Path<T>, {
      type: 'server',
      message: issue.message,
    })
  return true
}

export function FormField(props: {
  label: string
  error?: string
  hint?: string
  children: (id: string, invalid: boolean) => ReactNode
}) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      {props.children(id, !!props.error)}
      {props.hint && !props.error && (
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      )}
      {props.error && (
        <p role="alert" className="text-xs text-destructive">
          {props.error}
        </p>
      )}
    </div>
  )
}

export const selectClass =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm'

export function CheckField(props: {
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
      <Label htmlFor={id}>{props.label}</Label>
    </div>
  )
}

/** Motivo obrigatório ao desativar (`PATCH active:false` é alto impacto). */
export function ReasonField(props: {
  value: string
  onChange: (value: string) => void
  error: string | null
}) {
  return (
    <FormField label="Motivo" error={props.error ?? undefined}>
      {(id, invalid) => (
        <Textarea
          id={id}
          rows={2}
          value={props.value}
          aria-invalid={invalid}
          onChange={event => props.onChange(event.target.value)}
          placeholder="Por que está desativando? Fica na auditoria."
        />
      )}
    </FormField>
  )
}

export function DialogFrame(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onSubmit: () => void
  pending: boolean
  children: ReactNode
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Os campos nascem a cada abertura: nada vaza de um item para o outro. */}
        {props.open && (
          <form
            noValidate
            onSubmit={event => {
              event.preventDefault()
              props.onSubmit()
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>{props.title}</DialogTitle>
              <DialogDescription>{props.description}</DialogDescription>
            </DialogHeader>
            {props.children}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={props.pending}>
                {props.pending ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Motivo exigido só quando um item ativo é desligado. */
export function useReason(required: boolean) {
  const [reason, setReason] = useState('')
  const [shown, setShown] = useState(false)
  const error = required && shown ? validateReason(reason) : null
  return {
    reason,
    setReason,
    error,
    /** `true` quando pode seguir; senão passa a mostrar o erro. */
    check(): boolean {
      if (!required) return true
      setShown(true)
      return validateReason(reason) === null
    },
    header: required ? reason.trim() : undefined,
  }
}

// ---- Formulário de produto ---------------------------------------------------------

const MODELS = ['standard', 'per_unit', 'one_time'] as const

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome')
    .max(200, 'Até 200 caracteres'),
  billingModel: z.enum(MODELS, 'Escolha o modelo de cobrança'),
  active: z.boolean(),
})
type Values = z.infer<typeof schema>

const FIELDS = ['name', 'billingModel', 'active']

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: Product
  onSaved?: (product: Product) => void
}

function Body({ product, onOpenChange, onSaved }: Omit<Props, 'open'>) {
  const edit = !!product
  const initial = {
    name: product?.name ?? '',
    billingModel: product?.billingModelKey ?? 'standard',
    active: product?.active ?? true,
  } as Values
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  })
  const [serverError, setServerError] = useState<Error | null>(null)
  const active = form.watch('active')
  const reason = useReason(edit && initial.active && !active)

  const save = useAdminAction({
    run: (values: Values, why) => {
      const header = why ? { 'X-Admin-Reason': why } : {}
      if (!product)
        return call(
          api.POST('/admin/catalog/products', {
            body: values,
            params: { header },
          }),
        )
      const patch: Partial<Values> = {}
      if (values.name !== initial.name) patch.name = values.name
      if (values.billingModel !== initial.billingModel)
        patch.billingModel = values.billingModel
      if (values.active !== initial.active) patch.active = values.active
      return call(
        api.PATCH('/admin/catalog/products/{id}', {
          body: patch,
          params: { path: { id: product.id }, header },
        }),
      )
    },
    invalidates: () => INVALIDATES.catalog(),
    success: result =>
      edit ? 'Produto atualizado' : `Produto ${result.name} criado`,
    onError: error => {
      if (!applyFieldErrors(form, error, FIELDS)) setServerError(error)
    },
  })

  const submit = form.handleSubmit(async values => {
    setServerError(null)
    if (!reason.check()) return
    const done = await save.execute(values, reason.header)
    if (!done) return
    onSaved?.(done.result)
    onOpenChange(false)
  })

  const errors = form.formState.errors
  return (
    <DialogFrame
      open
      onOpenChange={onOpenChange}
      title={edit ? 'Editar produto' : 'Novo produto'}
      description={
        edit
          ? `Produto #${product.id}. Só o que você mudar é enviado.`
          : 'Cria o produto no portal CRMThink.'
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
        label="Modelo de cobrança"
        error={errors.billingModel?.message}
        hint={
          edit
            ? 'Produto com planos ou apps vinculados não muda de modelo: crie um produto novo e desative este.'
            : undefined
        }
      >
        {id => (
          <select
            id={id}
            className={selectClass}
            {...form.register('billingModel')}
          >
            {!product?.billingModelKey && edit && <option value="">—</option>}
            {MODELS.map(model => (
              <option key={model} value={model}>
                {BILLING_MODEL_LABELS[model]}
              </option>
            ))}
          </select>
        )}
      </FormField>
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

export function ProductDialog(props: Props) {
  if (!props.open) return null
  return <Body {...props} />
}
