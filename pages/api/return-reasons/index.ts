import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { type = 'purchase' } = req.query

    // Get return reasons from database
    const returnReasons = await prisma.return_reasons.findMany({
      where: {
        type: type as string,
        status: 'Active'
      },
      select: {
        id: true,
        reason_name: true,
        type: true,
        status: true
      },
      orderBy: {
        reason_name: 'asc'
      }
    })

    res.status(200).json({
      success: true,
      data: returnReasons
    })
  } catch (error) {
    console.error('Return reasons fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch return reasons',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
