/**
 * Read-only verification: confirms the Batch 2 ALL20 CSV emails against
 * production dealer_prospects after import-batch2-missing-prod.ts.
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/verify-batch2-import-prod.ts
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import { db } from '../src/lib/db'
import { dealerProspects } from '../src/lib/db/schema'
import { normalizeEmail } from '../src/lib/outreach/eligibility'

const CSV_PATH = 'outputs/utah_county_dealer_prospects_batch_2_ALL20_IMPORT.csv'
// Known pre-existing (skipped by import-batch2-missing-prod.ts) — confirmed
// in both the original dry-run and this run's SKIPPED_ALREADY_EXISTED output.
const PRE_EXISTING_EMAILS = new Set(['sales@dexautogroup.com', 'motiv8dmotors@gmail.com'])

async function main() {
  const raw = fs.readFileSync(path.resolve(CSV_PATH), 'utf8')
  const parsed = Papa.parse<Record<string, string>>(raw.trim(), { header: true, skipEmptyLines: true })
  const rows = parsed.data.filter(r => (r.dealershipName ?? '').trim())
  const csvEmails = new Set(rows.map(r => normalizeEmail(r.publicEmail)).filter((e): e is string => !!e))

  const existing = await db
    .select({ publicEmail: dealerProspects.publicEmail })
    .from(dealerProspects)
  const existingEmails = new Set(
    existing.map(r => normalizeEmail(r.publicEmail)).filter((e): e is string => !!e),
  )

  const matched = [...csvEmails].filter(e => existingEmails.has(e))
  const newlyImported = matched.filter(e => !PRE_EXISTING_EMAILS.has(e))
  const preExisting = matched.filter(e => PRE_EXISTING_EMAILS.has(e))
  const stillMissing = [...csvEmails].filter(e => !existingEmails.has(e))

  console.log('VERIFY=' + JSON.stringify({
    totalCsvRows: rows.length,
    matchedImportedInProduction: matched.length,
    newlyImported: newlyImported.length,
    existing: preExisting.length,
    stillMissing: stillMissing.length,
  }))
  if (stillMissing.length) console.log('STILL_MISSING=' + JSON.stringify(stillMissing))
}

main().catch(err => {
  console.error('verify-batch2-import-prod failed:', err)
  process.exit(1)
})
