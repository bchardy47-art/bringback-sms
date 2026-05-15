/**
 * automotive-signals.ts
 *
 * Extracts structured automotive buying signals from an inbound SMS reply body.
 * Builds a fact-only internal handoff summary from confirmed signals.
 *
 * Both exports are:
 *   • Pure — no I/O, no LLM, no DB calls, no side effects
 *   • Deterministic — same input always produces the same output
 *   • Auditable — every extracted fact leaves a named trace in rawMatchedTerms
 *
 * Hard constraints on buildSalesSummary():
 *   • Every clause requires a confirmed signal — nothing is invented
 *   • Never quotes vehicle prices, promises availability, or estimates payments
 *   • leadVehicle (from CRM) is used as background context only when the reply
 *     itself contains no vehicle mention — it is never modified or fabricated
 *   • Output is for internal staff only — never surfaced to the customer
 *   • Output is capped at 160 characters
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type VehicleType = 'truck' | 'suv' | 'car' | 'van' | 'ev'
export type Timeline    = 'today' | 'this_week' | 'later'
export type UsedOrNew   = 'used' | 'new'

export type AutomotiveSignals = {
  /** Vehicle category extracted from the reply body */
  vehicleType:          VehicleType | null
  /** Canonical make name extracted from the reply body, e.g. "Chevrolet", "Toyota" */
  makeMentioned:        string | null
  /** Whether the reply indicates a new or used preference */
  usedOrNew:            UsedOrNew | null
  /** Maximum purchase price in dollars — e.g. 35000 from "under $35k" */
  budgetMax:            number | null
  /** Target monthly payment in dollars — e.g. 500 from "$500/month" */
  paymentTarget:        number | null
  /** Reply mentions a trade-in vehicle */
  hasTrade:             boolean
  /** Reply mentions financing, credit, loan, or lease */
  hasFinancingMention:  boolean
  /** Urgency level inferred from timeline language */
  timeline:             Timeline | null
  /** Reply indicates desire to visit the lot or schedule a test drive */
  hasAppointmentIntent: boolean
  /** Reply indicates preference for a phone call rather than text */
  prefersCall:          boolean
  /**
   * Audit trail — every extraction that fired leaves an entry here.
   * Format: "<signal>:<value>:<matched text snippet>"
   * Empty array means no signals were found.
   */
  rawMatchedTerms:      string[]
}

// ── Pattern constants ─────────────────────────────────────────────────────────
//
// All patterns are defined as module-level constants so they are compiled once
// and can be inspected independently in tests without calling extractSignals().

// ── Vehicle type —————————————————————————————————————————————————————————————
// Ordered by specificity; first match wins.
// Each entry maps specific model names and type words to a vehicle category.

type VehicleTypeRule = { type: VehicleType; pattern: RegExp }

const VEHICLE_TYPE_RULES: VehicleTypeRule[] = [
  {
    type: 'truck',
    pattern: /\b(truck|pickup|f-?150|f-?250|f-?350|silverado|ram\s*1500|ram\s*2500|tundra|tacoma|colorado|ranger|frontier|sierra|canyon|titan|ridgeline|maverick|gladiator)\b/i,
  },
  {
    type: 'suv',
    pattern: /\b(suv|crossover|cr-?v|rav-?4|equinox|tahoe|suburban|explorer|pilot|highlander|traverse|pathfinder|4runner|rogue|escape|tucson|santa\s*fe|edge|compass|cherokee|grand\s*cherokee|blazer|trax|forester|outback|cx-?5|cx-?50|tiguan|atlas|sorento|telluride|palisade|sportage|acadia|yukon|expedition|navigator|sequoia|wrangler|bronco|durango|passport|murano|armada)\b/i,
  },
  {
    type: 'ev',
    // "hybrid" intentionally omitted — too ambiguous without vehicle-type context
    pattern: /\b(electric\s*(?:vehicle|car|truck|suv)?|plug-?in|tesla|leaf|bolt|ioniq|rivian|lucid|model\s*[3syx]\b|lightning|lyriq|cybertruck)\b/i,
  },
  {
    type: 'van',
    pattern: /\b(van|minivan|odyssey|sienna|caravan|pacifica|transit|sprinter|express|savana|cargo\s*van)\b/i,
  },
  {
    type: 'car',
    // "car" is last — generic fallback after all specific types are checked
    pattern: /\b(car|sedan|coupe|hatchback|accord|camry|civic|corolla|altima|malibu|impala|sonata|elantra|jetta|passat|mustang|charger|challenger|3\s*series|c-?class|e-?class)\b/i,
  },
]

