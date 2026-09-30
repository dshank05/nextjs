import { withObservability } from '../../../../lib/withObservability';
import { lookupCollection, CAR_MODEL } from '../../../../lib/product-lookups';

/** GET (list) and POST (create) — see lib/product-lookups.ts. */
export default withObservability(lookupCollection(CAR_MODEL));
