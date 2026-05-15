import {
  pgTable, pgEnum, uuid, text, timestamp, integer,
  boolean, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ── Enums ──────────────────────────────────────────────────────────────────

export const leadStateEnum = pgEnum('lead_state', [
  'active', 'stale', 'orphaned',
  'revival_eligible',   // passed suppression check — queued for workflow enrollment
  'enrolled', 'responded',
  'revived', 'exhausted', 'converted', 'opted_out', 'dead',
])

export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound'])

export const messageStatusEnum = pgEnum('message_status', [
  'queued', 'sent', 'delivered', 'failed', 'received',
])

export const conversationStatusEnum = pgEnum('conversation_status', [
  'open', 'closed', 'opted_out',
])

export const enrollmentStatusEnum = pgEnum('enrollment_status', [
  'active', 'paused', 'completed', 'cancelled',
])

export const stepExecutionStatusEnum = pgEnum('step_execution_status', [
  'pending', 'executed', 'skipped', 'failed',
])

export const stepTypeEnum = pgEnum('step_type', ['send_sms', 'condition', 'assign'])

export const workflowTriggerTypeEnum = pgEnum('workflow_trigger_type', [
  'stale', 'orphaned', 'no_show', 'manual',
])

export const userRoleEnum = pgEnum('user_role', ['admin', 'manager', 'agent', 'dealer'])

// ── Step config types ──────────────────────────────────────────────────────
// Delay is embedded in each step: delayHours = how long to wait before running this step.

export type SendSmsConfig = {
  type: 'send_sms'
  /** Main template — supports {{firstName}}, {{lastName}}, {{vehicleOfInterest}}, {{dealershipName}} */
  template: string
  /** Used when an optional merge field (e.g. vehicleOfInterest) is missing */
  fallbackTemplate?: string
  delayHours?: number
  /**
   * Optional opt-out footer appended to every rendered body for this step.
   * Example: "Reply STOP to unsubscribe."
   * Required on at least one step when workflow.requiresOptOutLanguage = true.
   */
  optOutFooter?: string
}

export type ConditionConfig = {
  type: 'condition'
  field: 'lead.state' | 'lead.responded'
  operator: 'eq' | 'neq'
  value: string
  ifTrue: 'continue' | 'skip' | 'stop'
  ifFalse: 'continue' | 'skip' | 'stop'
}

export type AssignConfig = {
  type: 'assign'
  to: 'original_salesperson' | string // userId
  delayHours?: number
}

export type StepConfig = SendSmsConfig | ConditionConfig | AssignConfig

// ── Tables ─────────────────────────────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  settings: jsonb('settings')
    .$type<{
      staleThresholdDays?: number
      dealerPhone?:        string
      quietHours?: {
        enabled?:  boolean
        start?:    string   // "HH:mm" 24h local
        end?:      string   // "HH:mm" 24h local
        timezone?: string   // IANA, e.g. "America/Los_Angeles"
      }
    }>()
    .default({}),
  // Per-dealership kill switch. When true, no leads will be enrolled or texted.
  // Overrides SMS_LIVE_MODE at the tenant level.
  automationPaused: boolean('automation_paused').default(false).notNull(),

  // ── Phase 8: Live SMS readiness ───────────────────────────────────────────
  // Master live-send approval — must be set by DLR admin before any live sends.
  smsLiveApproved: boolean('sms_live_approved').default(false).notNull(),
  // 10DLC registration status: not_started | pending | approved | rejected | exempt | dev_override
  tenDlcStatus: text('ten_dlc_status').default('not_started').notNull(),
  // Primary outbound number for this tenant (denormalised for fast readiness checks).
  smsSendingNumber: text('sms_sending_number'),
  // Hard compliance block — no sends at all while true.
  complianceBlocked: boolean('compliance_blocked').default(false).notNull(),
  complianceBlockReason: text('compliance_block_reason'),
  // When true, every send requires an additional manual approval step.
  requiresManualApprovalBeforeSend: boolean('requires_manual_approval_before_send').default(false).notNull(),
  // Audit trail for when live sending was first enabled.
  liveActivatedAt: timestamp('live_activated_at', { withTimezone: true }),
  liveActivatedBy: text('live_activated_by'),

  // ── Phase 10: Telnyx / 10DLC detail ───────────────────────────────────────
  // TCR brand registration status: pending | approved | rejected | null
  brandStatus: text('brand_status'),
  // TCR campaign registration status: pending | approved | rejected | null
  campaignStatus: text('campaign_status'),
  // Telnyx messaging profile UUID (links number to messaging profile in Telnyx)
  messagingProfileId: text('messaging_profile_id'),
  // TCR campaign ID (e.g. CMP-xxxxxxxx)
  campaignId: text('campaign_id'),
  // Free-text notes about 10DLC status (e.g. vetting notes, appeal status)
  tenDlcStatusNotes: text('ten_dlc_status_notes'),
  // When 10DLC was approved / rejected
  tenDlcApprovedAt: timestamp('ten_dlc_approved_at', { withTimezone: true }),
  tenDlcRejectedAt: timestamp('ten_dlc_rejected_at', { withTimezone: true }),
  tenDlcRejectionReason: text('ten_dlc_rejection_reason'),

  // ── Phase 12: 10DLC submission + production readiness ──────────────────────
  // Business identity (TCR brand registration)
  businessLegalName:      text('business_legal_name'),
  ein:                    text('ein'),            // EIN/Tax ID — for submission only
  businessAddress:        text('business_address'),
  businessWebsite:        text('business_website'),
  // Compliance copy URLs (required for TCR + carrier submission)
  privacyPolicyUrl:       text('privacy_policy_url'),
  termsUrl:               text('terms_url'),
  smsTermsUrl:            text('sms_terms_url'),
  // TCR campaign fields
  brandUseCase:           text('brand_use_case'),
  campaignUseCase:        text('campaign_use_case'),
  // Sample messages stored for 10DLC submission (array of strings)
  tenDlcSampleMessages:   jsonb('ten_dlc_sample_messages').$type<string[]>(),
  // Volume + consent narrative
  expectedMonthlyVolume:  integer('expected_monthly_volume'),
  consentExplanation:     text('consent_explanation'),
  leadSourceExplanation:  text('lead_source_explanation'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: userRoleEnum('role').default('agent').notNull(),
  phone: text('phone'),                          // for SMS revival alerts
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── Dealer Invites ─────────────────────────────────────────────────────────────
// One-time tokens that allow a dealer user to create their own account.
// Generated by an admin, sent to the dealer, consumed on first sign-up.

export const dealerInvites = pgTable('dealer_invites', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  token:     text('token').notNull().unique(),
  email:     text('email'),          // optional pre-fill
  used:      boolean('used').default(false).notNull(),
  usedBy:    uuid('used_by'),        // user id after redemption
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  crmSource: text('crm_source').default('csv').notNull(),
  crmLeadId: text('crm_lead_id'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  vehicleOfInterest: text('vehicle_of_interest'),
  salespersonId: text('salesperson_id'),
  salespersonName: text('salesperson_name'),
  state: leadStateEnum('state').default('active').notNull(),
  staleAt: timestamp('stale_at'),
  lastCrmActivityAt: timestamp('last_crm_activity_at'),
  enrolledAt: timestamp('enrolled_at'),
  revivedAt: timestamp('revived_at'),
  lastAutomatedAt: timestamp('last_automated_at', { withTimezone: true }),              // set whenever automation sends a message
  lastCustomerReplyAt: timestamp('last_customer_reply_at', { withTimezone: true }),    // set on inbound message received
  lastHumanContactAt: timestamp('last_human_contact_at', { withTimezone: true }),      // set when a human (manager/agent) sends manually
  doNotAutomate: boolean('do_not_automate').default(false).notNull(), // hard block from all automation
  isTest: boolean('is_test').default(false).notNull(),       // marks fake/test contacts
  // Last suppression reason from eligibility agent. Cleared when lead becomes revival_eligible.
  suppressionReason: text('suppression_reason'),

  // ── Phase 10: Consent / source tracking ───────────────────────────────────
  // unknown | implied | explicit | revoked
  // 'revoked' is a hard block — treated the same as an opt-out at send time.
  // 'unknown' is a soft block — skipped with reason 'missing_consent'.
  consentStatus: text('consent_status').default('unknown').notNull(),
  // Who captured consent: 'crm_import' | 'web_form' | 'inbound_reply' | 'manual' | etc.
  consentSource: text('consent_source'),
  // When explicit consent was captured
  consentCapturedAt: timestamp('consent_captured_at', { withTimezone: true }),
  // Original date the lead first inquired (from CRM import or manual entry)
  originalInquiryAt: timestamp('original_inquiry_at', { withTimezone: true }),
  // Free-text compliance notes (e.g. "opted in via web form 2024-01-15")
  smsConsentNotes: text('sms_consent_notes'),
  // ── Reply classification (Phase 4) ────────────────────────────────────────
  // Set on every non-STOP inbound reply. lastCustomerReplyAt above doubles as lastReplyAt.
  lastReplyBody: text('last_reply_body'),                       // truncated body of most recent inbound
  replyClassification: text('reply_classification'),            // classified intent (see classify-reply.ts)
  replyClassificationReason: text('reply_classification_reason'), // matched keyword/rule for audit
  needsHumanHandoff: boolean('needs_human_handoff').default(false).notNull(), // warm lead — human action needed
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  tenantStateIdx: index('leads_tenant_state_idx').on(t.tenantId, t.state),
  phoneIdx: index('leads_phone_idx').on(t.phone),
  crmLeadIdx: index('leads_crm_lead_idx').on(t.tenantId, t.crmSource, t.crmLeadId),
}))

export const leadStateHistory = pgTable('lead_state_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id')
    .references(() => leads.id, { onDelete: 'cascade' })
    .notNull(),
  fromState: leadStateEnum('from_state'),
  toState: leadStateEnum('to_state').notNull(),
  reason: text('reason'),
  actor: text('actor').default('system').notNull(), // 'system' | 'user:{id}'
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  leadIdx: index('state_history_lead_idx').on(t.leadId),
}))

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  leadId: uuid('lead_id')
    .references(() => leads.id, { onDelete: 'cascade' })
    .notNull()
    .unique(), // one conversation per lead
  tenantPhone: text('tenant_phone').notNull(),
  leadPhone: text('lead_phone').notNull(),
  status: conversationStatusEnum('status').default('open').notNull(),
  revivedAlertSentAt: timestamp('revived_alert_sent_at'),   // dedup guard for manager alerts
  humanTookOverAt: timestamp('human_took_over_at'),          // set when a manager takes over
  takenOverBy: uuid('taken_over_by').references(() => users.id), // who took over
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('conversations_tenant_idx').on(t.tenantId, t.status),
}))

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' })
    .notNull(),
  direction: messageDirectionEnum('direction').notNull(),
  body: text('body').notNull(),
  mediaUrls: jsonb('media_urls').$type<string[]>().default([]),
  provider: text('provider').default('telnyx').notNull(),
  providerMessageId: text('provider_message_id'),
  status: messageStatusEnum('status').default('queued').notNull(),
  workflowStepId: uuid('workflow_step_id').references(() => workflowSteps.id),
  // Per-execution idempotency: one message row per step execution, enforced by unique index.
  // Null for manual inbox sends.
  stepExecutionId: uuid('step_execution_id').references(() => workflowStepExecutions.id),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  // Populated when the message was not sent (dry-run, sms_not_live, opted_out, etc.)
  skipReason: text('skip_reason'),
  skippedAt: timestamp('skipped_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  convIdx: index('messages_conv_idx').on(t.conversationId, t.createdAt),
  stepExecIdx: uniqueIndex('messages_step_execution_idx').on(t.stepExecutionId),
}))

