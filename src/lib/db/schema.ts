import {
  pgTable, pgEnum, uuid, text, timestamp, integer,
  boolean, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ── Enums ──────────────────────────────────────────────────────────────────

export const leadStateEnum = pgEnum('lead_state', [
  'active', 'stale', 'orphaned', 'enrolled', 'responded',
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

export const userRoleEnum = pgEnum('user_role', ['admin', 'manager', 'agent'])

// ── Step config types ──────────────────────────────────────────────────────
// Delay is embedded in each step: delayHours = how long to wait before running this step.

export type SendSmsConfig = {
  type: 'send_sms'
  template: string  // supports {{firstName}}, {{lastName}}, {{vehicleOfInterest}}, {{dealershipName}}
  delayHours?: number
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
    .$type<{ staleThresholdDays?: number; dealerPhone?: string }>()
    .default({}),
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
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  convIdx: index('messages_conv_idx').on(t.conversationId, t.createdAt),
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

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: workflowTriggerTypeEnum('trigger_type').notNull(),
  triggerConfig: jsonb('trigger_config')
    .$type<{ daysInactive?: number }>()
    .default({}),
  isActive: boolean('is_active').default(true).notNull(),
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

// ── Relations ──────────────────────────────────────────────────────────────

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  leads: many(leads),
  conversations: many(conversations),
  workflows: many(workflows),
  phoneNumbers: many(phoneNumbers),
  optOuts: many(optOuts),
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

export const workflowStepExecutionsRelations = relations(workflowStepExecutions, ({ one }) => ({
  enrollment: one(workflowEnrollments, {
    fields: [workflowStepExecutions.enrollmentId],
    references: [workflowEnrollments.id],
  }),
  step: one(workflowSteps, {
    fields: [workflowStepExecutions.stepId],
    references: [workflowSteps.id],
  }),
}))

export const phoneNumbersRelations = relations(phoneNumbers, ({ one }) => ({
  tenant: one(tenants, { fields: [phoneNumbers.tenantId], references: [tenants.id] }),
}))
