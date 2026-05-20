/**
 * Dealer-facing compliance attestation copy + version.
 *
 * The exact text the dealer ticks is snapshotted into the
 * compliance_attestations row alongside its version string, so a future
 * copy edit doesn't rewrite history. Bump the version when the text
 * changes; old rows keep their original v.
 *
 * Versions are short strings ('v1', 'v2', ...) rather than dates so the
 * audit trail is stable across timezone/rendering edge cases.
 */

// ── Lead upload certification ──────────────────────────────────────────────

export const LEAD_UPLOAD_CERT_VERSION = 'v1'
export const LEAD_UPLOAD_CERT_TEXT =
  'I certify that this dealership has the right to contact these leads ' +
  'by SMS, that the data was lawfully collected, that any required ' +
  'consent exists, and that no uploaded contact has opted out or ' +
  'requested not to be contacted.'

// ── Campaign launch approval ───────────────────────────────────────────────

export const CAMPAIGN_APPROVAL_VERSION = 'v1'
export const CAMPAIGN_APPROVAL_TEXT =
  'I approve DLR to begin sending the reviewed campaign messages on ' +
  'behalf of this dealership.'