export const messageStatusEvents = pgTable('message_status_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id')
    .references(() => messages.id, { onDelete: 'cascade' })
    .notNull(),
  providerMessageId: text('provider_message_id').notNull(),
  status: messageStatusEnum('status').notNull(),
  rawPayload: jsonb('raw_payload').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const optOuts = pgTable('opt_outs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  phone: text('phone').notNull(),
  source: text('source').default('inbound_stop').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantPhoneIdx: uniqueIndex('opt_outs_tenant_phone_idx').on(t.tenantId, t.phone),
}))

// ── SMS consent events ────────────────────────────────────────────────────────
// Append-only audit record of every web-form / API-captured SMS consent. Used
// to prove consent to carriers (10DLC) and in TCPA defense. Never updated or
// deleted — revocations are recorded as new rows (or as `optOuts` entries).
//
// `leadId` is nullable: the submission may come from a contact who is not yet
// (or never becomes) a lead. The full disclosure text and version are snapshot
// inline so we can prove what the user agreed to even if the page copy changes.
export const smsConsentEvents = pgTable('sms_consent_events', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id')
                         .references(() => tenants.id, { onDelete: 'cascade' })
                         .notNull(),
  leadId:              uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  phone:               text('phone').notNull(),         // E.164
  firstName:           text('first_name'),
  lastName:            text('last_name'),
  email:               text('email'),
  vehicleOfInterest:   text('vehicle_of_interest'),
  // Where the consent was captured: 'web_form' | 'intake' | 'api' | 'manual' | etc.
  source:              text('source').default('web_form').notNull(),
  // Version identifier for the disclosure text the user saw.
  consentTextVersion:  text('consent_text_version').notNull(),
  // Verbatim snapshot of the disclosure text the user agreed to.
  consentTextSnapshot: text('consent_text_snapshot').notNull(),
  // Network metadata for the submission.
  ipAddress:           text('ip_address'),
  userAgent:           text('user_agent'),
  // URL the form was submitted from (for multi-page hosting).
  pageUrl:             text('page_url'),
  // Free-text notes (e.g. "phone normalized from 18015551212").
  notes:               text('notes'),
  createdAt:           timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantPhoneIdx: index('sms_consent_events_tenant_phone_idx').on(t.tenantId, t.phone),
  createdIdx:     index('sms_consent_events_created_idx').on(t.createdAt),
}))

