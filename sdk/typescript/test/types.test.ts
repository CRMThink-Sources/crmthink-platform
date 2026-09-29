import { describe, expectTypeOf, it } from 'vitest'
import type {
  InstallerPayload,
  PlatformEvent,
  PlatformEventOf,
  PlatformEventType,
} from '../src/index.js'

/** Verificados pelo `yarn check-types`; em execução estes testes não fazem nada. */
describe('SDK: tipos dos eventos', () => {
  it('estreita o `data` pelo `type`', () => {
    const handle = (event: PlatformEvent) => {
      if (event.type === 'subscription.renewed') {
        expectTypeOf(event.data.previousPeriodEnd).toEqualTypeOf<string>()
        expectTypeOf(event.data.invoiceId).toEqualTypeOf<string | null>()
      }
      if (event.type === 'installation.created')
        expectTypeOf(event.subscription).toEqualTypeOf<null>()
    }
    expectTypeOf(handle).toBeFunction()
  })

  it('cobre os tipos de evento do contrato e o instalador', () => {
    expectTypeOf<'purchase.paid'>().toExtend<PlatformEventType>()
    expectTypeOf<'installer'>().not.toExtend<PlatformEventType>()
    expectTypeOf<
      PlatformEventOf<'charge.refunded'>['type']
    >().toEqualTypeOf<'charge.refunded'>()
    expectTypeOf<InstallerPayload['isReinstall']>().toEqualTypeOf<boolean>()
  })
})
