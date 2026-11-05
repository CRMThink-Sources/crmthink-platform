import { Lock } from 'lucide-react'
import { useState } from 'react'
import { api, call, type Schemas } from '@/api/client'
import { useHasRole } from '@/components/role-gate'
import { PageHeader } from '@/components/filters'
import { LoadingState } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ActionDialog } from '@/features/actions/action-dialog'
import {
  INVALIDATES,
  useAdminAction,
} from '@/features/actions/use-admin-action'
import { useMe } from '@/features/auth/session'
import { formatDateTime } from '@/lib/format'

type SweepKind = 'stripe' | 'spa'
type SweepResult = Schemas['SweepResult']

const SWEEPS: Record<
  SweepKind,
  { title: string; description: string; button: string }
> = {
  stripe: {
    title: 'Varredura do Stripe',
    description:
      'Compara as assinaturas do Stripe com o SPA do portal e emite os eventos que faltaram.',
    button: 'Rodar varredura do Stripe',
  },
  spa: {
    title: 'Varredura dos SPAs',
    description:
      'Reconcilia as mudanças recentes dos SPAs do portal que a plataforma pode ter perdido.',
    button: 'Rodar varredura dos SPAs',
  },
}

function SweepSummary({
  kind,
  result,
}: {
  kind: SweepKind
  result: SweepResult
}) {
  const detail = result.detail
  return (
    <dl
      className="grid grid-cols-3 gap-3 text-sm"
      aria-label={`Resultado da varredura ${kind}`}
    >
      <div>
        <dt className="text-xs text-muted-foreground">Corrigidos</dt>
        <dd className="text-lg font-semibold">{result.fixed}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Erros</dt>
        <dd
          className={`text-lg font-semibold ${result.errors ? 'text-destructive' : ''}`}
        >
          {result.errors}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">
          {'checked' in detail ? 'Verificados' : 'Janela desde'}
        </dt>
        <dd className="text-lg font-semibold">
          {'checked' in detail ? detail.checked : formatDateTime(detail.since)}
        </dd>
      </div>
    </dl>
  )
}

function SweepCard({ kind }: { kind: SweepKind }) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<SweepResult | null>(null)
  const sweep = SWEEPS[kind]
  const run = useAdminAction({
    run: (_: void, reason) =>
      call(
        api.POST('/admin/sweeps/{kind}', {
          params: {
            path: { kind },
            header: reason ? { 'X-Admin-Reason': reason } : {},
          },
        }),
      ),
    invalidates: () => INVALIDATES.sweeps(),
    success: res =>
      `Varredura concluída: ${res.fixed} corrigido(s), ${res.errors} erro(s)`,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{sweep.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">{sweep.description}</p>
        <div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            {sweep.button}
          </Button>
        </div>
        {result && <SweepSummary kind={kind} result={result} />}
      </CardContent>
      <ActionDialog
        open={open}
        onOpenChange={next => {
          if (!next) run.reset()
          setOpen(next)
        }}
        title={sweep.title}
        target={
          kind === 'stripe' ? 'Stripe × SPA de assinaturas' : 'SPAs do portal'
        }
        effect="Roda agora, no lugar de esperar a rotina agendada. Pode demorar alguns segundos e é seguro repetir."
        confirmLabel="Rodar agora"
        pending={run.pending}
        error={run.error}
        onConfirm={async reason => {
          const done = await run.execute(undefined, reason)
          if (!done) return
          setResult(done.result)
          setOpen(false)
        }}
      />
    </Card>
  )
}

function SigningKeyCard() {
  const [open, setOpen] = useState(false)
  const [lead, setLead] = useState('10')
  const [rotated, setRotated] = useState<Schemas['SigningKeyRotated'] | null>(
    null,
  )
  const leadMinutes = Number(lead)
  const leadValid =
    /^\d+$/.test(lead.trim()) && leadMinutes >= 0 && leadMinutes <= 1440
  const rotate = useAdminAction({
    run: (minutes: number, reason) =>
      call(
        api.POST('/admin/signing-keys/rotate', {
          body: { leadMinutes: minutes },
          params: { header: { 'X-Admin-Reason': reason ?? '' } },
        }),
      ),
    invalidates: () => INVALIDATES.system(),
    success: res =>
      `Chave do JWT rotacionada; passa a assinar às ${formatDateTime(res.activatesAt)}`,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chave de assinatura do JWT</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          A chave nova entra no JWKS já, mas só passa a assinar depois do prazo
          escolhido: é o tempo para os apps atualizarem o cache do JWKS.
        </p>
        <div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            Rotacionar chave do JWT
          </Button>
        </div>
        {rotated && (
          <p className="text-sm" role="status">
            Chave <code className="text-xs">{rotated.kid}</code> criada; passa a
            assinar em {formatDateTime(rotated.activatesAt)}.
          </p>
        )}
      </CardContent>
      <ActionDialog
        open={open}
        onOpenChange={next => {
          if (!next) rotate.reset()
          setOpen(next)
        }}
        title="Rotacionar chave do JWT"
        target="Chave de assinatura da plataforma"
        effect="Gera uma chave nova e a publica no JWKS. As sessões e os JWT já emitidos continuam válidos até expirar."
        confirmLabel="Rotacionar"
        destructive
        confirmText="ROTACIONAR"
        reasonRequired
        disabled={!leadValid}
        pending={rotate.pending}
        error={rotate.error}
        onConfirm={async reason => {
          const done = await rotate.execute(leadMinutes, reason)
          if (!done) return
          setRotated(done.result)
          setOpen(false)
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="lead-minutes">
            Minutos até a chave nova começar a assinar
          </Label>
          <Input
            id="lead-minutes"
            inputMode="numeric"
            value={lead}
            onChange={event => setLead(event.target.value)}
            aria-invalid={!leadValid}
          />
          {!leadValid && (
            <p role="alert" className="text-xs text-destructive">
              Informe de 0 a 1440 minutos.
            </p>
          )}
        </div>
      </ActionDialog>
    </Card>
  )
}

/** Tela "Sistema": varreduras de reconciliação e chave do JWT. Só `operator`. */
export function SystemPage() {
  const me = useMe()
  const allowed = useHasRole('operator')
  return (
    <>
      <PageHeader title="Sistema" />
      {me.isPending ? (
        <LoadingState rows={3} />
      ) : !allowed ? (
        <Alert>
          <Lock />
          <AlertTitle>Sem permissão</AlertTitle>
          <AlertDescription>
            Estas ações são só para o papel operator.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <SweepCard kind="stripe" />
          <SweepCard kind="spa" />
          <div className="lg:col-span-2">
            <SigningKeyCard />
          </div>
        </div>
      )}
    </>
  )
}
