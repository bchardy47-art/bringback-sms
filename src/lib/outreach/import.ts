/**
 * Prospect import — parse pasted CSV/TSV into dealer_prospects with dedup,
 * validation, and safe status derivation.
 *
 * Rules (from the outreach spec):
 *   • dedup on website OR email OR (dealershipName + city) — duplicates UPDATE
 *     the existing row's empty fields rather than creating a second prospect.
 *   • emails normalized lowercase + trimmed + shape-validated.
 *   • a source URL is REQUIRED for an emailed prospect to become "ready".
 *   • no email but a contact-form URL → status "missing_contact" (never auto-
 *     submit a form, never guess an email).
 *
 * Pure data path: never sends anything.
 */

import 'server-only'
import Papa from 'papaparse'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerProspects, type ProspectStatus } from '@/lib/db/schema'
import { isValidEmail, normalizeEmail } from './eligibility'

type Actor = { id: string; email: string }

export type ImportSummary = {
  created: number
  updated: number
  skippedDuplicates: number
  missingRequired: number
  invalidEmails: number
  rowErrors: Array<{ row: number; message: string }>
  totalRows: number
}

// Header aliases → canonical field. Lowercased, non-alphanumerics stripped.
const HEADER_MAP: Record<string, string> = {
  dealershipname: 'dealershipName',
  dealership: 'dealershipName',
  name: 'dealershipName',
  citystate: 'cityState',
  city: 'city',
  state: 'state',
  website: 'website',
  url: 'website',
  mainphone: 'mainPhone',
  phone: 'mainPhone',
  publicemail: 'publicEmail',
  email: 'publicEmail',
  contactformurl: 'contactFormUrl',
  contactform: 'contactFormUrl',
  bestcontactperson: 'bestContactName',
  bestcontact: 'bestContactName',
  contactperson: 'bestContactName',
  contactname: 'bestContactName',
  contacttitle: 'bestContactTitle',
  title: 'bestContactTitle',
  sourceurl: 'sourceUrl',
  source: 'sourceUrl',
  notesondealershipfit: 'fitNotes',
  fitnotes: 'fitNotes',
  notes: 'sourceNotes',
  outreachpriority: 'priority',
  priority: 'priority',
  suggestedpersonalizationline: 'personalizationLine',
  personalizationline: 'personalizationLine',
  personalization: 'personalizationLine',
}

function canonHeader(h: string): string | null {
  const key = h.toLowerCase().replace(/[^a-z0-9]/g, '')
  return HEADER_MAP[key] ?? null
}

function normPriority(raw?: string): 'A' | 'B' | 'C' {
  const v = (raw ?? '').trim().toUpperCase()
  if (v === 'A' || v.startsWith('HIGH') || v === '1') return 'A'
  if (v === 'C' || v.startsWith('LOW') || v === '3') return 'C'
  return 'B'
}

function splitCityState(raw: string): { city?: string; state?: string } {
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length >= 2) return { city: parts[0], state: parts[1] }
  if (parts.length === 1) return { city: parts[0] }
  return {}
}

type ParsedProspect = {
  dealershipName: string
  city: string | null
  state: string | null
  website: string | null
  mainPhone: string | null
  publicEmail: string | null
  contactFormUrl: string | null
  bestContactName: string | null
  bestContactTitle: string | null
  sourceUrl: string | null
  sourceNotes: string | null
  fitNotes: string | null
  priority: 'A' | 'B' | 'C'
  personalizationLine: string | null
}

function clean(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length ? s : null
}

/** Decide the import status from what contact info is present. */
export function deriveStatus(p: { publicEmail: string | null; sourceUrl: string | null; contactFormUrl: string | null }): ProspectStatus {
  if (p.publicEmail && !isValidEmail(p.publicEmail)) return 'bad_email'
  if (p.publicEmail && isValidEmail(p.publicEmail)) {
    return p.sourceUrl ? 'ready' : 'new' // needs a source URL before it's "ready"
  }
  // no usable email
  if (p.contactFormUrl) return 'missing_contact' // contact-form-only; never auto-submit
  return 'missing_contact'
}

