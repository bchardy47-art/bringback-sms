/**
 * Reply Classifier  (Phase 5 — Automotive-aware)
 *
 * Deterministic, pattern/signal-based intent classification for inbound SMS.
 * No LLM required — every decision is auditable and testable.
 *
 * Classification buckets (12):
 *
 *   HOT (immediate handoff — likely buying now):
 *     hot_appointment   — wants to visit / schedule test drive
 *     hot_inventory     — asking about specific vehicle availability now
 *     hot_payment       — ready-to-buy signal or explicit payment/budget intent
 *
 *   WARM (handoff — engaged but not closing yet):
 *     warm_trade        — mentions trade-in
 *     warm_finance      — mentions financing, credit, or payment exploration
 *
 *   SOFT / NO HANDOFF:
 *     not_now           — interested but not ready; re-engage later
 *     neutral_unclear   — no buying signal; do not hand off
 *
 *   TERMINAL (stop automation):
 *     not_interested    — explicit rejection / compliance opt-out
 *     already_bought    — purchased elsewhere
 *     wrong_number      — message not intended for us
 *     angry_or_complaint — hostile / legal threat; escalation only
 *
 *   REVIEW (human needed — narrow):
 *     needs_human_review — affirmative or automotive-signal reply that
 *                          doesn't fit a hotter bucket; also fires for
 *                          "call me" / callback intent
 *
 * Pass order:
 *   1. Terminal/compliance  (wrong_number, already_bought, not_interested, angry)
 *   2. hot_appointment      (signal: hasAppointmentIntent OR pattern)
 *   3. hot_payment          (signal: paymentTarget+today OR ready-to-buy pattern)
 *   4. hot_inventory        (vehicle signal + availability pattern OR today timeline)
 *   5. warm_trade           (signal: hasTrade)
 *      warm_finance         (signal: hasFinancingMention OR payment+no timeline)
 *   6a. price/deal inquiry  (→ needs_human_review; checked BEFORE not_now)
 *   6. not_now              (signal: timeline=later OR not-now patterns)
 *   7. needs_human_review   (positive affirmative OR prefersCall OR ? + auto signal)
 *   8. bare vehicle signal  (→ needs_human_review; catches vehicle-change replies)
 *   default → neutral_unclear
 */

import { extractSignals } from '@/lib/messaging/automotive-signals'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReplyClassification =
  | 'hot_appointment'
  | 'hot_inventory'
  | 'hot_payment'
  | 'warm_trade'
  | 'warm_finance'
  | 'not_now'
  | 'not_interested'
  | 'already_bought'
  | 'wrong_number'
  | 'angry_or_complaint'
  | 'needs_human_review'
  | 'neutral_unclear'

export type ClassificationResult = {
  classification: ReplyClassification
  /** Matched rule name or signal path — for audit logging */
  reason: string
}

/**
 * Classifications that require a human handoff task to be created.
 * Keep in sync with HANDOFF_TRIGGERING_CLASSIFICATIONS in handoff-agent.ts.
 */
export const HANDOFF_CLASSIFICATIONS: ReadonlySet<ReplyClassification> = new Set<ReplyClassification>([
  'hot_appointment',
  'hot_inventory',
  'hot_payment',
  'warm_trade',
  'warm_finance',
  'needs_human_review',   // narrow — see Pass 7
  'angry_or_complaint',   // escalation task
])

/**
 * Classifications that should terminate automation.
 * Leads in these states must not receive further outbound messages.
 */
export const TERMINAL_CLASSIFICATIONS: ReadonlySet<ReplyClassification> = new Set<ReplyClassification>([
  'not_interested',
  'already_bought',
  'wrong_number',
  'angry_or_complaint',
])

// ── Pass 1 — Terminal / compliance patterns ───────────────────────────────────
// Checked first, unconditionally. Order within this group matters:
// wrong_number before angry so "who is this asshole" → angry (anger wins).

