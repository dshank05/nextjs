import { BillForm } from '../../components/bills/BillForm'

/** Create / edit (?edit=id) an Invoice C (components/bills/BillForm.tsx, shared with Purchase and Sale). */
export default function SalexCreate() {
  return <BillForm kind="salex" />
}
