interface HistoryEntry {
  id: string
  fromState: string | null
  toState: string
  reason: string | null
  actor: string
  createdAt: Date
}

export function LeadStateHistory({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="text-xs text-gray-400">No state changes recorded.</p>
  }

  return (
    <div className="space-y-2">
      {history.map((entry) => (
        <div key={entry.id} className="flex items-start gap-2 text-xs">
          <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5" />
          <div>
            <span className="text-gray-500">
              {entry.fromState ? (
                <>
                  <span className="text-gray-400">{entry.fromState}</span>
                  <span className="mx-1 text-gray-300">→</span>
                </>
              ) : null}
              <span className="font-medium text-gray-800">{entry.toState}</span>
            </span>
            {entry.reason && (
              <span className="ml-1.5 text-gray-400">{entry.reason}</span>
            )}
            <div className="text-gray-400 mt-0.5">
              {new Date(entry.createdAt).toLocaleString()} · {entry.actor}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
