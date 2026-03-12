import { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { customer_id, column_name, get_balance } = req.query;

    if (!customer_id) {
      return res.status(400).json({ error: 'customer_id is required' });
    }

    // If requesting current balance from master table
    if (get_balance === 'true') {
      const balance = await prisma.customer_details.findUnique({
        where: { id: parseInt(customer_id as string) },
        select: {
          total_paid: true,
          total_allocated: true,
          total_refunded: true,
          total_refund_allocated: true
        }
      });

      return res.status(200).json({ balance });
    }

    // Build where clause
    const where: any = {
      customer_id: parseInt(customer_id as string)
    };

    if (column_name && column_name !== '') {
      where.column_name = column_name as string;
    }

    // Fetch logs
    const logs = await prisma.customer_balance_logs.findMany({
      where,
      orderBy: {
        created_at: 'desc'
      },
      include: {
        customer: {
          select: {
            billing_name: true
          }
        }
      }
    });

    // Format response
    const formattedLogs = logs.map(log => ({
      id: log.id,
      customer_name: log.customer?.billing_name || 'Unknown',
      column_name: log.column_name,
      change_amount: Number(log.change_amount),
      old_value: Number(log.old_value),
      new_value: Number(log.new_value),
      source_type: log.source_type,
      reference_no: log.reference_no || '',
      created_at: log.created_at.toISOString(),
      notes: log.notes || ''
    }));

    return res.status(200).json({
      success: true,
      data: formattedLogs
    });

  } catch (error) {
    console.error('Error fetching customer balance logs:', error);
    return res.status(500).json({ error: 'Failed to fetch customer balance logs' });
  }
}
