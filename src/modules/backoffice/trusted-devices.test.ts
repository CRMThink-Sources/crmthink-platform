import { describe, expect, it } from 'vitest'
import { FakePrisma } from '@/test/fake-prisma'
import { FakeClock, testEnv } from '@/test/fakes'
import { TrustedDevices } from './application/trusted-devices'

const DAY = 86_400_000

function setup(trustedDeviceDays = 30) {
  const clock = new FakeClock()
  const db = new FakePrisma()
  db.useClock(() => clock.now())
  const devices = new TrustedDevices(db.asDb(), clock, { trustedDeviceDays })
  return { clock, db, devices }
}

describe('ADMIN_TRUSTED_DEVICE_DAYS', () => {
  it('vale 30 quando ausente, aceita 0 e rejeita negativo', () => {
    expect(testEnv().backoffice.trustedDeviceDays).toBe(30)
    expect(
      testEnv({ ADMIN_TRUSTED_DEVICE_DAYS: '0' }).backoffice.trustedDeviceDays,
    ).toBe(0)
    expect(() => testEnv({ ADMIN_TRUSTED_DEVICE_DAYS: '-1' })).toThrow()
  })
})

describe('TrustedDevices', () => {
  it('lembra o navegador por N dias e guarda só o hash', async () => {
    const { clock, db, devices } = setup()
    const { token, expiresAt } = await devices.trust(1, { userAgent: 'x' })

    expect(expiresAt.getTime()).toBe(clock.now().getTime() + 30 * DAY)
    expect(await devices.isTrusted(token, 1)).toBe(true)
    const rows = db.rows('adminTrustedDevice') as Array<Record<string, any>>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.idHash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0]!.idHash).not.toBe(token)
  })

  it('não vale para token nulo, desconhecido ou de outro operador', async () => {
    const { devices } = setup()
    const { token } = await devices.trust(1)

    expect(await devices.isTrusted(null, 1)).toBe(false)
    expect(await devices.isTrusted('desconhecido', 1)).toBe(false)
    expect(await devices.isTrusted(token, 2)).toBe(false)
  })

  it('deixa de valer depois da validade', async () => {
    const { clock, devices } = setup()
    const { token } = await devices.trust(1)

    clock.advance(31 * DAY)
    expect(await devices.isTrusted(token, 1)).toBe(false)
  })

  it('revokeAll esquece os navegadores da conta e só dela', async () => {
    const { devices } = setup()
    const mine = await devices.trust(1)
    const other = await devices.trust(2)

    await devices.revokeAll(1)

    expect(await devices.isTrusted(mine.token, 1)).toBe(false)
    expect(await devices.isTrusted(other.token, 2)).toBe(true)
  })

  it('com 0 dias o recurso fica desligado', async () => {
    const { db, devices } = setup(0)

    expect(devices.enabled).toBe(false)
    const { token } = await devices.trust(1)
    expect(db.rows('adminTrustedDevice')).toHaveLength(0)
    expect(await devices.isTrusted(token, 1)).toBe(false)
  })
})
