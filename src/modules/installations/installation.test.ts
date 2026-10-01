import { beforeEach, describe, expect, it } from 'vitest'
import { verifySignatureHeader } from '@/shared/crypto/hmac-signature'
import { http } from '@/test/app'
import {
  createHarness,
  DOMAIN,
  GPTMAKER,
  installPayload,
  MEMBER_ID,
  outbox,
  seedGptMaker,
  type Harness,
} from '@/test/harness'

let installerStatus = 200
let installerCalls: Array<{ body: any; signature: string | null }> = []

function harness(): Harness {
  return createHarness({
    webhookHandler: (url, init) => {
      if (url.endsWith('/platform/installer')) {
        installerCalls.push({
          body: JSON.parse(String(init.body)),
          signature:
            (init.headers as Record<string, string>)['X-Platform-Signature'] ??
            null,
        })
        return new Response('{}', { status: installerStatus })
      }
      return new Response('{}', { status: 200 })
    },
  })
}

describe('instalação', () => {
  let h: Harness
  let apiKey: string
  let webhookSecret: string

  beforeEach(async () => {
    installerStatus = 200
    installerCalls = []
    h = harness()
    const seeded = await seedGptMaker(h)
    apiKey = seeded.credentials.apiKey
    webhookSecret = seeded.credentials.webhookSecret
  })

  it('página com o tema do app e 404 para app desconhecido', async () => {
    await h.container.registry.update(GPTMAKER, {
      installTheme: { title: 'Bem-vindo ao GPTMaker', primaryColor: '#ff0000' },
    })
    const page = await http(h).get(`/install/${GPTMAKER}`)
    expect(page.status).toBe(200)
    expect(page.text).toContain('Bem-vindo ao GPTMaker')
    expect(page.text).toContain('#ff0000')
    expect(page.text).toContain('api.bitrix24.com/api/v1')

    const unknown = await http(h).get('/install/crmthink.naoexiste')
    expect(unknown.status).toBe(404)
  })

  it('página também abre por POST, como o Bitrix carrega o app', async () => {
    const page = await http(h)
      .post(`/install/${GPTMAKER}`)
      .type('form')
      .send({ AUTH_ID: 'x', DOMAIN, member_id: MEMBER_ID })
    expect(page.status).toBe(200)
    expect(page.text).toContain('api.bitrix24.com/api/v1')
  })

  it('página tem só o botão Instalar, sem campos de formulário', async () => {
    const page = await http(h).get(`/install/${GPTMAKER}`)
    expect(page.text).toContain('id="submit"')
    expect(page.text).not.toMatch(/<form|<input/)
    expect(page.text).toContain('Ao clicar em Instalar, você aceita os')
  })

  it('app sem tema usa o tema padrão com o nome do app', async () => {
    const page = await http(h).get(`/install/${GPTMAKER}`)
    expect(page.text).toContain('Instalação — GPTMaker')
  })

  it('primeira instalação: verifica no Bitrix, cria item 1060, chama instalador assinado, ACTIVE, trial e eventos', async () => {
    const payload = installPayload(h)
    const res = await http(h).post('/v1/install').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ACTIVE')

    const installationId = res.body.installationId as number
    const installation = h.db.rows('installation')[0]!
    expect(installation).toMatchObject({
      id: installationId,
      spaItemId: installationId,
      status: 'ACTIVE',
      memberId: MEMBER_ID,
      domain: DOMAIN,
    })
    // Nenhum dado do cliente é coletado na instalação (regra do marketplace).
    expect(installation.contact ?? null).toBeNull()
    expect(h.portal.calls.some(c => c.method === 'user.current')).toBe(false)

    // Item do SPA 1060 com app, portal e Ambiente, sem contato nem STATUS/TRIAL_*.
    const spa = await h.crm.getItem(1060, installationId)
    const f = h.config.installation
    expect(spa).toMatchObject({
      [f.appCode]: GPTMAKER,
      [f.memberId]: MEMBER_ID,
      [f.domain]: DOMAIN,
      [f.environment]: 'homolog',
    })
    for (const field of [f.email, f.name, f.phone, f.company])
      expect(spa![field]).toBeUndefined()
    expect(Object.keys(spa!).some(key => key === 'ufCrm55_1776720499466')).toBe(
      false,
    )

    // Tokens cifrados: os do OAuth (renovados na verificação), nunca os do navegador em claro.
    const credential = h.db.rows('credential')[0]!
    expect(credential.accessTokenEnc.startsWith('v1:')).toBe(true)
    expect(h.container.cipher.decrypt(credential.accessTokenEnc)).toBe(
      'access-1',
    )

    // event.bind do ONAPPINSTALL (traz o application_token) e do ONAPPUNINSTALL.
    const handler = `https://platform.test/bitrix/events/${GPTMAKER}`
    expect(
      h.portal.calls
        .filter(call => call.method === 'event.bind')
        .map(call => call.params),
    ).toEqual([
      { event: 'ONAPPINSTALL', handler },
      { event: 'ONAPPUNINSTALL', handler },
    ])

    // Instalador síncrono, assinado com o segredo do webhook.
    expect(installerCalls).toHaveLength(1)
    expect(installerCalls[0]!.body).toEqual({
      installationId,
      memberId: MEMBER_ID,
      domain: DOMAIN,
      appCode: GPTMAKER,
      isReinstall: false,
    })
    expect(
      verifySignatureHeader(
        installerCalls[0]!.signature ?? '',
        webhookSecret,
        JSON.stringify(installerCalls[0]!.body),
      ).ok,
    ).toBe(true)

    // installation.created + trial de 14 dias + subscription.trial_started.
    const types = outbox(h).map(e => e.type)
    expect(types).toEqual([
      'installation.created',
      'subscription.trial_started',
    ])
    const trial = outbox(h)[1]!.payload
    expect(trial.subscription).toMatchObject({
      status: 'trialing',
      planId: 500,
      version: 1,
    })
    expect(
      new Date(trial.data.trialEndsAt).getTime() - h.clock.now().getTime(),
    ).toBe(14 * 86_400_000)
    expect(outbox(h)[0]!.payload.subscription).toBeNull()
    expect(h.db.rows('installation')[0]!.trialUsed).toBe(true)
  })

  it('termos não aceitos: 400 e nada gravado', async () => {
    const payload = { ...installPayload(h), acceptedTerms: false }
    const res = await http(h).post('/v1/install').send(payload)
    expect(res.status).toBe(400)
    expect(h.db.rows('installation')).toHaveLength(0)
  })

  it('token de outro app Bitrix: 403 e nada gravado', async () => {
    const payload = installPayload(h, { clientId: 'local.outroapp' })
    const res = await http(h).post('/v1/install').send(payload)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('TOKEN_APP_MISMATCH')
    expect(h.db.rows('installation')).toHaveLength(0)
  })

  it('member_id divergente do Bitrix: 403 e nada gravado', async () => {
    const payload = installPayload(h)
    payload.auth.memberId = 'member-forjado'
    const res = await http(h).post('/v1/install').send(payload)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('MEMBER_ID_MISMATCH')
    expect(h.db.rows('installation')).toHaveLength(0)
    expect(h.crm.calls.filter(c => c.op === 'add')).toHaveLength(0)
  })

  it('usuário que não é admin do portal: 403', async () => {
    const res = await http(h)
      .post('/v1/install')
      .send(installPayload(h, { admin: false }))
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_PORTAL_ADMIN')
  })

  it('Bitrix indisponível na verificação: erro recuperável', async () => {
    const payload = installPayload(h)
    h.portal.unavailable = true
    const res = await http(h).post('/v1/install').send(payload)
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('BITRIX_UNAVAILABLE')
  })

  it('app inativo: 404 na página e na instalação', async () => {
    await h.container.registry.update(GPTMAKER, { active: false })
    expect((await http(h).get(`/install/${GPTMAKER}`)).status).toBe(404)
    expect(
      (await http(h).post('/v1/install').send(installPayload(h))).status,
    ).toBe(404)
  })

  it('instalador falha: INSTALL_PENDING, sem evento; nova tentativa chama só o instalador e conclui', async () => {
    installerStatus = 500
    const payload = installPayload(h)
    const first = await http(h).post('/v1/install').send(payload)
    expect(first.body.status).toBe('INSTALL_PENDING')
    expect(h.db.rows('installation')[0]!.status).toBe('INSTALL_PENDING')
    expect(outbox(h)).toHaveLength(0)
    expect(
      h.db.rows('installAttempt').map(a => `${a.step}:${a.status}`),
    ).toEqual(['register:ok', 'event-bind:ok', 'installer:error'])

    // App usa o token durante/depois do instalador mesmo em INSTALL_PENDING.
    const token = await http(h)
      .get(`/v1/installations/${first.body.installationId}/token`)
      .set('Authorization', `Bearer ${apiKey}`)
    expect(token.status).toBe(200)

    installerStatus = 200
    const binds = h.portal.calls.filter(c => c.method === 'event.bind').length
    const retry = await http(h)
      .post('/v1/install/retry')
      .send({
        appCode: GPTMAKER,
        auth: {
          accessToken: payload.auth.accessToken,
          memberId: MEMBER_ID,
          domain: DOMAIN,
        },
      })
    expect(retry.body.status).toBe('ACTIVE')
    expect(installerCalls).toHaveLength(2)
    expect(h.portal.calls.filter(c => c.method === 'event.bind').length).toBe(
      binds,
    )
    expect(outbox(h).map(e => e.type)).toEqual([
      'installation.created',
      'subscription.trial_started',
    ])
  })

  it('application_token no ONAPPINSTALL (antes ou depois do install) e desinstalação forjada', async () => {
    const payload = installPayload(h)
    // ONAPPINSTALL chega antes do POST /v1/install.
    const early = await http(h)
      .post(`/bitrix/events/${GPTMAKER}`)
      .type('form')
      .send({
        event: 'ONAPPINSTALL',
        'auth[application_token]': 'app-token-1',
        'auth[member_id]': MEMBER_ID,
        'auth[domain]': DOMAIN,
        'auth[access_token]': payload.auth.accessToken,
      })
    expect(early.status).toBe(200)
    expect(early.body.handled).toBe('application-token-pending')

    const res = await http(h).post('/v1/install').send(payload)
    const installationId = res.body.installationId as number
    const stored = h.db.rows('applicationToken')[0]!
    expect(stored.tokenEnc).not.toContain('app-token-1')

    const got = await http(h)
      .get(`/v1/installations/${installationId}`)
      .set('Authorization', `Bearer ${apiKey}`)
    expect(got.body).toMatchObject({
      installationId,
      appCode: GPTMAKER,
      memberId: MEMBER_ID,
      status: 'ACTIVE',
      applicationToken: 'app-token-1',
    })

    // ONAPPINSTALL forjado (token de outro app) não troca o token guardado.
    h.portal.clientIdByToken.set('forged-access', 'local.outroapp')
    const forgedInstall = await http(h)
      .post(`/bitrix/events/${GPTMAKER}`)
      .type('form')
      .send({
        event: 'ONAPPINSTALL',
        'auth[application_token]': 'evil',
        'auth[member_id]': MEMBER_ID,
        'auth[domain]': DOMAIN,
        'auth[access_token]': 'forged-access',
      })
    expect(forgedInstall.status).toBe(401)

    const forged = await http(h)
      .post(`/bitrix/events/${GPTMAKER}`)
      .type('form')
      .send({
        event: 'ONAPPUNINSTALL',
        'auth[application_token]': 'evil',
        'auth[member_id]': MEMBER_ID,
      })
    expect(forged.status).toBe(401)
    expect(h.db.rows('installation')[0]!.status).toBe('ACTIVE')
  })

  it('desinstalação válida: UNINSTALLED, tokens apagados, installation.removed; assinatura intacta; token 410', async () => {
    const payload = installPayload(h)
    await http(h).post(`/bitrix/events/${GPTMAKER}`).type('form').send({
      event: 'ONAPPINSTALL',
      'auth[application_token]': 'app-token-1',
      'auth[member_id]': MEMBER_ID,
      'auth[domain]': DOMAIN,
      'auth[access_token]': payload.auth.accessToken,
    })
    const { body } = await http(h).post('/v1/install').send(payload)
    const subscriptionsBefore = [
      ...(h.crm.items.get(1142)?.values() ?? []),
    ].map(s => ({ ...s }))

    const res = await http(h)
      .post(`/bitrix/events/${GPTMAKER}`)
      .type('form')
      .send({
        event: 'ONAPPUNINSTALL',
        'auth[application_token]': 'app-token-1',
        'auth[member_id]': MEMBER_ID,
      })
    expect(res.status).toBe(200)
    expect(h.db.rows('installation')[0]!.status).toBe('UNINSTALLED')
    expect(h.db.rows('credential')).toHaveLength(0)
    expect(outbox(h).at(-1)).toMatchObject({ type: 'installation.removed' })
    expect(outbox(h).at(-1)!.payload).toMatchObject({
      installationId: body.installationId,
      memberId: MEMBER_ID,
      subscription: null,
      data: {},
    })
    expect(
      [...(h.crm.items.get(1142)?.values() ?? [])].map(
        s => s[h.config.subscription.status],
      ),
    ).toEqual(subscriptionsBefore.map(s => s[h.config.subscription.status]))

    const token = await http(h)
      .get(`/v1/installations/${body.installationId}/token`)
      .set('Authorization', `Bearer ${apiKey}`)
    expect(token.status).toBe(410)
  })

  it('sem application_token guardado: desinstalação só vale se o portal já recusa o token da instalação', async () => {
    // Instalação importada do hub-core / ONAPPINSTALL perdido: nenhum token guardado.
    await http(h).post('/v1/install').send(installPayload(h))
    expect(h.db.rows('applicationToken')).toHaveLength(0)
    const uninstall = () =>
      http(h).post(`/bitrix/events/${GPTMAKER}`).type('form').send({
        event: 'ONAPPUNINSTALL',
        'auth[application_token]': 'qualquer',
        'auth[member_id]': MEMBER_ID,
      })

    // App ainda instalado (token da instalação aceito): forjado.
    expect((await uninstall()).status).toBe(401)
    expect(h.db.rows('installation')[0]!.status).toBe('ACTIVE')

    // Desinstalado de verdade: o Bitrix revogou o token.
    h.portal.clientIdByToken.delete('access-1')
    expect((await uninstall()).status).toBe(200)
    expect(h.db.rows('installation')[0]!.status).toBe('UNINSTALLED')
    expect(outbox(h).at(-1)!.type).toBe('installation.removed')
  })

  it('reinstalação: mesmo installationId, isReinstall=true, installation.reinstalled, sem novo trial', async () => {
    const first = await http(h).post('/v1/install').send(installPayload(h))
    await h.db.$transaction(async () => {
      h.db.rows('installation')[0]!.status = 'UNINSTALLED'
    })
    const second = await http(h).post('/v1/install').send(installPayload(h))
    expect(second.body.installationId).toBe(first.body.installationId)
    expect(installerCalls.at(-1)!.body.isReinstall).toBe(true)
    expect(outbox(h).map(e => e.type)).toEqual([
      'installation.created',
      'subscription.trial_started',
      'installation.reinstalled',
    ])
    expect(h.db.rows('installation')).toHaveLength(1)
  })

  it('mesmo portal em apps diferentes gera instalações e itens distintos', async () => {
    await seedGptMaker(h, {
      appCode: 'crmthink.thinkzap',
      name: 'ThinkZap',
      bitrixClientId: 'local.thinkzap',
      trialOnInstall: false,
      installerUrl: null,
    })
    await http(h).post('/v1/install').send(installPayload(h))
    const tz = installPayload(h, { clientId: 'local.thinkzap' })
    const res = await http(h)
      .post('/v1/install')
      .send({ ...tz, appCode: 'crmthink.thinkzap' })
    expect(res.body.status).toBe('ACTIVE')
    const rows = h.db.rows('installation')
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(r => r.spaItemId)).size).toBe(2)
  })

  it('item do SPA 1060 removido à mão: 404 para o app até a reinstalação revincular', async () => {
    const { body } = await http(h).post('/v1/install').send(installPayload(h))
    await h.crm.deleteItem(1060, body.installationId)
    await h.container.spaProcessor.process({
      entityTypeId: 1060,
      itemId: body.installationId,
      verb: 'DELETE',
    })

    const got = await http(h)
      .get(`/v1/installations/${body.installationId}`)
      .set('Authorization', `Bearer ${apiKey}`)
    expect(got.status).toBe(404)

    const again = await http(h).post('/v1/install').send(installPayload(h))
    expect(again.body.installationId).toBe(body.installationId)
    const row = h.db.rows('installation')[0]!
    expect(row.spaItemId).not.toBeNull()
    expect(row.spaItemId).not.toBe(body.installationId)
    expect(
      (
        await http(h)
          .get(`/v1/installations/${body.installationId}`)
          .set('Authorization', `Bearer ${apiKey}`)
      ).status,
    ).toBe(200)
  })

  it('escopos diferentes do cadastro: alerta e segue', async () => {
    await h.container.registry.update(GPTMAKER, {
      scopes: ['crm', 'imbot', 'imopenlines'],
    })
    const res = await http(h).post('/v1/install').send(installPayload(h))
    expect(res.body.status).toBe('ACTIVE')
  })
})

