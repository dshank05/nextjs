import { withObservability } from '../../../lib/withObservability'
import { purchaseCollectionRoute } from '../../../lib/api/purchase-routes'

/** List (GET) and create (POST). The work lives in lib/purchase-query.ts and lib/purchase-create.ts. */
export default withObservability(purchaseCollectionRoute)
