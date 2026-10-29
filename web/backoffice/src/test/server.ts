import { setupServer } from 'msw/node'

/** Servidor MSW dos testes: cada teste registra os handlers que usa (`server.use`). */
export const server = setupServer()
