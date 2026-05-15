import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dealerIntakes } from '@/lib/db/schema'

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  return undefined
}

function num(v: unknown): number | undefined {
  const n = parseInt(String(v), 10)
  return isNaN(n) ? undefined : n
}

function bool(v: unknown): boolean {
  return v === 'true' || v === true || v === 'on'
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const intake = await db.query.dealerIntakes.findFirst({
      where: eq(dealerIntakes.token, params.token),
    })

    if (!intake) {
      return NextResponse.json({ error: 'Invalid intake link.' }, { status: 404 })
    }

    if (intake.submittedAt) {
      return NextResponse.json({ error: 'This intake has already been submitted.' }, { status: 409 })
    }

    const body = await req.json()

    // Validate required fields
    const required: [string, string][] = [
      [body.dealershipName,     'Dealership name'],
      [body.businessLegalName,  'Legal business name'],
      [body.ein,                'EIN / Tax ID'],
      [body.businessWebsite,    'Business website'],
      [body.businessAddress,    'Business address'],
      [body.primaryContactName, 'Primary contact name'],
      [body.primaryContactEmail,'Primary contact email'],
      [body.alertEmail,         'Alert email'],
      [body.alertPhone,         'Manager mobile'],
      [body.crmSystem,          'CRM system'],
      [body.timezone,           'Timezone'],
      [body.leadSourceExplanation, 'Lead source explanation'],
      [body.consentExplanation, 'Consent explanation'],
    ]

    for (const [val, label] of required) {
      if (!val || String(val).trim() === '') {
        return NextResponse.json({ error: `${label} is required.` }, { status: 422 })
      }
    }

    // Compute initial launch status
    // If all info is present we mark info_complete so admin sees it's ready to progress
    const infoComplete =
      str(body.sampleMessage1) !== undefined &&
      str(body.sampleMessage2) !== undefined

    const launchStatus = infoComplete ? 'info_complete' : 'submitted'

    await db
      .update(dealerIntakes)
      .set({
        launchStatus,
        dealershipName:         str(body.dealershipName),
        businessLegalName:      str(body.businessLegalName),
        ein:                    str(body.ein),
        businessWebsite:        str(body.businessWebsite),
        businessAddress:        str(body.businessAddress),
        primaryContactName:     str(body.primaryContactName),
        primaryContactEmail:    str(body.primaryContactEmail),
        primaryContactPhone:    str(body.primaryContactPhone),
        salesManagerName:       str(body.salesManagerName),
        alertEmail:             str(body.alertEmail),
        alertPhone:             str(body.alertPhone),
        storePhone:             str(body.storePhone),
        timezone:               str(body.timezone),
        businessHours:          str(body.businessHours),
        crmSystem:              str(body.crmSystem),
        leadSourceExplanation:  str(body.leadSourceExplanation),
        consentExplanation:     str(body.consentExplanation),
        expectedMonthlyVolume:  num(body.expectedMonthlyVolume),
        preferredWorkflowTypes: Array.isArray(body.preferredWorkflowTypes)
          ? body.preferredWorkflowTypes
          : [],
        sampleMessage1:       str(body.sampleMessage1),
        sampleMessage2:       str(body.sampleMessage2),
        approvedSenderName:   str(body.approvedSenderName),
        templateReviewAgreed: bool(body.templateReviewAgreed),
        complianceAgreed:     bool(body.complianceAgreed),
        submittedAt:          new Date(),
        updatedAt:            new Date(),
      })
      .where(eq(dealerIntakes.id, intake.id))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[intake POST]', err)
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 })
  }
}
