/**
 * /admin/dealers — index. The canonical dealer list still lives at
 * /admin/dlr/dealers; this thin redirect gives the primary "Dealers" nav
 * item a stable home under the /admin/dealers prefix (where per-dealer
 * detail pages already live) without duplicating the list UI.
 */
import { redirect } from 'next/navigation'

export default function AdminDealersIndex() {
  redirect('/admin/dlr/dealers')
}
