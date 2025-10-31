import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';
import { broadcast } from '../../../../lib/broadcast';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Customer ID is required' });
  }

  if (req.method === 'PUT') {
    try {
      const { status, confirmed } = req.body;

      // Validate status
      if (!['Active', 'Inactive'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status. Must be Active or Inactive.' });
      }

      // Check if confirmation is provided
      if (!confirmed) {
        return res.status(400).json({
          message: 'Confirmation required to change status',
          requiresConfirmation: true
        });
      }

      // Get current customer to check current status
      const currentCustomer = await prisma.customer_details.findUnique({
        where: { id: parseInt(id) },
        select: { status: true, billing_name: true }
      });

      if (!currentCustomer) {
        return res.status(404).json({ message: 'Customer not found' });
      }

      // Update status
      await prisma.customer_details.update({
        where: { id: parseInt(id) },
        data: { status }
      });

      // Broadcast the change
      broadcast({
        type: 'updated',
        resource: 'customers',
        id: parseInt(id),
        data: { status, name: currentCustomer.billing_name }
      });

      res.status(200).json({
        message: `Customer status updated to ${status}`,
        status
      });
    } catch (error) {
      console.error('Customer status update error:', error);
      res.status(500).json({
        message: 'Failed to update customer status',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else if (req.method === 'GET') {
    try {
      const customer = await prisma.customer_details.findUnique({
        where: { id: parseInt(id) },
        select: { status: true, billing_name: true }
      });

      if (!customer) {
        return res.status(404).json({ message: 'Customer not found' });
      }

      res.status(200).json({
        status: customer.status,
        name: customer.billing_name
      });
    } catch (error) {
      console.error('Customer status fetch error:', error);
      res.status(500).json({
        message: 'Failed to fetch customer status',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else {
    return res.status(405).json({ message: 'Method not allowed' });
  }
}
