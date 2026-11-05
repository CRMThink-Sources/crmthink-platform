import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'

/**
 * Paginação por cursor das tabelas. "Próxima" põe o `nextCursor` na URL (nova entrada
 * no histórico); "Anterior" volta no histórico — ou, num link aberto direto numa página
 * do meio, vai para a primeira.
 */
export function Pager(props: {
  cursor: string | undefined
  nextCursor: string | null | undefined
  onCursor: (cursor: string | undefined) => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const previous = () => {
    if (location.key !== 'default') navigate(-1)
    else props.onCursor(undefined)
  }
  if (!props.cursor && !props.nextCursor) return null
  return (
    <div className="flex items-center justify-end gap-2 py-3">
      <Button
        variant="outline"
        size="sm"
        disabled={!props.cursor}
        onClick={previous}
      >
        <ChevronLeft /> Anterior
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!props.nextCursor}
        onClick={() => props.onCursor(props.nextCursor ?? undefined)}
      >
        Próxima <ChevronRight />
      </Button>
    </div>
  )
}
