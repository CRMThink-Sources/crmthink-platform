import request from 'supertest'
import { createApp } from '@/app'
import { HealthState } from '@/health'
import type { Harness } from './harness'

export function http(h: Harness) {
  const app = createApp(h.container, new HealthState(h.container.db, null))
  return request(app)
}
