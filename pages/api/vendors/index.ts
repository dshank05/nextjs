import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const vendors = await prisma.vendor_details.findMany({
      select: {
        id: true,
        vendor_name: true,
        tax_id: true,
        contact_no: true,
        email: true
      },
      orderBy: { vendor_name: 'asc' }
    })

    const formattedVendors = vendors.map(vendor => ({
      id: vendor.id.toString(),
      name: vendor.vendor_name,
      gstin: vendor.tax_id || '',
      contact: vendor.contact_no || '',
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