// ── Phase 10 types ────────────────────────────────────────────────────────────

/** Consent status for SMS outreach */
export type ConsentStatus = 'unknown' | 'implied' | 'explicit' | 'revoked'

// ── Phase 8 types ─────────────────────────────────────────────────────────────

export type TenDlcStatus =
  | 'not_started'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'exempt'
  | 'dev_override'

export type WorkflowActivationStatus =
  | 'draft'
  | 'preview_ready'
  | 'approved'
  | 'active'
  | 'paused'

export type WorkflowTriggerConfig = {
  daysInactive?: number
  cooldownDays?: number
  // Template library metadata (populated on isTemplate=true rows)
  intendedLeadSource?: string
  eligibilityNotes?: string
  stopConditions?: string[]
  handoffConditions?: string[]
  requiredMergeFields?: string[]
  optionalMergeFields?: string[]
  maxAttempts?: number
}

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: workflowTriggerTypeEnum('trigger_type').notNull(),
  triggerConfig: jsonb('trigger_config')
    .$type<WorkflowTriggerConfig>()
    .default({}),
  isActive: boolean('is_active').default(false).notNull(),
  /** Identifies a pre-built template — unique per tenant when set */
  key: text('key'),
  /** True for library templates that are not yet live */
  isTemplate: boolean('is_template').default(false).notNull(),

  /**
   * Age bucket this workflow handles, set during tenant provisioning.
   * null = not a bucket workflow (standard / manually-assigned).
   * 'a' = 14–29 days  'b' = 30–59 days  'c' = 60–89 days  'd' = 90+ days
   * Unique per tenant: only one workflow per bucket per tenant.
   */
  ageBucket: text('age_bucket'),

  // ── Phase 8: Workflow activation controls ─────────────────────────────────
  /** Human has reviewed and approved message copy for live sends */
  approvedForLive: boolean('approved_for_live').default(false).notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
  /** Message templates must include opt-out language (e.g. "Reply STOP") */
  requiresOptOutLanguage: boolean('requires_opt_out_language').default(true).notNull(),
  /** When true, a human must review the dry-run preview before activation */
  manualReviewRequired: boolean('manual_review_required').default(false).notNull(),
  /**
   * Fine-grained lifecycle state:
   * draft | preview_ready | approved | active | paused
   */
  activationStatus: text('activation_status').default('draft').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const workflowSteps = pgTable('workflow_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id')
    .references(() => workflows.id, { onDelete: 'cascade' })
    .notNull(),
  position: integer('position').notNull(),
  type: stepTypeEnum('type').notNull(),
  config: jsonb('config').$type<StepConfig>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  workflowPosIdx: index('steps_workflow_pos_idx').on(t.workflowId, t.position),
}))

export const workflowEnrollments = pgTable('workflow_enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id')
    .references(() => workflows.id)
    .notNull(),
  leadId: uuid('lead_id')
    .references(() => leads.id, { onDelete: 'cascade' })
    .notNull(),
  status: enrollmentStatusEnum('status').default('active').notNull(),
  currentStepPosition: integer('current_step_position').default(0).notNull(),
  enrolledAt: timestamp('enrolled_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  // Why and when the enrollment stopped (cancelled, completed, or stop-condition hit)
  stopReason: text('stop_reason'),
  stoppedAt: timestamp('stopped_at', { withTimezone: true }),
}, (t) => ({
  leadWorkflowIdx: index('enrollments_lead_workflow_idx').on(t.leadId, t.workflowId),
  statusIdx: index('enrollments_status_idx').on(t.status),
}))

