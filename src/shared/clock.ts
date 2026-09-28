/** Fonte de tempo injetável — os jobs de trial, aviso de período e renovação dependem dela nos testes. */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }
