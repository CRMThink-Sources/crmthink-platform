import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api, ApiError, call, type Schemas } from '@/api/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { safeNext } from '@/lib/safe-next'
import { CodeStep } from './code-step'
import { CredentialsStep } from './credentials-step'
import { meQueryKey } from './session'
import { TotpSetupStep } from './totp-setup-step'

/** Mensagem do erro de login: genérica, sem dizer qual fator falhou. */
export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const seconds = Number(error.headers?.get('Retry-After') ?? 0)
    const minutes = Math.max(1, Math.ceil(seconds / 60))
    return `Muitas tentativas. Tente de novo em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`
  }
  if (error instanceof ApiError && error.code === 'CHALLENGE_EXPIRED')
    return 'O tempo para digitar o código acabou. Entre de novo.'
  if (error instanceof ApiError && error.status === 401)
    return 'E-mail, senha ou código inválidos.'
  return 'Não foi possível entrar agora. Tente de novo.'
}

type Step =
  | { kind: 'credentials' }
  | { kind: 'code'; challenge: string; trustedDeviceDays: number }
  | {
      kind: 'setup'
      challenge: string
      secret: string
      otpauthUri: string
      trustedDeviceDays: number
    }

const DESCRIPTION: Record<Step['kind'], string> = {
  credentials: 'Entre com seu e-mail e senha.',
  code: 'Digite o código do app autenticador.',
  setup: 'Cadastre o app autenticador para continuar.',
}

/**
 * Login em duas etapas: e-mail e senha, depois o código do app autenticador (ou o cadastro
 * dele, no primeiro acesso). O desafio e o segredo vivem só neste estado: nada de cache de
 * consultas (por isso as chamadas não passam por `useMutation`), armazenamento ou URL.
 */
export function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>({ kind: 'credentials' })
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function finish(operator: Schemas['Operator']) {
    setStep({ kind: 'credentials' })
    await queryClient.invalidateQueries({ queryKey: meQueryKey })
    if (operator.mustChangePassword)
      navigate(`/password?next=${encodeURIComponent(next)}`, { replace: true })
    else navigate(next, { replace: true })
  }

  async function run(action: () => Promise<void>) {
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'CHALLENGE_EXPIRED')
        setStep({ kind: 'credentials' })
      setError(caught)
    } finally {
      setPending(false)
    }
  }

  const submitCredentials = (credentials: {
    email: string
    password: string
  }) =>
    run(async () => {
      const result = await call(
        api.POST('/admin/auth/login', { body: credentials }),
      )
      if (result.step === 'totp') {
        setStep({
          kind: 'code',
          challenge: result.challenge,
          trustedDeviceDays: result.trustedDeviceDays,
        })
      } else if (result.step === 'totp-setup') {
        setStep({
          kind: 'setup',
          challenge: result.challenge,
          secret: result.secret,
          otpauthUri: result.otpauthUri,
          trustedDeviceDays: result.trustedDeviceDays,
        })
      } else {
        await finish(result.operator)
      }
    })

  const submitCode = (input: { code: string; rememberDevice: boolean }) => {
    if (step.kind === 'credentials') return
    const { challenge } = step
    return run(async () => {
      const result = await call(
        api.POST('/admin/auth/totp', { body: { challenge, ...input } }),
      )
      await finish(result.operator)
    })
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Backoffice CRMThink</CardTitle>
          <CardDescription>{DESCRIPTION[step.kind]}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error !== null && (
            <Alert variant="destructive" role="alert">
              <AlertTriangle />
              <AlertDescription>{loginErrorMessage(error)}</AlertDescription>
            </Alert>
          )}
          {step.kind === 'credentials' && (
            <CredentialsStep
              email={email}
              onEmailChange={setEmail}
              pending={pending}
              onSubmit={credentials => void submitCredentials(credentials)}
            />
          )}
          {step.kind === 'code' && (
            <CodeStep
              trustedDeviceDays={step.trustedDeviceDays}
              pending={pending}
              errorToken={error}
              onSubmit={input => void submitCode(input)}
            />
          )}
          {step.kind === 'setup' && (
            <TotpSetupStep
              secret={step.secret}
              otpauthUri={step.otpauthUri}
              trustedDeviceDays={step.trustedDeviceDays}
              pending={pending}
              errorToken={error}
              onSubmit={input => void submitCode(input)}
            />
          )}
        </CardContent>
      </Card>
    </main>
  )
}
