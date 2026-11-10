import { QrCode } from '@/features/actions/qr-code'
import { CodeForm } from './code-step'

/**
 * Primeiro acesso: o operador cadastra o app autenticador. O QR code é gerado aqui mesmo
 * (o `otpauth://` carrega o segredo e não sai do navegador); o segredo também aparece em
 * texto, para digitar no app. Só o primeiro código válido grava o segredo na conta.
 */
export function TotpSetupStep(props: {
  secret: string
  otpauthUri: string
  trustedDeviceDays: number
  pending: boolean
  errorToken: unknown
  onSubmit: (input: { code: string; rememberDevice: boolean }) => void
}) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Sua conta ainda não tem autenticador. Leia o QR code com um app como o
        Google Authenticator, Microsoft Authenticator ou 1Password e digite o
        código de 6 dígitos que ele mostrar.
      </p>
      <QrCode
        value={props.otpauthUri}
        label="QR code para o app autenticador"
      />
      <div className="grid gap-1 text-center text-sm">
        <span className="text-muted-foreground">
          Sem câmera? Digite este segredo no app:
        </span>
        <code className="break-all rounded bg-muted px-2 py-1 font-mono">
          {props.secret}
        </code>
      </div>
      <CodeForm
        submitLabel="Confirmar e entrar"
        pendingLabel="Confirmando…"
        trustedDeviceDays={props.trustedDeviceDays}
        pending={props.pending}
        errorToken={props.errorToken}
        onSubmit={props.onSubmit}
      />
    </div>
  )
}