export const workflowStepExecutions = pgTable('workflow_step_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  enrollmentId: uuid('enrollment_id')
    .references(() => workflowEnrollments.id, { onDelete: 'cascade' })
    .notNull(),
  stepId: uuid('step_id')
    .references(() => workflowSteps.id)
    .notNull(),
  status: stepExecutionStatusEnum('status').default('pending').notNull(),
  retryCount: integer('retry_count').default(0).notNull(),
  scheduledAt: timestamp('scheduled_at').notNull(),
  executedAt: timestamp('executed_at'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  enrollmentIdx: index('executions_enrollment_idx').on(t.enrollmentId),
}))

export const phoneNumbers = pgTable('phone_numbers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  number: text('number').notNull().unique(),
  provider: text('provider').default('telnyx').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── Phase 5: Handoff tasks ─────────────────────────────────────────────────
//
// Created whenever a warm/hot inbound reply (interested, appointment_request,
// callback_request, question) or a complaint (angry_or_complaint) is received.
//
// taskType:
//   'sales'      — warm/hot lead; human should continue the sales conversation
//   'escalation' — complaint or hostile reply; route to manager
//
// status lifecycle:
//   open → in_progress → resolved | dismissed
//
// Dedup: only one open/in_progress task per lead at a time.

export const handoffTasks = pgTable('handoff_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  leadId: uuid('lead_id')
    .references(() => leads.id, { onDelete: 'cascade' })
    .notNull(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'set null' }),
  classification: text('classification').notNull(),  // ReplyClassification value
  taskType: text('task_type').notNull().default('sales'), // 'sales' | 'escalation'
  priority: text('priority').notNull(),               // 'urgent' | 'high' | 'normal'
  customerMessage: text('customer_message').notNull(),
  recommendedNextAction: text('recommended_next_action').notNull(),
  recommendedReply: text('recommended_reply'),        // null for complaints
  status: text('status').notNull().default('open'),   // 'open' | 'in_progress' | 'resolved' | 'dismissed'
  assignedTo: uuid('assigned_to')
    .references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by')
    .references(() => users.id, { onDelete: 'set null' }),

  // ── Phase 5b: Automotive intelligence ───────────────────────────────────────
  // heat_score: 'hot' | 'warm' | null (null = no handoff / escalation only)
  heatScore: text('heat_score'),
  // sales_summary: short fact-only template-built string for the human agent
  salesSummary: text('sales_summary'),
  // automotive_signals: full AutomotiveSignals JSON for audit / future ML
  automotiveSignals: jsonb('automotive_signals'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  // Supports "find open tasks for lead" (dedup check) and "find all open tasks for tenant"
  leadStatusIdx: index('handoff_tasks_lead_status_idx').on(t.leadId, t.status),
  tenantStatusIdx: index('handoff_tasks_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
}))

// ── Relations ──────────────────────────────────────────────────────────────

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  leads: many(leads),
  conversations: many(conversations),
  workflows: many(workflows),
  phoneNumbers: many(phoneNumbers),
  optOuts: many(optOuts),
  intakes: many(dealerIntakes),
}))

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
}))

export const leadsRelations = relations(leads, ({ one, many }) => ({
  tenant: one(tenants, { fields: [leads.tenantId], references: [tenants.id] }),
  stateHistory: many(leadStateHistory),
  conversation: one(conversations, { fields: [leads.id], references: [conversations.leadId] }),
  enrollments: many(workflowEnrollments),
}))

export const leadStateHistoryRelations = relations(leadStateHistory, ({ one }) => ({
  lead: one(leads, { fields: [leadStateHistory.leadId], references: [leads.id] }),
}))

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  tenant: one(tenants, { fields: [conversations.tenantId], references: [tenants.id] }),
  lead: one(leads, { fields: [conversations.leadId], references: [leads.id] }),
  messages: many(messages),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  step: one(workflowSteps, {
    fields: [messages.workflowStepId],
    references: [workflowSteps.id],
  }),
  stepExecution: one(workflowStepExecutions, {
    fields: [messages.stepExecutionId],
    references: [workflowStepExecutions.id],
  }),
  statusEvents: many(messageStatusEvents),
}))

export const messageStatusEventsRelations = relations(messageStatusEvents, ({ one }) => ({
  message: one(messages, {
    fields: [messageStatusEvents.messageId],
    references: [messages.id],
  }),
}))

export const optOutsRelations = relations(optOuts, ({ one }) => ({
  tenant: one(tenants, { fields: [optOuts.tenantId], references: [tenants.id] }),
}))

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workflows.tenantId], references: [tenants.id] }),
  steps: many(workflowSteps),
  enrollments: many(workflowEnrollments),
}))

export const workflowStepsRelations = relations(workflowSteps, ({ one, many }) => ({
  workflow: one(workflows, { fields: [workflowSteps.workflowId], references: [workflows.id] }),
  executions: many(workflowStepExecutions),
}))

export const workflowEnrollmentsRelations = relations(workflowEnrollments, ({ one, many }) => ({
  workflow: one(workflows, {
    fields: [workflowEnrollments.workflowId],
    references: [workflows.id],
  }),
  lead: one(leads, { fields: [workflowEnrollments.leadId], references: [leads.id] }),
  stepExecutions: many(workflowStepExecutions),
}))

export const workflowStepExecutionsRelations = relations(workflowStepExecutions, ({ one, many }) => ({
  enrollment: one(workflowEnrollments, {
    fields: [workflowStepExecutions.enrollmentId],
    references: [workflowEnrollments.id],
  }),
  step: one(workflowSteps, {
    fields: [workflowStepExecutions.stepId],
    references: [workflowSteps.id],
  }),
  messages: many(messages),
}))

