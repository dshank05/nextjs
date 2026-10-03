import { withObservability } from '../../../lib/withObservability'
import { saleLastInvoiceRoute } from '../../../lib/api/sale-routes'

/** The last invoice number in the current financial year (as the counter sees it). */
export default withObservability(saleLastInvoiceRoute('sale'))
