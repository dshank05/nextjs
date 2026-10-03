import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { listPartyTransactions } from '../../../lib/party-transactions';

/** GET /api/customer-transactions: payments and refunds, one list (lib/party-transactions.ts). */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    return res.status(200).json(await listPartyTransactions('customer', req.query));
  } catch (error) {
    console.error('Error listing customer transactions:', error);
    return res.status(500).json({ error: 'Failed to list customer transactions', message: 'Failed to list customer transactions' });
  }
}