export const phoneNumbersRelations = relations(phoneNumbers, ({ one }) => ({
  tenant: one(tenants, { fields: [phoneNumbers.tenantId], references: [tenants.id] }),
}))

export const handoffTasksRelations = relations(handoffTasks, ({ one }) => ({
  tenant: one(tenants, { fields: [handoffTasks.tenantId], references: [tenants.id] }),
  lead: one(leads, { fields: [handoffTasks.leadId], references: [leads.id] }),
  conversation: one(conversations, { fields: [handoffTasks.conversationId], references: [conversations.id] }),
  assignee: one(users, { fields: [handoffTasks.assignedTo], references: [users.id] }),
  resolver: one(users, { fields: [handoffTasks.resolvedBy], references: [users.id] }),
}))

// ── Phase 9: Pilot Batches ─────────────────────────────────────────────────
//
// A pilot batch is a manually-curated, admin-approved set of leads that
// run through a specific workflow in a controlled manner.
//
// Status lifecycle:
//   draft → previewed → approved → sending → completed
//                                 ↘ paused  → sending (resumed)
//                                 ↘ cancelled
//
// HARD_PILOT_CAP is the absolute maximum batch size enforced in code.
// Per-batch max is stored in max_lead_count (≤ HARD_PILOT_CAP).

export const HARD_PILOT_CAP  = 50 // absolute maximum batch size
export const FIRST_PILOT_CAP = 5  // max leads for the first live pilot

// ── Lead-age classification ────────────────────────────────────────────────────

/** Minimum days since first contact before DLR will reach out. */
export const LEAD_HOLD_DAYS = 14

/** Four age buckets used to auto-assign leads to pre-configured workflows. */
export type AgeBucket = 'a' | 'b' | 'c' | 'd'

/**
 * Operator-facing bucket labels. These intentionally diverge from
 * AGE_BUCKET_RANGES for bucket A: the displayed window reads as
 * 0–29 days so the four buckets line up as clean 30-day windows in
 * the UI. Leads under LEAD_HOLD_DAYS are still held (not bucket-eligible)
 * by the classifier — see AGE_BUCKET_RANGES below for the true threshold.
 */
export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  a: '0–29 days',
  b: '30–59 days',
  c: '60–89 days',
  d: '90+ days',
}

export const AGE_BUCKET_RANGES: Record<AgeBucket, { minDays: number; maxDays: number | null }> = {
  a: { minDays: 14, maxDays: 29 },
  b: { minDays: 30, maxDays: 59 },
  c: { minDays: 60, maxDays: 89 },
  d: { minDays: 90, maxDays: null },
}

/**
 * How a lead was classified during import.
 * Stored on pilotLeadImports.ageClassification.
 */
export type LeadAgeClassification =
  | 'too_fresh'    // < 14 days — held until enrollAfter date
  | 'bucket_a'     // 14–29 days
  | 'bucket_b'     // 30–59 days
  | 'bucket_c'     // 60–89 days
  | 'bucket_d'     // 90+ days
  | 'needs_review' // contactDate missing or unparseable

export type FirstPilotState =
  | 'not_started'
  | 'ready_for_smoke_test'
  | 'smoke_test_sending'
  | 'smoke_test_passed'
  | 'smoke_test_failed'
  | 'ready_for_remaining'
  | 'remaining_sending'
  | 'completed'
  | 'paused'
  | 'cancelled'

export type PilotBatchStatus =
  | 'draft'
  | 'previewed'
  | 'approved'
  | 'sending'
  | 'paused'
  | 'completed'
  | 'cancelled'

export type PilotLeadSendStatus = 'pending' | 'sent' | 'skipped' | 'cancelled'

export type PilotEligibilityResult = {
  eligible: boolean
  reason?: string
  checks: Array<{ id: string; passed: boolean; detail: string }>
}

export type PilotPreviewMessage = {
  position: number
  type: 'send_sms' | 'condition'
  rendered: string | null
  usedFallback: boolean
  delayHours: number
  label: string
}

export type PilotDryRunSummary = {
  generatedAt: string
  eligibleCount: number
  ineligibleCount: number
  leads: Array<{
    leadId: string
    firstName: string
    lastName: string
    eligible: boolean
    skipReason?: string
    messages: PilotPreviewMessage[]
  }>
}

// ── Phase 13: Live pilot execution types ──────────────────────────────────────

/** The exact phrase the admin must type to confirm the live pilot */
export const REQUIRED_CONFIRMATION_PHRASE = 'SEND FIRST PILOT'

/** All four confirmation checkboxes must be true before the smoke test can start */
export type PilotConfirmationChecks = {
  tenDlcApproved: boolean
  messageReviewed: boolean
  optOutTested: boolean
  emergencyControlsUnderstood: boolean
}

export type PilotReportLead = {
  leadId: string
  firstName: string
  lastName: string
  phone: string
  sendStatus: string
  skipReason?: string | null
  enrollmentId?: string | null
  renderedMessages: PilotPreviewMessage[]
  sentMessages: Array<{
    body: string
    sentAt: string | null
    providerMessageId: string | null
    status: string
    deliveredAt: string | null
  }>
  replyClassification?: string | null
  replyBody?: string | null
  optedOut: boolean
  handoffTaskId?: string | null
  complaint: boolean
}

export type PilotReportEvent = {
  at: string
  type:
    | 'sent'
    | 'delivered'
    | 'failed'
    | 'reply'
    | 'opt_out'
    | 'complaint'
    | 'handoff'
    | 'smoke_test_passed'
    | 'paused'
    | 'cancelled'
  leadId?: string | null
  detail: string
}

