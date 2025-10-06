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
        // ===== BILLING ADDRESS (Consistent with vendor pattern) =====
        billing_address: req.body.billing_address,        // Main billing address line (REQUIRED)
        billing_address_2: req.body.billing_address_2 || null, // Additional billing address line (OPTIONAL)
        billing_city: req.body.billing_city || null,     // Billing city

        billing_state: parseInt(req.body.billing_state),
        billing_state_code: parseInt(req.body.billing_state_code),
        billing_gstin: req.body.billing_gstin,
        contact_no: req.body.contact_no,
        email: req.body.email,

        shipping_name: req.body.shipping_name || null,

        // ===== SHIPPING ADDRESS (Consistent with vendor pattern) =====
        shipping_address: req.body.shipping_address || null,          // Main shipping address line
        shipping_address_2: req.body.shipping_address_2 || null,       // Additional shipping address line
        shipping_city: req.body.shipping_city || null,               // Shipping city

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

  if (req.method === 'GET') {
    try {
      const {
        page = '1',
        limit = '25',
        search = ''
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      // Build where clause for search
      const where: any = {};
      if (search) {
        where.OR = [
          { billing_name: { contains: search } },
          { contact_no: { contains: search } },
          { email: { contains: search } }
        ];
      }

      // Get customers with pagination
      const [customersData, total] = await Promise.all([
        prisma.customer_details.findMany({
          where,
          select: {
            id: true,
            billing_name: true,
            // ===== BILLING ADDRESS FIELDS (Matching vendor pattern) =====
            billing_address: true,
            billing_address_2: true,
            billing_gstin: true,
            contact_no: true,
            email: true,
            shipping_name: true,
            // ===== SHIPPING ADDRESS FIELDS (Matching vendor pattern) =====
            shipping_address: true,
            shipping_address_2: true,
            shipping_gstin: true
          },
          skip,
          take: limitNum,
          orderBy: { billing_name: 'asc' }
        }),
        prisma.customer_details.count({ where })
      ]);

      const formattedCustomers = customersData.map(customer => ({
        id: customer.id.toString(),
        billing_name: customer.billing_name,
        // ===== BILLING ADDRESS (Consistent with vendors) =====
        billing_address: customer.billing_address || '',
        billing_address_2: customer.billing_address_2 || '',
        billing_gstin: customer.billing_gstin || '',
        contact_no: customer.contact_no || '',
        email: customer.email || '',
        shipping_name: customer.shipping_name || '',
        // ===== SHIPPING ADDRESS (Consistent with vendors) =====
        shipping_address: customer.shipping_address || '',
        shipping_address_2: customer.shipping_address_2 || '',
        shipping_gstin: customer.shipping_gstin || ''
      }));

      const totalPages = Math.ceil(total / limitNum);

      res.status(200).json({
        customers: formattedCustomers,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        }
      });
    } catch (error) {
      console.error('Customers fetch error:', error);
      res.status(500).json({
        message: 'Failed to fetch customers data',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }
}
