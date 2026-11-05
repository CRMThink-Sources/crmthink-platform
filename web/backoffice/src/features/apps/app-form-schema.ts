import z from 'zod'
import type { App } from '@/api/types'

/**
 * Formulário de app. Os campos de lista e número são texto no formulário e viram
 * array e número só no envio (`toPayload`). As regras espelham as da API
 * (`registry/app-registry.ts`), que continua sendo a validação final: o que ela recusar
 * volta por campo (`applyApiErrors`).
 */

const optionalUrl = z
  .string()
  .trim()
  .refine(value => !value || URL.canParse(value), 'URL inválida')

const optionalPositiveInt = z
  .string()
  .trim()
  .refine(
    value => !value || (/^\d+$/.test(value) && Number(value) > 0),
    'Informe um número inteiro maior que zero',
  )

export const APP_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/

const themeSchema = z.object({
  primaryColor: z.string().trim().max(32, 'Até 32 caracteres'),
  backgroundColor: z.string().trim().max(32, 'Até 32 caracteres'),
  textColor: z.string().trim().max(32, 'Até 32 caracteres'),
  title: z.string().trim().max(200, 'Até 200 caracteres'),
  welcomeText: z.string().trim().max(2000, 'Até 2000 caracteres'),
  termsUrl: optionalUrl,
  termsText: z.string().trim().max(500, 'Até 500 caracteres'),
})

export type AppFormMode = 'create' | 'edit'

export function appFormSchema(mode: AppFormMode) {
  return z
    .object({
      appCode:
        mode === 'create'
          ? z
              .string()
              .trim()
              .regex(
                APP_CODE_PATTERN,
                'appCode inválido (ex.: crmthink.gptmaker)',
              )
          : z.string(),
      name: z
        .string()
        .trim()
        .min(1, 'Informe o nome')
        .max(200, 'Até 200 caracteres'),
      logoUrl: optionalUrl,
      bitrixClientId: z.string().trim().min(1, 'Informe o client_id'),
      // Cadastro exige; na edição o campo é só de escrita e vazio significa "não mudar".
      bitrixClientSecret:
        mode === 'create'
          ? z.string().min(1, 'Informe o client_secret')
          : z.string(),
      bitrixAppCode: z.string().trim().max(200, 'Até 200 caracteres'),
      scopes: z.string(),
      installerUrl: optionalUrl,
      webhookUrl: optionalUrl,
      productSpaIds: z
        .string()
        .trim()
        .refine(
          value =>
            !value ||
            splitList(value).every(
              item => /^\d+$/.test(item) && Number(item) > 0,
            ),
          'Informe ids numéricos separados por vírgula',
        ),
      trialDays: z
        .string()
        .trim()
        .refine(
          value => !value || (/^\d+$/.test(value) && Number(value) <= 365),
          'Informe de 0 a 365 dias',
        ),
      trialOnInstall: z.boolean(),
      trialPlanId: optionalPositiveInt,
      active: z.boolean(),
      theme: themeSchema,
    })
    .superRefine((value, ctx) => {
      if (!value.trialOnInstall) return
      if (!Number(value.trialDays))
        ctx.addIssue({
          code: 'custom',
          path: ['trialDays'],
          message: 'O trial na instalação exige dias de trial maiores que zero',
        })
      if (!value.trialPlanId)
        ctx.addIssue({
          code: 'custom',
          path: ['trialPlanId'],
          message: 'O trial na instalação exige o plano de trial',
        })
    })
}

export type AppFormValues = z.infer<ReturnType<typeof appFormSchema>>

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

export const EMPTY_THEME: AppFormValues['theme'] = {
  primaryColor: '',
  backgroundColor: '',
  textColor: '',
  title: '',
  welcomeText: '',
  termsUrl: '',
  termsText: '',
}

export const emptyForm = (): AppFormValues => ({
  appCode: '',
  name: '',
  logoUrl: '',
  bitrixClientId: '',
  bitrixClientSecret: '',
  bitrixAppCode: '',
  scopes: '',
  installerUrl: '',
  webhookUrl: '',
  productSpaIds: '',
  trialDays: '0',
  trialOnInstall: false,
  trialPlanId: '',
  active: true,
  theme: { ...EMPTY_THEME },
})

