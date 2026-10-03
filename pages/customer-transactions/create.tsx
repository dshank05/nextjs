import { PartyTransactionForm } from '../../components/transactions/PartyTransactionForm'

/** Record or edit a customer receipt / payment (?edit=<id>&type=income|expense). */
export default function CustomerTransactionEntry() {
  return <PartyTransactionForm party="customer" />
}