describe('autenticação dos apps', () => {
  let h: Harness
  let apiKey: string

  beforeEach(async () => {
    h = harness()
    apiKey = (await seedGptMaker(h)).credentials.apiKey
  })

  it('sem chave ou chave desconhecida: 401', async () => {
    expect((await http(h).get('/v1/plans')).status).toBe(401)
    expect(
      (await http(h).get('/v1/plans').set('Authorization', 'Bearer cp_nada'))
        .status,
    ).toBe(401)
  })

  it('instalação de outro app: 404; busca por memberId só do próprio app', async () => {
    const other = await seedGptMaker(h, {
      appCode: 'crmthink.thinkzap',
      name: 'ThinkZap',
      bitrixClientId: 'local.thinkzap',
      trialOnInstall: false,
      installerUrl: null,
    })
    const { body } = await http(h).post('/v1/install').send(installPayload(h))
    expect(
      (
        await http(h)
          .get(`/v1/installations/${body.installationId}`)
          .set('Authorization', `Bearer ${other.credentials.apiKey}`)
      ).status,
    ).toBe(404)
    const search = await http(h)
      .get(`/v1/installations?memberId=${MEMBER_ID}`)
      .set('Authorization', `Bearer ${other.credentials.apiKey}`)
    expect(search.body.items).toEqual([])
    const own = await http(h)
      .get(`/v1/installations?memberId=${MEMBER_ID}`)
      .set('Authorization', `Bearer ${apiKey}`)
    expect(own.body.items).toHaveLength(1)
  })

  it('app inativo: 403 e nenhum evento novo gravado', async () => {
    await h.container.registry.update(GPTMAKER, { active: false })
    const res = await http(h)
      .get('/v1/plans')
      .set('Authorization', `Bearer ${apiKey}`)
    expect(res.status).toBe(403)
    await h.db.$transaction(async (tx: any) => {
      const { appendEvent } = await import('@/modules/events/outbox')
      expect(
        await appendEvent(tx, {
          appCode: GPTMAKER,
          type: 'installation.created',
          installationId: 1,
          memberId: 'm',
          subscription: null,
        }),
      ).toBeNull()
    })
  })

  it('rotação da chave: a anterior vale durante a transição', async () => {
    const admin = await http(h)
      .post(`/admin/apps/${GPTMAKER}/rotate-api-key`)
      .set('Authorization', 'Bearer admin-token')
    expect(admin.status).toBe(200)
    expect(
      (
        await http(h)
          .get('/v1/plans')
          .set('Authorization', `Bearer ${admin.body.apiKey}`)
      ).status,
    ).toBe(200)
    expect(
      (await http(h).get('/v1/plans').set('Authorization', `Bearer ${apiKey}`))
        .status,
    ).toBe(200)
    h.clock.advance(25 * 3600_000)
    expect(
      (await http(h).get('/v1/plans').set('Authorization', `Bearer ${apiKey}`))
        .status,
    ).toBe(401)
  })

  it('rotas administrativas exigem credencial de operador', async () => {
    expect((await http(h).get('/admin/apps')).status).toBe(401)
    expect(
      (
        await http(h)
          .get('/admin/apps')
          .set('Authorization', `Bearer ${apiKey}`)
      ).status,
    ).toBe(401)
    const list = await http(h)
      .get('/admin/apps')
      .set('Authorization', 'Bearer admin-token')
    expect(list.status).toBe(200)
    expect(JSON.stringify(list.body)).not.toContain('secret-gptmaker')
  })

  it('cadastro gera credenciais mostradas uma vez e guarda só hash/cifrado', async () => {
    const res = await http(h)
      .post('/admin/apps')
      .set('Authorization', 'Bearer admin-token')
      .send({
        appCode: 'crmthink.novo',
        name: 'Novo',
        bitrixClientId: 'local.novo',
        bitrixClientSecret: 'shh',
        webhookUrl: 'https://novo.app/events',
      })
    expect(res.status).toBe(201)
    expect(res.body.credentials.apiKey).toMatch(/^cp_/)
    const row = h.db.rows('app').find(a => a.appCode === 'crmthink.novo')!
    expect(row.apiKeyHash).not.toBe(res.body.credentials.apiKey)
    expect(row.bitrixClientSecretEnc.startsWith('v1:')).toBe(true)
    expect(row.webhookSecretEnc.startsWith('v1:')).toBe(true)
  })
})
