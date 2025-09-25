import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'POST') {
    // Handle customer creation
    try {
      const customerData = {
        billing_name: req.body.billing_name,
        billing_address: req.body.billing_address,
        billing_state: parseInt(req.body.billing_state),
        billing_state_code: parseInt(req.body.billing_state_code),
        billing_gstin: req.body.billing_gstin,
        contact_no: req.body.contact_no,
        email: req.body.email,
        shipping_name: req.body.shipping_name || null,
        shipping_address: req.body.shipping_address || null,
        shipping_state: req.body.shipping_state ? parseInt(req.body.shipping_state) : null,
        shipping_state_code: req.body.shipping_state_code ? parseInt(req.body.shipping_state_code) : null,
        shipping_gstin: req.body.shipping_gstin || null,
      };

      const customer = await prisma.customer_details.create({
        data: customerData,
      });

      res.status(201).json({
        message: 'Customer created successfully',
        customer: {
          id: customer.id.toString(),
          ...customerData
        }
      });
    } catch (error) {
      console.error('Customer creation error:', error);
      res.status(500).json({
        message: 'Failed to create customer',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const customers = await prisma.customer_details.findMany({
      select: {
        id: true,
        billing_name: true,
        billing_address: true,
        billing_gstin: true,
        contact_no: true,
        email: true,
        shipping_name: true,
        shipping_address: true,
        shipping_gstin: true
      },
      orderBy: { billing_name: 'asc' }
    })

    const formattedCustomers = customers.map(customer => ({
      id: customer.id.toString(),
      billing_name: customer.billing_name,
      billing_address: customer.billing_address || '',
      billing_gstin: customer.billing_gstin || '',
      contact_no: customer.contact_no || '',
      email: customer.email || '',
      shipping_name: customer.shipping_name || '',
      shipping_address: customer.shipping_address || '',
      shipping_gstin: customer.shipping_gstin || ''
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
