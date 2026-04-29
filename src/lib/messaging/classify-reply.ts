/**
 * Reply Classifier
 *
 * Deterministic, keyword/pattern-based intent classification for inbound SMS.
 * No LLM required — designed so every decision is auditable and testable.
 *
 * Classification categories:
 *   interested           — positive interest, wants more info
 *   appointment_request  — wants to visit or schedule a test drive
 *   callback_request     — wants a phone call
 *   not_interested       — explicit rejection
 *   already_bought       — purchased elsewhere or recently
 *   wrong_number         — message intended for someone else
 *   angry_or_complaint   — hostile, profanity, legal threats
 *   question             — any other question (catch-all with ?)
 *   neutral_unclear      — no pattern matched, no question mark
 *
 * Ordering:
 *   Compliance/terminal rules first (wrong_number, already_bought,
 *   not_interested, angry_or_complaint), then intent-positive rules
 *   (appointment_request, callback_request), then generic question,
 *   then interested, then neutral_unclear.
 *
 *   Appointment and callback take priority over the generic question catch-all
 *   so "when can I come in?" → appointment_request, not question.
 *   The generic question check fires before interested so "is it available?"
 *   → question, not interested.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReplyClassification =
  | 'interested'
  | 'appointment_request'
  | 'callback_request'
  | 'not_interested'
  | 'already_bought'
  | 'wrong_number'
  | 'angry_or_complaint'
  | 'question'
  | 'neutral_unclear'

export type ClassificationResult = {
  classification: ReplyClassification
  /** Matched rule name + pattern excerpt — for audit logging */
  reason: string
}

// Warm/hot classifications — lead needs human follow-up
export const HANDOFF_CLASSIFICATIONS: ReadonlySet<ReplyClassification> = new Set<ReplyClassification>([
  'interested',
  'appointment_request',
  'callback_request',
  'question',
])

// Terminal classifications — stop automation, no outbound follow-up needed
export const TERMINAL_CLASSIFICATIONS: ReadonlySet<ReplyClassification> = new Set<ReplyClassification>([
  'not_interested',
  'already_bought',
  'wrong_number',
  'angry_or_complaint',
])

// ── Pattern rules ─────────────────────────────────────────────────────────────

type Rule = {
  classification: ReplyClassification
  name: string
  patterns: RegExp[]
}

const RULES: Rule[] = [
  // ── 1. Wrong number ──────────────────────────────────────────────────────
  {
    classification: 'wrong_number',
    name: 'wrong_number',
    patterns: [
      /who (is|are) (this|you)/i,
      /wrong (number|person|contact)/i,
      /don'?t know (you|this number|who (this|you) is)/i,
      /not the right (person|number|contact)/i,
      /i think you have the wrong/i,
      /you have the wrong/i,
      /this isn'?t .{0,20}(number|person)/i,
    ],
  },

  // ── 2. Already bought ────────────────────────────────────────────────────
  {
    classification: 'already_bought',
    name: 'already_bought',
    patterns: [
      /already (bought|purchased|got one|have one|have a car|own one)/i,
      /just (bought|purchased|got) (a |one|it|the car)/i,
      /bought (a car|one|it|already)/i,
      /purchased (a car|one|already)/i,
      /went (ahead and )?(bought|purchased)/i,
      /found (a car|one|something)/i,
    ],
  },

  // ── 3. Not interested ────────────────────────────────────────────────────
  {
    classification: 'not_interested',
    name: 'not_interested',
    patterns: [
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
    ],
  },

  // ── 4. Angry or complaint ────────────────────────────────────────────────
  {
    classification: 'angry_or_complaint',
    name: 'angry_or_complaint',
    patterns: [
      // Profanity (common terms only)
      /\b(fuck(ing)?|shit|bullshit|ass(hole)?|damn it|bastard|idiot|stupid|moron)\b/i,
      // Legal threats / harassment
      /\b(scam|fraud|spam(mer)?|harassment|harassing|stalking)\b/i,
      /\b(lawsuit|sue|lawyer|attorney|legal action|report (you|this))\b/i,
      // Anger expressions
      /how dare you/i,
      /this is (terrible|horrible|awful|outrageous|unacceptable)/i,
      /stop (harassing|bothering|texting) (me|us)/i,
      /i('m| am) (so )?(angry|furious|pissed|fed up)/i,
    ],
  },

  // ── 5. Appointment request ───────────────────────────────────────────────
  {
    classification: 'appointment_request',
    name: 'appointment_request',
    patterns: [
      /\b(appointment|test.?drive)\b/i,
      /come (in|see (you|the car)|by|visit)/i,
      /\b(schedule|book|reserve) (an? )?(appointment|time|visit|test)/i,
      /when can (i|we) (come|visit|see|swing|stop)/i,
      /set up (a |an )?(time|meeting|visit|appointment)/i,
      /can (i|we) (come|visit|see it|stop by)/i,
      /want to (come|visit|see it|stop by|check it out)/i,
    ],
  },

  // ── 6. Callback request ──────────────────────────────────────────────────
  {
    classification: 'callback_request',
    name: 'callback_request',
    patterns: [
      /call (me|us)(\s|$|,|\.)/i,
      /give (me|us) a call/i,
      /can (you|someone) (call|reach|contact) (me|us)/i,
      /please (call|ring|phone) (me|us)/i,
      /call (me )?back/i,
      /reach (me|us) (at|by|on)/i,
      /my (number|phone) is/i,
      /(i'?m|i am) available (to talk|by phone|at)/i,
    ],
  },

  // Question catch-all — fires BEFORE interested so "is it available?" → question
  // (Rules below this point are post-question.)

  // ── 7. Interested (Pass 2 — checked only after '?' catch-all) ───────────
  //   Matches affirmative signals in non-question context.
  {
    classification: 'interested',
    name: 'interested',
    patterns: [
      /\binterested\b/i,
      /tell me more/i,
      /sounds (good|great|interesting|nice|perfect)/i,
      /i'?d (like|love) (to|more information|more info|details)/i,
      /yes( please| i| ,|$)/i,
      /yeah (sure|okay|ok|i'?m|i am)/i,
      /\b(absolutely|definitely|for sure|of course)\b/i,
      /send (me )?(more )?(info|information|details|pricing|price)/i,
      /what'?s (the )?price\b/i,
      /how much (is|does|for|would)/i,
      /still (available|for sale)\b/i,
      /is (it|that) (still )?(available|for sale)\b/i,
      /\bI'?m in\b/i,
      /love to (hear|know|see|learn)/i,
    ],
  },

  // neutral_unclear is the default — no rule needed
]

// ── Classifier ────────────────────────────────────────────────────────────────

// Rules are split into two priority groups so the generic '?' check can be
// inserted between high-confidence intent rules and the softer 'interested'
// catch-all.  This ensures "is it still available?" → question, not interested,
// while "appointment" questions still → appointment_request.
//
// Pass 1: compliance/terminal + appointment + callback (indices 0–5)
// ? check (question if no specific match yet)
// Pass 2: interested (index 6)
// neutral_unclear
const PASS_1_RULES = RULES.slice(0, 6)  // wrong_number → callback_request
const PASS_2_RULES = RULES.slice(6)     // interested

/**
 * Classify an inbound SMS body into one of the ReplyClassification categories.
 * Pure, synchronous, no side effects.
 */
export function classifyReply(body: string): ClassificationResult {
  const text = body.trim()

  // Pass 1: high-confidence/specific rules (compliance-first, then appointment/callback)
  for (const rule of PASS_1_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return {
          classification: rule.classification,
          reason: `${rule.name}:/${pattern.source.slice(0, 50)}/`,
        }
      }
    }
  }

  // Question catch-all — fires AFTER appointment/callback (which already handle
  // "when can I…?" and "can you call?") but BEFORE the softer interested check.
  // This ensures "is it still available?" → question, not interested.
  if (text.includes('?')) {
    return { classification: 'question', reason: 'contains_question_mark' }
  }

  // Pass 2: softer affirmative/interest signals (non-question context only)
  for (const rule of PASS_2_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return {
          classification: rule.classification,
          reason: `${rule.name}:/${pattern.source.slice(0, 50)}/`,
        }
      }
    }
  }

  return { classification: 'neutral_unclear', reason: 'no_pattern_matched' }
}
