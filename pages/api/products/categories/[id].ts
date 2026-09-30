import { withObservability } from '../../../../lib/withObservability';
import { lookupItem, CATEGORY } from '../../../../lib/product-lookups';

/** PUT (update) and DELETE (guarded) — see lib/product-lookups.ts. */
export default withObservability(lookupItem(CATEGORY));
