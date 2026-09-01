import { z } from 'zod'

/** PRD section 9.1 - every asynchronous boundary must be represented. */
export const RelayState = z.enum([
  'DRAFT',
  'READY',
  'ACTIVE',
  'WAITING_FOR_RUN',
  'RUN_VERIFIED',
  'INVITING',
  'RUNNER_CLAIMED',
  'PASS_INTENT_READY',
  'PASS_ATTEMPTING',
  'TX_SUBMITTED',
  'TX_CONFIRMED',
  'HANDOFF_FINALIZING',
  'COMPLETED',
  'STRANDED',
  'EXPIRED',
  'CANCELLED',
])
export type RelayState = z.infer<typeof RelayState>

export const RelayMode = z.enum(['global', 'quick', 'crew', 'rival', 'daily', 'creator'])
export type RelayMode = z.infer<typeof RelayMode>

export const HandoffIntentState = z.enum([
  'CREATED',
  'PASS_ATTEMPTING',
  'TX_SUBMITTED',
  'TX_CONFIRMED',
  'FINALIZED',
  'SUPERSEDED',
  'EXPIRED',
])
export type HandoffIntentState = z.infer<typeof HandoffIntentState>
