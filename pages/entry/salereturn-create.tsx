import { ReturnForm } from '../../components/returns/ReturnForm';

/** Create (?invoice=<id>&type=) or edit (?id=&type=) a sale / Invoice C return. */
export default function SaleReturnCreatePage() {
  return <ReturnForm party="customer" />;
}
