import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'

describe('ambiente de teste', () => {
  it('renderiza e intercepta fetch com MSW', async () => {
    server.use(
      http.get('http://localhost/admin/auth/me', () =>
        HttpResponse.json({ ok: true }),
      ),
    )
    render(<p>olá</p>)
    expect(screen.getByText('olá')).toBeInTheDocument()
    const response = await fetch('http://localhost/admin/auth/me')
    expect(await response.json()).toEqual({ ok: true })
  })
})
