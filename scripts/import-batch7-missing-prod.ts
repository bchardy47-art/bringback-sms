/**
 * One-off, file-scoped import of ONLY the Batch 7 dealers missing from
 * production dealer_prospects.
 *
 * Scope guarantee: loads outputs/utah_dealer_prospects_batch_7_ALL20_IMPORT.csv,
 * queries production for emails/websites/(name+city) that already exist, and
 * imports ONLY the CSV rows that don't match any existing prospect by any of
 * those three keys. Existing rows are never touched — no insert, no update,
 * no cooldown/send history change.
 *
 * SAFETY:
 *   - Host guard: refuses unless DATABASE_URL resolves to a *.neon.tech host
 *     (checked via dynamic import, so it runs before any DB module loads —
 *     a static top-level import would be hoisted ahead of the guard).
 *   - Dry-run by DEFAULT. Pass --commit to actually insert.
 *   - Exact-20 CSV row guard.
 *   - Dedup on email OR website OR name+city — matched rows are SKIPPED,
 *     never updated.
 *
 * Run (dry):
 *   export DATABASE_URL=...   # from .env.production.local, verified *.neon.tech
 *   npx tsx scripts/import-batch7-missing-prod.ts
 * Run (commit):
 *   npx tsx scripts/import-batch7-missing-prod.ts --commit
 */

import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'

const CSV_PATH = 'outputs/utah_dealer_prospects_batch_7_ALL20_IMPORT.csv'
const ACTOR_EMAIL = 'brian@dlr-sms.com'
const EXPECTED_ROWS = 20
const COMMIT = process.argv.includes('--commit')

function assertNeonProductionUrl(): void {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('Refusing: DATABASE_URL is not set. Export it (verified *.neon.tech) before running.')
    process.exit(1)
  }
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    console.error('Refusing: DATABASE_URL is not a valid URL.')
    process.exit(1)
  }
  if (!/\.neon\.tech$/i.test(host)) {
    console.error(`Refusing: DATABASE_URL host "${host}" is not *.neon.tech — refusing to touch a non-production/unverified database.`)
    process.exit(1)
  }
  console.log(`DATABASE_HOST=${host}`)
}

function clean(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length ? s : null
}
function normWebsite(w: string | null): string {
  return (w ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
}
function keyNameCity(n: string, c: string | null): string {
  return `${n.trim().toLowerCase()}|${(c ?? '').trim().toLowerCase()}`
}

async function main() {
  assertNeonProductionUrl()

  const raw = fs.readFileSync(path.resolve(CSV_PATH), 'utf8')
  const parsed = Papa.parse<Record<string, string>>(raw.trim(), { header: true, skipEmptyLines: true })
  const rows = parsed.data.filter(r => (r.dealershipName ?? '').trim())
  console.log(`CSV=${CSV_PATH}`)
  console.log(`CSV_ROWS=${rows.length}`)
  if (rows.length !== EXPECTED_ROWS) {
    console.error(`Refusing: expected exactly ${EXPECTED_ROWS} rows, found ${rows.length}.`)
    process.exit(1)
  }

  // Dynamic imports so nothing DB-related loads before the host guard above.
  const { db } = await import('../src/lib/db')
  const { dealerProspects } = await import('../src/lib/db/schema')
  const { normalizeEmail, isValidEmail } = await import('../src/lib/outreach/eligibility')

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
  for (const e of existing) {
    if (e.publicEmail) byEmail.set(e.publicEmail.toLowerCase(), e.id)
    const nw = normWebsite(e.website)
    if (nw) byWebsite.set(nw, e.id)
    byNameCity.set(keyNameCity(e.dealershipName, e.city), e.id)
  }

  let wouldCreate = 0, skippedDuplicates = 0
  const createdNames: string[] = []
  const skippedNames: string[] = []

  for (const r of rows) {
    const dealershipName = clean(r.dealershipName)
    if (!dealershipName) continue
    const city = clean(r.city)
    const state = clean(r.state)
    const website = clean(r.website)
    const mainPhone = clean(r.mainPhone)
    const publicEmailRaw = clean(r.publicEmail)
    const publicEmail = publicEmailRaw ? normalizeEmail(publicEmailRaw) : null
    const sourceUrl = clean(r.sourceUrl)
    const bestContactName = clean(r.bestContactName)
    const bestContactTitle = clean(r.bestContactTitle)
    const fitNotes = clean(r.fitNotes)

    const dupId =
      (publicEmail && byEmail.get(publicEmail)) ||
      (normWebsite(website) && byWebsite.get(normWebsite(website))) ||
      byNameCity.get(keyNameCity(dealershipName, city)) ||
      null

    if (dupId) {
      skippedDuplicates++
      skippedNames.push(`${dealershipName} <${publicEmail ?? '(no email)'}>`)
      continue
    }

    const status = publicEmail && !isValidEmail(publicEmail)
      ? 'bad_email'
      : publicEmail
        ? (sourceUrl ? 'ready' : 'new')
        : 'missing_contact'

    if (COMMIT) {
      const insertedId = await db
        .insert(dealerProspects)
        .values({
          dealershipName, city, state, website, mainPhone,
          publicEmail, sourceUrl, bestContactName, bestContactTitle, fitNotes,
          priority: 'B',
          status,
          createdByEmail: ACTOR_EMAIL,
        })
        .returning({ id: dealerProspects.id })
      if (publicEmail) byEmail.set(publicEmail, insertedId[0]?.id ?? 'pending')
      const nw = normWebsite(website)
      if (nw) byWebsite.set(nw, insertedId[0]?.id ?? 'pending')
      byNameCity.set(keyNameCity(dealershipName, city), insertedId[0]?.id ?? 'pending')
    }

    wouldCreate++
    createdNames.push(`${dealershipName} <${publicEmail ?? '(no email)'}>`)
  }

  console.log(`MODE=${COMMIT ? 'COMMIT' : 'DRY_RUN'}`)
  console.log('IMPORT_SUMMARY=' + JSON.stringify({
    totalRows: rows.length,
    wouldCreate, skippedDuplicates, committed: COMMIT,
  }))
  console.log(`${COMMIT ? 'CREATED' : 'WOULD_CREATE'}=` + JSON.stringify(createdNames))
  console.log('SKIPPED_ALREADY_EXISTED=' + JSON.stringify(skippedNames))
}

main().catch(err => {
  console.error('import-batch7-missing-prod failed:', err)
  process.exit(1)
})
