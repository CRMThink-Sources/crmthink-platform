import { randomUUID } from 'node:crypto'
import {
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  SignJWT,
  type JWK,
} from 'jose'
import type { SigningKey } from '@/prisma/client'
import type { Db } from '@/shared/infra/prisma'
import type { Clock } from '@/shared/clock'
import type { TokenCipher } from '@/shared/crypto/token-cipher'
import { logger } from '@/shared/observability/logger'

/**
 * Chaves RS256 da sessão do iframe (D5), em `signing_key` com a privada cifrada.
 *
 * Rotação sem janela de falha:
 * - a chave nova entra publicada com `activatedAt` no futuro (`leadMs`): aparece no
 *   JWKS **antes** do primeiro token assinado com ela;
 * - a que assina é a de `activatedAt` mais recente já alcançada;
 * - a anterior continua no JWKS até `ttl + margem` depois de a sucessora ativar, que
 *   é quando expira o último token assinado com ela.
 */

export const ALG = 'RS256'
const RETENTION_MARGIN_MS = 5 * 60_000

export class NoActiveSigningKeyError extends Error {
  constructor() {
    super(
      'Nenhuma chave de assinatura do JWT ativa: configure JWT_SIGNING_PRIVATE_KEY ou rode admin:rotate-signing-key',
    )
    this.name = 'NoActiveSigningKeyError'
  }
}

export type JwtClaims = {
  sub: string
  aud: string
  installationId: number
  memberId: string
  domain: string
  isAdmin: boolean
  name: string
  departmentIds: number[]
}

type Keyed = { key: SigningKey; successorActivatedAt: Date | null }

export class SigningKeys {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly clock: Clock,
    private readonly options: { issuer: string; ttlSeconds: number },
  ) {}

  private async ordered(): Promise<Keyed[]> {
    const keys = await this.db.signingKey.findMany({
      where: { activatedAt: { not: null } },
      orderBy: { activatedAt: 'asc' },
    })
    return keys.map((key, index) => ({
      key,
      successorActivatedAt: keys[index + 1]?.activatedAt ?? null,
    }))
  }

  private async activeKey(): Promise<SigningKey | null> {
    const now = this.clock.now()
    return this.db.signingKey.findFirst({
      where: { activatedAt: { lte: now } },
      orderBy: { activatedAt: 'desc' },
    })
  }

  /**
   * Boot: garante uma chave ativa. Sem nenhuma no banco, importa a de
   * `JWT_SIGNING_PRIVATE_KEY`; sem as duas, o processo não sobe.
   */
  async ensureActive(bootstrapPem: string): Promise<void> {
    if (await this.activeKey()) return
    if (!bootstrapPem.trim()) throw new NoActiveSigningKeyError()
    const privateKey = await importPKCS8(bootstrapPem, ALG, {
      extractable: true,
    })
    await this.store(privateKey, this.clock.now())
    logger().info(
      'chave de assinatura do JWT importada de JWT_SIGNING_PRIVATE_KEY',
    )
  }

  private async store(
    privateKey: Parameters<typeof exportPKCS8>[0],
    activatedAt: Date,
  ): Promise<string> {
    const kid = randomUUID()
    const jwk = await exportJWK(privateKey)
    const publicJwk: JWK = {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      kid,
      alg: ALG,
      use: 'sig',
    }
    await this.db.signingKey.create({
      data: {
        kid,
        publicJwk,
        privateKeyEnc: this.cipher.encrypt(await exportPKCS8(privateKey)),
        activatedAt,
      },
    })
    return kid
  }

  /** Gera uma chave nova, publicada já, que passa a assinar após `leadMs`. */
  async rotate(
    leadMs = 10 * 60_000,
  ): Promise<{ kid: string; activatesAt: Date }> {
    const { privateKey } = await generateKeyPair(ALG, {
      modulusLength: 2048,
      extractable: true,
    })
    const activatesAt = new Date(this.clock.now().getTime() + leadMs)
    const kid = await this.store(privateKey, activatesAt)
    return { kid, activatesAt }
  }

  /** Chaves publicáveis: a futura, a ativa e as antigas ainda dentro da retenção. */
  async jwks(): Promise<{ keys: JWK[] }> {
    const now = this.clock.now().getTime()
    const retentionMs = this.options.ttlSeconds * 1000 + RETENTION_MARGIN_MS
    const keys = (await this.ordered())
      .filter(({ successorActivatedAt }) => {
        if (!successorActivatedAt) return true
        return successorActivatedAt.getTime() + retentionMs > now
      })
      .map(({ key }) => key.publicJwk as JWK)
    return { keys }
  }

  async sign(claims: JwtClaims): Promise<{ token: string; expiresAt: Date }> {
    const key = await this.activeKey()
    if (!key) throw new NoActiveSigningKeyError()
    const privateKey = await importPKCS8(
      this.cipher.decrypt(key.privateKeyEnc),
      ALG,
    )
    const now = this.clock.now()
    const expiresAt = new Date(now.getTime() + this.options.ttlSeconds * 1000)
    const { sub, aud, ...rest } = claims
    const token = await new SignJWT(rest)
      .setProtectedHeader({ alg: ALG, kid: key.kid, typ: 'JWT' })
      .setIssuer(this.options.issuer)
      .setAudience(aud)
      .setSubject(sub)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .setJti(randomUUID())
      .sign(privateKey)
    return { token, expiresAt }
  }
}
