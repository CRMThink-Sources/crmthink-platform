import type { InstallTheme, RegisteredApp } from '@/modules/registry/domain/app'
import {
  DEFAULT_TEXTS,
  ERROR_TEXTS,
  FALLBACK_LANGUAGE,
  HTML_LANG,
  LANGUAGES,
  PORTUGUESE_CODES,
  UI_TEXTS,
  UNAVAILABLE_TEXTS,
  type Language,
} from './install-texts'

/**
 * Página `/install/{appCode}` (D12): fluxo e validações únicos, só a apresentação
 * muda por app. Sem tema cadastrado, usa o tema padrão com nome e logotipo do app.
 *
 * Idiomas: português para portal em português (`BX24.getLang()`), inglês para os
 * demais; o seletor PT/EN/ES troca sem recarregar. O HTML sai em inglês.
 *
 * Só um botão "Instalar": o marketplace do Bitrix não aceita coleta de dados do
 * cliente na instalação. O clique vale como aceite dos termos exibidos logo abaixo.
 *
 * `BX24.installFinish()` só é chamado quando a instalação fica `ACTIVE`; em
 * `INSTALL_PENDING` a página oferece "tentar novamente", que reexecuta só o
 * instalador do app.
 */

export const DEFAULT_THEME: Required<
  Omit<InstallTheme, 'termsUrl' | 'translations'>
