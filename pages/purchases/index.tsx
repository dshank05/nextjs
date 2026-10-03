import { BillList } from '../../components/bills/BillList'

/** The purchase list (components/bills/BillList.tsx, shared with Sale and Invoice C). */
export default function PurchasesPage() {
  return <BillList kind="purchase" />
}