export type PilotReport = {
  generatedAt: string
  batchId: string
  tenantId: string
  tenantName: string
  workflowName: string
  totalLeads: number
  leads: PilotReportLead[]
  sentCount: number
  skippedCount: number
  failedCount: number
  replyCount: number
  optOutCount: number
  complaintCount: number
  handoffCount: number
  timeline: PilotReportEvent[]
  recommendation: 'expand' | 'repeat' | 'pause' | 'fix_issues'
  recommendationReason: string
}

export const pilotBatches = pgTable('pilot_batches', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  workflowId:     uuid('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
  status:         text('status').default('draft').notNull(),
  maxLeadCount:   integer('max_lead_count').default(10).notNull(),
  createdBy:      text('created_by').notNull(),
  approvedBy:     text('approved_by'),
  approvedAt:     timestamp('approved_at', { withTimezone: true }),
  startedAt:      timestamp('started_at', { withTimezone: true }),
  completedAt:    timestamp('completed_at', { withTimezone: true }),
  cancelledAt:    timestamp('cancelled_at', { withTimezone: true }),
  cancelReason:   text('cancel_reason'),
  dryRunSummary:  jsonb('dry_run_summary').$type<PilotDryRunSummary>(),
  liveSendCount:  integer('live_send_count').default(0).notNull(),
  blockedCount:   integer('blocked_count').default(0).notNull(),
  replyCount:     integer('reply_count').default(0).notNull(),
  handoffCount:   integer('handoff_count').default(0).notNull(),

  // ── Phase 11: First Live Pilot ─────────────────────────────────────────────
  /** True when this batch is the first live pilot (max FIRST_PILOT_CAP leads) */
  isFirstPilot:             boolean('is_first_pilot').default(false).notNull(),
  /** Smoke-test / remaining-sends state machine */
  firstPilotState:          text('first_pilot_state').default('not_started').notNull(),
  /** Which pilot_batch_lead was the smoke-test subject */
  // FK to pilot_batch_leads.id exists in DB migration (0010); omit here to avoid circular schema reference
  smokeTestLeadId:          uuid('smoke_test_lead_id'),
  smokeTestSentAt:          timestamp('smoke_test_sent_at', { withTimezone: true }),
  smokeTestPassedAt:        timestamp('smoke_test_passed_at', { withTimezone: true }),
  smokeTestFailedAt:        timestamp('smoke_test_failed_at', { withTimezone: true }),
  smokeTestFailReason:      text('smoke_test_fail_reason'),
  remainingStartedAt:       timestamp('remaining_started_at', { withTimezone: true }),
  /** Set when a STOP or escalation occurs — blocks further sends until confirmed */
  continuationRequired:     boolean('continuation_required').default(false).notNull(),
  continuationReason:       text('continuation_reason'),
  continuationConfirmedBy:  text('continuation_confirmed_by'),
  continuationConfirmedAt:  timestamp('continuation_confirmed_at', { withTimezone: true }),
  /** Set by verifySmokeTest */
  auditRowVerified:         boolean('audit_row_verified').default(false).notNull(),
  providerIdVerified:       boolean('provider_id_verified').default(false).notNull(),

  // ── Phase 13: Live pilot confirmation gate ────────────────────────────────
  /** Admin must type REQUIRED_CONFIRMATION_PHRASE exactly to unlock smoke test */
  confirmationPhrase:       text('confirmation_phrase'),
  /** All four checkboxes must be checked before smoke test can begin */
  confirmationChecks:       jsonb('confirmation_checks').$type<PilotConfirmationChecks>(),
  /** Who submitted the confirmation (userId or email) */
  confirmedBy:              text('confirmed_by'),
  /** When confirmation was submitted */
  confirmedAt:              timestamp('confirmed_at', { withTimezone: true }),
  /** Final pilot report — generated after completion or on demand */
  pilotReport:              jsonb('pilot_report').$type<PilotReport>(),

  createdAt:      timestamp('created_at').defaultNow().notNull(),
  updatedAt:      timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  tenantStatusIdx:   index('pilot_batches_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
  firstPilotIdx:     index('pilot_batches_first_pilot_idx').on(t.isFirstPilot, t.firstPilotState),
}))

export const pilotBatchLeads = pgTable('pilot_batch_leads', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  batchId:             uuid('batch_id').references(() => pilotBatches.id, { onDelete: 'cascade' }).notNull(),
  leadId:              uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }).notNull(),
  eligibilityResult:   jsonb('eligibility_result').$type<PilotEligibilityResult>(),
  previewMessages:     jsonb('preview_messages').$type<PilotPreviewMessage[]>(),
  approvedForSend:     boolean('approved_for_send').default(false).notNull(),
  sendStatus:          text('send_status').default('pending').notNull(),
  skipReason:          text('skip_reason'),
  replyClassification: text('reply_classification'),
  handoffTaskId:       uuid('handoff_task_id').references(() => handoffTasks.id, { onDelete: 'set null' }),
  enrollmentId:        uuid('enrollment_id').references(() => workflowEnrollments.id, { onDelete: 'set null' }),
  createdAt:           timestamp('created_at').defaultNow().notNull(),
  updatedAt:           timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  batchStatusIdx:  index('pilot_batch_leads_batch_idx').on(t.batchId, t.sendStatus),
  leadIdx:         index('pilot_batch_leads_lead_idx').on(t.leadId),
  batchLeadUnique: uniqueIndex('pilot_batch_leads_unique').on(t.batchId, t.leadId),
}))

// ── Pilot Relations ───────────────────────────────────────────────────────────

export const pilotBatchesRelations = relations(pilotBatches, ({ one, many }) => ({
  tenant:   one(tenants,   { fields: [pilotBatches.tenantId],   references: [tenants.id] }),
  workflow: one(workflows, { fields: [pilotBatches.workflowId], references: [workflows.id] }),
  leads:    many(pilotBatchLeads),
}))

