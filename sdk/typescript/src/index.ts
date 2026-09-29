/**
 * @crmthink-sources/platform-sdk — o que um app TypeScript precisa para falar com a plataforma.
 *
 * Autocontido de propósito (só `node:crypto` e `jose`). Nada aqui importa código da
 * plataforma.
 *
 * - `verifyPlatformSignature`: webhooks de eventos e chamada do instalador.
 * - `createSessionVerifier`: JWT RS256 da sessão do iframe, validado pelo JWKS.
 * - `PlatformTokenClient`: token do Bitrix por instalação, com cache e renovação.
 */
export type * from './types.js'
export * from './signature.js'
export * from './events.js'
export * from './session.js'
export * from './client.js'
