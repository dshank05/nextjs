import type { NextApiRequest, NextApiResponse } from 'next';

export function withObservability(
  // Promise<unknown>, not Promise<void>. Handlers in this codebase are written
  // both ways - some end with `res.json(...)`, some `return res.json(...)` -
  // and the narrower type rejected every handler of the second kind, which is
  // why the busiest product route could not be wrapped (F-89). The return value
  // is ignored either way; Next.js takes the response from `res`.
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>
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
