import { PartyTransactionForm } from '../../components/transactions/PartyTransactionForm'

/** Record or edit a vendor payment / refund (?edit=<id>&type=expense|income). */
export default function VendorTransactionEntry() {
  return <PartyTransactionForm party="vendor" />
}
