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

    // Required fields for Stage 2.
    //
    // We dropped the Stage 1 echoes (dealership name, contact name/email,
    // mobile, website, address) because those are already in the row from
    // activation — re-requiring them just blocks the dealer at "Save".
    // Alert email, CRM, and timezone were relaxed: alert email can reuse
    // primary contact email, CRM was optional in Stage 1, timezone can be
    // defaulted from address.
    //
    // What remains required is the irreducible 10DLC carrier set:
    //   legal name, EIN, lead-source writeup, consent writeup.
    const required: [string, string][] = [
      [body.businessLegalName,     'Legal business name'],
      [body.ein,                   'EIN / Tax ID'],
      [body.leadSourceExplanation, 'Lead source explanation'],
      [body.consentExplanation,    'Consent explanation'],
    ]

    for (const [val, label] of required) {
      if (!val || String(val).trim() === '') {
        return NextResponse.json({ error: `${label} is required.` }, { status: 422 })
      }
    }

    // Launch status only advances; never regresses.
    //   info_complete = ready to submit to TCR (sample messages provided).
    //   Otherwise leave the status alone — Stage 1 already set it to
    //   'activated' and we don't want to drop back to 'submitted'.
    const infoComplete =
      str(body.sampleMessage1) !== undefined &&
      str(body.sampleMessage2) !== undefined
    const launchStatusOverride = infoComplete ? 'info_complete' : intake.launchStatus

    await db
      .update(dealerIntakes)
      .set({
        launchStatus: launchStatusOverride,
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
        // Acknowledgments only flip forward — never regress true to false
        // if the dealer happened to uncheck them in Stage 2.
        templateReviewAgreed: bool(body.templateReviewAgreed) || intake.templateReviewAgreed,
        complianceAgreed:     bool(body.complianceAgreed)     || intake.complianceAgreed,
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
