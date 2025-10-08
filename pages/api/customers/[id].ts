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
        return res.status(400).json({ message: 'Customer ID is required' })
      }

      const customer = await prisma.customer_details.findUnique({
        where: { id: parseInt(id) }
      })

      if (!customer) {
        return res.status(404).json({ message: 'Customer not found' })
      }



      const formattedCustomer = {
        id: customer.id.toString(),
        billing_name: customer.billing_name,
        // ===== BILLING ADDRESS (Consistent with vendor pattern) =====
        billing_address: customer.billing_address,
        billing_address_2: customer.billing_address_2 || null, // NEW: Additional address field
        billing_city: customer.billing_city || null,
        billing_state: customer.billing_state,          // State name from DB
        billing_state_code: customer.billing_state_code, // State code from DB
        billing_gstin: customer.billing_gstin,
        contact_no: customer.contact_no,
        email: customer.email,
        shipping_name: customer.shipping_name,
        // ===== SHIPPING ADDRESS (Consistent with vendor pattern) =====
        shipping_address: customer.shipping_address,
        shipping_address_2: customer.shipping_address_2 || null, // NEW: Additional address field
        shipping_city: customer.shipping_city || null,
        shipping_state: customer.shipping_state,        // State name from DB
        shipping_state_code: customer.shipping_state_code, // State code from DB
        shipping_gstin: customer.shipping_gstin
      }

      res.status(200).json(formattedCustomer)
    } catch (error) {
      console.error('Customer fetch error:', error)
      res.status(500).json({
        message: 'Failed to fetch customer',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  } else if (req.method === 'PUT') {
    // Update customer
    try {
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: 'Customer ID is required' })
      }

      const customerData = {
        billing_name: req.body.billing_name,
        billing_address: req.body.billing_address,
        billing_address_2: req.body.billing_address_2 || null,
        billing_city: req.body.billing_city || null,
        billing_state: req.body.billing_state,           // State name as string
        billing_state_code: parseInt(req.body.billing_state_code) || 0, // State code as number
        billing_gstin: req.body.billing_gstin,
        contact_no: req.body.contact_no,
        email: req.body.email,
        shipping_name: req.body.shipping_name || null,
        shipping_address: req.body.shipping_address || null,
        shipping_address_2: req.body.shipping_address_2 || null,
        shipping_city: req.body.shipping_city || null,
        shipping_state: req.body.shipping_state,         // State name as string
        shipping_state_code: parseInt(req.body.shipping_state_code) || 0, // State code as number
        shipping_gstin: req.body.shipping_gstin || null,
      };

      const customer = await prisma.customer_details.update({
        where: { id: parseInt(id) },
        data: customerData
      });

      const formattedCustomer = {
        id: customer.id.toString(),
        billing_name: customer.billing_name,
        billing_address: customer.billing_address,
        billing_address_2: customer.billing_address_2 || null,
        billing_city: customer.billing_city || null,
        billing_state: customer.billing_state,          // State name from DB
        billing_state_code: customer.billing_state_code, // State code from DB
        billing_gstin: customer.billing_gstin,
        contact_no: customer.contact_no,
        email: customer.email,
        shipping_name: customer.shipping_name,
        shipping_address: customer.shipping_address,
        shipping_address_2: customer.shipping_address_2 || null,
        shipping_city: customer.shipping_city || null,
        shipping_state: customer.shipping_state,        // State name from DB
        shipping_state_code: customer.shipping_state_code, // State code from DB
        shipping_gstin: customer.shipping_gstin
      }

      res.status(200).json({
        message: 'Customer updated successfully',
        customer: formattedCustomer
      });
    } catch (error) {
      console.error('Customer update error:', error);
      res.status(500).json({
        message: 'Failed to update customer',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else if (req.method === 'DELETE') {
    try {
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: 'Customer ID is required' })
      }

      await prisma.customer_details.delete({
        where: { id: parseInt(id) }
      });

      res.status(200).json({ message: 'Customer deleted successfully' });
    } catch (error) {
      console.error('Customer delete error:', error);
      res.status(500).json({
        message: 'Failed to delete customer',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else {
    return res.status(405).json({ message: 'Method not allowed' })
  }
}
