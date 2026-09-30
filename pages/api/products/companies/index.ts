import { withObservability } from '../../../../lib/withObservability';
import { lookupCollection, COMPANY } from '../../../../lib/product-lookups';

/** GET (list) and POST (create) — see lib/product-lookups.ts. */
export default withObservability(lookupCollection(COMPANY));
