import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Campo do código do autenticador, a opção "Lembrar este navegador" e o botão. Compartilhado
 * entre a 2ª etapa do login e o cadastro do autenticador. O código some a cada erro.
 */
export function CodeForm(props: {
  submitLabel: string
  pendingLabel: string
  /** Dias da opção "lembrar"; `0` esconde a opção (recurso desligado). */
  trustedDeviceDays: number
  pending: boolean
  /** Muda a cada resposta com erro, para limpar o código digitado. */
  errorToken: unknown
  onSubmit: (input: { code: string; rememberDevice: boolean }) => void
}) {
  const [code, setCode] = useState('')
  const [rememberDevice, setRememberDevice] = useState(false)

  useEffect(() => {
    if (props.errorToken) setCode('')
  }, [props.errorToken])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    props.onSubmit({ code: code.trim(), rememberDevice })
  }

  const days = props.trustedDeviceDays
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="code">Código (6 dígitos)</Label>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      {days > 0 && (
        <div className="flex items-center gap-2">
          <input
            id="remember-device"
            type="checkbox"
            className="size-4 rounded border-input"
            checked={rememberDevice}
            onChange={e => setRememberDevice(e.target.checked)}
          />
          <Label htmlFor="remember-device" className="font-normal">
            Lembrar este navegador por {days} {days === 1 ? 'dia' : 'dias'}
          </Label>
        </div>
      )}
      <Button type="submit" disabled={props.pending}>
        {props.pending ? props.pendingLabel : props.submitLabel}
      </Button>
    </form>
  )
}

/** 2ª etapa do login: a conta já tem autenticador. */
export function CodeStep(props: {
  trustedDeviceDays: number
  pending: boolean
  errorToken: unknown
  onSubmit: (input: { code: string; rememberDevice: boolean }) => void
}) {
  return <CodeForm {...props} submitLabel="Entrar" pendingLabel="Entrando…" />
}