export const pilotBatchLeadsRelations = relations(pilotBatchLeads, ({ one }) => ({
  batch:       one(pilotBatches,         { fields: [pilotBatchLeads.batchId],      references: [pilotBatches.id] }),
  lead:        one(leads,                { fields: [pilotBatchLeads.leadId],        references: [leads.id] }),
  handoffTask: one(handoffTasks,         { fields: [pilotBatchLeads.handoffTaskId], references: [handoffTasks.id] }),
  enrollment:  one(workflowEnrollments,  { fields: [pilotBatchLeads.enrollmentId],  references: [workflowEnrollments.id] }),
}))

// ── Phase 14: Pilot Lead Imports ───────────────────────────────────────────────
//
// A staging table for leads being considered for the first pilot batch.
// Leads are validated (phone normalization, dedup, consent, opt-out) here
// before being promoted to the leads table on batch creation.
// No enrollments or SMS sends occur at import time.

export type PilotLeadImportStatus =
  | 'pending'       // not yet validated
  | 'eligible'      // all checks passed
  | 'blocked'       // hard block — cannot be selected
  | 'warning'       // soft issue — can be selected but admin is warned
  | 'selected'      // admin has checked this lead for the pilot
  | 'excluded'      // admin explicitly removed this row
  | 'held'          // too fresh (< 14 days) — eligible after enrollAfter date
  | 'needs_review'  // contactDate missing or unparseable — operator must resolve

/** Generated on-demand from pilot_lead_imports for the pre-approval review. */
export type PilotImportDryRunReport = {
  generatedAt:      string
  tenantId:         string
  totalImported:    number
  selectedCount:    number
  eligibleCount:    number
  warningCount:     number
  blockedCount:     number
  reviewedCount:    number
  consentCoverage:  Record<string, number>   // explicit | implied | unknown | revoked → count
  duplicateCount:   number
  fallbackCount:    number                   // leads that will use fallback copy
  leads: Array<{
    importId:       string
    firstName:      string
    lastName:       string
    phone:          string | null
    consentStatus:  string
    importStatus:   string
    selected:       boolean
    reviewed:       boolean
    isDuplicate:    boolean
    hasFallback:    boolean
    blockedReasons: string[]
    warnings:       string[]
    firstMessage:   string | null           // rendered first step body
  }>
  recommendation:       'ready' | 'fix_warnings' | 'blocked'
  recommendationReason: string
}

export const pilotLeadImports = pgTable('pilot_lead_imports', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),

  // Raw input
  firstName:            text('first_name').notNull(),
  lastName:             text('last_name').notNull(),
  phoneRaw:             text('phone_raw').notNull(),
  phone:                text('phone'),                // E.164 normalized; null if invalid
  email:                text('email'),
  vehicleOfInterest:    text('vehicle_of_interest'),
  leadSource:           text('lead_source'),
  originalInquiryAt:    timestamp('original_inquiry_at', { withTimezone: true }),

  // ── Phase 16: Age-based auto-classification ──────────────────────────────
  /**
   * Canonical "day 1" date — the dealership's first contact with this lead.
   * Parsed from the CSV (accepts contactDate, firstContact, originalInquiryAt, etc.).
   * Used to compute leadAgeDays and ageBucket.
   */
  contactDate:          timestamp('contact_date', { withTimezone: true }),
  /** Days between contactDate and import date. Null if contactDate is missing. */
  leadAgeDays:          integer('lead_age_days'),
  /**
   * Age bucket assigned at import time.
   * null = not yet classified, or held/needs_review.
   * 'a' = 14–29d  'b' = 30–59d  'c' = 60–89d  'd' = 90+d
   */
  ageBucket:            text('age_bucket'),
  /** For held leads: the date they become eligible (contactDate + LEAD_HOLD_DAYS). */
  enrollAfter:          timestamp('enroll_after', { withTimezone: true }),
  /** Workflow auto-assigned based on ageBucket. Null if bucket workflow not found. */
  assignedWorkflowId:   uuid('assigned_workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
  // ─────────────────────────────────────────────────────────────────────────

  consentStatus:        text('consent_status').default('unknown').notNull(),
  consentSource:        text('consent_source'),
  consentCapturedAt:    timestamp('consent_captured_at', { withTimezone: true }),
  smsConsentNotes:      text('sms_consent_notes'),
  crmSource:            text('crm_source').default('manual'),
  externalId:           text('external_id'),
  notes:                text('notes'),

  // Validation results
  importStatus:         text('import_status').default('pending').notNull(),
  blockedReasons:       jsonb('blocked_reasons').$type<string[]>(),
  warnings:             jsonb('warnings').$type<string[]>(),

  // Dedup links
  duplicateOfLeadId:    uuid('duplicate_of_lead_id'),  // existing leads.id with same phone/email
  duplicateOfImportId:  uuid('duplicate_of_import_id'), // earlier row in same import session

  // Promoted lead (set on batch creation)
  leadId:               uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),

  // Selection
  selectedForBatch:     boolean('selected_for_batch').default(false).notNull(),

  // Preview data
  previewMessages:      jsonb('preview_messages').$type<PilotPreviewMessage[]>(),
  eligibilityResult:    jsonb('eligibility_result').$type<PilotEligibilityResult>(),

  // Session tracking
  importedBy:           text('imported_by'),
  importedAt:           timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),

  // Phase 15: Review tracking
  reviewed:             boolean('reviewed').default(false).notNull(),
  reviewedAt:           timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy:           text('reviewed_by'),

  createdAt:            timestamp('created_at').defaultNow().notNull(),
  updatedAt:            timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  tenantStatusIdx: index('pilot_lead_imports_tenant_idx').on(t.tenantId, t.importStatus, t.createdAt),
  phoneIdx:        index('pilot_lead_imports_phone_idx').on(t.tenantId, t.phone),
  bucketIdx:       index('pilot_lead_imports_bucket_idx').on(t.tenantId, t.ageBucket, t.importStatus),
  enrollAfterIdx:  index('pilot_lead_imports_enroll_after_idx').on(t.enrollAfter, t.importStatus),
}))

