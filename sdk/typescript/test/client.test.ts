import { describe, expect, it } from 'vitest'
import {
  PlatformClient,
  PlatformError,
  PlatformRequestError,
} from '../src/index.js'

type Call = { method: string; url: string; headers: Headers; body?: string }

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: new Headers(init?.headers),
      body: init?.body as string | undefined,
    }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return { calls, impl }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const client = (fetchImpl: typeof fetch, timeoutMs?: number) =>
  new PlatformClient({
    platformUrl: 'https://p.test/',
    apiKey: 'cp_key',
    fetch: fetchImpl,
    timeoutMs,
  })

describe('SDK: transporte do PlatformClient', () => {
  it('monta método, caminho, query, Bearer e corpo JSON', async () => {
    const { calls, impl } = fakeFetch(() => json({ items: [] }))
    const platform = client(impl)

    await platform.listInstallations('a b&c')
    await platform.updateItem(7, 42, { title: 'Agente' })

    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: 'https://p.test/v1/installations?memberId=a+b%26c',
    })
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer cp_key')
    expect(calls[0]!.headers.has('content-type')).toBe(false)
    expect(calls[1]).toMatchObject({
      method: 'PATCH',
      url: 'https://p.test/v1/subscriptions/7/items/42',
      body: '{"title":"Agente"}',
    })
    expect(calls[1]!.headers.get('content-type')).toBe('application/json')
  })

  it('204 resolve sem valor', async () => {
    const { impl } = fakeFetch(() => new Response(null, { status: 204 }))
    await expect(client(impl).listPlans()).resolves.toBeUndefined()
  })

  it('erro da plataforma: status, code, message e details do envelope', async () => {
    const { impl } = fakeFetch(() =>
      json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'corpo inválido',
            details: [{ path: 'planId', message: 'obrigatório' }],
          },
        },
        400,
      ),
    )
    const error = await client(impl)
      .createCheckoutSession({
        installationId: 1,
        planId: 1,
        intent: 'subscribe',
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PlatformError)
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'corpo inválido',
      details: [{ path: 'planId', message: 'obrigatório' }],
    })
  })

  it('corpo fora do envelope: code HTTP_<status>', async () => {
    const { impl } = fakeFetch(
      () => new Response('<html>Bad Gateway</html>', { status: 502 }),
    )
    await expect(client(impl).listPlans()).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_502',
    })
  })

  it('tempo esgotado: aborta e lança PlatformRequestError timeout', async () => {
    const impl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal!.reason as Error),
        )
      })) as typeof fetch
    const error = await client(impl, 20)
      .listPlans()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PlatformRequestError)
    expect(error).toMatchObject({ kind: 'timeout' })
    expect(error).not.toHaveProperty('status')
  })

  it('falha de rede: PlatformRequestError network', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    await expect(client(impl).listPlans()).rejects.toMatchObject({
      name: 'PlatformRequestError',
      kind: 'network',
    })
  })
})

describe('SDK: tokens no PlatformClient', () => {
  it('pedidos simultâneos da mesma instalação fazem uma requisição só', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const { calls, impl } = fakeFetch(async () => {
      await gate
      return json({
        accessToken: 'atual',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        domain: 'd',
        clientEndpoint: null,
      })
    })
    const platform = client(impl)

    const pending = [
      platform.getInstallationToken(1),
      platform.getInstallationToken(1),
      platform.getInstallationToken(2),
    ]
    release()
    const [a, b] = await Promise.all(pending)
    expect(a).toBe(b)
    expect(calls.map(call => call.url)).toEqual([
      'https://p.test/v1/installations/1/token',
      'https://p.test/v1/installations/2/token',
    ])

    await platform.getInstallationToken(1)
    expect(calls).toHaveLength(2)
    platform.forgetInstallationToken(1)
    await platform.getInstallationToken(1)
    expect(calls).toHaveLength(3)
  })

  it('falha na busca não fica presa: o próximo pedido tenta de novo', async () => {
    let fail = true
    const { calls, impl } = fakeFetch(() =>
      fail
        ? json({ error: { code: 'AUTH_ERROR', message: 'x' } }, 409)
        : json({
            accessToken: 'ok',
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            domain: 'd',
            clientEndpoint: null,
          }),
    )
    const platform = client(impl)
    await expect(platform.getInstallationToken(1)).rejects.toMatchObject({
      code: 'AUTH_ERROR',
    })
    fail = false
    expect((await platform.getInstallationToken(1)).accessToken).toBe('ok')
    expect(calls).toHaveLength(2)
  })
})
