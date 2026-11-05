import { create } from 'qrcode'
import { useMemo } from 'react'

/**
 * QR code gerado no navegador, como SVG. Sem rede e sem canvas: o URI `otpauth://`
 * carrega o segredo do TOTP e não pode sair daqui (nem para um serviço de QR code).
 */
export function QrCode(props: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = create(props.value, { errorCorrectionLevel: 'M' })
    const cells: string[] = []
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) cells.push(`M${col} ${row}h1v1h-1z`)
      }
    }
    return { size: modules.size, path: cells.join('') }
  }, [props.value])

  const quiet = 4
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
      className="mx-auto size-44 rounded-md"
      shapeRendering="crispEdges"
    >
      <rect
        x={-quiet}
        y={-quiet}
        width={size + quiet * 2}
        height={size + quiet * 2}
        fill="#fff"
      />
      <path d={path} fill="#000" />
    </svg>
  )
}
