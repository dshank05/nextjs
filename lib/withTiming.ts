import type { NextApiRequest, NextApiResponse, NextApiHandler } from 'next'

export function withTiming(handler: NextApiHandler) {
  return async function timedHandler(req: NextApiRequest, res: NextApiResponse) {
    const start = process.hrtime.bigint()

    // Wrap res.json to measure response duration
    const originalJson = res.json.bind(res)
    res.json = (data: any) => {
      const end = process.hrtime.bigint()
      const durationMs = Number(end - start) / 1_000_000
      console.log(`[API] ${req.method} ${req.url} - ${durationMs.toFixed(2)}ms`)
      return originalJson(data)
    }

    return handler(req, res)
  }
}