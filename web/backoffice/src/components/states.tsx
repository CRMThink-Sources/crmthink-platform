import { AlertTriangle, Inbox, Lock, RotateCw } from 'lucide-react'
import { ApiError } from '@/api/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function LoadingState(props: { rows?: number }) {
  return (
    <div className="space-y-2 py-2" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: props.rows ?? 5 }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}

/** Vazio com o filtro aplicado descrito (ex.: "Nenhum evento morto de crmthink.gptmaker"). */
export function EmptyState(props: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <Inbox className="size-6" />
      <p>{props.message}</p>
    </div>
  )
}

/**
 * Erro de uma área da tela, com o código da API e "Tentar novamente". 403 aparece
 * como falta de permissão, sem quebrar o resto da tela.
 */
export function ErrorState(props: { error: unknown; onRetry?: () => void }) {
  const error = props.error
  if (error instanceof ApiError && error.status === 403) {
    return (
      <Alert>
        <Lock />
        <AlertTitle>Sem permissão</AlertTitle>
        <AlertDescription>
          Seu papel não permite ver isto ({error.code}).
        </AlertDescription>
      </Alert>
    )
  }
  const code = error instanceof ApiError ? error.code : 'ERRO_DE_REDE'
  const message =
    error instanceof Error ? error.message : 'Não foi possível carregar.'
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>Não foi possível carregar</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>
          <code className="font-mono text-xs">{code}</code> — {message}
        </span>
        {props.onRetry && (
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            <RotateCw /> Tentar novamente
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
