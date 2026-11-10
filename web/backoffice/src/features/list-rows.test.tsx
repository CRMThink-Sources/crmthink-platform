import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { Schemas } from '@/api/client'
import { meHandler, page, viewer } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { server } from '@/test/server'

const NOW = '2026-10-28T12:00:00.000Z'

const APP: Schemas['App'] = {
  appCode: 'crmthink.gptmaker',
  name: 'GPTMaker',
  logoUrl: null,
  installTheme: null,
  bitrixClientId: 'local.gptmaker',
  bitrixAppCode: null,
  scopes: ['crm', 'imbot'],
  installerUrl: 'https://gptmaker.app/platform/installer',
  webhookUrl: 'https://gptmaker.app/platform/events',
  trialDays: 14,
  trialOnInstall: true,
  trialPlanId: 500,
  productSpaIds: [10, 11],
  active: true,
}

const installation = (
  overrides: Partial<Schemas['AdminInstallationPage']['items'][number]> = {},
) => ({
  id: 1234,
  appCode: 'crmthink.gptmaker',
  domain: 'acme.bitrix24.com.br',
  memberId: 'member-acme',
  status: 'ACTIVE' as const,
  installedAt: NOW,
  activatedAt: NOW,
  uninstalledAt: null,
  trialUsed: true,
  tokenHealth: 'ok' as const,
  ...overrides,
})

const LONG = 'a'.repeat(80)

describe('lista de instalações', () => {
  function open(item = installation()) {
    server.use(
      meHandler(viewer()),
      http.get('*/admin/apps', () => HttpResponse.json({ items: [APP] })),
      http.get('*/admin/installations', () => HttpResponse.json(page([item]))),
    )
    return renderApp('/installations')
  }

  it('junta id e app na primeira célula, com o domínio em destaque', async () => {
    open()
    const link = await screen.findByRole('link', {
      name: 'acme.bitrix24.com.br',
    })

    expect(
      screen.getAllByRole('columnheader').map(header => header.textContent),
    ).toEqual(['Instalação', 'Status', 'Token', 'Instalada'])
    expect(link).toHaveAttribute('href', '/installations/1234')
    expect(link).toHaveClass('font-medium', 'break-all')
    const cell = link.closest('td')!
    expect(within(cell).getByText('#1234 · crmthink.gptmaker')).toHaveClass(
      'text-xs',
      'text-muted-foreground',
    )
  })

  it('a primeira célula permite quebra de linha (o nowrap das células não vale nela)', async () => {
    open()
    const link = await screen.findByRole('link', {
      name: 'acme.bitrix24.com.br',
    })

    expect(link.closest('td')).toHaveClass('whitespace-normal')
  })

  it('domínio muito longo quebra em vez de estourar o cartão', async () => {
    open(installation({ domain: `${LONG}.bitrix24.com.br` }))

    const link = await screen.findByRole('link', {
      name: `${LONG}.bitrix24.com.br`,
    })

    expect(link).toHaveClass('break-all')
  })
})

describe('lista de apps', () => {
  function open(app = APP) {
    server.use(
      meHandler(viewer()),
      http.get('*/admin/apps', () => HttpResponse.json({ items: [app] })),
    )
    return renderApp('/apps')
  }

  it('junta nome e appCode na primeira célula, com o nome em destaque', async () => {
    open()
    const link = await screen.findByRole('link', { name: 'GPTMaker' })

    expect(
      screen.getAllByRole('columnheader').map(header => header.textContent),
    ).toEqual(['App', 'Estado', 'Trial', 'Escopos'])
    expect(link).toHaveAttribute('href', '/apps/crmthink.gptmaker')
    expect(link).toHaveClass('font-medium', 'break-all')
    const code = within(link.closest('td')!).getByText('crmthink.gptmaker')
    expect(code.tagName).toBe('CODE')
    expect(code).toHaveClass('text-xs', 'text-muted-foreground')
  })

  it('a primeira célula permite quebra de linha (o nowrap das células não vale nela)', async () => {
    open()
    const link = await screen.findByRole('link', { name: 'GPTMaker' })

    expect(link.closest('td')).toHaveClass('whitespace-normal')
  })

  it('nome muito longo quebra em vez de estourar o cartão', async () => {
    open({ ...APP, name: LONG })

    const link = await screen.findByRole('link', { name: LONG })

    expect(link).toHaveClass('break-all')
  })
})
