import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Tone = 'ok' | 'warn' | 'bad' | 'neutral'

const TONE: Record<Tone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  bad: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
}

const LABELS = {
  installation: {
    ACTIVE: ['Ativa', 'ok'],
    INSTALL_PENDING: ['Instalação pendente', 'warn'],
    AUTH_ERROR: ['Erro de autenticação', 'bad'],
    UNINSTALLED: ['Desinstalada', 'neutral'],
  },
  event: {
    pending: ['Pendente', 'warn'],
    delivered: ['Entregue', 'ok'],
    dead: ['Morto', 'bad'],
  },
  stripe: {
    received: ['Recebido', 'neutral'],
    processed: ['Processado', 'ok'],
    ignored: ['Ignorado', 'neutral'],
    failed: ['Falhou', 'warn'],
    dead: ['Morto', 'bad'],
  },
  token: {
    ok: ['Token ok', 'ok'],
    refresh_failing: ['Renovação falhando', 'bad'],
    missing: ['Sem token', 'warn'],
  },
} satisfies Record<string, Record<string, [string, Tone]>>

export type StatusKind = keyof typeof LABELS

/** Status com cor e rótulo em pt-br. Valor desconhecido aparece como veio. */
export function StatusBadge(props: { kind: StatusKind; value: string }) {
  const entry = (LABELS[props.kind] as Record<string, [string, Tone]>)[
    props.value
  ]
  const [label, tone] = entry ?? [props.value, 'neutral' as Tone]
  return (
    <Badge variant="secondary" className={cn(TONE[tone])}>
      {label}
    </Badge>
  )
}
