import { withObservability } from '../../../../lib/withObservability'
import { historyRoute } from '../../../../lib/product-history'

/** GET the product's last five purchase-returns — see lib/product-history.ts. */
export default withObservability(historyRoute('purchase-returns'))
