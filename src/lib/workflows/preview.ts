/**
 * Workflow Message Preview & Merge Field Renderer
 *
 * Renders a step template string against a lead + tenant context, applying
 * fallback copy when optional merge fields are absent. Returns the rendered
 * message plus a per-field status map so callers can surface warnings in the UI.
 *
 * Usage:
 *   const result = renderTemplate(config, lead, tenantName)
 *   // result.rendered   — final message string (safe to display/preview)
 *   // result.usedFallback — true if fallbackTemplate was used
 *   // result.fields     — { firstName: 'resolved', vehicleOfInterest: 'missing', ... }
 *   // result.valid      — false if any REQUIRED field is missing
 *
 * IMPORTANT: This module is preview-only. It never sends messages.
 * All actual sends go through the executor + send guard pipeline.
 */

import type { SendSmsConfig } from '@/lib/db/schema'

// ── Types ──────────────────────────────────────────────────────────────────────

export type MergeContext = {
  firstName?: string | null
  lastName?: string | null
  dealershipName?: string | null
  vehicleOfInterest?: string | null
  salespersonName?: string | null
}

export type FieldStatus = 'resolved' | 'missing' | 'fallback_used'

export type RenderResult = {
  /** The final rendered message string — safe for display */
  rendered: string
  /** True if the fallbackTemplate was used instead of the main template */
  usedFallback: boolean
  /** Per-field resolution status */
  fields: Record<string, FieldStatus>
  /** False if a required field could not be resolved */
  valid: boolean
  /** List of required field names that were missing */
  missingRequired: string[]
}

// Fields that must be present for any send to be valid
const ALWAYS_REQUIRED: (keyof MergeContext)[] = ['firstName', 'dealershipName']

// Fields that are optional — their absence triggers fallback template usage
const OPTIONAL_FIELDS: (keyof MergeContext)[] = [
  'vehicleOfInterest',
  'salespersonName',
  'lastName',
]

// ── Core renderer ──────────────────────────────────────────────────────────────

/**
 * Substitute {{field}} placeholders with values from context.
 * Returns the substituted string and a map of which fields resolved.
 */
function substitute(
  template: string,
  context: MergeContext
): { text: string; fields: Record<string, FieldStatus> } {
  const fields: Record<string, FieldStatus> = {}

  const text = template.replace(/\{\{(\w+)\}\}/g, (match, fieldName) => {
    const value = context[fieldName as keyof MergeContext]
    if (value) {
      fields[fieldName] = 'resolved'
      return value
    }
    fields[fieldName] = 'missing'
    return match // leave placeholder visible in failed renders
  })

  return { text, fields }
}

/**
 * Render a SendSmsConfig template against a lead/tenant context.
 *
 * Strategy:
 *   1. Try the main template.
 *   2. If any optional field is missing AND a fallbackTemplate exists, use it.
 *   3. If required fields are still missing after substitution, mark invalid.
 */
export function renderTemplate(
  config: SendSmsConfig,
  context: MergeContext
): RenderResult {
  // Determine which optional fields are missing
  const missingOptional = OPTIONAL_FIELDS.filter((f) => !context[f])

  // Decide which template string to use
  const needsFallback = missingOptional.length > 0 && !!config.fallbackTemplate
  const templateStr = needsFallback ? config.fallbackTemplate! : config.template

  const { text, fields } = substitute(templateStr, context)

  // Check required fields
  const missingRequired = ALWAYS_REQUIRED.filter((f) => {
    const val = context[f]
    return !val
  })

  // Mark optional fields that triggered fallback
  for (const f of missingOptional) {
    if (!(f in fields)) {
      fields[f] = needsFallback ? 'fallback_used' : 'missing'
    }
  }

  // Append opt-out footer if configured — the preview must show exactly what
  // will be sent, so the footer is included here, not added at send time.
  const rendered = config.optOutFooter ? `${text}\n\n${config.optOutFooter}` : text

  return {
    rendered,
    usedFallback: needsFallback,
    fields,
    valid: missingRequired.length === 0,
    missingRequired,
  }
}

// ── Workflow preview ───────────────────────────────────────────────────────────

export type StepPreview = {
  position: number
  type: 'send_sms' | 'condition'
  delayHours: number
  rendered: string | null    // null for condition steps
  usedFallback: boolean
  valid: boolean
  missingRequired: string[]
  fields: Record<string, FieldStatus>
  label: string              // human description of this step
}

/**
 * Preview all send_sms steps in a workflow template against a sample lead.
 * Condition steps are included as metadata (no rendering needed).
 */
export function previewWorkflow(
  steps: Array<{
    position: number
    type: string
    config: SendSmsConfig | { type: 'condition' | 'assign'; [key: string]: unknown }
  }>,
  context: MergeContext
): StepPreview[] {
  return steps.map((step) => {
    if (step.type === 'send_sms') {
      const config = step.config as SendSmsConfig
      const result = renderTemplate(config, context)
      return {
        position: step.position,
        type: 'send_sms',
        delayHours: config.delayHours ?? 0,
        rendered: result.rendered,
        usedFallback: result.usedFallback,
        valid: result.valid,
        missingRequired: result.missingRequired,
        fields: result.fields,
        label: stepLabel(step.position, config.delayHours ?? 0),
      }
    }
    // Condition step
    return {
      position: step.position,
      type: 'condition',
      delayHours: 0,
      rendered: null,
      usedFallback: false,
      valid: true,
      missingRequired: [],
      fields: {},
      label: '— Stop if lead has replied —',
    }
  })
}

function stepLabel(position: number, delayHours: number): string {
  if (delayHours === 0) return `Step ${position} — send immediately`
  if (delayHours < 24)  return `Step ${position} — send after ${delayHours}h`
  const days = Math.round(delayHours / 24)
  return `Step ${position} — send after ${days} day${days !== 1 ? 's' : ''}`
}

// ── Required field validator ───────────────────────────────────────────────────

/**
 * Validate that a context object satisfies the required merge fields for a
 * given template. Returns a map of field → 'ok' | 'missing'.
 */
export function validateMergeFields(
  requiredFields: string[],
  context: MergeContext
): { valid: boolean; fieldStatus: Record<string, 'ok' | 'missing'> } {
  const fieldStatus: Record<string, 'ok' | 'missing'> = {}
  let valid = true

  for (const field of requiredFields) {
    const val = context[field as keyof MergeContext]
    if (val) {
      fieldStatus[field] = 'ok'
    } else {
      fieldStatus[field] = 'missing'
      valid = false
    }
  }

  return { valid, fieldStatus }
}
