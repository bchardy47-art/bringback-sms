import { z } from 'zod'

// Permissive normalization for dealer-entered website URLs.
//
// Accepts the formats real dealers actually type:
//   yourdealership.com
//   www.yourdealership.com
//   http://yourdealership.com
//   https://www.yourdealership.com
//   yourdealership.com/about    (path retained)
//   sub.dealer-group.co.uk      (sub-domains + multi-part TLDs)
//
// Stores the normalized form: if the input has no scheme, prepend
// `https://`. The original host/path is preserved verbatim — we don't
// strip or canonicalize `www.` either way (dealers' choice).
//
// Rejects values that don't look like a domain at all (no dot, spaces,
// obvious junk like "not a website") so we still keep garbage out of
// the carrier-registration record.
export function normalizeWebsite(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return 'https://' + trimmed
}

// Zod schema for the website field. Applies normalizeWebsite() as a
// transform, then refines on whether the result parses as a URL with a
// host that looks like a domain (letters/digits/hyphens, at least one
// dot, no whitespace).
export const websiteSchema = z
  .string()
  .trim()
  .min(3, 'Website is required')
  .max(500, 'Website is too long')
  .transform(normalizeWebsite)
  .refine(
    (v) => {
      try {
        const u = new URL(v)
        return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)
      } catch {
        return false
      }
    },
    {
      message:
        'Enter a real website (e.g. yourdealership.com or https://www.yourdealership.com)',
    },
  )
