import { BillForm } from '../../components/bills/BillForm'

/** Create / edit (?edit=id) a purchase (components/bills/BillForm.tsx, shared with Sale and Invoice C). */
export default function PurchaseCreate() {
  return <BillForm kind="purchase" />
}
