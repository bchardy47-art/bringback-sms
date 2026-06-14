import { redirect } from 'next/navigation'

// /dealer/upload is not a real route — redirect to the correct import page.
export default function DealerUploadRedirect() {
  redirect('/dealer/import')
}
