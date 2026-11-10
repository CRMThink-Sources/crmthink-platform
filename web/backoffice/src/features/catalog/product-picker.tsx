import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Schemas } from '@/api/client'
import { useHasRole } from '@/components/role-gate'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { catalogQuery } from './catalog-queries'
import { StatusBadge } from './page'
import { BILLING_MODEL_LABELS, ProductDialog } from './product-dialog'

type Product = Schemas['CatalogProduct']

/** Ids do formulário (`"10, 11"`), na ordem em que estão, sem repetir. */
function parseIds(value: string): string[] {
  const ids = value
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean)
  return [...new Set(ids)]
}

const join = (ids: string[]) => ids.join(', ')

function Row(props: {
  id: string
  product?: Product
  checked: boolean
  onToggle: () => void
}) {
  const { product, checked } = props
  // Inválido só pode ser desmarcado: não entra em app um produto que o portal recusa.
  const disabled = !!product && !product.valid && !checked
  return (
    <li>
      <label className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={checked}
          disabled={disabled}
          onChange={props.onToggle}
        />
        {product ? (
          <span className="grid gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{product.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{`#${product.id}`}</span>
              <span className="text-xs text-muted-foreground">
                {product.billingModelKey
                  ? BILLING_MODEL_LABELS[product.billingModelKey]
                  : 'Modelo desconhecido'}
              </span>
              <StatusBadge active={product.active} />
            </span>
            {product.problems.length > 0 && (
              <span className="text-xs text-destructive">
                {product.problems.join('; ')}
              </span>
            )}
          </span>
        ) : (
          <span className="text-destructive">{`produto #${props.id} (não encontrado)`}</span>
        )}
      </label>
    </li>
  )
}

/**
 * Escolha dos produtos do app. `value` é a mesma lista de ids separada por vírgula do
 * formulário; ids que o catálogo não conhece continuam nela até serem desmarcados.
 */
export function ProductPicker(props: {
  value: string
  onChange: (value: string) => void
}) {
  const catalog = useQuery(catalogQuery)
  const operator = useHasRole('operator')
  const [creating, setCreating] = useState(false)
  const selected = parseIds(props.value)

  const toggle = (id: string) =>
    props.onChange(
      join(
        selected.includes(id)
          ? selected.filter(item => item !== id)
          : [...selected, id],
      ),
    )

  if (catalog.isPending) return <LoadingState rows={3} />
  if (catalog.isError)
    return (
      <ErrorState
        error={catalog.error}
        onRetry={() => void catalog.refetch()}
      />
    )

  const { products, writable } = catalog.data
  const known = new Set(products.map(product => String(product.id)))
  const unknown = selected.filter(id => !known.has(id))

  return (
    <div className="grid gap-2">
      <ul className="grid max-h-64 gap-0.5 overflow-y-auto rounded-md border p-1">
        {products.map(product => (
          <Row
            key={product.id}
            id={String(product.id)}
            product={product}
            checked={selected.includes(String(product.id))}
            onToggle={() => toggle(String(product.id))}
          />
        ))}
        {unknown.map(id => (
          <Row key={`?${id}`} id={id} checked onToggle={() => toggle(id)} />
        ))}
        {products.length === 0 && unknown.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-muted-foreground">
            Nenhum produto cadastrado.
          </li>
        )}
      </ul>
      {operator && writable && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCreating(true)}
          >
            Criar produto
          </Button>
          {/* O envio do diálogo (portal) não pode subir até o formulário do app. */}
          <div onSubmit={event => event.stopPropagation()}>
            <ProductDialog
              open={creating}
              onOpenChange={setCreating}
              onSaved={product => {
                const id = String(product.id)
                if (!selected.includes(id))
                  props.onChange(join([...selected, id]))
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
