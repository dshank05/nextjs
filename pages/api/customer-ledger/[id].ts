import { withObservability } from '../../../lib/withObservability'
import { ledgerNoteRoute } from '../../../lib/api/ledger-note-route'

/** PATCH a customer ledger row's note (the page called this route; it did not exist). */
export default withObservability(ledgerNoteRoute('customer_ledger'))
