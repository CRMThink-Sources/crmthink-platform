import { AsyncLocalStorage } from 'node:async_hooks'

/** Campos de correlação que entram em toda linha de log do contexto corrente. */
export type LogContext = {
  appCode?: string
  installationId?: number
  subscriptionId?: number
  eventId?: string
  requestId?: string
}

const storage = new AsyncLocalStorage<LogContext>()

export function getLogContext(): LogContext {
  return storage.getStore() ?? {}
}

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...getLogContext(), ...context }, fn)
}

/** Acrescenta campos ao contexto corrente (ex.: depois de resolver a instalação). */
export function setLogContext(context: LogContext): void {
  const store = storage.getStore()
  if (store) Object.assign(store, context)
}