// ── Make ——————————————————————————————————————————————————————————————————————

const MAKE_PATTERN = /\b(toyota|honda|ford|chevy|chevrolet|dodge|ram|gmc|jeep|nissan|hyundai|kia|subaru|mazda|volkswagen|vw|bmw|mercedes|audi|lexus|acura|tesla|cadillac|buick|lincoln|chrysler|mitsubishi|volvo|infiniti|genesis|rivian|lucid|porsche)\b/i

// Normalize raw match text to a canonical make display name
const MAKE_CANONICAL: Record<string, string> = {
  chevy:      'Chevrolet',
  chevrolet:  'Chevrolet',
  vw:         'Volkswagen',
  volkswagen: 'Volkswagen',
  ram:        'RAM',
  gmc:        'GMC',
  bmw:        'BMW',
}

function normalizeMake(raw: string): string {
  const lower = raw.toLowerCase()
  return MAKE_CANONICAL[lower] ?? (raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase())
}

// ── Used / new ————————————————————————————————————————————————————————————————

const USED_PATTERN = /\b(used|pre-?owned|pre\s+owned|certified\s+pre-?owned|cpo|second.?hand)\b/i
const NEW_PATTERN  = /\b(new|brand\s*new)\b/i

// ── Payment target ————————————————————————————————————————————————————————————
// Must include a monthly marker or "payment" context word.
// Accepts 3–4 digit amounts ($100–$3000) — realistic car payment range.

const PAYMENT_PATTERNS: RegExp[] = [
  /\$\s*(\d{3,4})\s*(?:\/mo(?:nth)?|a\s+month|per\s+month|monthly)\b/i,
  /(\d{3,4})\s*(?:\/mo(?:nth)?|a\s+month|per\s+month)\b/i,
  /payments?\s+(?:around|of|under|about|near|at)?\s*\$?\s*(\d{3,4})\b/i,
  /\bpay(?:ing)?\s+(?:around|about|under|close\s+to)?\s*\$?\s*(\d{3,4})\s*(?:a\s+month|per\s+month|\/mo(?:nth)?)?\b/i,
]

// ── Budget max ————————————————————————————————————————————————————————————————
// Requires a purchase-price qualifier word to avoid matching years, phone
// numbers, mileage, etc. Accepts $2,000–$200,000 (sanity bounds).
// "k" suffix is supported (35k → 35000). Comma separators are stripped.

const BUDGET_PATTERN = /\b(?:under|around|about|up\s+to|max(?:imum)?|budget(?:\s+(?:is|of|around|under))?|no\s+more\s+than|keep(?:ing)?\s+it\s+(?:under|around)|looking\s+to\s+spend|spend(?:ing)?\s+(?:around|up\s+to|under)?)\s*\$?\s*([\d,]+)\s*(k)?\b/i

const BUDGET_MIN = 2_000
const BUDGET_MAX = 200_000

// ── Trade-in —————————————————————————————————————————————————————————————————

const TRADE_PATTERN = /\b(trade-?in|trading\s+in|trade\s+in|i\s+have\s+a\s+.{0,30}to\s+trade|my\s+(?:current|existing)\s+(?:car|truck|suv|van|vehicle|ride)|i\s+(?:need|want)\s+to\s+trade)\b/i

// ── Financing / credit ————————————————————————————————————————————————————————

