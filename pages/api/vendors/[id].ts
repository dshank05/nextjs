import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  if (req.method === 'GET') {
    try {
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: 'Vendor ID is required' })
      }

      const vendor = await prisma.vendor_details.findUnique({
        where: { id: parseInt(id) }
      })

      if (!vendor) {
        return res.status(404).json({ message: 'Vendor not found' })
      }

      // Fetch state name separately
      const state = vendor.state ? await prisma.states.findUnique({ where: { id: vendor.state } }) : null

      const formattedVendor = {
        id: vendor.id.toString(),
        vendor_name: vendor.vendor_name,
        address: vendor.address,
        address_2: vendor.address_2,
        state: state?.state_name || null,
        state_code: vendor.state_code || null,
        contact_no: vendor.contact_no,
        email: vendor.email,
        tax_id: vendor.tax_id
      }

      res.status(200).json(formattedVendor)
    } catch (error) {
      console.error('Vendor fetch error:', error)
      res.status(500).json({
        message: 'Failed to fetch vendor',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  } else if (req.method === 'PUT') {
    // Update vendor
    try {
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: 'Vendor ID is required' })
      }

      const vendorData = {
        vendor_name: req.body.vendor_name,
        address: req.body.address,
        address_2: req.body.address_2 || null,
        state: parseInt(req.body.state),
        state_code: parseInt(req.body.state_code),
        contact_no: req.body.contact_no || null,
        email: req.body.email || null,
        tax_id: req.body.tax_id || null,
      };

      const vendor = await prisma.vendor_details.update({
        where: { id: parseInt(id) },
        data: vendorData
      });

      // Fetch state name separately
      const state = vendor.state ? await prisma.states.findUnique({ where: { id: vendor.state } }) : null

      const formattedVendor = {
        id: vendor.id.toString(),
        vendor_name: vendor.vendor_name,
        address: vendor.address,
        address_2: vendor.address_2,
        state: state?.state_name || null,
        state_code: vendor.state_code || null,
        contact_no: vendor.contact_no,
        email: vendor.email,
        tax_id: vendor.tax_id
      }

      res.status(200).json({
        message: 'Vendor updated successfully',
        vendor: formattedVendor
      });
    } catch (error) {
      console.error('Vendor update error:', error);
      res.status(500).json({
        message: 'Failed to update vendor',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else if (req.method === 'DELETE') {
    try {
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: 'Vendor ID is required' })
      }

      await prisma.vendor_details.delete({
        where: { id: parseInt(id) }
      });

      res.status(200).json({ message: 'Vendor deleted successfully' });
    } catch (error) {
      console.error('Vendor delete error:', error);
      res.status(500).json({
        message: 'Failed to delete vendor',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else {
    return res.status(405).json({ message: 'Method not allowed' })
  }
}