const WRONG_NUMBER_PATTERNS: RegExp[] = [
  /who (is|are) (this|you)\b/i,
  /wrong (number|person|contact)/i,
  /don'?t know (you|this number|who (this|you) is)/i,
  /not the right (person|number|contact)/i,
  /i think you have the wrong/i,
  /you have the wrong/i,
  /this isn'?t .{0,20}(number|person)/i,
]

const ALREADY_BOUGHT_PATTERNS: RegExp[] = [
  /already (bought|purchased|got one|have one|have a car|own one)/i,
  /just (bought|purchased|got) (a |one|it|the car)/i,
  /bought (a car|one|it|already)/i,
  /purchased (a car|one|already)/i,
  /went (ahead and )?(bought|purchased)/i,
  /found (a car|one|something) (else|already)/i,
  /got (a new|another|a different) (car|vehicle|truck|suv)/i,
]

const NOT_INTERESTED_PATTERNS: RegExp[] = [
  /not interested/i,
  /no (thanks|thank you|thx|ty)\b/i,
  /don'?t (contact|text|call|message|reach) (me|us)/i,
  /do not (contact|text|call|message|reach)/i,
  /please (don'?t|stop) (contact|text|call|message)/i,
  /remove (me|us) (from|off)/i,
  /take (me|us) off/i,
  /leave (me|us) alone/i,
  /not (looking|shopping|in the market)/i,
  /not interested in/i,
  /\bno longer interested\b/i,
]

const ANGRY_PATTERNS: RegExp[] = [
  // Profanity
  /\b(fuck(ing|er)?|shit|bullshit|ass(hole)?|damn it|bastard|idiot|moron)\b/i,
  // Legal / harassment threats
  /\b(scam|fraud|spam(mer)?|harassment|harassing|stalking)\b/i,
  /\b(lawsuit|sue|lawyer|attorney|legal action|report (you|this))\b/i,
  // Anger expressions
  /how dare you/i,
  /this is (terrible|horrible|awful|outrageous|unacceptable)/i,
  /stop (harassing|bothering|texting) (me|us)/i,
  /i('m| am) (so )?(angry|furious|pissed|fed up)/i,
]

// ── Pass 2 — hot_appointment patterns ─────────────────────────────────────────
// Also fires when signals.hasAppointmentIntent is true (extracted from message).

const APPOINTMENT_PATTERNS: RegExp[] = [
  /\b(appointment|test.?drive)\b/i,
  /come (in|see (you|the car|it)|by|visit)/i,
  /\b(schedule|book|reserve) (an? )?(appointment|time|visit|test)/i,
  /when can (i|we) (come|visit|see|swing|stop)/i,
  /set up (a |an )?(time|meeting|visit|appointment)/i,
  /can (i|we) (come in|visit|see it|stop by)/i,
  /want to (come in|visit|see it|stop by|check it out)/i,
  /\bswing by\b/i,
  /\bdrop (in|by)\b/i,
]

// ── Pass 3 — hot_payment patterns ─────────────────────────────────────────────
// "Ready to buy" language — fires even without a payment number.

const READY_TO_BUY_PATTERNS: RegExp[] = [
  /\bready (to (buy|purchase|sign|get it|make a deal)|to close)\b/i,
  /\b(let'?s (do it|make a deal|get this done|sign))\b/i,
  /\bi'?ll take it\b/i,
  /\bwrite (it|the deal) up\b/i,
  /\bwhat (do i|does it) take (to buy|to purchase|to get it|to close)\b/i,
  /\bwhat (is|are) (your|the) (out.?of.?pocket|total|monthly|payments?)\b/i,
  /\bhow (much|soon) can (i|we) (get|close|drive|pick it up|have it)\b/i,
  /\bfinance (it|this|that|one)\b/i,
]

// ── Pass 4 — hot_inventory patterns ───────────────────────────────────────────
// Combined with a vehicle signal (vehicleType or makeMentioned).

const AVAILABILITY_PATTERNS: RegExp[] = [
  /\bstill (available|in stock|for sale|there)\b/i,
  /\bis (it|that|this|the .{1,20}) (still )?(available|in stock|for sale)\b/i,
  /\bdo (you|they) (still )?(have|carry|stock|sell)\b/i,
  /\bavailable\b/i,
  /\bin stock\b/i,
  /\bfor sale\b/i,
  /\bcan (i|we) (see|look at|check out|view) (it|the .{1,20})\b/i,
  /\bsend (me )?(photos?|pics?|pictures?|more (photos?|pics?|info))\b/i,
  /\bmore (photos?|pics?|pictures?|info|details)\b/i,
  /\bwhat (colors?|trim|options?|features?|packages?)\b/i,
  /\bmileage\b/i,
]

// ── Pass 6a — price / deal negotiation patterns ───────────────────────────────
// Checked BEFORE not_now so "still looking + price question" is treated as a
// warm buying signal rather than suppressed by the not_now pass. Routes to
// needs_human_review — the salesperson should respond with a specific offer.

const PRICE_INQUIRY_PATTERNS: RegExp[] = [
  /what'?s (the )?best (deal|price|offer)/i,
  /best (deal|price|offer) (you can|on it|on (the|that)|for)/i,
  /what can you (do|offer) (on|for) (the price|it|that|this)/i,
  /how (low|close) can you go/i,
  /any (wiggle )?room (on|in) the price/i,
  /can you (come down|go lower|do any better)/i,
  /make (me|us) (a |an )?(offer|deal)/i,
  /\bnegotiat/i,
  /out.?the.?door (price|cost)/i,
  /what'?s (the )?lowest (you|they) (can|will|would)/i,
  /how much (off|under|below)/i,
  /what (kind of |any )?(discount|deal|incentive|rebate)/i,
]

// ── Pass 6 — not_now patterns ─────────────────────────────────────────────────
// Soft deferral — interested but not soon. No handoff created.

const NOT_NOW_PATTERNS: RegExp[] = [
  /not (right )?now/i,
  /\bmaybe later\b/i,
  /\bnot yet\b/i,
  /\bnot ready\b/i,
  /\bjust (looking|browsing)\b/i,
  /still (looking|shopping|deciding|thinking)/i,
  /not (for a while|anytime soon|for a few months?)/i,
  /\b(few|couple of?) (weeks?|months?)\b/i,
  /\bdown the (road|line)\b/i,
  /\bnot (until|till|before)\b/i,
  /\bkeep (me|us) (posted|updated|in mind)\b/i,
  /\bcheck back\b/i,
  /\bwe'?ll see\b/i,
]

// ── Pass 7 — needs_human_review patterns ──────────────────────────────────────
// Genuine buying intent or affirmative signal — narrow enough to avoid noise.
// Also fires when signals.prefersCall is true.

const POSITIVE_INTEREST_PATTERNS: RegExp[] = [
  /\binterested\b/i,
  /tell me more/i,
  /sounds (good|great|interesting|nice|perfect|like a deal)/i,
  /i'?d (like|love) (to|more information|more info|details)/i,
  /\byes( please)?(\b|,|$)/i,
  /\byeah (sure|okay|ok|i'?m|i am|definitely|absolutely)\b/i,
  /\b(absolutely|definitely|for sure|of course)\b/i,
  /send (me )?(more )?(info|information|details|pricing|price)/i,
  /what'?s (the )?price\b/i,
  /how much (is|does|would)/i,
  /what'?s (the )?best (deal|price|offer)/i,
  /best (deal|price) you can/i,
  /what can you do on/i,
  /i'?m in\b/i,
  /love to (hear|know|see|learn)/i,
  /\bsure,? (why not|sounds good|i'?m interested|let'?s)\b/i,
  /\byes,? (i'?m|i am|i'd|we'?re|we are)\b/i,
]

// Callback / "call me" — no dedicated bucket; routes to needs_human_review
const CALLBACK_PATTERNS: RegExp[] = [
  /call (me|us)(\s|$|,|\.)/i,
  /give (me|us) a call/i,
  /can (you|someone) (call|reach|contact) (me|us)/i,
  /please (call|ring|phone) (me|us)/i,
  /call (me )?back/i,
  /reach (me|us) (at|by|on)/i,
  /my (number|phone) is\b/i,
  /i'?m available (to talk|by phone|for a call)/i,
  /\bgive me a ring\b/i,
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): RegExp | null {
  for (const p of patterns) {
    if (p.test(text)) return p
  }
  return null
}

function excerpt(p: RegExp): string {
  return `/${p.source.slice(0, 60)}/`
}

// ── classifyReply ─────────────────────────────────────────────────────────────

/**
 * Classify an inbound SMS body into one of the ReplyClassification categories.
 * Pure, synchronous, no side effects.
 *
 * Calls extractSignals() internally — callers do NOT need to extract separately
 * unless they want the signals for logging. The returned `reason` encodes the
 * decisive signal or pattern for audit.
 */
export function classifyReply(body: string): ClassificationResult {
  const text = body.trim()

  // Extract automotive signals once — used across multiple passes below.
  const signals = extractSignals(text, null)
  const hasVehicleSignal = signals.vehicleType !== null || signals.makeMentioned !== null

  // ── Pass 1: Terminal / compliance ─────────────────────────────────────────
  // Checked unconditionally and first. Angry beats wrong_number if both fire
  // (order matters: wrong_number checked first, but angry_or_complaint wins
  // because it's checked last in this block).

  let m: RegExp | null

  if ((m = matchesAny(text, WRONG_NUMBER_PATTERNS))) {
    return { classification: 'wrong_number', reason: `wrong_number:${excerpt(m)}` }
  }

  if ((m = matchesAny(text, ALREADY_BOUGHT_PATTERNS))) {
    return { classification: 'already_bought', reason: `already_bought:${excerpt(m)}` }
  }

  if ((m = matchesAny(text, NOT_INTERESTED_PATTERNS))) {
    return { classification: 'not_interested', reason: `not_interested:${excerpt(m)}` }
  }

  if ((m = matchesAny(text, ANGRY_PATTERNS))) {
    return { classification: 'angry_or_complaint', reason: `angry_or_complaint:${excerpt(m)}` }
  }

  // ── Pass 2: hot_appointment ───────────────────────────────────────────────
  // Signal-first (extracted from the message), then pattern fallback.

  if (signals.hasAppointmentIntent) {
    return { classification: 'hot_appointment', reason: 'signal:hasAppointmentIntent' }
  }
  if ((m = matchesAny(text, APPOINTMENT_PATTERNS))) {
    return { classification: 'hot_appointment', reason: `hot_appointment:${excerpt(m)}` }
  }

  // ── Pass 3: hot_payment ───────────────────────────────────────────────────
  // Explicit payment target with urgency, OR ready-to-buy language.

  if (signals.paymentTarget !== null && signals.timeline === 'today') {
    return {
      classification: 'hot_payment',
      reason: `signal:paymentTarget=${signals.paymentTarget}+timeline=today`,
    }
  }
  if (signals.budgetMax !== null && signals.timeline === 'today') {
    return {
      classification: 'hot_payment',
      reason: `signal:budgetMax=${signals.budgetMax}+timeline=today`,
    }
  }
  if ((m = matchesAny(text, READY_TO_BUY_PATTERNS))) {
    return { classification: 'hot_payment', reason: `hot_payment:${excerpt(m)}` }
  }

  // ── Pass 4: hot_inventory ─────────────────────────────────────────────────
  // Vehicle context + availability question, OR vehicle + buying today.

  if (hasVehicleSignal) {
    if ((m = matchesAny(text, AVAILABILITY_PATTERNS))) {
      return {
        classification: 'hot_inventory',
        reason: `hot_inventory:vehicle+${excerpt(m)}`,
      }
    }
    if (signals.timeline === 'today') {
      return {
        classification: 'hot_inventory',
        reason: `hot_inventory:vehicle+timeline=today`,
      }
    }
  }

  // ── Pass 5: warm_trade / warm_finance ─────────────────────────────────────
  // Trade and finance signals can overlap — trade is checked first; a message
  // with both a trade and a finance mention will be classified warm_trade
  // (the human follow-up handles both). If only finance, warm_finance.

  if (signals.hasTrade) {
    return { classification: 'warm_trade', reason: 'signal:hasTrade' }
  }

  if (signals.hasFinancingMention) {
    return { classification: 'warm_finance', reason: 'signal:hasFinancingMention' }
  }

  // Payment target without a "today" timeline — buying-curious, not red-hot.
  if (signals.paymentTarget !== null || signals.budgetMax !== null) {
    const which = signals.paymentTarget !== null
      ? `paymentTarget=${signals.paymentTarget}`
      : `budgetMax=${signals.budgetMax}`
    return { classification: 'warm_finance', reason: `signal:${which}` }
  }

  // ── Pass 6a: price / deal negotiation ────────────────────────────────────
  // Must run BEFORE not_now. Messages like "still looking, what's the best
  // deal you can do?" contain a deferral phrase AND a buying signal. Checking
  // price inquiry first prevents the not_now pass from swallowing the intent.

  if ((m = matchesAny(text, PRICE_INQUIRY_PATTERNS))) {
    return {
      classification: 'needs_human_review',
      reason: `needs_human_review:price_inquiry:${excerpt(m)}`,
    }
  }

  // ── Pass 6: not_now ───────────────────────────────────────────────────────
  // "Later" timeline or soft deferral language. No handoff — re-engage later.

  if (signals.timeline === 'later') {
    return { classification: 'not_now', reason: 'signal:timeline=later' }
  }
  if ((m = matchesAny(text, NOT_NOW_PATTERNS))) {
    return { classification: 'not_now', reason: `not_now:${excerpt(m)}` }
  }

  // ── Pass 7: needs_human_review (NARROW) ───────────────────────────────────
  // Only fires for genuine positive signals — affirmative intent, callback
  // request, or a question that came with automotive context. Vague replies
  // ("ok", "k", "sure" alone) fall through to neutral_unclear.

  // (a) Explicit callback / "call me" language — human must respond
  if (signals.prefersCall) {
    return { classification: 'needs_human_review', reason: 'signal:prefersCall' }
  }
  if ((m = matchesAny(text, CALLBACK_PATTERNS))) {
    return { classification: 'needs_human_review', reason: `needs_human_review:callback:${excerpt(m)}` }
  }

  // (b) Positive affirmative reply (not just punctuation / single word)
  if ((m = matchesAny(text, POSITIVE_INTEREST_PATTERNS))) {
    return { classification: 'needs_human_review', reason: `needs_human_review:positive:${excerpt(m)}` }
  }

  // (c) Question with at least one automotive term — deliberate buyer inquiry
  if (text.includes('?') && signals.rawMatchedTerms.length > 0) {
    return {
      classification: 'needs_human_review',
      reason: `needs_human_review:question+signals:[${signals.rawMatchedTerms.slice(0, 3).join(',')}]`,
    }
  }

  // ── Pass 8: bare vehicle signal ───────────────────────────────────────────
  // If execution reaches here and the message still contains a vehicle signal,
  // the customer is engaged and talking about cars — just not in a category
  // the earlier passes recognized. Common case: vehicle change ("thinking about
  // a Camry instead of the Tundra"), vague curiosity, or browsing a different
  // model. Route to needs_human_review so a salesperson can engage rather than
  // letting the lead silently fall to neutral_unclear.
  // All terminal/negative passes have already fired above, so a vehicle signal
  // here is a genuine buying-context mention without a negative qualifier.

  if (hasVehicleSignal) {
    return {
      classification: 'needs_human_review',
      reason: `needs_human_review:vehicle_signal:[${signals.rawMatchedTerms.slice(0, 3).join(',')}]`,
    }
  }

  // ── Default ───────────────────────────────────────────────────────────────
  return { classification: 'neutral_unclear', reason: 'no_pattern_matched' }
}
