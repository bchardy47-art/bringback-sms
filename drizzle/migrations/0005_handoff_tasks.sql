-- Phase 5: Handoff tasks
--
-- Created whenever a warm/hot inbound reply or complaint is received.
-- One open/in_progress task per lead at a time (enforced in application layer).
--
-- taskType:
--   'sales'      — warm/hot lead (interested, appointment_request, callback_request, question)
--   'escalation' — complaint or hostile reply (angry_or_complaint)
--
-- priority: 'urgent' | 'high' | 'normal'
-- status: 'open' → 'in_progress' → 'resolved' | 'dismissed'

CREATE TABLE IF NOT EXISTS handoff_tasks (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id                  uuid        NOT NULL REFERENCES leads(id)   ON DELETE CASCADE,
  conversation_id          uuid        REFERENCES conversations(id)    ON DELETE SET NULL,
  classification           text        NOT NULL,
  task_type                text        NOT NULL DEFAULT 'sales',
  priority                 text        NOT NULL,
  customer_message         text        NOT NULL,
  recommended_next_action  text        NOT NULL,
  recommended_reply        text,
  status                   text        NOT NULL DEFAULT 'open',
  assigned_to              uuid        REFERENCES users(id) ON DELETE SET NULL,
  resolved_at              timestamptz,
  resolved_by              uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamp   NOT NULL DEFAULT now(),
  updated_at               timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS handoff_tasks_lead_status_idx   ON handoff_tasks(lead_id, status);
CREATE INDEX IF NOT EXISTS handoff_tasks_tenant_status_idx ON handoff_tasks(tenant_id, status, created_at);
