import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/requireAuth'
import { importLeadsFromCsv } from '@/lib/crm/csv'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { session, error } = await requireAuth()
  if (error) return error

  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const text = await (file as File).text()
  if (!text.trim()) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 })
  }

  const result = await importLeadsFromCsv(text, session.user.tenantId)

  return NextResponse.json(result, { status: result.imported > 0 ? 200 : 422 })
}
