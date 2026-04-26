import type { LeadState } from '@/lib/lead/state-machine'

export type StopReason =
  | 'opted_out'
  | 'lead_dead'
  | 'lead_converted'
  | 'lead_responded'
  | 'enrollment_cancelled'
  | 'enrollment_paused'

interface StopCheckInput {
  leadState: LeadState
  enrollmentStatus: string
}

export function shouldStop(input: StopCheckInput): StopReason | null {
  const { leadState, enrollmentStatus } = input

  if (leadState === 'opted_out') return 'opted_out'
  if (leadState === 'dead') return 'lead_dead'
  if (leadState === 'converted') return 'lead_converted'
  if (leadState === 'responded' || leadState === 'revived') return 'lead_responded'

  if (enrollmentStatus === 'cancelled') return 'enrollment_cancelled'
  if (enrollmentStatus === 'paused') return 'enrollment_paused'

  return null
}
