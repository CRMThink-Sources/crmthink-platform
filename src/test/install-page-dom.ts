import { runInNewContext } from 'node:vm'

/**
 * DOM mínimo para executar o script da página de instalação nos testes: só o que ele
 * usa (`getElementById`, `querySelectorAll` por classe ou atributo, `textContent`,
 * cliques). O `BX24` e o `fetch` são dublês controlados pelo teste.
 */
export type FakeElement = {
  id: string
  textContent: string
  disabled: boolean
  attributes: Record<string, string>
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  addEventListener(type: string, listener: () => void): void
  click(): void
  classList: {
    toggle(name: string, on: boolean): void
    contains(name: string): boolean
  }
}

const unescapeHtml = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

function element(attributes: Record<string, string>, text: string) {
  const listeners: Array<() => void> = []
  const classes = new Set((attributes.class ?? '').split(' ').filter(Boolean))
  const el: FakeElement = {
    id: attributes.id ?? '',
    textContent: text,
    disabled: 'disabled' in attributes,
    attributes,
    getAttribute: name => attributes[name] ?? null,
    setAttribute: (name, value) => {
      attributes[name] = value
    },
    addEventListener: (_type, listener) => {
      listeners.push(listener)
    },
    click: () => listeners.forEach(listener => listener()),
    classList: {
      toggle: (name, on) => {
        if (on) classes.add(name)
        else classes.delete(name)
      },
      contains: name => classes.has(name),
    },
  }
  return el
}

export type InstallResponse = { status: number; body: unknown }

export function loadInstallPage(
  html: string,
  options: { responses?: InstallResponse[] } = {},
) {
  const markup = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
  const elements = [...markup.matchAll(/<([a-z0-9]+)(\s[^>]*)>([^<]*)/g)].map(
    ([, , raw, text]) => {
      const attributes: Record<string, string> = {}
      for (const [, name, value] of raw!.matchAll(
        /([a-z0-9-]+)(?:="([^"]*)")?/g,
      ))
        attributes[name!] = unescapeHtml(value ?? '')
      return element(attributes, unescapeHtml(text!))
    },
  )

  const byId = (id: string) => {
    const found = elements.find(el => el.id === id)
    if (!found) throw new Error(`elemento #${id} não existe`)
    return found
  }
  const select = (selector: string) => {
    if (selector.startsWith('.'))
      return elements.filter(el =>
        (el.attributes.class ?? '').split(' ').includes(selector.slice(1)),
      )
    const attribute = /^\[([a-z0-9-]+)\]$/.exec(selector)?.[1]
    if (!attribute) throw new Error(`seletor não suportado: ${selector}`)
    return elements.filter(el => attribute in el.attributes)
  }

  const document = {
    title: '',
    documentElement: { lang: /<html lang="([^"]*)"/.exec(html)?.[1] ?? '' },
    getElementById: byId,
    querySelectorAll: select,
  }

  let ready: (() => void) | null = null
  let language = ''
  let finished = 0
  const requests: Array<{ path: string; body: unknown }> = []
  const responses = [...(options.responses ?? [])]

  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
  runInNewContext(script, {
    document,
    BX24: {
      init: (callback: () => void) => {
        ready = callback
      },
      getLang: () => language,
      getAuth: () => ({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
        member_id: 'm',
        domain: 'portal.bitrix24.com',
      }),
      installFinish: () => {
        finished += 1
      },
    },
    fetch: async (path: string, init: { body: string }) => {
      requests.push({ path, body: JSON.parse(init.body) })
      const next = responses.shift() ?? { status: 500, body: {} }
      return { status: next.status, json: async () => next.body }
    },
  })

  return {
    document,
    requests,
    /** O `BX24.init` concluiu com o portal no idioma informado. */
    init(portalLanguage: string) {
      language = portalLanguage
      ready?.()
    },
    /** Texto do elemento marcado com `data-i18n="<chave>"`. */
    text(key: string) {
      const found = elements.find(el => el.attributes['data-i18n'] === key)
      if (!found) throw new Error(`data-i18n="${key}" não existe`)
      return found.textContent
    },
    byId,
    chooseLanguage(lang: string) {
      const button = elements.find(el => el.attributes['data-lang'] === lang)
      if (!button) throw new Error(`sem botão de idioma ${lang}`)
      button.click()
    },
    async click(id: string) {
      byId(id).click()
      await new Promise(resolve => setImmediate(resolve))
    },
    get finished() {
      return finished
    },
  }
}
