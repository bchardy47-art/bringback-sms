// Single source of truth for the version of the legal docs the dealer
// agrees to at activation time. Lives in lib/ (not app/) so it can be
// imported by both server pages and client components without dragging
// route-level exports (metadata, default page component) into a client
// bundle.
//
// Bump this whenever the substance of /terms, /privacy, or /sms-terms
// changes so the next dealer acceptance is recorded as a new version.
// dealer_intakes.terms_version stores whatever string was current at
// the moment of the dealer's click on "Activate account".
export const TERMS_VERSION = '2026-05-17'
