import { beforeEach, describe, expect, it } from 'vitest'
import {
  installThemeSchema,
  type InstallTheme,
} from '@/modules/registry/domain/app'
import { http } from '@/test/app'
import {
  createHarness,
  GPTMAKER,
  seedGptMaker,
  type Harness,
} from '@/test/harness'
import { loadInstallPage, type InstallResponse } from '@/test/install-page-dom'

describe('página de instalação: idiomas', () => {
  let h: Harness

  beforeEach(async () => {
    h = createHarness()
    await seedGptMaker(h)
  })

  async function open(
    theme: InstallTheme | null = null,
    responses: InstallResponse[] = [],
  ) {
    await h.container.registry.update(GPTMAKER, { installTheme: theme })
    const res = await http(h).get(`/install/${GPTMAKER}`).expect(200)
    return loadInstallPage(res.text, { responses })
  }

  const apiError = (code: string, message: string, status = 403) => ({
    status,
    body: { error: { code, message } },
  })

  it.each(['br', 'pt', 'BR'])('portal em %s abre em português', async lang => {
    const page = await open()
    page.init(lang)
    expect(page.document.documentElement.lang).toBe('pt-BR')
    expect(page.document.title).toBe('Instalação — GPTMaker')
    expect(page.text('title')).toBe('Instalação — GPTMaker')
    expect(page.text('install')).toBe('Instalar')
    expect(page.text('termsPrefix')).toBe(
      'Ao clicar em Instalar, você aceita os ',
    )
    expect(page.text('termsText')).toBe('termos de uso')
  })

  it.each(['en', 'la', 'de', ''])(
    'portal em "%s" abre em inglês',
    async lang => {
      const page = await open()
      page.init(lang)
      expect(page.document.documentElement.lang).toBe('en')
      expect(page.text('title')).toBe('Installation — GPTMaker')
      expect(page.text('install')).toBe('Install')
      expect(page.text('termsPrefix')).toBe(
        'By clicking Install, you accept the ',
      )
      expect(page.text('termsText')).toBe('terms of use')
    },
  )

  it('antes do BX24 responder, a página já está em inglês', async () => {
    const page = await open()
    expect(page.document.documentElement.lang).toBe('en')
    expect(page.text('install')).toBe('Install')
  })

  it('o seletor troca o idioma e marca o escolhido', async () => {
    const page = await open()
    page.init('br')
    page.chooseLanguage('es')
    expect(page.document.documentElement.lang).toBe('es')
    expect(page.text('install')).toBe('Instalar')
    expect(page.text('termsText')).toBe('términos de uso')
    expect(page.text('installing')).toBe(
      'Instalando… esto puede tardar unos segundos.',
    )
    const pressed = page.document
      .querySelectorAll('[data-lang]')
      .filter(el => el.getAttribute('aria-pressed') === 'true')
      .map(el => el.getAttribute('data-lang'))
    expect(pressed).toEqual(['es'])
  })

  it('escolha feita antes do BX24 responder não é sobrescrita', async () => {
    const page = await open()
    page.chooseLanguage('es')
    page.init('br')
    expect(page.document.documentElement.lang).toBe('es')
  })

  it('textos do app: português do tema e traduções por idioma', async () => {
    const page = await open({
      title: 'Instalar o GPTMaker',
      welcomeText: 'Conecte o GPTMaker.',
      termsText: 'termos do GPTMaker',
      translations: {
        en: { title: 'Install GPTMaker', welcomeText: 'Connect <GPTMaker>.' },
      },
    })
    page.init('br')
    expect(page.text('title')).toBe('Instalar o GPTMaker')
    expect(page.text('welcomeText')).toBe('Conecte o GPTMaker.')
    expect(page.text('termsText')).toBe('termos do GPTMaker')

    page.chooseLanguage('en')
    expect(page.text('title')).toBe('Install GPTMaker')
    expect(page.text('welcomeText')).toBe('Connect <GPTMaker>.')
    // Sem tradução: padrão do idioma, nunca o texto em português.
    expect(page.text('termsText')).toBe('terms of use')

    page.chooseLanguage('es')
    expect(page.text('title')).toBe('Instalación — GPTMaker')
  })

  it('texto traduzido não escapa do <script>', async () => {
    const page = await open({
      translations: { en: { title: '</script><b>x</b>' } },
    })
    page.init('en')
    expect(page.text('title')).toBe('</script><b>x</b>')
  })

  it('erro da API é traduzido pelo código e acompanha a troca de idioma', async () => {
    const page = await open(null, [
      apiError(
        'NOT_PORTAL_ADMIN',
        'A instalação exige um administrador do portal',
      ),
    ])
    page.init('en')
    await page.click('submit')
    const error = page.byId('form-error')
    expect(error.textContent).toBe(
      'Only a portal administrator can install the app.',
    )
    expect(page.byId('submit').disabled).toBe(false)

    page.chooseLanguage('es')
    expect(error.textContent).toBe(
      'Solo un administrador del portal puede instalar la aplicación.',
    )
    page.chooseLanguage('pt')
    expect(error.textContent).toBe(
      'A instalação exige um administrador do portal',
    )
  })

  it('código desconhecido vira mensagem genérica fora do português', async () => {
    const page = await open(null, [
      apiError('NOVO_CODIGO', 'Algo em português'),
    ])
    page.init('en')
    await page.click('submit')
    expect(page.byId('form-error').textContent).toBe(
      'We could not complete the installation right now. Please try again.',
    )
  })

  it('pendente, nova tentativa com erro e conclusão', async () => {
    const page = await open(null, [
      { status: 200, body: { status: 'INSTALL_PENDING' } },
      apiError('BITRIX_UNAVAILABLE', 'Bitrix indisponível', 503),
      { status: 200, body: { status: 'ACTIVE' } },
    ])
    page.init('la')
    await page.click('submit')
    expect(page.byId('pending').classList.contains('active')).toBe(true)
    expect(page.byId('pending-error').textContent).toBe('')

    await page.click('retry')
    expect(page.byId('pending-error').textContent).toBe(
      'Bitrix24 is unavailable right now. Please try again.',
    )
    await page.click('retry')
    expect(page.byId('done').classList.contains('active')).toBe(true)
    expect(page.text('done')).toBe('Installation complete!')
    expect(page.finished).toBe(1)
  })

  it('traduz todos os códigos que a instalação devolve', async () => {
    const codes = [
      'APP_NOT_FOUND',
      'BITRIX_TOKEN_REJECTED',
      'TOKEN_APP_MISMATCH',
      'NOT_PORTAL_ADMIN',
      'MEMBER_ID_MISMATCH',
      'DOMAIN_MISMATCH',
      'BITRIX_UNAVAILABLE',
      'CRMTHINK_UNAVAILABLE',
      'EVENT_BIND_FAILED',
      'INSTALLATION_MISMATCH',
      'INSTALLATION_NOT_PENDING',
    ]
    const languages = [
      [
        'en',
        'We could not complete the installation right now. Please try again.',
      ],
      ['es', 'No se pudo completar la instalación ahora. Inténtalo de nuevo.'],
    ] as const
    for (const [lang, generic] of languages) {
      const page = await open(
        null,
        codes.map(code => apiError(code, 'mensagem do servidor')),
      )
      page.init('en')
      page.chooseLanguage(lang)
      for (const code of codes) {
        await page.click('submit')
        const shown = page.byId('form-error').textContent
        expect(shown, `${lang} ${code}`).not.toBe(generic)
        expect(shown, `${lang} ${code}`).not.toBe('mensagem do servidor')
      }
    }
  })

  it.each([
    ['br', 'pt-BR', 'Instalação indisponível'],
    ['la', 'en', 'Installation unavailable'],
    [undefined, 'en', 'Installation unavailable'],
  ])('página de erro com LANG=%s', async (lang, htmlLang, title) => {
    const query = lang ? `?LANG=${lang}` : ''
    const res = await http(h)
      .get(`/install/crmthink.naoexiste${query}`)
      .expect(404)
    expect(res.text).toContain(`<html lang="${htmlLang}">`)
    expect(res.text).toContain(`<h1>${title}</h1>`)
  })

  it('cadastro aceita só as traduções em inglês e espanhol', () => {
    const accepts = (translations: unknown) =>
      installThemeSchema.safeParse({ translations }).success
    expect(accepts({ en: { title: 'x' }, es: { termsText: 'y' } })).toBe(true)
    expect(accepts({ fr: { title: 'x' } })).toBe(false)
    expect(accepts({ en: { primaryColor: '#000' } })).toBe(false)
  })
})
