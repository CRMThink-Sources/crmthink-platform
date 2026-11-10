import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * 1ª etapa do login: e-mail e senha. A senha fica só no estado deste componente e some
 * quando a etapa troca (o desafio da próxima não a carrega).
 */
export function CredentialsStep(props: {
  email: string
  onEmailChange: (email: string) => void
  pending: boolean
  onSubmit: (credentials: { email: string; password: string }) => void
}) {
  const [password, setPassword] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    props.onSubmit({ email: props.email, password })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={props.email}
          onChange={e => props.onEmailChange(e.target.value)}
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
      <Button type="submit" disabled={props.pending}>
        {props.pending ? 'Conferindo…' : 'Continuar'}
      </Button>
    </form>
  )
}
