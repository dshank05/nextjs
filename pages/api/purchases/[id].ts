import { withObservability } from '../../../lib/withObservability'
import { purchaseDocumentRoute } from '../../../lib/api/purchase-routes'

/** One purchase: GET / PUT / DELETE. The work lives in lib/purchase-read.ts, lib/purchase-edit.ts and lib/purchase-delete.ts. */
export default withObservability(purchaseDocumentRoute)
