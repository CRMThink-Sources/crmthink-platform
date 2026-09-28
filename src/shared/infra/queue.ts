import { Queue, type JobsOptions } from 'bullmq'
import type { Redis } from 'ioredis'

/** Filas do BullMQ. Um nome por responsabilidade, prefixo por ambiente (`QUEUE_PREFIX`). */
export const QUEUES = {
  stripeEvents: 'stripe-events',
  spaEvents: 'spa-events',
  scheduled: 'scheduled',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

/** O que a API precisa para enfileirar. Dublê simples nos testes. */
export interface JobQueue {
  add(
    queue: QueueName,
    name: string,
    data: unknown,
    options?: JobsOptions,
  ): Promise<void>
}

/** Retry com backoff; esgotadas as tentativas o job fica `failed` (dead-letter) e o worker alerta. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * 86_400, count: 10_000 },
  removeOnFail: false,
}

export class BullJobQueue implements JobQueue {
  private readonly queues = new Map<QueueName, Queue>()

  constructor(
    private readonly connection: Redis,
    private readonly prefix: string,
  ) {}

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name)
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        prefix: this.prefix,
      })
      this.queues.set(name, queue)
    }
    return queue
  }

  async add(
    queue: QueueName,
    name: string,
    data: unknown,
    options?: JobsOptions,
  ): Promise<void> {
    await this.queue(queue).add(name, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...options,
    })
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map(queue => queue.close()))
  }
}

export class InMemoryJobQueue implements JobQueue {
  readonly jobs: Array<{
    queue: QueueName
    name: string
    data: unknown
    options?: JobsOptions
  }> = []
  async add(
    queue: QueueName,
    name: string,
    data: unknown,
    options?: JobsOptions,
  ): Promise<void> {
    this.jobs.push({ queue, name, data, options })
  }
}
