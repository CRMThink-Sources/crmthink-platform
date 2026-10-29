import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api, ApiError, call } from '@/api/client'
import { LoadingState } from '@/components/states'
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
import { meQueryKey, useMe } from './session'

const MIN_LENGTH = 12

function passwordError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS')
    return 'Senha atual incorreta.'
  if (error instanceof ApiError && error.code === 'VALIDATION_ERROR')
    return error.fieldErrors[0]?.message ?? error.message
  return 'Não foi possível trocar a senha agora.'
}

/**
 * Troca de senha. Com senha provisória é obrigatória: a tela fica fora do layout e
 * nenhuma outra é liberada antes (a API também recusa com `PASSWORD_CHANGE_REQUIRED`).
 */
export function PasswordPage() {
  const me = useMe()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const change = useMutation({
    mutationFn: () =>
      call(
        api.POST('/admin/auth/password', {
          body: { currentPassword: current, newPassword: next },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: meQueryKey })
      navigate(safeNext(params.get('next')), { replace: true })
    },
  })

  if (me.isPending) return <LoadingState rows={3} />
  const required =
    me.data?.kind === 'operator' && me.data.operator.mustChangePassword

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (next.length < MIN_LENGTH)
      return setLocalError(
        `A nova senha precisa de ao menos ${MIN_LENGTH} caracteres.`,
      )
    if (next !== confirm) return setLocalError('As senhas não conferem.')
    setLocalError(null)
    change.mutate()
  }
  const message =
    localError ?? (change.isError ? passwordError(change.error) : null)

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {required ? 'Defina sua senha' : 'Trocar senha'}
          </CardTitle>
          <CardDescription>
            {required
              ? 'Você entrou com uma senha provisória. Defina a sua para continuar.'
              : `A nova senha precisa de ao menos ${MIN_LENGTH} caracteres.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="current">
                {required ? 'Senha provisória' : 'Senha atual'}
              </Label>
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={e => setCurrent(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new">Nova senha</Label>
              <Input
                id="new"
                type="password"
                autoComplete="new-password"
                required
                value={next}
                onChange={e => setNext(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm">Confirme a nova senha</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
              />
            </div>
            {message && (
              <Alert variant="destructive" role="alert">
                <AlertTriangle />
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              {!required && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(-1)}
                >
                  Cancelar
                </Button>
              )}
              <Button
                type="submit"
                className="flex-1"
                disabled={change.isPending}
              >
                {change.isPending ? 'Salvando…' : 'Salvar senha'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
