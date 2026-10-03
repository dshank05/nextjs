import { SaleForm } from '../../components/bills/SaleForm';

/** Create (and, with ?edit=id, edit) a sale. The form is components/bills/SaleForm.tsx, shared with Invoice C. */
export default function SaleCreate() {
  return <SaleForm kind="sale" />;
}
