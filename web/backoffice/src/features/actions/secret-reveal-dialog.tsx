import { Check, Copy, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
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
import { QrCode } from './qr-code'

export type RevealedSecret = { label: string; value: string }

export type SecretReveal = {
  title: string
  secrets: RevealedSecret[]
  /** URI `otpauth://` do TOTP: mostrado como QR code gerado aqui mesmo. */
  otpauthUri?: string
}

/**
 * Segredo devolvido por uma ação (chave de API, segredo de webhook, senha provisória,
 * TOTP). Fica só no estado do componente que o abriu — nunca no cache de consultas, no
 * armazenamento do navegador, na URL nem no console — e some ao fechar.
 */
export function useSecretReveal() {
  const [reveal, setReveal] = useState<SecretReveal | null>(null)
  return {
    reveal,
    show: setReveal,
    /** "Guardei": descarta os valores. */
    dismiss: () => setReveal(null),
  }
}

function CopyButton(props: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Sem permissão da área de transferência: o valor continua selecionável na tela.
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void copy()}
      aria-label={`Copiar ${props.label}`}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copiado' : 'Copiar'}
    </Button>
  )
}

/**
 * Só fecha pelo botão "Guardei": clicar fora ou apertar `Esc` não descarta o segredo
 * sem o operador ter tido a chance de copiá-lo.
 */
export function SecretRevealDialog(props: {
  reveal: SecretReveal | null
  onDismiss: () => void
}) {
  const { reveal } = props
  return (
    <Dialog open={!!reveal} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg"
        onEscapeKeyDown={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
      >
        {reveal && (
          <>
            <DialogHeader>
              <DialogTitle>{reveal.title}</DialogTitle>
              <DialogDescription>
                Copie e guarde agora num lugar seguro.
              </DialogDescription>
            </DialogHeader>
            <Alert>
              <ShieldAlert />
              <AlertTitle>Exibido uma única vez</AlertTitle>
              <AlertDescription>
                Estes valores não serão mostrados de novo. Se perder, será
                preciso gerar outros.
              </AlertDescription>
            </Alert>
            <div className="grid gap-3">
              {reveal.secrets.map(secret => (
                <div key={secret.label} className="grid gap-1">
                  <span className="text-xs text-muted-foreground">
                    {secret.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 text-xs break-all select-all">
                      {secret.value}
                    </code>
                    <CopyButton value={secret.value} label={secret.label} />
                  </div>
                </div>
              ))}
              {reveal.otpauthUri && (
                <div className="grid gap-2">
                  <QrCode
                    value={reveal.otpauthUri}
                    label="QR code para o app autenticador"
                  />
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 text-xs break-all select-all">
                      {reveal.otpauthUri}
                    </code>
                    <CopyButton
                      value={reveal.otpauthUri}
                      label="URI do autenticador"
                    />
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" onClick={props.onDismiss}>
                Guardei
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
