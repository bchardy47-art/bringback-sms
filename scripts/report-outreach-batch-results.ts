import 'dotenv/config'
import { desc, eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { dealerProspects, outreachSends, outreachTemplates } from '../src/lib/db/schema'

const TEMPLATE_KEY = 'dlr_pilot_invite_v1_red_revival'
const BRIAN = 'brian@dlr-sms.com'

async function main() {
  const [tpl] = await db
    .select({ id: outreachTemplates.id, key: outreachTemplates.key })
    .from(outreachTemplates)
    .where(eq(outreachTemplates.key, TEMPLATE_KEY))
    .limit(1)

  if (!tpl) {
    console.error(`Template not found: ${TEMPLATE_KEY}`)
    process.exit(1)
  }

  const rows = await db
    .select({
      id: outreachSends.id,
      createdAt: outreachSends.createdAt,
      toEmail: outreachSends.toEmail,
      subject: outreachSends.subject,
      status: outreachSends.status,
      failureReason: outreachSends.failureReason,
      skipReason: outreachSends.skipReason,
      providerMessageId: outreachSends.providerMessageId,
      sentByEmail: outreachSends.sentByEmail,
      isTest: outreachSends.isTest,
      prospectId: outreachSends.prospectId,
      dealershipName: dealerProspects.dealershipName,
    })
    .from(outreachSends)
    .leftJoin(dealerProspects, eq(dealerProspects.id, outreachSends.prospectId))
    .where(eq(outreachSends.templateId, tpl.id))
    .orderBy(desc(outreachSends.createdAt))

  const liveRows = rows.filter(r => !r.isTest)
  const sentRows = liveRows.filter(r => r.status === 'sent')
  const failedRows = liveRows.filter(r => r.status === 'failed')
  const skippedRows = liveRows.filter(r => r.status === 'skipped')

  console.log('LIVE_SENT_TOTAL=' + sentRows.length)
  console.log('LIVE_RECIPIENTS=' + JSON.stringify(sentRows.map(r => ({
    dealershipName: r.dealershipName,
    toEmail: r.toEmail,
    createdAt: r.createdAt,
    providerMessageId: r.providerMessageId,
  }))))
  console.log('FAILURES=' + JSON.stringify(failedRows.map(r => ({
    dealershipName: r.dealershipName,
    toEmail: r.toEmail,
    createdAt: r.createdAt,
    failureReason: r.failureReason,
  }))))
  console.log('SKIPPED=' + JSON.stringify(skippedRows.map(r => ({
    dealershipName: r.dealershipName,
    toEmail: r.toEmail,
    createdAt: r.createdAt,
    skipReason: r.skipReason,
  }))))
  console.log('SUBJECTS_USED=' + JSON.stringify(Array.from(new Set(liveRows.map(r => r.subject)))))
  console.log('ANY_TO_BRIAN=' + liveRows.some(r => (r.toEmail ?? '').toLowerCase() === BRIAN))
  console.log('LATEST_TIMESTAMPS=' + JSON.stringify(liveRows.slice(0, 20).map(r => ({
    status: r.status,
    toEmail: r.toEmail,
    createdAt: r.createdAt,
  }))))
  console.log('FINAL_SUMMARY=' + JSON.stringify({
    totalLiveRows: liveRows.length,
    totalSent: sentRows.length,
    totalFailed: failedRows.length,
    totalSkipped: skippedRows.length,
    latestLiveAt: liveRows[0]?.createdAt ?? null,
    earliestLiveAt: liveRows[liveRows.length - 1]?.createdAt ?? null,
  }))
}

main().catch(err => {
  console.error('report-outreach-batch-results failed:', err)
  process.exit(1)
})