export const pilotLeadImportsRelations = relations(pilotLeadImports, ({ one }) => ({
  tenant: one(tenants, { fields: [pilotLeadImports.tenantId], references: [tenants.id] }),
  lead:   one(leads,   { fields: [pilotLeadImports.leadId],   references: [leads.id] }),
}))

// ── Dealer Intakes ─────────────────────────────────────────────────────────────
//
// Pre-tenant intake record created when a dealership is closed.
// A unique token links to a public form the dealer fills out.
// Once complete, admin provisions tenant/user from this record in one click.
//
// Launch status lifecycle:
//   submitted → info_complete (computed) → 10dlc_pending → 10dlc_approved
//              → provisioned → pilot_ready → live

export type DealerIntakeLaunchStatus =
  | 'submitted'
  | 'info_complete'
  | '10dlc_pending'
  | '10dlc_approved'
  | 'provisioned'
  | 'pilot_ready'
  | 'live'

export const dealerIntakes = pgTable('dealer_intakes', {
  id:    uuid('id').primaryKey().defaultRandom(),
  // Random URL-safe token — forms the public intake URL /intake/[token]
  token: text('token').notNull(),

  // Set once provisionTenant() runs
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),

  launchStatus: text('launch_status').default('submitted').notNull(),

  // ── Section 1: Business identity (maps to tenants 10DLC fields) ──────────
  // Display/rooftop name shown in the DLR app (e.g. "Smith Honda")
  dealershipName:    text('dealership_name'),
  // IRS-registered legal entity name (e.g. "Smith Automotive Group LLC")
  businessLegalName: text('business_legal_name'),
  ein:               text('ein'),
  businessWebsite:   text('business_website'),
  businessAddress:   text('business_address'),

  // ── Section 2: Contacts ───────────────────────────────────────────────────
  primaryContactName:  text('primary_contact_name'),
  primaryContactEmail: text('primary_contact_email'),
  primaryContactPhone: text('primary_contact_phone'),
  salesManagerName:    text('sales_manager_name'),
  alertEmail:          text('alert_email'),
  alertPhone:          text('alert_phone'), // manager mobile — required for launch

  // ── Section 3: Operations ─────────────────────────────────────────────────
  storePhone:    text('store_phone'),
  timezone:      text('timezone'),
  businessHours: text('business_hours'),
  crmSystem:     text('crm_system'),

  // ── Section 4: Compliance (verbatim copy for TCR campaign submission) ─────
  leadSourceExplanation: text('lead_source_explanation'),
  consentExplanation:    text('consent_explanation'),
  expectedMonthlyVolume: integer('expected_monthly_volume'),

  // ── Section 5: Campaign setup ─────────────────────────────────────────────
  preferredWorkflowTypes: jsonb('preferred_workflow_types').$type<string[]>(),
  sampleMessage1:         text('sample_message_1'),
  sampleMessage2:         text('sample_message_2'),

  // ── Section 6: Agreements ─────────────────────────────────────────────────
  approvedSenderName:   text('approved_sender_name'),
  templateReviewAgreed: boolean('template_review_agreed').default(false).notNull(),
  complianceAgreed:     boolean('compliance_agreed').default(false).notNull(),

  // ── Admin ─────────────────────────────────────────────────────────────────
  adminNotes:    text('admin_notes'),
  submittedAt:   timestamp('submitted_at', { withTimezone: true }),
  provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
  provisionedBy: text('provisioned_by'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  tokenIdx:  uniqueIndex('dealer_intakes_token_idx').on(t.token),
  statusIdx: index('dealer_intakes_status_idx').on(t.launchStatus, t.createdAt),
}))

export const dealerIntakesRelations = relations(dealerIntakes, ({ one }) => ({
  tenant: one(tenants, { fields: [dealerIntakes.tenantId], references: [tenants.id] }),
}))

// ── Phase 16: Pilot Data Pack + 10DLC Waiting Room ────────────────────────────

/**
 * Overall waiting-room status for the 10DLC/Telnyx approval process.
 * Computed from tenant fields + pilot import state.
 */
export type TenDLCWaitingStatus =
  | 'waiting_on_10dlc'       // still pending approval but everything else is ready
  | 'missing_tenant_info'    // brand registration fields are incomplete
  | 'missing_consent_data'   // selected leads lack consent documentation
  | 'pilot_batch_not_ready'  // no selected leads or no batch created yet
  | 'ready_when_approved'    // all systems go — only waiting on 10DLC approval
  | 'ready_for_live_pilot'   // 10DLC approved, compliance clear, ready to fire

/** Score breakdown by category (sum = 100). */
export type ReadinessBreakdown = {
  leadDataCompleteness: number  // 0–15  first name, phone, valid E.164
  consentCoverage:      number  // 0–20  explicit > implied > unknown
  previewCompleteness:  number  // 0–15  rendered previews present
  noBlockers:           number  // 0–15  0 blocked + 0 warning leads
  workflowApproval:     number  // 0–10  workflow approvedForLive
  tenDlcReadiness:      number  // 0–15  registration tier
  complianceHealth:     number  // 0–10  no compliance blocks
}

/**
 * Pilot readiness score: 0–100 derived from DB state.
 * Does NOT require any live sends or batch approval changes.
 */
export type PilotReadinessScore = {
  score:                number
  status:               'not_started' | 'in_progress' | 'needs_attention' | 'ready'
  blockers:             string[]
  warnings:             string[]
  recommendedNextAction: string
  breakdown:            ReadinessBreakdown
}
