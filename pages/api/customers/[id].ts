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

      // Fetch state names separately
      const [billingState, shippingState] = await Promise.all([
        customer.billing_state ? prisma.states.findUnique({ where: { id: customer.billing_state } }) : null,
        customer.shipping_state ? prisma.states.findUnique({ where: { id: customer.shipping_state } }) : null
      ])

      const formattedCustomer = {
        id: customer.id.toString(),
        billing_name: customer.billing_name,
        billing_address: customer.billing_address,
        billing_state: billingState?.state_name || null,
        billing_state_code: customer.billing_state_code || null,
        billing_gstin: customer.billing_gstin,
        contact_no: customer.contact_no,
        email: customer.email,
        shipping_name: customer.shipping_name,
        shipping_address: customer.shipping_address,
        shipping_state: shippingState?.state_name || null,
        shipping_state_code: customer.shipping_state_code || null,
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

      const customer = await prisma.customer_details.update({
        where: { id: parseInt(id) },
        data: customerData
      });

      // Fetch state names separately
      const [billingState, shippingState] = await Promise.all([
        customer.billing_state ? prisma.states.findUnique({ where: { id: customer.billing_state } }) : null,
        customer.shipping_state ? prisma.states.findUnique({ where: { id: customer.shipping_state } }) : null
      ])

      const formattedCustomer = {
        id: customer.id.toString(),
        billing_name: customer.billing_name,
        billing_address: customer.billing_address,
        billing_state: billingState?.state_name || null,
        billing_state_code: customer.billing_state_code || null,
        billing_gstin: customer.billing_gstin,
        contact_no: customer.contact_no,
        email: customer.email,
        shipping_name: customer.shipping_name,
        shipping_address: customer.shipping_address,
        shipping_state: shippingState?.state_name || null,
        shipping_state_code: customer.shipping_state_code || null,
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
