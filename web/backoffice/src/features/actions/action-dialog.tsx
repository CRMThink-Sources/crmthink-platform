import { AlertTriangle } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '@/api/client'
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
import { REASON_MAX, validateReason } from './reason'

export type ActionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Quem sofre a ação (appCode, domínio, e-mail...), em destaque. */
  target: string
  /** O que vai acontecer, em português. */
  effect: ReactNode
  confirmLabel: string
  destructive?: boolean
  /** Alto impacto: texto exato que precisa ser digitado para liberar a confirmação. */
  confirmText?: string
  /** O motivo é obrigatório (alto impacto); nas outras ações é opcional. */
  reasonRequired?: boolean
  pending?: boolean
  /** Erro da última tentativa: o diálogo continua aberto e mostra código e mensagem. */
  error?: Error | null
  /** Campos próprios da ação (ex.: contato do trial). */
  children?: ReactNode
  /** Bloqueio extra vindo dos campos próprios. */
  disabled?: boolean
  onConfirm: (reason: string | undefined) => void
}

/**
 * Confirmação de uma ação de operador: alvo, efeito, campos da ação, motivo e, no alto
 * impacto, confirmação por digitação. Quem usa fecha o diálogo só em caso de sucesso.
 */
export function ActionDialog(props: ActionDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Os campos nascem a cada abertura: nada vaza de uma ação para a outra. */}
        {props.open && <Body {...props} />}
      </DialogContent>
    </Dialog>
  )
}

/** `details.reason` de erros como `TOKEN_REFRESH_FAILED` (ex.: `invalid_grant`). */
function errorReason(error: Error): string | null {
  if (!(error instanceof ApiError)) return null
  const details = error.details as { reason?: unknown } | undefined
  return typeof details?.reason === 'string' ? details.reason : null
}

function Body(props: ActionDialogProps) {
  const ids = { typed: useId(), reason: useId() }
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)

  const reasonProvided = reason.trim().length > 0
  const reasonInvalid = validateReason(reason)
  const reasonOk = props.reasonRequired
    ? reasonInvalid === null
    : !reasonProvided || reasonInvalid === null
  const reasonShown =
    (touched || reasonProvided) && (props.reasonRequired || reasonProvided)
      ? reasonInvalid
      : null
  const typedOk = props.confirmText === undefined || typed === props.confirmText
  const canConfirm = typedOk && reasonOk && !props.pending && !props.disabled

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!canConfirm) return
    props.onConfirm(reasonProvided ? reason.trim() : undefined)
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{props.title}</DialogTitle>
        <DialogDescription asChild>
          <div className="grid gap-2">
            <span>
              Alvo: <strong className="text-foreground">{props.target}</strong>
            </span>
            <span>{props.effect}</span>
          </div>
        </DialogDescription>
      </DialogHeader>

      {props.children}

      {props.confirmText !== undefined && (
        <div className="grid gap-1.5">
          <Label htmlFor={ids.typed}>
            Digite <code className="font-mono">{props.confirmText}</code> para
            confirmar
          </Label>
          <Input
            id={ids.typed}
            value={typed}
            onChange={event => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={ids.reason}>
          Motivo{props.reasonRequired ? '' : ' (opcional)'}
        </Label>
        <Textarea
          id={ids.reason}
          value={reason}
          onChange={event => setReason(event.target.value)}
          onBlur={() => setTouched(true)}
          rows={2}
          aria-invalid={!!reasonShown}
          placeholder="Por que esta ação está sendo feita? Fica na auditoria."
        />
        <p className="text-xs text-muted-foreground">
          Até {REASON_MAX} caracteres, em uma linha.
        </p>
        {reasonShown && (
          <p role="alert" className="text-xs text-destructive">
            {reasonShown}
          </p>
        )}
      </div>

      {props.error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>A ação não foi concluída</AlertTitle>
          <AlertDescription>
            <code className="font-mono text-xs">
              {props.error instanceof ApiError ? props.error.code : 'ERRO'}
            </code>{' '}
            — {props.error.message}
            {errorReason(props.error) && (
              <> (motivo: {errorReason(props.error)})</>
            )}
          </AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => props.onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          variant={props.destructive ? 'destructive' : 'default'}
          disabled={!canConfirm}
        >
          {props.pending ? 'Executando…' : props.confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
