import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'POST') {
    // Handle vendor creation
    try {
      const vendorData = {
        vendor_name: req.body.vendor_name,
        address: req.body.address || null,
        address_2: req.body.address_2 || null,
        state: req.body.state ? parseInt(req.body.state) : null,
        state_code: req.body.state_code ? parseInt(req.body.state_code) : null,
        contact_no: req.body.contact_no,
        email: req.body.email,
        tax_id: req.body.tax_id,
      };

      const vendor = await prisma.vendor_details.create({
        data: vendorData,
      });

      res.status(201).json({
        message: 'Vendor created successfully',
        vendor: {
          id: vendor.id.toString(),
          ...vendorData
        }
      });
    } catch (error) {
      console.error('Vendor creation error:', error);
      res.status(500).json({
        message: 'Failed to create vendor',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const vendors = await prisma.vendor_details.findMany({
      select: {
        id: true,
        vendor_name: true,
        address: true,
        address_2: true,
        tax_id: true,
        contact_no: true,
        email: true
      },
      orderBy: { vendor_name: 'asc' }
    })

    const formattedVendors = vendors.map(vendor => ({
      id: vendor.id.toString(),
      vendor_name: vendor.vendor_name,
      address: vendor.address || '',
      address_2: vendor.address_2 || '',
      tax_id: vendor.tax_id || '',
      contact_no: vendor.contact_no || '',
      email: vendor.email || ''
    }))

    res.status(200).json({
      vendors: formattedVendors
    })
  } catch (error) {
    console.error('Vendors fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch vendors data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
