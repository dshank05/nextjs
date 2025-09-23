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
    const customers = await prisma.customer_details.findMany({
      select: {
        id: true,
        billing_name: true,
        billing_gstin: true,
        contact_no: true,
        email: true
      },
      orderBy: { billing_name: 'asc' }
    })

    const formattedCustomers = customers.map(customer => ({
      id: customer.id.toString(),
      name: customer.billing_name,
      gstin: customer.billing_gstin || '',
      contact: customer.contact_no || '',
      email: customer.email || ''
    }))

    res.status(200).json({
      customers: formattedCustomers
    })
  } catch (error) {
    console.error('Customers fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch customers data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