const FINANCE_PATTERN = /\b(financ(?:e|ing|ed)?|credit\b|get\s+approved|approval\b|loan\b|bad\s+credit|no\s+credit|low\s+credit|interest\s+rate|apr\b|payment\s+plan|in-?house\s+financ|special\s+financ|lease\b|leasing)\b/i

// ── Timeline —————————————————————————————————————————————————————————————————
// Checked in priority order: today > this_week > later.

const TIMELINE_RULES: { timeline: Timeline; pattern: RegExp }[] = [
  {
    timeline: 'today',
    pattern: /\b(today|right\s+now|asap|as\s+soon\s+as\s+possible|this\s+afternoon|this\s+evening|tonight|immediately)\b/i,
  },
  {
    timeline: 'this_week',
    pattern: /\b(this\s+week|tomorrow|this\s+weekend|within\s+(?:the\s+)?(?:week|a\s+few\s+days)|in\s+the\s+next\s+(?:day|few\s+days)|pretty\s+soon|very\s+soon)\b/i,
  },
  {
    timeline: 'later',
    pattern: /\b(next\s+month|in\s+a\s+few\s+months|down\s+the\s+road|not\s+in\s+a\s+hurry|when\s+the\s+time\s+is\s+right|eventually|next\s+year|a\s+couple\s+(?:months?|weeks?)|few\s+months|just\s+browsing|just\s+looking|not\s+(?:quite\s+)?ready|still\s+thinking|thinking\s+about\s+it)\b/i,
  },
]

// ── Appointment intent ————————————————————————————————————————————————————————

const APPOINTMENT_PATTERN = /\b(test\s*drive|come\s+in|stop\s+by|swing\s+by|appointment|schedule\s+(?:a\s+)?(?:time|visit|appointment)|book\s+(?:a\s+)?(?:time|appointment|visit)|set\s+up\s+(?:a\s+)?(?:time|meeting|appointment)|want\s+to\s+(?:see\s+it|come\s+in|visit|look\s+at\s+it)|can\s+i\s+(?:come|visit|stop)|come\s+check\s+it\s+out|when\s+(?:can\s+i|are\s+you)\s+(?:open|available))\b/i

// ── Call preference ———————————————————————————————————————————————————————————

const CALL_PATTERN = /\b(call\s+me|give\s+(?:me|us)\s+a\s+call|can\s+(?:you|someone)\s+call|please\s+call|call\s+(?:me\s+)?back|prefer(?:red|ring)?\s+(?:to\s+)?(?:talk|call|phone|speak)|better\s+to\s+call|reach\s+me\s+(?:at|by\s+phone|by\s+calling)|my\s+(?:number|cell|phone)\s+is)\b/i

// ── extractSignals ────────────────────────────────────────────────────────────

/**
 * Extract structured automotive buying signals from an inbound SMS body.
 *
 * @param body        Raw inbound SMS text — not sanitized or modified before
 *                    calling this function.
 * @param leadVehicle Vehicle of interest from the CRM lead record (may be null).
 *                    NOT used for signal extraction — only passed through so
 *                    buildSalesSummary() can use it as context.
 * @returns           AutomotiveSignals — all fields default to null/false/[]
 *                    if no pattern matched.
 */
