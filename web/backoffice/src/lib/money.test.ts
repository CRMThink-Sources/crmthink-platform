import { centsToReais, reaisToCents } from './money'

describe('centsToReais', () => {
  it.each([
    [19900, '199,00'],
    [150, '1,50'],
    [0, '0,00'],
    [5, '0,05'],
    [199000, '1990,00'],
  ])('%i vira %s', (cents, text) => {
    expect(centsToReais(cents)).toBe(text)
  })
})

describe('reaisToCents', () => {
  it.each([
    ['199', 19900],
    ['199,5', 19950],
    ['199,50', 19950],
    ['1.990,00', 199000],
    [' 10,05 ', 1005],
    ['0', 0],
  ])('%s vira %i', (text, cents) => {
    expect(reaisToCents(text)).toBe(cents)
  })

  it.each([[''], ['  '], ['abc'], ['10,555'], ['-5'], ['1,2,3'], ['10.5.5']])(
    '%j é inválido',
    text => {
      expect(reaisToCents(text)).toBeNull()
    },
  )
})
