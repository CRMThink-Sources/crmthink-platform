import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import {
  useForm,
  useWatch,
  type FieldPath,
  type UseFormReturn,
} from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, api, call } from '@/api/client'
import { JsonBlock, PageHeader } from '@/components/filters'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'
import { REASON_MAX, validateReason } from '@/features/actions/reason'
import {
  SecretRevealDialog,
  useSecretReveal,
} from '@/features/actions/secret-reveal-dialog'
import { ProductPicker } from '@/features/catalog/product-picker'
import {
  appFormSchema,
  emptyForm,
  FIELD_LABELS,
  formFieldOf,
  fromApp,
  toCreatePayload,
  toPatchPayload,
  type AppFormMode,
  type AppFormValues,
} from './app-form-schema'
import { InstallPreview } from './install-preview'

type FormApi = UseFormReturn<AppFormValues>

/** Campo com rótulo, dica e a mensagem de erro (da validação local ou da API). */
function Field(props: {
  form: FormApi
  name: FieldPath<AppFormValues>
  label: string
  hint?: string
  readOnly?: boolean
  placeholder?: string
  type?: string
  autoComplete?: string
  className?: string
  multiline?: boolean
}) {
  const id = useId()
  const error = props.name
    .split('.')
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      props.form.formState.errors,
    ) as { message?: string } | undefined
  const common = {
    id,
    placeholder: props.placeholder,
    readOnly: props.readOnly,
    'aria-invalid': !!error,
    'aria-describedby': error ? `${id}-error` : undefined,
    ...props.form.register(props.name as never),
  }
  return (
    <div className={`grid gap-1.5 ${props.className ?? ''}`}>
      <Label htmlFor={id}>{props.label}</Label>
      {props.multiline ? (
        <Textarea rows={3} {...common} />
      ) : (
        <Input
          type={props.type}
          autoComplete={props.autoComplete ?? 'off'}
          {...common}
        />
      )}
      {props.hint && !error && (
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      )}
      {error?.message && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error.message}
        </p>
      )}
    </div>
  )
}

function Check(props: {
  form: FormApi
  name: 'trialOnInstall' | 'active'
  label: string
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-primary"
        {...props.form.register(props.name)}
      />
      <Label htmlFor={id}>{props.label}</Label>
    </div>
  )
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {props.children}
      </CardContent>
    </Card>
  )
}

/** Erros da API por campo; o que não é de campo vira o aviso no topo. */
function applyApiErrors(form: FormApi, error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  if (error.code === 'VALIDATION_ERROR' && error.fieldErrors.length) {
    for (const issue of error.fieldErrors)
      form.setError(formFieldOf(issue.path) as FieldPath<AppFormValues>, {
        type: 'server',
        message: issue.message,
      })
    return null
  }
  const byCode: Record<string, FieldPath<AppFormValues>> = {
    APP_ALREADY_EXISTS: 'appCode',
    BITRIX_CLIENT_ID_IN_USE: 'bitrixClientId',
  }
  const field = byCode[error.code]
  if (field) {
    form.setError(field, { type: 'server', message: error.message })
    return null
  }
  return `${error.code} — ${error.message}`
}