export function extractSignals(
  body: string,
  leadVehicle: string | null,  // eslint-disable-line @typescript-eslint/no-unused-vars
): AutomotiveSignals {
  const text = body.trim()
  const matched: string[] = []

  // ── Vehicle type ────────────────────────────────────────────────────────────
  let vehicleType: VehicleType | null = null
  for (const rule of VEHICLE_TYPE_RULES) {
    const m = text.match(rule.pattern)
    if (m) {
      vehicleType = rule.type
      matched.push(`vehicleType:${rule.type}:${m[0].trim()}`)
      break
    }
  }

  // ── Make ────────────────────────────────────────────────────────────────────
  let makeMentioned: string | null = null
  const makeMatch = text.match(MAKE_PATTERN)
  if (makeMatch) {
    makeMentioned = normalizeMake(makeMatch[0])
    matched.push(`make:${makeMentioned}:${makeMatch[0].trim()}`)
  }

  // ── Used / new ──────────────────────────────────────────────────────────────
  let usedOrNew: UsedOrNew | null = null
  const usedMatch = text.match(USED_PATTERN)
  if (usedMatch) {
    usedOrNew = 'used'
    matched.push(`usedOrNew:used:${usedMatch[0].trim()}`)
  } else {
    const newMatch = text.match(NEW_PATTERN)
    if (newMatch) {
      usedOrNew = 'new'
      matched.push(`usedOrNew:new:${newMatch[0].trim()}`)
    }
  }

  // ── Payment target ──────────────────────────────────────────────────────────
  // Checked before budgetMax — payment patterns are more specific (monthly markers).
  let paymentTarget: number | null = null
  for (const pattern of PAYMENT_PATTERNS) {
    const m = text.match(pattern)
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10)
      if (n >= 100 && n <= 3_000) {
        paymentTarget = n
        matched.push(`paymentTarget:${n}:${m[0].trim()}`)
      }
      break
    }
  }

  // ── Budget max ──────────────────────────────────────────────────────────────
  // Both budgetMax and paymentTarget can coexist (e.g. "under $30k, $400/month").
  let budgetMax: number | null = null
  const budgetMatch = text.match(BUDGET_PATTERN)
  if (budgetMatch) {
    let amount = parseInt(budgetMatch[1].replace(/,/g, ''), 10)
    if (budgetMatch[2]?.toLowerCase() === 'k') amount *= 1_000
    if (amount >= BUDGET_MIN && amount <= BUDGET_MAX) {
      budgetMax = amount
      matched.push(`budgetMax:${amount}:${budgetMatch[0].trim()}`)
    }
  }

  // ── Trade-in ────────────────────────────────────────────────────────────────
  const hasTrade = TRADE_PATTERN.test(text)
  if (hasTrade) {
    const m = text.match(TRADE_PATTERN)
    matched.push(`hasTrade:${m![0].trim()}`)
  }

  // ── Financing / credit ──────────────────────────────────────────────────────
  const hasFinancingMention = FINANCE_PATTERN.test(text)
  if (hasFinancingMention) {
    const m = text.match(FINANCE_PATTERN)
    matched.push(`hasFinancing:${m![0].trim()}`)
  }

  // ── Timeline ────────────────────────────────────────────────────────────────
  // Priority order: today > this_week > later — first match wins.
  let timeline: Timeline | null = null
  for (const rule of TIMELINE_RULES) {
    const m = text.match(rule.pattern)
    if (m) {
      timeline = rule.timeline
      matched.push(`timeline:${rule.timeline}:${m[0].trim()}`)
      break
    }
  }

  // ── Appointment intent ──────────────────────────────────────────────────────
  const hasAppointmentIntent = APPOINTMENT_PATTERN.test(text)
  if (hasAppointmentIntent) {
    const m = text.match(APPOINTMENT_PATTERN)
    matched.push(`appointment:${m![0].trim()}`)
  }

  // ── Call preference ─────────────────────────────────────────────────────────
  const prefersCall = CALL_PATTERN.test(text)
  if (prefersCall) {
    const m = text.match(CALL_PATTERN)
    matched.push(`prefersCall:${m![0].trim()}`)
  }

  return {
    vehicleType,
    makeMentioned,
    usedOrNew,
    budgetMax,
    paymentTarget,
    hasTrade,
    hasFinancingMention,
    timeline,
    hasAppointmentIntent,
    prefersCall,
    rawMatchedTerms: matched,
  }
}

// ── buildSalesSummary ─────────────────────────────────────────────────────────

const SUMMARY_MAX_LENGTH = 160