/** App existente → valores do formulário (o `client_secret` nunca vem da API). */
export function fromApp(app: App): AppFormValues {
  return {
    appCode: app.appCode,
    name: app.name,
    logoUrl: app.logoUrl ?? '',
    bitrixClientId: app.bitrixClientId,
    bitrixClientSecret: '',
    bitrixAppCode: app.bitrixAppCode ?? '',
    scopes: app.scopes.join(', '),
    installerUrl: app.installerUrl ?? '',
    webhookUrl: app.webhookUrl ?? '',
    productSpaIds: app.productSpaIds.join(', '),
    trialDays: String(app.trialDays),
    trialOnInstall: app.trialOnInstall,
    trialPlanId: app.trialPlanId?.toString() ?? '',
    active: app.active,
    theme: { ...EMPTY_THEME, ...(app.installTheme ?? {}) },
  }
}

type Theme = NonNullable<App['installTheme']>

/** Só os campos preenchidos entram no tema; tudo vazio vira `null` (tema padrão). */
export function themeOf(theme: AppFormValues['theme']): Theme | null {
  const entries = Object.entries(theme)
    .map(([key, value]) => [key, value.trim()] as const)
    .filter(([, value]) => value)
  return entries.length ? (Object.fromEntries(entries) as Theme) : null
}

const orNull = (value: string) => value.trim() || null

/** Valores do formulário → campos do app como a API os recebe (sem o segredo). */
export function toFields(values: AppFormValues) {
  return {
    name: values.name.trim(),
    logoUrl: orNull(values.logoUrl),
    installTheme: themeOf(values.theme),
    bitrixClientId: values.bitrixClientId.trim(),
    bitrixAppCode: orNull(values.bitrixAppCode),
    scopes: splitList(values.scopes),
    installerUrl: orNull(values.installerUrl),
    webhookUrl: orNull(values.webhookUrl),
    productSpaIds: splitList(values.productSpaIds).map(Number),
    trialDays: Number(values.trialDays || 0),
    trialOnInstall: values.trialOnInstall,
    trialPlanId: values.trialPlanId.trim() ? Number(values.trialPlanId) : null,
  }
}

export type AppFields = ReturnType<typeof toFields>

export function toCreatePayload(values: AppFormValues) {
  return {
    ...toFields(values),
    appCode: values.appCode.trim(),
    bitrixClientSecret: values.bitrixClientSecret,
    active: values.active,
  }
}

/**
 * Edição: só o que mudou em relação ao app carregado. O `client_secret` só vai se foi
 * digitado. Corpo vazio = nada a salvar.
 */
export function toPatchPayload(
  initial: AppFormValues,
  current: AppFormValues,
): Partial<AppFields> & { bitrixClientSecret?: string } {
  const before = toFields(initial)
  const after = toFields(current)
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(after) as Array<keyof AppFields>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      patch[key] = after[key]
  }
  if (current.bitrixClientSecret)
    patch.bitrixClientSecret = current.bitrixClientSecret
  return patch
}

/** Campos do diff com nome legível, para o resumo "o que vai mudar". */
export const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  logoUrl: 'Logo',
  installTheme: 'Tema da página de instalação',
  bitrixClientId: 'client_id do Bitrix',
  bitrixClientSecret: 'client_secret do Bitrix (novo valor)',
  bitrixAppCode: 'CODE no app.info',
  scopes: 'Escopos',
  installerUrl: 'URL do instalador',
  webhookUrl: 'URL de webhook',
  productSpaIds: 'Produtos',
  trialDays: 'Dias de trial',
  trialOnInstall: 'Trial na instalação',
  trialPlanId: 'Plano de trial',
}

/**
 * Caminho de um erro da API (`installTheme.primaryColor`, `scopes.0`) → nome do campo
 * do formulário (`theme.primaryColor`, `scopes`).
 */
export function formFieldOf(path: string): string {
  const parts = path.split('.')
  if (parts[0] === 'installTheme') return ['theme', ...parts.slice(1)].join('.')
  const [head] = parts
  return head === 'scopes' || head === 'productSpaIds' ? head : path || 'name'
}
