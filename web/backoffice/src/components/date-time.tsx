import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatDateTime, formatRelative, TIME_ZONE } from '@/lib/format'

/**
 * Data relativa ("há 3 horas") com a data e hora completas, em America/Sao_Paulo, ao
 * passar o mouse. `relative={false}` mostra a absoluta direto.
 */
export function DateTime(props: {
  value: string | null | undefined
  relative?: boolean
}) {
  if (!props.value) return <span className="text-muted-foreground">—</span>
  const full = formatDateTime(props.value)
  if (props.relative === false)
    return (
      <time dateTime={props.value} className="tabular-nums">
        {full}
      </time>
    )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={props.value} className="cursor-default">
          {formatRelative(props.value)}
        </time>
      </TooltipTrigger>
      <TooltipContent>
        {full} ({TIME_ZONE})
      </TooltipContent>
    </Tooltip>
  )
}