/**
 * Build a short internal handoff summary from confirmed signal facts only.
 *
 * Assembly rules (in order):
 *   1. Opening clause — what the customer wants to do (appointment or shopping)
 *   2. Vehicle description — from reply signals; falls back to CRM vehicle only
 *      when nothing was mentioned in this reply
 *   3. Budget / payment — only if explicitly extracted from the reply
 *   4. Trade-in — only if explicitly detected in the reply
 *   5. Financing — only if detected
 *   6. Timeline — only if detected
 *   7. Contact preference — only if call preference was detected
 *
 * @param signals     Output of extractSignals() for this reply.
 * @param firstName   Lead first name — available for future use, not in body yet.
 * @param leadVehicle Vehicle of interest from CRM lead record — used as fallback
 *                    context only, never modified. Included as-is if no vehicle
 *                    was mentioned in this reply.
 */
export function buildSalesSummary(
  signals: AutomotiveSignals,
  firstName: string,       // reserved — not currently included in summary body
  leadVehicle: string | null,
): string {
  const clauses: string[] = []

  const vehicleDesc = _describeVehicle(signals, leadVehicle)

  // 1. Opening / intent clause
  if (signals.hasAppointmentIntent) {
    clauses.push(vehicleDesc ? `Wants to test drive ${vehicleDesc}` : 'Wants to come in')
  } else if (vehicleDesc) {
    clauses.push(`Shopping for ${vehicleDesc}`)
  }

  // 2. Budget / payment (both can coexist)
  if (signals.budgetMax !== null && signals.paymentTarget !== null) {
    clauses.push(`budget under $${signals.budgetMax.toLocaleString()}, ~$${signals.paymentTarget}/mo`)
  } else if (signals.budgetMax !== null) {
    clauses.push(`budget under $${signals.budgetMax.toLocaleString()}`)
  } else if (signals.paymentTarget !== null) {
    clauses.push(`targeting $${signals.paymentTarget}/mo`)
  }

  // 3. Trade-in
  if (signals.hasTrade) {
    clauses.push('has trade')
  }

  // 4. Financing
  if (signals.hasFinancingMention) {
    clauses.push('financing questions')
  }

  // 5. Timeline
  if (signals.timeline === 'today') {
    clauses.push('wants options today')
  } else if (signals.timeline === 'this_week') {
    clauses.push('this week')
  } else if (signals.timeline === 'later') {
    clauses.push('not ready yet')
  }

  // 6. Contact preference
  if (signals.prefersCall) {
    clauses.push('prefers call')
  }

  // Fallback — no signals at all
  if (clauses.length === 0) {
    return 'Reply received — review conversation.'
  }

  // Assemble: first clause + comma-joined remainder + trailing period
  const [first, ...rest] = clauses
  const sentence = rest.length > 0
    ? `${first}, ${rest.join(', ')}.`
    : `${first}.`

  return sentence.length > SUMMARY_MAX_LENGTH
    ? sentence.slice(0, SUMMARY_MAX_LENGTH - 3) + '...'
    : sentence
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build a vehicle description from signal data.
 *
 * Priority: signals from this reply > CRM lead vehicle (fallback).
 * usedOrNew is only included when there is also a type or make —
 * "Shopping for a used." would be incomplete and confusing.
 *
 * The CRM vehicle (leadVehicle) is used verbatim as a fallback label.
 * It comes from the import file, not from this SMS. It is never modified.
 */
function _describeVehicle(
  signals: AutomotiveSignals,
  leadVehicle: string | null,
): string | null {
  const hasVehicleContext = signals.vehicleType !== null || signals.makeMentioned !== null

  const parts: string[] = []
  if (signals.usedOrNew && hasVehicleContext) parts.push(signals.usedOrNew)
  if (signals.makeMentioned) parts.push(signals.makeMentioned)
  if (signals.vehicleType) parts.push(signals.vehicleType)

  if (parts.length === 0) {
    // Nothing mentioned in this reply — use CRM vehicle as context only
    return leadVehicle ?? null
  }

  // Add 'a' or 'an' based on first character of description
  const firstChar = parts[0].charAt(0).toLowerCase()
  const article = 'aeiou'.includes(firstChar) ? 'an' : 'a'
  return `${article} ${parts.join(' ')}`
}
