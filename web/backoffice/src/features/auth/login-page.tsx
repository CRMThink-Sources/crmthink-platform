import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api, ApiError, call } from '@/api/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeNext } from '@/lib/safe-next'
import { meQueryKey } from './session'

/** Mensagem do erro de login: genérica, sem dizer qual fator falhou. */
export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const seconds = Number(error.headers?.get('Retry-After') ?? 0)
    const minutes = Math.max(1, Math.ceil(seconds / 60))
    return `Muitas tentativas. Tente de novo em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`
  }
  if (error instanceof ApiError && error.status === 401)
    return 'E-mail, senha ou código inválidos.'
  return 'Não foi possível entrar agora. Tente de novo.'
}

export function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')

  const login = useMutation({
    mutationFn: () =>
      call(
        api.POST('/admin/auth/login', {
          body: { email, password, code: code.trim() },
        }),
      ),
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: meQueryKey })
      if (result.operator.mustChangePassword)
        navigate(`/password?next=${encodeURIComponent(next)}`, {
          replace: true,
        })
      else navigate(next, { replace: true })
    },
    onError: () => setCode(''),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    login.mutate()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Backoffice CRMThink</CardTitle>
          <CardDescription>
            Entre com seu e-mail, senha e o código do app autenticador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="code">Código (6 dígitos)</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {login.isError && (
              <Alert variant="destructive" role="alert">
                <AlertTriangle />
                <AlertDescription>
                  {loginErrorMessage(login.error)}
                </AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={login.isPending}>
              {login.isPending ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
