import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';
import { broadcast } from '../../../../lib/broadcast';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Vendor ID is required' });
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

      // Get current vendor to check current status
      const currentVendor = await prisma.vendor_details.findUnique({
        where: { id: parseInt(id) },
        select: { status: true, vendor_name: true }
      });

      if (!currentVendor) {
        return res.status(404).json({ message: 'Vendor not found' });
      }

      // Update status
      await prisma.vendor_details.update({
        where: { id: parseInt(id) },
        data: { status }
      });

      // Broadcast the change
      broadcast({
        type: 'updated',
        resource: 'vendors',
        id: parseInt(id),
        data: { status, name: currentVendor.vendor_name }
      });

      res.status(200).json({
        message: `Vendor status updated to ${status}`,
        status
      });
    } catch (error) {
      console.error('Vendor status update error:', error);
      res.status(500).json({
        message: 'Failed to update vendor status',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else if (req.method === 'GET') {
    try {
      const vendor = await prisma.vendor_details.findUnique({
        where: { id: parseInt(id) },
        select: { status: true, vendor_name: true }
      });

      if (!vendor) {
        return res.status(404).json({ message: 'Vendor not found' });
      }

      res.status(200).json({
        status: vendor.status,
        name: vendor.vendor_name
      });
    } catch (error) {
      console.error('Vendor status fetch error:', error);
      res.status(500).json({
        message: 'Failed to fetch vendor status',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else {
    return res.status(405).json({ message: 'Method not allowed' });
  }
}
