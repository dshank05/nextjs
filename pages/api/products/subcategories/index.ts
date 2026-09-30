import { withObservability } from '../../../../lib/withObservability';
import { lookupCollection, SUBCATEGORY } from '../../../../lib/product-lookups';

/** GET (list) and POST (create) — see lib/product-lookups.ts. */
export default withObservability(lookupCollection(SUBCATEGORY));
