/**
 * AdminModeBanner — a thin, always-visible status strip across every /admin
 * page so Brian can tell at a glance whether real texts / real dealer emails
 * can go out, without digging into the System panel.
 *
 * Display-only. Reads two already-computed booleans (see admin layout) and
 * renders plain-English labels. It does NOT read or change any env behaviour
 * itself — the layout passes the resolved flags in. Raw env var names are
 * intentionally kept out of the primary copy.
 */

export function AdminModeBanner({
  smsLive,
  outreachArmed,
}: {
  smsLive: boolean
  outreachArmed: boolean
}) {
  return (
    <div className="w-full border-b border-gray-200 bg-white px-4 md:px-8 py-1.5">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-gray-400">Mode</span>
        <ModeChip
          live={smsLive}
          liveLabel="SMS: LIVE"
          testLabel="SMS: TEST MODE — no real texts should send"
        />
        <ModeChip
          live={outreachArmed}
          liveLabel="Outreach: LIVE SENDING ARMED"
          testLabel="Outreach: TEST MODE — real dealer emails are off"
        />
      </div>
    </div>
  )
}

function ModeChip({
  live,
  liveLabel,
  testLabel,
}: {
  live: boolean
  liveLabel: string
  testLabel: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold ${
        live
          ? 'bg-red-600 text-white ring-1 ring-red-700'
          : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-white animate-pulse' : 'bg-amber-500'}`} />
      {live ? liveLabel : testLabel}
    </span>
  )
}