function AppForm(props: { mode: AppFormMode; initial: AppFormValues }) {
  const { mode, initial } = props
  const navigate = useNavigate()
  const secret = useSecretReveal()
  const [topError, setTopError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [createdCode, setCreatedCode] = useState<string | null>(null)
  const schema = useMemo(() => appFormSchema(mode), [mode])
  const form = useForm<AppFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  })
  const current = useWatch({ control: form.control }) as AppFormValues

  const reasonError = reason.trim() ? validateReason(reason) : null
  const patch = mode === 'edit' ? toPatchPayload(initial, current) : {}
  const changed = Object.keys(patch)

  const onError = (error: Error) => setTopError(applyApiErrors(form, error))
  const create = useAdminAction({
    run: (values: AppFormValues, why) =>
      call(
        api.POST('/admin/apps', {
          body: toCreatePayload(values),
          params: { header: why ? { 'X-Admin-Reason': why } : {} },
        }),
      ),
    invalidates: result => INVALIDATES.apps(result.app.appCode),
    success: result => `App ${result.app.appCode} cadastrado`,
    onError,
  })
  const update = useAdminAction({
    run: (values: AppFormValues, why) =>
      call(
        api.PATCH('/admin/apps/{appCode}', {
          params: {
            path: { appCode: initial.appCode },
            header: why ? { 'X-Admin-Reason': why } : {},
          },
          body: toPatchPayload(initial, values),
        }),
      ),
    invalidates: () => INVALIDATES.apps(initial.appCode),
    success: () => 'Alterações salvas',
    onError,
  })

  const submit = form.handleSubmit(async values => {
    setTopError(null)
    if (reasonError) return
    const why = reason.trim() || undefined
    if (mode === 'create') {
      const done = await create.execute(values, why)
      if (!done) return
      create.reset()
      setCreatedCode(done.result.app.appCode)
      secret.show({
        title: `App ${done.result.app.appCode} cadastrado`,
        secrets: [
          { label: 'Chave de API', value: done.result.credentials.apiKey },
          {
            label: 'Segredo de webhook',
            value: done.result.credentials.webhookSecret,
          },
        ],
      })
      return
    }
    if (await update.execute(values, why)) {
      update.reset()
      navigate(`/apps/${encodeURIComponent(initial.appCode)}`)
    }
  })

  const pending = create.pending || update.pending
  const saveDisabled =
    pending || !!reasonError || (mode === 'edit' && changed.length === 0)

  return (
    <>
      <form
        onSubmit={submit}
        className="grid gap-4 lg:grid-cols-[1fr_22rem]"
        noValidate
      >
        <div className="grid gap-4">
          {topError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Não foi possível salvar</AlertTitle>
              <AlertDescription>{topError}</AlertDescription>
            </Alert>
          )}

          <Section title="Cadastro">
            <Field
              form={form}
              name="appCode"
              label="appCode"
              hint="Identificador fixo (ex.: crmthink.gptmaker). Não muda depois."
              readOnly={mode === 'edit'}
              className="sm:col-span-2"
            />
            <Field form={form} name="name" label="Nome" />
            <Field form={form} name="logoUrl" label="Logo (URL)" />
            <Field
              form={form}
              name="bitrixClientId"
              label="client_id do Bitrix"
            />
            <Field
              form={form}
              name="bitrixClientSecret"
              label="client_secret do Bitrix"
              type="password"
              autoComplete="new-password"
              hint={
                mode === 'edit'
                  ? 'Só de escrita: deixe vazio para manter o atual.'
                  : undefined
              }
            />
            <Field
              form={form}
              name="bitrixAppCode"
              label="CODE no app.info"
              hint="Só para app de parceiro; vazio = o próprio client_id."
            />
            <Field
              form={form}
              name="scopes"
              label="Escopos"
              hint="Separados por vírgula (ex.: crm, imbot)."
            />
            {mode === 'create' && (
              <Check form={form} name="active" label="Cadastrar já ativo" />
            )}
          </Section>

          <Section title="Integração e produtos">
            <Field form={form} name="installerUrl" label="URL do instalador" />
            <Field form={form} name="webhookUrl" label="URL de webhook" />
            <div
              role="group"
              aria-labelledby="product-picker-label"
              className="grid gap-1.5 sm:col-span-2"
            >
              <Label id="product-picker-label">Produtos (SPA 1134)</Label>
              <ProductPicker
                value={current.productSpaIds ?? ''}
                onChange={value =>
                  form.setValue('productSpaIds', value, {
                    shouldDirty: true,
                    shouldValidate: form.formState.isSubmitted,
                  })
                }
              />
              {form.formState.errors.productSpaIds?.message && (
                <p role="alert" className="text-xs text-destructive">
                  {form.formState.errors.productSpaIds.message}
                </p>
              )}
            </div>
          </Section>

          <Section title="Trial">
            <Field form={form} name="trialDays" label="Dias de trial" />
            <Field
              form={form}
              name="trialPlanId"
              label="Plano de trial (SPA 1138)"
            />
            <Check
              form={form}
              name="trialOnInstall"
              label="Iniciar trial na instalação"
            />
          </Section>

          <Section title="Tema da página de instalação">
            <Field
              form={form}
              name="theme.title"
              label="Título"
              className="sm:col-span-2"
            />
            <Field
              form={form}
              name="theme.welcomeText"
              label="Texto de boas-vindas"
              multiline
              className="sm:col-span-2"
            />
            <Field
              form={form}
              name="theme.primaryColor"
              label="Cor do botão"
              placeholder="#2f6fed"
            />
            <Field
              form={form}
              name="theme.backgroundColor"
              label="Cor de fundo"
              placeholder="#f5f7fb"
            />
            <Field
              form={form}
              name="theme.textColor"
              label="Cor do texto"
              placeholder="#1f2937"
            />
            <Field
              form={form}
              name="theme.termsText"
              label="Texto dos termos"
            />
            <Field
              form={form}
              name="theme.termsUrl"
              label="URL dos termos"
              className="sm:col-span-2"
            />
          </Section>

          {mode === 'edit' && (
            <Card>
              <CardHeader>
                <CardTitle>O que vai mudar</CardTitle>
              </CardHeader>
              <CardContent>
                {changed.length ? (
                  <ul className="grid gap-1 text-sm">
                    {changed.map(key => (
                      <li key={key}>
                        <strong>{FIELD_LABELS[key] ?? key}</strong>
                        {key !== 'bitrixClientSecret' && (
                          <JsonValue
                            value={(patch as Record<string, unknown>)[key]}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma alteração ainda.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="grid gap-3 pt-4">
              <div className="grid gap-1.5">
                <Label htmlFor="app-reason">Motivo (opcional)</Label>
                <Textarea
                  id="app-reason"
                  rows={2}
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                  aria-invalid={!!reasonError}
                  placeholder="Fica na auditoria."
                />
                <p className="text-xs text-muted-foreground">
                  Até {REASON_MAX} caracteres, em uma linha.
                </p>
                {reasonError && (
                  <p role="alert" className="text-xs text-destructive">
                    {reasonError}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saveDisabled}>
                  {pending
                    ? 'Salvando…'
                    : mode === 'create'
                      ? 'Cadastrar app'
                      : 'Salvar alterações'}
                </Button>
                <Button variant="outline" asChild>
                  <Link
                    to={
                      mode === 'create'
                        ? '/apps'
                        : `/apps/${encodeURIComponent(initial.appCode)}`
                    }
                  >
                    Cancelar
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="grid content-start gap-2 lg:sticky lg:top-4">
          <h2 className="text-sm font-medium">Pré-visualização do tema</h2>
          <InstallPreview
            name={current.name || 'Seu app'}
            logoUrl={current.logoUrl ?? ''}
            theme={current.theme}
          />
          <p className="text-xs text-muted-foreground">
            O logo só aparece aqui se for um endereço que este painel pode
            carregar.
          </p>
        </aside>
      </form>

      <SecretRevealDialog
        reveal={secret.reveal}
        onDismiss={() => {
          secret.dismiss()
          if (createdCode) navigate(`/apps/${encodeURIComponent(createdCode)}`)
        }}
      />
    </>
  )
}

function JsonValue({ value }: { value: unknown }) {
  const text =
    typeof value === 'object' && value !== null ? null : String(value)
  return text === null ? (
    <JsonBlock value={value} />
  ) : (
    <>
      {' → '}
      <code className="text-xs">{text || '(vazio)'}</code>
    </>
  )
}

/** `/apps/new`: cadastro de app. */
export function AppCreatePage() {
  return (
    <>
      <PageHeader title="Cadastrar app" />
      <AppForm mode="create" initial={emptyForm()} />
    </>
  )
}

/** `/apps/:appCode/edit`: edição com diff dos campos alterados. */
export function AppEditPage() {
  const appCode = useParams().appCode ?? ''
  const app = useQuery({
    queryKey: ['app', appCode],
    queryFn: () =>
      call(api.GET('/admin/apps/{appCode}', { params: { path: { appCode } } })),
  })
  return (
    <>
      <PageHeader title={`Editar ${app.data?.name ?? appCode}`} />
      {app.isPending ? (
        <LoadingState rows={6} />
      ) : app.isError ? (
        <ErrorState error={app.error} onRetry={() => void app.refetch()} />
      ) : (
        <AppForm mode="edit" initial={fromApp(app.data)} />
      )}
    </>
  )
}
