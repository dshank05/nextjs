import { withObservability } from '../../../lib/withObservability'
import { saleDocumentRoute } from '../../../lib/api/sale-routes'

/** One bill: GET / PUT / DELETE. The work lives in lib/sale-read.ts, lib/sale-edit.ts and lib/sale-delete.ts. */
export default withObservability(saleDocumentRoute('salex'))
