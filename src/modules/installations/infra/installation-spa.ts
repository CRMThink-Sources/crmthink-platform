import type { SpaConfig } from '@/config/spa-config'
import type { BitrixRestClient } from '@/shared/bitrix/bitrix-rest.client'
import type { SpaEnvironment } from '@/shared/spa/environment'
import type { InstallationContact } from '../ports'

/**
 * Espelho da instalação no SPA 1060 (Instalações) do portal CRMThink.
 *
 * Só escreve identificação, contato (da solicitação de trial), `appCode` e Ambiente. Os campos legados STATUS e
 * TRIAL_* não são lidos nem escritos (removidos do SPA); o status técnico da
 * instalação vive só no banco.
 *
 * Contato vazio **não** é enviado: numa reinstalação, `''` apagaria o que o comercial
 * já tem no item (mesma regra do `BitrixSpaRepository` do hub-core).
 */
export class InstallationSpa {
  constructor(
    private readonly crm: BitrixRestClient,
    private readonly config: SpaConfig,
    private readonly environment: SpaEnvironment,
  ) {}

  private get entityTypeId(): number {
    return this.config.entityTypes.installation
  }

  /** Item existente deste app e portal, no ambiente desta instância. */
  async find(appCode: string, memberId: string): Promise<number | null> {
    const f = this.config.installation
    const items = await this.crm.listItems(
      this.entityTypeId,
      { [f.appCode]: appCode, [f.memberId]: memberId },
      { select: ['id', f.environment] },
    )
    const own = items.find(item => this.environment.owns(item, f.environment))
    return own ? Number(own.id) : null
  }

  async exists(itemId: number): Promise<boolean> {
    return (await this.crm.getItem(this.entityTypeId, itemId)) !== null
  }

  async create(input: {
    appCode: string
    appName: string
    domain: string
    memberId: string
  }): Promise<number> {
    const f = this.config.installation
    const item = await this.crm.addItem(this.entityTypeId, {
      title: `${input.appName} — ${input.domain}`,
      [f.appCode]: input.appCode,
      [f.domain]: input.domain,
      [f.memberId]: input.memberId,
      [f.environment]: this.environment.writeValue,
    })
    return Number(item.id)
  }

  async update(itemId: number, input: { domain: string }): Promise<void> {
    await this.crm.updateItem(this.entityTypeId, itemId, {
      [this.config.installation.domain]: input.domain,
    })
  }

  /** Contato da solicitação de trial; campos vazios não são enviados. */
  async updateContact(
    itemId: number,
    contact: InstallationContact,
  ): Promise<void> {
    const f = this.config.installation
    const fields: Record<string, string> = {}
    for (const key of ['name', 'email', 'phone', 'company', 'role'] as const) {
      const value = contact[key]?.trim()
      if (value) fields[f[key]] = value
    }
    if (Object.keys(fields).length === 0) return
    await this.crm.updateItem(this.entityTypeId, itemId, fields)
  }

  async markTrialUsed(itemId: number): Promise<void> {
    await this.crm.updateItem(this.entityTypeId, itemId, {
      [this.config.installation.trialUsed]: 'Y',
    })
  }
}
