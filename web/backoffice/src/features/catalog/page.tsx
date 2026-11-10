import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Schemas } from '@/api/client'
import { PageHeader } from '@/components/filters'
import { useHasRole } from '@/components/role-gate'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { centsToReais } from '@/lib/money'
import { catalogQuery } from './catalog-queries'
import { PlanDialog } from './plan-dialog'
import { ProductDialog } from './product-dialog'

type Product = Schemas['CatalogProduct']
type Plan = Schemas['CatalogPlan']

type Dialog =
  | { kind: 'product'; product?: Product }
  | { kind: 'plan'; product: Product; plan?: Plan }
  | null

type Open = (dialog: NonNullable<Dialog>) => void

const MODELS: Record<NonNullable<Product['billingModelKey']>, string> = {
  standard: 'Padrão',
  per_unit: 'Por unidade',
  one_time: 'Compra única',
}

const INTERVALS: Record<NonNullable<Plan['interval']>, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  yearly: 'Anual',
}

function Problems({ problems }: { problems: string[] }) {
  if (!problems.length) return null
  return (
    <ul className="mt-1 list-disc pl-4 text-xs text-destructive">
      {problems.map(problem => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? 'secondary' : 'outline'}>
      {active ? 'Ativo' : 'Inativo'}
    </Badge>
  )
}

/** O ambiente em uso não vem da API: mostra a presença do preço nos dois. */
function PriceStatus({ plan }: { plan: Plan }) {
  if (plan.isTrial) return <span className="text-muted-foreground">—</span>
  const part = (label: string, id: string | null) =>
    `${label} ${id ? 'ok' : 'faltando'}`
  const missing = !plan.priceHomolog || !plan.priceProduction
  return (
    <span
      className={`text-xs ${missing ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {`Stripe: ${part('homolog', plan.priceHomolog)} · ${part('produção', plan.priceProduction)}`}
    </span>
  )
}

function PlanRow(props: { plan: Plan; onEdit?: () => void }) {
  const { plan } = props
  return (
    <TableRow>
      <TableCell className="pl-8 whitespace-normal">
        <span className="font-medium break-all">{plan.name}</span>
        <p className="text-xs text-muted-foreground">#{plan.id}</p>
        {!plan.valid && <Problems problems={plan.problems} />}
      </TableCell>
      <TableCell>{plan.interval ? INTERVALS[plan.interval] : '—'}</TableCell>
      <TableCell className="space-x-1">
        <StatusBadge active={plan.active} />
        {plan.isTrial && <Badge variant="outline">Trial</Badge>}
      </TableCell>
      <TableCell>{`R$ ${centsToReais(plan.amount)}`}</TableCell>
      <TableCell>
        <PriceStatus plan={plan} />
      </TableCell>
      <TableCell className="text-right">
        {props.onEdit && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Editar plano ${plan.name}`}
            onClick={props.onEdit}
          >
            Editar
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

function ProductRows(props: { product: Product; onOpen?: Open }) {
  const { product, onOpen } = props
  const count = product.apps.length
  return (
    <>
      <TableRow className="bg-muted/40">
        <TableCell className="whitespace-normal">
          <span className="font-medium break-all">{product.name}</span>
          <p className="text-xs text-muted-foreground">
            <span>{`#${product.id}`}</span>
            {' · '}
            <span>{`usado por ${count} ${count === 1 ? 'app' : 'apps'}`}</span>
          </p>
          {!product.valid && <Problems problems={product.problems} />}
        </TableCell>
        <TableCell>
          {product.billingModelKey
            ? MODELS[product.billingModelKey]
            : product.billingModel || 'Sem modelo'}
        </TableCell>
        <TableCell>
          <StatusBadge active={product.active} />
        </TableCell>
        <TableCell />
        <TableCell />
        <TableCell className="space-x-1 text-right whitespace-normal">
          {onOpen && (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Editar produto ${product.name}`}
                onClick={() => onOpen({ kind: 'product', product })}
              >
                Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpen({ kind: 'plan', product })}
              >
                Novo plano neste produto
              </Button>
            </>
          )}
        </TableCell>
      </TableRow>
      {product.plans.map(plan => (
        <PlanRow
          key={plan.id}
          plan={plan}
          onEdit={onOpen && (() => onOpen({ kind: 'plan', product, plan }))}
        />
      ))}
    </>
  )
}

function OrphanPlans({ plans }: { plans: Plan[] }) {
  return (
    <section className="mt-6 space-y-2">
      <h2 className="text-base font-semibold">
        Planos com problema (produto inexistente)
      </h2>
      <ul className="divide-y rounded-md border">
        {plans.map(plan => (
          <li key={plan.id} className="p-3">
            <span className="font-medium break-all">{plan.name}</span>
            <p className="text-xs text-muted-foreground">{`#${plan.id}`}</p>
            <Problems problems={plan.problems} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CatalogPage() {
  const catalog = useQuery(catalogQuery)
  const writable = catalog.data?.writable ?? false
  const canWrite = useHasRole('operator') && writable
  const [dialog, setDialog] = useState<Dialog>(null)
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null)
  }
  return (
    <>
      <PageHeader
        title="Catálogo"
        description="Produtos e planos cobrados no portal CRMThink."
      >
        {canWrite && (
          <Button onClick={() => setDialog({ kind: 'product' })}>
            Novo produto
          </Button>
        )}
      </PageHeader>
      {catalog.isPending ? (
        <LoadingState />
      ) : catalog.isError ? (
        <ErrorState
          error={catalog.error}
          onRetry={() => void catalog.refetch()}
        />
      ) : (
        <>
          {!catalog.data.writable && (
            <p className="mb-4 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              Somente leitura fora da produção: o catálogo só pode ser alterado
              no ambiente de produção.
            </p>
          )}
          {!catalog.data.products.length ? (
            <EmptyState message="Nenhum produto cadastrado." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto / plano</TableHead>
                  <TableHead>Modelo / intervalo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Preço no Stripe</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalog.data.products.map(product => (
                  <ProductRows
                    key={product.id}
                    product={product}
                    onOpen={canWrite ? setDialog : undefined}
                  />
                ))}
              </TableBody>
            </Table>
          )}
          {catalog.data.orphanPlans.length > 0 && (
            <OrphanPlans plans={catalog.data.orphanPlans} />
          )}
        </>
      )}
      <ProductDialog
        open={dialog?.kind === 'product'}
        onOpenChange={closeDialog}
        product={dialog?.kind === 'product' ? dialog.product : undefined}
      />
      {dialog?.kind === 'plan' && (
        <PlanDialog
          open
          onOpenChange={closeDialog}
          product={dialog.product}
          plan={dialog.plan}
        />
      )}
    </>
  )
}