export async function importProspects(rawText: string, actor: Actor): Promise<ImportSummary> {
  const summary: ImportSummary = {
    created: 0, updated: 0, skippedDuplicates: 0, missingRequired: 0,
    invalidEmails: 0, rowErrors: [], totalRows: 0,
  }

  const parsed = Papa.parse<Record<string, string>>(rawText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h, // keep raw; we canonicalize ourselves
  })

  if (!parsed.data.length) return summary

  // Remap each row's keys to canonical field names.
  const rows: ParsedProspect[] = []
  parsed.data.forEach((raw, i) => {
    summary.totalRows++
    const mapped: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      const c = canonHeader(k)
      if (c) mapped[c] = v
    }

    const dealershipName = clean(mapped.dealershipName)
    if (!dealershipName) {
      summary.missingRequired++
      summary.rowErrors.push({ row: i + 2, message: 'Missing dealership name' })
      return
    }

    let city = clean(mapped.city)
    let state = clean(mapped.state)
    if (mapped.cityState) {
      const cs = splitCityState(mapped.cityState)
      city = city ?? cs.city ?? null
      state = state ?? cs.state ?? null
    }

    const publicEmailRaw = clean(mapped.publicEmail)
    const publicEmail = publicEmailRaw ? normalizeEmail(publicEmailRaw) : null
    if (publicEmail && !isValidEmail(publicEmail)) summary.invalidEmails++

    rows.push({
      dealershipName,
      city, state,
      website: clean(mapped.website),
      mainPhone: clean(mapped.mainPhone),
      publicEmail,
      contactFormUrl: clean(mapped.contactFormUrl),
      bestContactName: clean(mapped.bestContactName),
      bestContactTitle: clean(mapped.bestContactTitle),
      sourceUrl: clean(mapped.sourceUrl),
      sourceNotes: clean(mapped.sourceNotes),
      fitNotes: clean(mapped.fitNotes),
      priority: normPriority(mapped.priority),
      personalizationLine: clean(mapped.personalizationLine),
    })
  })

  if (!rows.length) return summary

  // Load existing prospects to dedup against (small table).
  const existing = await db
    .select({
      id: dealerProspects.id,
      dealershipName: dealerProspects.dealershipName,
      city: dealerProspects.city,
      website: dealerProspects.website,
      publicEmail: dealerProspects.publicEmail,
    })
    .from(dealerProspects)

  const byEmail = new Map<string, string>()
  const byWebsite = new Map<string, string>()
  const byNameCity = new Map<string, string>()
  const keyNameCity = (n: string, c: string | null) =>
    `${n.trim().toLowerCase()}|${(c ?? '').trim().toLowerCase()}`
  const normWebsite = (w: string | null) =>
    (w ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')

  for (const e of existing) {
    if (e.publicEmail) byEmail.set(e.publicEmail.toLowerCase(), e.id)
    const nw = normWebsite(e.website)
    if (nw) byWebsite.set(nw, e.id)
    byNameCity.set(keyNameCity(e.dealershipName, e.city), e.id)
  }

  for (const r of rows) {
    const dupId =
      (r.publicEmail && byEmail.get(r.publicEmail)) ||
      (normWebsite(r.website) && byWebsite.get(normWebsite(r.website))) ||
      byNameCity.get(keyNameCity(r.dealershipName, r.city)) ||
      null

    const status = deriveStatus(r)

    // A duplicate that appeared earlier in THIS same paste — skip without a DB hit.
    if (dupId === 'pending') {
      summary.skippedDuplicates++
      continue
    }

    if (dupId) {
      // Update only EMPTY fields on the existing row — never clobber curated data.
      const cur = await db.select().from(dealerProspects).where(eq(dealerProspects.id, dupId)).limit(1)
      const row = cur[0]
      if (!row) { summary.skippedDuplicates++; continue }
      const patch: Partial<typeof dealerProspects.$inferInsert> = {}
      const fill = <K extends keyof ParsedProspect>(k: K, col: keyof typeof dealerProspects.$inferInsert) => {
        const incoming = r[k]
        if (incoming && !(row as Record<string, unknown>)[col as string]) {
          ;(patch as Record<string, unknown>)[col as string] = incoming
        }
      }
      fill('city', 'city'); fill('state', 'state'); fill('website', 'website')
      fill('mainPhone', 'mainPhone'); fill('publicEmail', 'publicEmail')
      fill('contactFormUrl', 'contactFormUrl'); fill('bestContactName', 'bestContactName')
      fill('bestContactTitle', 'bestContactTitle'); fill('sourceUrl', 'sourceUrl')
      fill('sourceNotes', 'sourceNotes'); fill('fitNotes', 'fitNotes')
      fill('personalizationLine', 'personalizationLine')

      if (Object.keys(patch).length === 0) {
        summary.skippedDuplicates++
        continue
      }
      patch.updatedAt = new Date()
      await db.update(dealerProspects).set(patch).where(eq(dealerProspects.id, dupId))
      summary.updated++
      continue
    }

    await db.insert(dealerProspects).values({
      dealershipName: r.dealershipName,
      city: r.city, state: r.state, website: r.website, mainPhone: r.mainPhone,
      publicEmail: r.publicEmail, contactFormUrl: r.contactFormUrl,
      bestContactName: r.bestContactName, bestContactTitle: r.bestContactTitle,
      sourceUrl: r.sourceUrl, sourceNotes: r.sourceNotes, fitNotes: r.fitNotes,
      priority: r.priority, personalizationLine: r.personalizationLine,
      status,
      createdByUserId: /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null,
      createdByEmail: actor.email,
    })
    summary.created++

    // Track within this import so two identical pasted rows don't both insert.
    if (r.publicEmail) byEmail.set(r.publicEmail, 'pending')
    const nw = normWebsite(r.website)
    if (nw) byWebsite.set(nw, 'pending')
    byNameCity.set(keyNameCity(r.dealershipName, r.city), 'pending')
  }

  return summary
}
