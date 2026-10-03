import { SaleForm } from '../../components/bills/SaleForm';

/** Create (and, with ?edit=id, edit) an Invoice C. The form is components/bills/SaleForm.tsx, shared with sale. */
export default function SalexCreate() {
  return <SaleForm kind="salex" />;
}
