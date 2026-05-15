/**
 * Quiet-hours window enforcement.
 *
 * Each tenant may define a quiet-hours window in `tenants.settings.quietHours`:
 *   {
 *     enabled:  boolean
 *     start:    "HH:mm"      // 24h local time when quiet hours begin (e.g. "20:00")
 *     end:      "HH:mm"      // 24h local time when quiet hours end   (e.g. "09:00")
 *     timezone: string       // IANA tz, e.g. "America/Los_Angeles"
 *   }
 *
 * Defaults: enabled, 20:00–09:00 local America/Los_Angeles. These mirror the
 * TCPA "no calls/texts before 8am or after 9pm local" rule with a safety
 * margin.
 *
 * isInQuietHours(now, cfg) → boolean
 * nextAllowedSend(now, cfg) → Date | null
 *   • returns null if `now` is already in an allowed window
 *   • otherwise returns the next start-of-window time (UTC Date)
 */

export type QuietHoursConfig = {
  enabled?:  boolean
  start?:    string   // "HH:mm"
  end?:      string   // "HH:mm"
  timezone?: string
}

const DEFAULT_CONFIG: Required<QuietHoursConfig> = {
  enabled:  true,
  start:    '20:00',  // 8pm
  end:      '09:00',  // 9am
  timezone: 'America/Los_Angeles',
}

function resolveConfig(cfg: QuietHoursConfig | null | undefined): Required<QuietHoursConfig> {
  return {
    enabled:  cfg?.enabled  ?? DEFAULT_CONFIG.enabled,
    start:    cfg?.start    ?? DEFAULT_CONFIG.start,
    end:      cfg?.end      ?? DEFAULT_CONFIG.end,
    timezone: cfg?.timezone ?? DEFAULT_CONFIG.timezone,
  }
}

function parseHHMM(s: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!match) return null
  const h = Number.parseInt(match[1], 10)
  const m = Number.parseInt(match[2], 10)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return { h, m }
}

/**
 * Returns the current local hour:minute in the given IANA timezone.
 * Uses `Intl.DateTimeFormat` so no extra timezone library is needed.
 */
function localHourMinute(now: Date, timezone: string): { h: number; m: number; dateStr: string } {
  // en-CA produces YYYY-MM-DD, easy to parse
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour12: false,
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return {
    h: Number.parseInt(get('hour'),   10),
    m: Number.parseInt(get('minute'), 10),
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

/**
 * Convert a (date in tz, HH:mm) into a UTC Date.
 * We rely on Intl to compute the offset of `dateStr 00:00:00` in `timezone`
 * and then add it.
 */
function tzDateAt(dateStr: string, hh: number, mm: number, timezone: string): Date {
  // First, build a "naive" UTC date as if dateStr + HH:mm were UTC.
  const naiveUtc = new Date(`${dateStr}T${pad2(hh)}:${pad2(mm)}:00Z`)
  // Now compute what wall-clock time `naiveUtc` is in `timezone`. The
  // difference between (wall clock) and (naive UTC) is the offset we need to
  // subtract to make the local time equal HH:mm.
  const local = localHourMinute(naiveUtc, timezone)
  const offsetMin = ((local.h * 60 + local.m) - (hh * 60 + mm))
  return new Date(naiveUtc.getTime() - offsetMin * 60_000)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export function isInQuietHours(now: Date, cfg: QuietHoursConfig | null | undefined): boolean {
  const c = resolveConfig(cfg)
  if (!c.enabled) return false
  const start = parseHHMM(c.start)
  const end   = parseHHMM(c.end)
  if (!start || !end) return false

  const { h, m } = localHourMinute(now, c.timezone)
  const cur   = h * 60 + m
  const sMin  = start.h * 60 + start.m
  const eMin  = end.h * 60 + end.m

  if (sMin === eMin) return false                       // empty window
  if (sMin < eMin)   return cur >= sMin && cur < eMin    // same-day window
  return cur >= sMin || cur < eMin                       // wraps midnight
}

/**
 * Compute the next allowed send time given current `now` and tenant config.
 * Returns null if `now` is already inside the allowed window (or quiet hours
 * are disabled).
 */
export function nextAllowedSend(now: Date, cfg: QuietHoursConfig | null | undefined): Date | null {
  const c = resolveConfig(cfg)
  if (!c.enabled) return null
  if (!isInQuietHours(now, cfg)) return null

  const end = parseHHMM(c.end)
  if (!end) return null

  // The next allowed time is end-of-quiet-window. Compute it as a UTC Date in
  // the tenant's timezone. If end falls before the current local time today
  // (wrap-midnight case), shift to tomorrow.
  const { h, m, dateStr } = localHourMinute(now, c.timezone)
  const cur   = h * 60 + m
  const eMin  = end.h * 60 + end.m

  // The candidate end is today at end-time in the tenant tz.
  const candidate = tzDateAt(dateStr, end.h, end.m, c.timezone)

  if (eMin > cur) {
    // End is later today (typical: it's 02:30, ends at 09:00 → today 09:00).
    return candidate
  }
  // End is earlier today (typical: it's 22:00, ends at 09:00 → tomorrow 09:00).
  return new Date(candidate.getTime() + 24 * 60 * 60 * 1000)
}
