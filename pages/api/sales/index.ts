import { withObservability } from '../../../lib/withObservability'
import { saleCollectionRoute } from '../../../lib/api/sale-routes'

/** List (GET) and create (POST). The work lives in lib/sale-query.ts and lib/sale-create.ts. */
export default withObservability(saleCollectionRoute('sale'))
