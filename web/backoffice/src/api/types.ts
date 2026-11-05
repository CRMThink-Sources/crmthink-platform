import type { Schemas } from './client'

/** Atalhos dos schemas do contrato usados nas telas. */
export type Overview = Schemas['Overview']
export type InstallationPage = Schemas['AdminInstallationPage']
export type InstallationItem = InstallationPage['items'][number]
export type InstallationDetail = Schemas['AdminInstallation']
export type TimelinePage = Schemas['InstallationTimeline']
export type TimelineItem = TimelinePage['items'][number]
export type OutboxEvent = Schemas['OutboxEventList']['items'][number]
export type StripeEvent = Schemas['StripeEventList']['items'][number]
export type StripeEventDetail = Schemas['StripeEventDetail']
export type App = Schemas['App']
export type AuditItem = Schemas['AuditPage']['items'][number]
export type InstallAttempt = Schemas['InstallAttemptList']['items'][number]
