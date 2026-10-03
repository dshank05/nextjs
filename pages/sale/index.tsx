import { BillList } from '../../components/bills/BillList'

/** The sale list (components/bills/BillList.tsx, shared with Purchase and Invoice C). */
export default function SalesPage() {
  return <BillList kind="sale" />
}
