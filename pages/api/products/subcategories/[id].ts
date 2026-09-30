import { withObservability } from '../../../../lib/withObservability';
import { lookupItem, SUBCATEGORY } from '../../../../lib/product-lookups';

/** PUT (update) and DELETE (guarded) — see lib/product-lookups.ts. */
export default withObservability(lookupItem(SUBCATEGORY));
