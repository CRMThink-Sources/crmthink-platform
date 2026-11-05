import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { vi } from 'vitest'
import { api, call } from '@/api/client'
import { Button } from '@/components/ui/button'
import { apiError } from '@/test/fixtures'
import { renderRoutes } from '@/test/render'
import { server } from '@/test/server'
import { ActionDialog } from './action-dialog'
import { QrCode } from './qr-code'
import { SecretRevealDialog, useSecretReveal } from './secret-reveal-dialog'
import { INVALIDATES, useAdminAction } from './use-admin-action'

const APP = 'crmthink.gptmaker'
const NEW_KEY = 'cp_chave-nova-secreta-123'

/** Rotação de chave de API montada só com os blocos do padrão de ação. */
function RotateKey() {
  const [open, setOpen] = useState(false)
  const secret = useSecretReveal()
  const rotate = useAdminAction({
    run: (appCode: string, reason) =>
      call(
        api.POST('/admin/apps/{appCode}/rotate-api-key', {
          params: {
            path: { appCode },
            header: { 'X-Admin-Reason': reason ?? '' },
          },
        }),
      ),
    invalidates: () => INVALIDATES.apps(APP),
    success: () => 'Chave rotacionada',
  })
  return (
    <>
      <Button onClick={() => setOpen(true)}>Rotacionar chave</Button>
      <ActionDialog
        open={open}
        onOpenChange={next => {
          if (!next) rotate.reset()
          setOpen(next)
        }}
        title="Rotacionar chave de API"
        target={APP}
        effect="A chave atual vale por mais 24 horas."
        confirmLabel="Rotacionar"
        destructive
        confirmText={APP}
        reasonRequired
        pending={rotate.pending}
        error={rotate.error}
        onConfirm={async reason => {
          const done = await rotate.execute(APP, reason)
          if (!done) return
          rotate.reset()
          setOpen(false)
          secret.show({
            title: 'Nova chave de API',
            secrets: [{ label: 'Chave de API', value: done.result.apiKey }],
          })
        }}
      />
      <SecretRevealDialog reveal={secret.reveal} onDismiss={secret.dismiss} />
    </>
  )
}

function mount() {
  return renderRoutes([{ path: '/', element: <RotateKey /> }], '/')
}

const confirmButton = () => screen.getByRole('button', { name: 'Rotacionar' })

describe('ActionDialog + useAdminAction', () => {
  it('trava o botão até digitar o alvo e informar o motivo', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Rotacionar chave' }))
    expect(confirmButton()).toBeDisabled()

    await user.type(screen.getByLabelText(/Digite/), APP)
    expect(confirmButton()).toBeDisabled()

    await user.type(screen.getByLabelText(/Motivo/), 'chave vazou')
    expect(confirmButton()).toBeEnabled()

    await user.clear(screen.getByLabelText(/Digite/))
    await user.type(screen.getByLabelText(/Digite/), 'outro.app')
    expect(confirmButton()).toBeDisabled()
  })

  it('envia o motivo em X-Admin-Reason', async () => {
    let received: string | null = null
    server.use(
      http.post('*/admin/apps/:appCode/rotate-api-key', ({ request }) => {
        received = request.headers.get('X-Admin-Reason')
        return HttpResponse.json({
          apiKey: NEW_KEY,
          previousValidUntil: '2026-11-05T12:00:00.000Z',
        })
      }),
    )
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Rotacionar chave' }))
    await user.type(screen.getByLabelText(/Digite/), APP)
    await user.type(
      screen.getByLabelText(/Motivo/),
      'cliente relatou vazamento da chave',
    )
    await user.click(confirmButton())
    await screen.findByText('Nova chave de API')
    expect(received).toBe('cliente relatou vazamento da chave')
  })

  it('recusa motivo com emoji antes de chamar a API', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Rotacionar chave' }))
    await user.type(screen.getByLabelText(/Digite/), APP)
    await user.type(screen.getByLabelText(/Motivo/), 'vazou 🔥')
    expect(confirmButton()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/sem emojis/)
  })

  it('erro da API: o diálogo continua aberto, com o código e os dados preenchidos', async () => {
    server.use(
      http.post('*/admin/apps/:appCode/rotate-api-key', () =>
        apiError(404, 'APP_NOT_FOUND', 'App inexistente'),
      ),
    )
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Rotacionar chave' }))
    await user.type(screen.getByLabelText(/Digite/), APP)
    await user.type(screen.getByLabelText(/Motivo/), 'teste')
    await user.click(confirmButton())

    expect(await screen.findByText('APP_NOT_FOUND')).toBeInTheDocument()
    expect(screen.getByText(/App inexistente/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Digite/)).toHaveValue(APP)
    expect(screen.getByLabelText(/Motivo/)).toHaveValue('teste')
    expect(confirmButton()).toBeEnabled()
  })
})

describe('SecretRevealDialog', () => {
  async function rotate() {
    server.use(
      http.post('*/admin/apps/:appCode/rotate-api-key', () =>
        HttpResponse.json({
          apiKey: NEW_KEY,
          previousValidUntil: '2026-11-05T12:00:00.000Z',
        }),
      ),
    )
    const view = mount()
    await view.user.click(
      screen.getByRole('button', { name: 'Rotacionar chave' }),
    )
    await view.user.type(screen.getByLabelText(/Digite/), APP)
    await view.user.type(screen.getByLabelText(/Motivo/), 'rotina')
    await view.user.click(confirmButton())
    await screen.findByText(NEW_KEY)
    return view
  }

  it('mostra o segredo uma vez, com aviso, e só fecha em "Guardei" (Esc não fecha)', async () => {
    const { user } = await rotate()
    expect(screen.getByText('Exibido uma única vez')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Copiar Chave de API/ }),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.getByText(NEW_KEY)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardei' }))
    await waitFor(() => expect(screen.queryByText(NEW_KEY)).toBeNull())
  })

  it('o segredo não fica no cache do QueryClient depois de fechar', async () => {
    const { user, queryClient } = await rotate()
    await user.click(screen.getByRole('button', { name: 'Guardei' }))
    await waitFor(() => expect(screen.queryByText(NEW_KEY)).toBeNull())

    const cached = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map(query => query.state.data),
      queryClient
        .getMutationCache()
        .getAll()
        .map(mutation => mutation.state.data),
    ])
    expect(cached).not.toContain(NEW_KEY)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(window.location.href).not.toContain(NEW_KEY)
  })
})

describe('QrCode', () => {
  it('gera o QR code no navegador, sem nenhuma chamada de rede', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const sendBeacon = vi.fn()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    })
    const { container } = renderRoutes(
      [
        {
          path: '/',
          element: (
            <QrCode
              value="otpauth://totp/CRMThink:dev@x.com?secret=ABCDEFGH&issuer=CRMThink"
              label="QR do autenticador"
            />
          ),
        },
      ],
      '/',
    )
    const svg = screen.getByRole('img', { name: 'QR do autenticador' })
    expect(svg.querySelector('path')?.getAttribute('d')).toMatch(
      /^M\d+ \d+h1v1h-1z/,
    )
    expect(container.querySelector('img, canvas')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sendBeacon).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
