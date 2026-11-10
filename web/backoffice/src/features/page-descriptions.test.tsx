import { screen } from '@testing-library/react'
import { http } from 'msw'
import { apiError, meHandler, operator } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

const DESCRIPTIONS: Array<[string, string]> = [
  ['/', 'Resumo do estado da plataforma.'],
  [
    '/installations',
    'Portais Bitrix24 com o app instalado: status, token e data da instalação.',
  ],
  ['/events', 'Entregas de eventos aos apps, com reenvio dos que falharam.'],
  [
    '/stripe-events',
    'Eventos recebidos do Stripe e o resultado do processamento.',
  ],
  ['/apps', 'Apps cadastrados na plataforma: estado, trial e escopos.'],
  ['/audit', 'Registro de quem fez o quê no backoffice.'],
  ['/system', 'Varreduras e chave de assinatura dos tokens.'],
  ['/operators', 'Contas de quem opera a plataforma.'],
]

describe('descrição no título das telas', () => {
  it.each(DESCRIPTIONS)('%s mostra a descrição', async (route, text) => {
    // O cabeçalho não depende dos dados: toda consulta falha e a tela mostra o erro.
    server.use(
      meHandler(operator()),
      http.get('*/admin/*', () => apiError(500, 'INTERNAL_ERROR')),
    )
    renderApp(route)

    expect(await screen.findByText(text)).toBeInTheDocument()
  })
})
