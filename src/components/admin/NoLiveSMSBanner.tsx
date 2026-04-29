/**
 * Shared banner shown on every page that is part of the sending path.
 * Makes the "nothing will send yet" guarantee explicit and visible.
 */

type Props = {
  reason?: string   // optional override for the specific blocking reason
  compact?: boolean // one-line version for use inside page headers
}

export function NoLiveSMSBanner({ reason, compact = false }: Props) {
  const defaultReason = '10DLC / Telnyx registration is still pending'
  const text = reason ?? defaultReason

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
        No live SMS will send — {text}
      </span>
    )
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <span className="text-amber-500 text-base mt-0.5 flex-shrink-0">⏳</span>
      <div>
        <p className="text-sm font-semibold text-amber-800">
          No live SMS will be sent from this page.
        </p>
        <p className="text-xs text-amber-700 mt-0.5">
          {text}. All actions here are safe to perform — batches stay in draft,
          previews are read-only, and the confirmation gate remains locked.
        </p>
      </div>
    </div>
  )
}
