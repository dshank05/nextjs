import { ReturnForm } from '../../components/returns/ReturnForm';

/** Create (?purchase=<id>) or edit (?id=) a purchase return. */
export default function PurchaseReturnVendorCreatePage() {
  return <ReturnForm party="vendor" />;
}
