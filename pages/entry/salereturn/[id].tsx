import { ReturnView } from '../../../components/returns/ReturnView';

/** One sale or Invoice C return (?type=invoice|invoicex). */
export default function SaleReturnDetailPage() {
  return <ReturnView party="customer" />;
}
