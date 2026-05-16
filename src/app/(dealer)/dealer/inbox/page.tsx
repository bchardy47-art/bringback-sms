import { MessageSquare } from 'lucide-react'

// The parent layout (./layout.tsx) is dynamic — it calls getServerSession
// and queries the conversation list on every request. This page is otherwise
// statically analyzable, which lets Next.js cache its RSC payload at build
// time. When a soft-nav _rsc request arrives for /dealer/inbox?status=X,
// Next.js then has to combine the cached static-page payload with a fresh
// dynamic-layout payload, and the static/dynamic boundary trips a 503 in
// the RSC flight handler for that combined response.
//
// Forcing the page dynamic keeps both halves of the response on the same
// fresh-render code path. No functional change — the empty-state JSX is
// identical — but the RSC payload is now produced per-request.
export const dynamic = 'force-dynamic'

export default function DealerInboxPage() {
  return (
    <div className="flex-1 flex items-center justify-center h-full bg-gray-50">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <MessageSquare size={28} className="text-gray-400" />
        </div>
        <h2 className="text-base font-semibold text-gray-700">Select a conversation</h2>
        <p className="text-sm text-gray-400 mt-1">
          When leads reply to your messages, they&apos;ll appear here.
        </p>
      </div>
    </div>
  )
}
