import type { InstallTheme, RegisteredApp } from '@/modules/registry/domain/app'

/**
 * Página `/install/{appCode}` (D12): fluxo e validações únicos, só a apresentação
 * muda por app. Sem tema cadastrado, usa o tema padrão com nome e logotipo do app.
 *
 * `BX24.installFinish()` só é chamado quando a instalação fica `ACTIVE`; em
 * `INSTALL_PENDING` a página oferece "tentar novamente", que reexecuta só o
 * instalador do app.
 */

export const DEFAULT_THEME: Required<Omit<InstallTheme, 'termsUrl'>> & {
  termsUrl: string | null
} = {
  primaryColor: '#2f6fed',
  backgroundColor: '#f5f7fb',
  textColor: '#1f2937',
  title: 'Instalação',
  welcomeText:
    'Preencha seus dados para concluir a instalação no seu Bitrix24.',
  termsUrl: null,
  termsText: 'Li e aceito os termos de uso',
  contactFields: ['name', 'phone', 'company'],
  requiredContactFields: [],
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
    title: theme.title ?? `${DEFAULT_THEME.title} — ${app.name}`,
    welcomeText: theme.welcomeText ?? DEFAULT_THEME.welcomeText,
    termsUrl: theme.termsUrl ?? DEFAULT_THEME.termsUrl,
    termsText: theme.termsText ?? DEFAULT_THEME.termsText,
    contactFields: theme.contactFields ?? DEFAULT_THEME.contactFields,
    requiredContactFields:
      theme.requiredContactFields ?? DEFAULT_THEME.requiredContactFields,
  }
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  phone: 'Telefone',
  company: 'Empresa',
}

export function renderInstallPage(app: RegisteredApp): string {
  const theme = resolveTheme(app)
  const fields = theme.contactFields
    .map(field => {
      const required = theme.requiredContactFields.includes(field)
      return `<label>${FIELD_LABELS[field]}${required ? ' *' : ''}<input name="${field}" ${required ? 'required' : ''} maxlength="200"></label>`
    })
    .join('\n')
  const terms = theme.termsUrl
    ? `<a href="${escapeHtml(theme.termsUrl)}" target="_blank" rel="noopener">${escapeHtml(theme.termsText)}</a>`
    : escapeHtml(theme.termsText)
  const logo = app.logoUrl
    ? `<img class="logo" src="${escapeHtml(app.logoUrl)}" alt="${escapeHtml(app.name)}">`
    : ''

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(theme.title)}</title>
<script src="https://api.bitrix24.com/api/v1/"></script>
<style>
  :root { --primary: ${theme.primaryColor}; --bg: ${theme.backgroundColor}; --text: ${theme.textColor}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); }
  main { max-width: 480px; margin: 32px auto; padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  .logo { max-height: 56px; display: block; margin: 0 auto 16px; }
  h1 { font-size: 1.4rem; margin: 0 0 8px; text-align: center; }
  p { line-height: 1.5; }
  label { display: block; margin: 12px 0; font-size: .9rem; }
  input:not([type=checkbox]) { display: block; width: 100%; padding: 10px; margin-top: 4px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 1rem; }
  .terms { display: flex; gap: 8px; align-items: flex-start; }
  button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--primary); color: #fff; font-size: 1rem; cursor: pointer; margin-top: 8px; }
  button[disabled] { opacity: .6; cursor: wait; }
  .state { display: none; text-align: center; }
  .state.active { display: block; }
  .error { color: #b91c1c; font-size: .9rem; min-height: 1.2em; }
</style>
</head>
<body>
<main>
  ${logo}
  <h1>${escapeHtml(theme.title)}</h1>
  <section id="form" class="state active">
    <p>${escapeHtml(theme.welcomeText)}</p>
    <form id="install-form" novalidate>
      <label>E-mail *<input name="email" type="email" required maxlength="200"></label>
      ${fields}
      <label class="terms"><input type="checkbox" name="acceptedTerms" required><span>${terms}</span></label>
      <div class="error" id="form-error"></div>
      <button type="submit" id="submit">Instalar</button>
    </form>
  </section>
  <section id="installing" class="state"><p>Instalando… isso pode levar alguns segundos.</p></section>
  <section id="pending" class="state">
    <p>A instalação não foi concluída pelo aplicativo.</p>
    <div class="error" id="pending-error"></div>
    <button type="button" id="retry">Tentar novamente</button>
  </section>
  <section id="done" class="state"><p>Instalação concluída!</p></section>
</main>
<script>
(function () {
  var CONFIG = ${safeJson({ appCode: app.appCode, requiredContactFields: theme.requiredContactFields })};
  var auth = null;

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
  function message(data, fallback) { return (data && data.error && data.error.message) || fallback; }
  function handle(result, errorEl) {
    if (result.status === 200 && result.data.status === 'ACTIVE') {
      show('done');
      BX24.installFinish();
      return;
    }
    if (result.status === 200 && result.data.status === 'INSTALL_PENDING') {
      show('pending');
      document.getElementById('pending-error').textContent = '';
      return;
    }
    show(errorEl === 'pending-error' ? 'pending' : 'form');
    document.getElementById(errorEl).textContent = message(result.data, 'Não foi possível instalar agora. Tente novamente.');
    document.getElementById('submit').disabled = false;
  }

  BX24.init(function () {
    auth = currentAuth();
    document.getElementById('install-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var form = event.target;
      var error = document.getElementById('form-error');
      if (!form.acceptedTerms.checked) { error.textContent = 'É preciso aceitar os termos de uso.'; return; }
      if (!form.email.value || !form.email.checkValidity()) { error.textContent = 'Informe um e-mail válido.'; return; }
      for (var i = 0; i < CONFIG.requiredContactFields.length; i++) {
        var field = form[CONFIG.requiredContactFields[i]];
        if (field && !field.value.trim()) { error.textContent = 'Preencha os campos obrigatórios.'; return; }
      }
      error.textContent = '';
      document.getElementById('submit').disabled = true;
      var contact = { email: form.email.value.trim() };
      ['name', 'phone', 'company'].forEach(function (name) { if (form[name] && form[name].value.trim()) contact[name] = form[name].value.trim(); });
      show('installing');
      post('/v1/install', { appCode: CONFIG.appCode, auth: currentAuth(), contact: contact, acceptedTerms: true })
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

export function renderErrorPage(message: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Instalação indisponível</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f7fb;color:#1f2937}main{max-width:480px;margin:48px auto;padding:24px;background:#fff;border-radius:12px;text-align:center}</style>
</head><body><main><h1>Instalação indisponível</h1><p>${escapeHtml(message)}</p></main></body></html>`
}
