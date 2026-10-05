import z from 'zod'

/**
 * Tema da página de instalação. Tudo opcional: o que faltar cai no tema padrão da
 * plataforma (`installations/http/install-page.ts`).
 */
export const installThemeSchema = z
  .object({
    primaryColor: z.string().max(32).optional(),
    backgroundColor: z.string().max(32).optional(),
    textColor: z.string().max(32).optional(),
    title: z.string().max(200).optional(),
    welcomeText: z.string().max(2000).optional(),
    termsUrl: z.string().url().optional(),
    termsText: z.string().max(500).optional(),
  })
  .strict()

export type InstallTheme = z.infer<typeof installThemeSchema>

/** A aplicação como o resto da plataforma a vê: segredos já decifrados só onde necessário. */
export type RegisteredApp = {
  appCode: string
  name: string
  logoUrl: string | null
  installTheme: InstallTheme | null
  bitrixClientId: string
  /** `CODE` do `app.info` quando não é o client_id (app de parceiro). `null` = o próprio client_id. */
  bitrixAppCode: string | null
  scopes: string[]
  installerUrl: string | null
  webhookUrl: string | null
  trialDays: number
  trialOnInstall: boolean
  trialPlanId: number | null
  productSpaIds: number[]
  active: boolean
}

export type AppSecrets = {
  bitrixClientSecret: string
  /** Segredos que assinam agora: o atual e, na transição, o anterior. */
  webhookSecrets: string[]
}