> & {
  termsUrl: string | null
} = {
  primaryColor: '#2f6fed',
  backgroundColor: '#f5f7fb',
  textColor: '#1f2937',
  title: 'Instalação',
  welcomeText: 'Clique em Instalar para concluir a instalação no seu Bitrix24.',
  termsUrl: null,
  termsText: 'termos de uso',
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** JSON seguro dentro de `<script>` (sem `</script>` nem comentários HTML). */
const safeJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')

const COLOR =
  /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/
const safeColor = (value: string | undefined, fallback: string) =>
  value && COLOR.test(value) ? value : fallback

export function resolveTheme(app: RegisteredApp) {
  const theme = app.installTheme ?? {}
  return {
    primaryColor: safeColor(theme.primaryColor, DEFAULT_THEME.primaryColor),
    backgroundColor: safeColor(
      theme.backgroundColor,
      DEFAULT_THEME.backgroundColor,
    ),
    textColor: safeColor(theme.textColor, DEFAULT_THEME.textColor),
    termsUrl: theme.termsUrl ?? DEFAULT_THEME.termsUrl,
  }
}

/**
 * Todos os textos da página num idioma. O que o app não traduziu usa o padrão do
 * idioma, nunca o texto em português do tema.
 */
function textsFor(app: RegisteredApp, language: Language) {
  const custom =
    language === 'pt'
      ? app.installTheme
      : app.installTheme?.translations?.[language]
  const defaults = language === 'pt' ? DEFAULT_THEME : DEFAULT_TEXTS[language]
  return {
    ...UI_TEXTS[language],
    title: custom?.title || `${defaults.title} — ${app.name}`,
    welcomeText: custom?.welcomeText || defaults.welcomeText,
    termsText: custom?.termsText || defaults.termsText,
  }
}

export function renderInstallPage(app: RegisteredApp): string {
  const theme = resolveTheme(app)
  const texts = {
    pt: textsFor(app, 'pt'),
    en: textsFor(app, 'en'),
    es: textsFor(app, 'es'),
  }
  const initial = texts[FALLBACK_LANGUAGE]
  /** Elemento com o texto no idioma inicial, trocado pelo script via `data-i18n`. */
  const i18n = (tag: string, key: keyof typeof initial, attributes = '') =>
    `<${tag}${attributes} data-i18n="${key}">${escapeHtml(initial[key])}</${tag}>`
  const terms = theme.termsUrl
    ? i18n(
        'a',
        'termsText',
        ` href="${escapeHtml(theme.termsUrl)}" target="_blank" rel="noopener"`,
      )
    : i18n('span', 'termsText')
  const logo = app.logoUrl
    ? `<img class="logo" src="${escapeHtml(app.logoUrl)}" alt="${escapeHtml(app.name)}">`
    : ''
  const languageButtons = LANGUAGES.map(
    language =>
      `<button type="button" data-lang="${language}" aria-pressed="${language === FALLBACK_LANGUAGE}">${language.toUpperCase()}</button>`,
  ).join('')

  return `<!doctype html>
<html lang="${HTML_LANG[FALLBACK_LANGUAGE]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(initial.title)}</title>
<script src="https://api.bitrix24.com/api/v1/"></script>
<style>
  :root { --primary: ${theme.primaryColor}; --bg: ${theme.backgroundColor}; --text: ${theme.textColor}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); }
  main { max-width: 480px; margin: 32px auto; padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  .logo { max-height: 56px; display: block; margin: 0 auto 16px; }
  h1 { font-size: 1.4rem; margin: 0 0 8px; text-align: center; }
  p { line-height: 1.5; }
  .terms { font-size: .85rem; text-align: center; color: #6b7280; }
  button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--primary); color: #fff; font-size: 1rem; cursor: pointer; margin-top: 8px; }
  button[disabled] { opacity: .6; cursor: wait; }
  .state { display: none; text-align: center; }
  .state.active { display: block; }
  .error { color: #b91c1c; font-size: .9rem; min-height: 1.2em; }
  .langs { display: flex; justify-content: flex-end; gap: 4px; margin: -8px -8px 8px 0; }
  .langs button { width: auto; margin: 0; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 6px; background: transparent; color: #6b7280; font-size: .75rem; }
  .langs button[aria-pressed="true"] { border-color: var(--primary); color: var(--primary); font-weight: 600; }
</style>
</head>
<body>
<main>
  <nav class="langs">${languageButtons}</nav>
  ${logo}
  ${i18n('h1', 'title')}
  <section id="form" class="state active">
    ${i18n('p', 'welcomeText')}
    <div class="error" id="form-error"></div>
    ${i18n('button', 'install', ' type="button" id="submit" disabled')}
    <p class="terms">${i18n('span', 'termsPrefix')}${terms}.</p>
  </section>
  <section id="installing" class="state">${i18n('p', 'installing')}</section>
  <section id="pending" class="state">
    ${i18n('p', 'pending')}
    <div class="error" id="pending-error"></div>
    ${i18n('button', 'retry', ' type="button" id="retry"')}
  </section>
  <section id="done" class="state">${i18n('p', 'done')}</section>
</main>
<script>
(function () {
  var CONFIG = ${safeJson({
    appCode: app.appCode,
    texts,
    errors: ERROR_TEXTS,
    htmlLang: HTML_LANG,
    portugueseCodes: PORTUGUESE_CODES,
    fallback: FALLBACK_LANGUAGE,
  })};
  var language = CONFIG.fallback;
  var chosen = false;
  var failures = {};

  function errorText(data) {
    var error = (data && data.error) || {};
    var known = language === 'pt' ? error.message : CONFIG.errors[language][error.code];
    return known || CONFIG.texts[language].genericError;
  }
  function showError(id) {
    document.getElementById(id).textContent = failures[id] ? errorText(failures[id]) : '';
  }
  function setError(id, data) {
    failures[id] = data;
    showError(id);
  }
  function apply(next) {
    language = next;
    var texts = CONFIG.texts[language];
    document.documentElement.lang = CONFIG.htmlLang[language];
    document.title = texts.title;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = texts[el.getAttribute('data-i18n')]; });
    document.querySelectorAll('[data-lang]').forEach(function (el) { el.setAttribute('aria-pressed', String(el.getAttribute('data-lang') === language)); });
    showError('form-error');
    showError('pending-error');
  }
  function portalLanguage() {
    var code = String(BX24.getLang() || '').toLowerCase();
    return CONFIG.portugueseCodes.indexOf(code) >= 0 ? 'pt' : CONFIG.fallback;
  }

  function show(id) {
    document.querySelectorAll('.state').forEach(function (el) { el.classList.toggle('active', el.id === id); });
  }
  function currentAuth() {
    var a = BX24.getAuth();
    return { accessToken: a.access_token, refreshToken: a.refresh_token, expiresIn: a.expires_in, memberId: a.member_id, domain: a.domain };
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; }); });
  }
  function handle(result, errorEl) {
    if (result.status === 200 && result.data.status === 'ACTIVE') {
      show('done');
      BX24.installFinish();
      return;
    }
    if (result.status === 200 && result.data.status === 'INSTALL_PENDING') {
      show('pending');
      setError('pending-error', null);
      return;
    }
    show(errorEl === 'pending-error' ? 'pending' : 'form');
    setError(errorEl, result.data || {});
    document.getElementById('submit').disabled = false;
  }

  document.querySelectorAll('[data-lang]').forEach(function (button) {
    button.addEventListener('click', function () {
      chosen = true;
      apply(button.getAttribute('data-lang'));
    });
  });

  BX24.init(function () {
    if (!chosen) apply(portalLanguage());
    var submit = document.getElementById('submit');
    submit.disabled = false;
    submit.addEventListener('click', function () {
      setError('form-error', null);
      submit.disabled = true;
      show('installing');
      post('/v1/install', { appCode: CONFIG.appCode, auth: currentAuth(), acceptedTerms: true })
        .then(function (result) { handle(result, 'form-error'); })
        .catch(function () { handle({ status: 0, data: {} }, 'form-error'); });
    });
    document.getElementById('retry').addEventListener('click', function () {
      show('installing');
      var a = currentAuth();
      post('/v1/install/retry', { appCode: CONFIG.appCode, auth: { accessToken: a.accessToken, memberId: a.memberId, domain: a.domain } })
        .then(function (result) { handle(result, 'pending-error'); })
        .catch(function () { handle({ status: 0, data: {} }, 'pending-error'); });
    });
  });
})();
</script>
</body>
</html>`
}

/**
 * App inexistente ou inativo. A página não carrega o BX24: o idioma vem do `LANG` que o
 * Bitrix põe na URL de abertura (sem ele, inglês).
 */
export function renderErrorPage(portalLanguage = ''): string {
  const language: Language = PORTUGUESE_CODES.includes(
    portalLanguage.toLowerCase(),
  )
    ? 'pt'
    : FALLBACK_LANGUAGE
  const { title, message } = UNAVAILABLE_TEXTS[language]
  return `<!doctype html><html lang="${HTML_LANG[language]}"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f7fb;color:#1f2937}main{max-width:480px;margin:48px auto;padding:24px;background:#fff;border-radius:12px;text-align:center}</style>
</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`
}
