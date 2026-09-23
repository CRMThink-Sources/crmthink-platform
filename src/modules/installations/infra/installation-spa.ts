import type { SpaConfig } from '@/config/spa-config'
import type { BitrixRestClient } from '@/shared/bitrix/bitrix-rest.client'
import type { SpaEnvironment } from '@/shared/spa/environment'
import type { InstallationContact } from '../ports'

/**
 * Espelho da instalação no SPA 1060 (Instalações) do portal CRMThink.
 *
 * Só escreve identificação, contato, `appCode` e Ambiente. Os campos legados STATUS e
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

  private contactFields(contact: InstallationContact): Record<string, string> {
    const f = this.config.installation
    const entries: Array<[string, string | undefined]> = [
      [f.email, contact.email],
      [f.name, contact.name],
      [f.phone, contact.phone],
      [f.company, contact.company],
    ]
    return Object.fromEntries(
      entries.filter((entry): entry is [string, string] => Boolean(entry[1])),
    )
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
    contact: InstallationContact
  }): Promise<number> {
    const f = this.config.installation
    const item = await this.crm.addItem(this.entityTypeId, {
      title: `${input.appName} — ${input.domain}`,
      [f.appCode]: input.appCode,
      [f.domain]: input.domain,
      [f.memberId]: input.memberId,
      [f.environment]: this.environment.writeValue,
      ...this.contactFields(input.contact),
    })
    return Number(item.id)
  }

  async update(
    itemId: number,
    input: { domain: string; contact: InstallationContact },
  ): Promise<void> {
    const f = this.config.installation
    await this.crm.updateItem(this.entityTypeId, itemId, {
      [f.domain]: input.domain,
      ...this.contactFields(input.contact),
    })
  }

  async markTrialUsed(itemId: number): Promise<void> {
    await this.crm.updateItem(this.entityTypeId, itemId, {
      [this.config.installation.trialUsed]: 'Y',
    })
  }
}
