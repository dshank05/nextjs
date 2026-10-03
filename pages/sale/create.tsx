import { BillForm } from '../../components/bills/BillForm'

/** Create / edit (?edit=id) a sale (components/bills/BillForm.tsx, shared with Purchase and Invoice C). */
export default function SaleCreate() {
  return <BillForm kind="sale" />
}
