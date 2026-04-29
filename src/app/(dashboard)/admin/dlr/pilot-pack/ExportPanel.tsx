'use client'

/**
 * Phase 16 — Pilot Data Pack export buttons.
 * Downloads each export format via its API route.
 */

type ExportItem = {
  key:      string
  label:    string
  desc:     string
  path:     string
  filename: string
  icon:     string
}

const EXPORTS: ExportItem[] = [
  {
    key:      'leads',
    label:    'Selected Leads CSV',
    desc:     'All selected pilot leads with contact info and consent status',
    path:     'leads',
    filename: 'pilot-leads.csv',
    icon:     '👥',
  },
  {
    key:      'previews',
    label:    'Message Previews CSV',
    desc:     'Rendered message copy for every step, one row per lead × step',
    path:     'previews',
    filename: 'pilot-message-previews.csv',
    icon:     '💬',
  },
  {
    key:      'dry-run',
    label:    'Dry-Run Report JSON',
    desc:     'Full dry-run report with warnings, blockers, consent coverage',
    path:     'dry-run',
    filename: 'pilot-dry-run.json',
    icon:     '📋',
  },
  {
    key:      'sample-messages',
    label:    '10DLC Sample Messages',
    desc:     'Unique rendered messages for TCR/10DLC campaign registration',
    path:     'sample-messages',
    filename: '10dlc-sample-messages.txt',
    icon:     '📄',
  },
  {
    key:      'checklist',
    label:    'Pilot Launch Checklist',
    desc:     'Markdown checklist with current pass/fail state per item',
    path:     'checklist',
    filename: 'pilot-checklist.md',
    icon:     '✅',
  },
]

export function ExportPanel({ tenantId }: { tenantId: string }) {
  function downloadUrl(path: string) {
    return `/api/admin/dlr/pilot-pack/export/${path}?tenantId=${tenantId}`
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">Export Pilot Pack</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Download everything needed to review, audit, or submit the pilot package.
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {EXPORTS.map(item => (
          <div key={item.key} className="px-5 py-3 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="text-lg mt-0.5">{item.icon}</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
              </div>
            </div>
            <a
              href={downloadUrl(item.path)}
              download={item.filename}
              className="shrink-0 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
            >
              Download
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
