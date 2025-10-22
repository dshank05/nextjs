import type { NextApiRequest, NextApiResponse } from 'next';

export function withObservability(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const start = performance.now();

    console.log(`🚀 [${req.method}] ${req.url} - Start`);

    try {
      await handler(req, res);
    } catch (err) {
      console.error(`❌ [${req.method}] ${req.url} - Error:`, err);
      throw err;
    } finally {
      const duration = (performance.now() - start).toFixed(2);
      console.log(`✅ [${req.method}] ${req.url} - Completed in ${duration} ms`);
    }
  };
}
