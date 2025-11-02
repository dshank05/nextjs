import type { NextApiRequest, NextApiResponse } from 'next';
import { getQueryStats } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const stats = getQueryStats();

    // Group by query pattern to identify duplicates
    const groupedStats = stats.reduce((acc: any, stat) => {
      const queryPattern = stat.query.replace(/\d+/g, '?').replace(/'[^']*'/g, '?');
      if (!acc[queryPattern]) {
        acc[queryPattern] = [];
      }
      acc[queryPattern].push(stat);
      return acc;
    }, {});

    const analysis = {
      totalQueries: stats.length,
      duplicateQueries: Object.keys(groupedStats).filter(key =>
        groupedStats[key].length > 1
      ).length,
      mostFrequent: stats.slice(0, 10),
      groupedByPattern: groupedStats,
      timestamp: new Date().toISOString()
    };

    res.status(200).json(analysis);
  } catch (error) {
    console.error('Query stats error:', error);
    res.status(500).json({
      message: 'Failed to get query statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
