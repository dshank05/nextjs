import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'POST') {
    // Handle customer creation
    try {
      // ===== VALIDATION =====
      const errors: string[] = [];

      if (!req.body.billing_name || !req.body.billing_name.trim()) {
        errors.push('Billing name is required');
      }
      if (!req.body.billing_address || !req.body.billing_address.trim()) {
        errors.push('Billing address is required');
      }
      if (!req.body.contact_no || !req.body.contact_no.trim()) {
        errors.push('Contact number is required');
      }
      if (!req.body.billing_state || !req.body.billing_state.trim()) {
        errors.push('Billing state is required');
      }

      // Only validate shipping fields if NOT copying from billing
      const copyFromBilling = req.body.copyFromBilling === true || req.body.copyFromBilling === 'true';
      if (!copyFromBilling) {
        if (!req.body.shipping_name || !req.body.shipping_name.trim()) {
          errors.push('Shipping name is required');
        }
        if (!req.body.shipping_address || !req.body.shipping_address.trim()) {
          errors.push('Shipping address is required');
        }
        if (!req.body.shipping_state || !req.body.shipping_state.trim()) {
          errors.push('Shipping state is required');
        }
      }

      if (errors.length > 0) {
        return res.status(400).json({
          message: 'Validation failed',
          errors
        });
      }

      const customerData = {
        billing_name: req.body.billing_name,
        // ===== BILLING ADDRESS (Consistent with vendor pattern) =====
        billing_address: req.body.billing_address,        // Main billing address line (REQUIRED)
        billing_address_2: req.body.billing_address_2 || null, // Additional billing address line (OPTIONAL)
        billing_city: req.body.billing_city || null,     // Billing city
        billing_pin_code: req.body.billing_pin_code || null, // Billing pin code

        billing_state: req.body.billing_state,           // State name as string
        billing_state_code: parseInt(req.body.billing_state_code) || 0, // State code as number
        billing_gstin: req.body.billing_gstin,
        contact_no: req.body.contact_no,
        email: req.body.email,

        shipping_name: req.body.shipping_name || null,

        // ===== SHIPPING ADDRESS (Consistent with vendor pattern) =====
        shipping_address: req.body.shipping_address || null,          // Main shipping address line
        shipping_address_2: req.body.shipping_address_2 || null,       // Additional shipping address line
        shipping_city: req.body.shipping_city || null,               // Shipping city
        shipping_pin_code: req.body.shipping_pin_code || null,       // Shipping pin code

        shipping_state: req.body.shipping_state,                      // State name as string
        shipping_state_code: parseInt(req.body.shipping_state_code) || 0, // State code as number
        shipping_gstin: req.body.shipping_gstin || null,
      };

      const customer = await prisma.customer_details.create({
        data: customerData,
      });

      res.status(201).json({
        status: "success",
        message: "Customer created successfully"
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
        limit = '50',
        search = '',
        dropdown = 'false'
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      // Build where clause for search and filtering
      const where: any = {};

      // Filter out inactive customers for dropdowns
      if (dropdown === 'true') {
        where.status = 'Active';
      }

      if (search) {
        where.OR = [
          { billing_name: { contains: search } },
          { contact_no: { contains: search } },
          { email: { contains: search } },
          { billing_city: { contains: search } },
          { billing_gstin: { contains: search } }
        ];
      }

      // Get customers with pagination
      const [customersData, total] = await Promise.all([
        prisma.customer_details.findMany({
          where,
          select: {
            id: true,
            billing_name: true,
            status: true,
            // ===== BILLING ADDRESS FIELDS (Matching vendor pattern) =====
            billing_address: true,
            billing_address_2: true,
            billing_city: true,
            billing_pin_code: true,
            billing_state: true,
            billing_state_code: true,
            billing_gstin: true,
            contact_no: true,
            contact_no_2: true,
            contact_no_3: true,
            email: true,
            shipping_name: true,
            // ===== SHIPPING ADDRESS FIELDS (Matching vendor pattern) =====
            shipping_address: true,
            shipping_address_2: true,
            shipping_city: true,
            shipping_pin_code: true,
            shipping_state: true,
            shipping_state_code: true,
            shipping_gstin: true
          },
          skip,
          take: limitNum,
          orderBy: { billing_name: 'asc' }
        }),
        prisma.customer_details.count({ where })
      ]);

      const formattedCustomers = customersData.map((customer: any) => ({
        id: customer.id.toString(),
        billing_name: customer.billing_name,
        status: customer.status || 'Active',
        // ===== BILLING ADDRESS (Consistent with vendors) =====
        billing_address: customer.billing_address || '',
        billing_address_2: customer.billing_address_2 || '',
        billing_city: customer.billing_city || '',
        billing_pin_code: customer.billing_pin_code || '',
        billing_state: customer.billing_state,
        billing_state_code: customer.billing_state_code,
        billing_gstin: customer.billing_gstin || '',
        contact_no: customer.contact_no || '',
        contact_no_2: customer.contact_no_2 || '',
        contact_no_3: customer.contact_no_3 || '',
        email: customer.email || '',
        shipping_name: customer.shipping_name || '',
        // ===== SHIPPING ADDRESS (Consistent with vendors) =====
        shipping_address: customer.shipping_address || '',
        shipping_address_2: customer.shipping_address_2 || '',
        shipping_city: customer.shipping_city || '',
        shipping_pin_code: customer.shipping_pin_code || '',
        shipping_state: customer.shipping_state,
        shipping_state_code: customer.shipping_state_code,
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

export default withObservability(handler)
