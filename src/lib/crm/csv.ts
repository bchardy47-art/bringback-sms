import Papa from 'papaparse'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { db } from '@/lib/db'
import { leads } from '@/lib/db/schema'

interface CsvRow {
  first_name?: string
  firstName?: string
  last_name?: string
  lastName?: string
  phone?: string
  email?: string
  vehicle_of_interest?: string
  vehicleOfInterest?: string
  salesperson_name?: string
  salespersonName?: string
  crm_lead_id?: string
  last_activity?: string
  [key: string]: string | undefined
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export async function importLeadsFromCsv(
  csvText: string,
  tenantId: string
): Promise<ImportResult> {
  const result = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true })
  const errors: string[] = []
  let imported = 0
  let skipped = 0

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i]
    const rowNum = i + 2 // account for header row
    const firstName = (row.first_name ?? row.firstName ?? '').trim()
    const lastName = (row.last_name ?? row.lastName ?? '').trim()
    const rawPhone = (row.phone ?? '').trim()

    if (!firstName || !lastName) {
      errors.push(`Row ${rowNum}: missing first_name or last_name`)
      skipped++
      continue
    }

    if (!rawPhone) {
      errors.push(`Row ${rowNum}: missing phone`)
      skipped++
      continue
    }

    const parsed = parsePhoneNumberFromString(rawPhone, 'US')
    if (!parsed?.isValid()) {
      errors.push(`Row ${rowNum}: invalid phone "${rawPhone}"`)
      skipped++
      continue
    }

    const phone = parsed.format('E.164')
    const lastCrmActivityAt = row.last_activity ? new Date(row.last_activity) : null

    try {
      await db
        .insert(leads)
        .values({
          tenantId,
          crmSource: 'csv',
          crmLeadId: row.crm_lead_id?.trim() ?? null,
          firstName,
          lastName,
          phone,
          email: row.email?.trim() ?? null,
          vehicleOfInterest:
            (row.vehicle_of_interest ?? row.vehicleOfInterest ?? '').trim() || null,
          salespersonName:
            (row.salesperson_name ?? row.salespersonName ?? '').trim() || null,
          lastCrmActivityAt,
          state: 'active',
        })
        .onConflictDoNothing() // skip if same tenant+crmSource+crmLeadId already exists
      imported++
    } catch (err) {
      errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : String(err)}`)
      skipped++
    }
  }

  return { imported, skipped, errors }
}
