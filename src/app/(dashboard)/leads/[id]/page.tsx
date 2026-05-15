import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm' // 'and' used in lead query with relations
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { leads, workflows } from '@/lib/db/schema'
import { LeadStateHistory } from '@/components/leads/LeadStateHistory'
import { EnrollLeadButton } from '@/components/leads/EnrollLeadButton'
import { ConversationPreview } from '@/components/leads/ConversationPreview'
import { VehicleEditField } from '@/components/leads/VehicleEditField'

const STATE_LABELS: Record<string, string> = {
  active:    'Active',
  stale:     'Stale',
  orphaned:  'Orphaned',
  enrolled:  'Enrolled',
  responded: 'Responded',
  revived:   'Revived',
  exhausted: 'Exhausted',
  converted: 'Converted',
  opted_out: 'Opted out',
  dead:      'Dead',
}

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, params.id), eq(leads.tenantId, session.user.tenantId)),
    with: {
      stateHistory: { orderBy: (h, { desc }) => [desc(h.createdAt)] },
      conversation: {
        with: { messages: { orderBy: (m, { asc }) => [asc(m.createdAt)] } },
      },
      enrollments: {
        with: { workflow: { with: { steps: true } } },
        orderBy: (e, { desc }) => [desc(e.enrolledAt)],
      },
    },
  })

  if (!lead) notFound()

  // Workflows available for manual enrollment
  const availableWorkflows = await db.query.workflows.findMany({
    where: eq(workflows.tenantId, session.user.tenantId),
  })

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <Link href="/leads" className="text-sm text-gray-400 hover:text-gray-600">
          ← Leads
        </Link>
      </div>

      {/* Opt-out suppression banner */}
      {lead.state === 'opted_out' && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">Messaging suppressed.</span>
          This lead has opted out. No further SMS will be sent.
        </div>
      )}

      {/* Lead header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {lead.firstName} {lead.lastName}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{lead.phone}</p>
        </div>
        <span className={`mt-1 inline-flex px-3 py-1 rounded-full text-xs font-medium
          ${lead.state === 'responded' || lead.state === 'revived' ? 'bg-green-100 text-green-800' :
            lead.state === 'enrolled' ? 'bg-blue-100 text-blue-800' :
            lead.state === 'stale' || lead.state === 'orphaned' ? 'bg-yellow-100 text-yellow-800' :
            lead.state === 'opted_out' || lead.state === 'dead' ? 'bg-gray-200 text-gray-500' :
            'bg-gray-100 text-gray-700'}`}
        >
          {STATE_LABELS[lead.state] ?? lead.state}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: lead info */}
        <div className="lg:col-span-1 space-y-4">
          <Section title="Details">
            <VehicleEditField leadId={lead.id} initialValue={lead.vehicleOfInterest} />
            <Field label="Email" value={lead.email} />
            <Field label="Salesperson" value={lead.salespersonName} />
            <Field label="Source" value={lead.crmSource} />
            <Field label="CRM ID" value={lead.crmLeadId} />
            <Field
              label="Last activity"
              value={lead.lastCrmActivityAt?.toLocaleDateString() ?? null}
            />
          </Section>

          {lead.state !== 'opted_out' && (
            <Section title="Enroll in workflow">
              <EnrollLeadButton leadId={lead.id} workflows={availableWorkflows} />
            </Section>
          )}

          {lead.enrollments.length > 0 && (
            <Section title="Workflow history">
              {lead.enrollments.map((e) => {
                const totalSteps = e.workflow.steps.length
                const isActive = e.status === 'active'
                const isPaused = e.status === 'paused'
                const showStep = (isActive || isPaused) && totalSteps > 0
                return (
                  <div key={e.id} className="text-xs text-gray-600 py-1.5 border-b border-gray-100 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{e.workflow.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        isActive ? 'bg-blue-100 text-blue-700' :
                        isPaused ? 'bg-orange-100 text-orange-700' :
                        e.status === 'completed' ? 'bg-green-100 text-green-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {isPaused ? 'Escalated' : e.status}
                      </span>
                    </div>
                    {showStep && (
                      <p className="mt-0.5 text-gray-400">
                        Step {e.currentStepPosition} of {totalSteps}
                        {isPaused && ' — needs attention'}
                      </p>
                    )}
                  </div>
                )
              })}
            </Section>
          )}
        </div>

        {/* Right: conversation + history */}
        <div className="lg:col-span-2 space-y-4">
          {lead.conversation ? (
            <Section title="Conversation">
              <ConversationPreview messages={lead.conversation.messages} />
              <Link
                href={`/inbox/${lead.conversation.id}`}
                className="text-xs text-blue-600 hover:underline"
              >
                Open in inbox →
              </Link>
            </Section>
          ) : (
            <Section title="Conversation">
              <p className="text-sm text-gray-400">No messages yet.</p>
            </Section>
          )}

          <Section title="State history">
            <LeadStateHistory history={lead.stateHistory} />
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value ?? '—'}</span>
    </div>
  )
}
