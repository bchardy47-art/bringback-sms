import type { ConditionConfig } from '@/lib/db/schema'
import type { LeadState } from '@/lib/lead/state-machine'

interface ConditionContext {
  leadState: LeadState
}

type ConditionOutcome = 'continue' | 'skip' | 'stop'

export function evaluateCondition(
  config: ConditionConfig,
  ctx: ConditionContext
): ConditionOutcome {
  let fieldValue: string

  switch (config.field) {
    case 'lead.state':
      fieldValue = ctx.leadState
      break
    case 'lead.responded':
      fieldValue = String(
        ctx.leadState === 'responded' || ctx.leadState === 'revived'
      )
      break
    default:
      return config.ifFalse
  }

  const matches =
    config.operator === 'eq'
      ? fieldValue === config.value
      : fieldValue !== config.value

  return matches ? config.ifTrue : config.ifFalse
}
