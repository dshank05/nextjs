import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    case 'PUT':
      return handlePut(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {

  try {
    const {
      page = '1',
      limit = '25',
      search = '',
      startDate = '',
      endDate = '',
      fy = '',
      status = '',
      amountMin = '',
      amountMax = '',
      vendor = ''
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    if (search) {
      where.OR = [
        { invoice_no: { contains: search as string } },
        { notes: { contains: search as string } },
      ]
    }

    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    if (startDate && endDate) {
      // Handle both string dates and Unix timestamps
      // Convert input dates to appropriate format for comparison
      try {
        // Always try to parse input dates as standard date strings
        const startDateObj = new Date(startDate as string);
        const endDateObj = new Date(endDate as string);

        if (!isNaN(startDateObj.getTime()) && !isNaN(endDateObj.getTime())) {
          // Convert to Unix timestamps for comparison (assuming data is stored as integers)
          const startTimestamp = Math.floor(startDateObj.getTime() / 1000);
          const endTimestamp = Math.floor(endDateObj.getTime() / 1000);

          where.invoice_date = {
            gte: startTimestamp,
            lte: endTimestamp
          };
        }
      } catch (error) {
        console.warn('Error parsing filter dates:', error);
      }
    }

    if (status && status !== '') {
      if (status === '1' || status === '0') {
        where.status = parseInt(status)
      } else if (status === 'unknown') {
        // For unknown status, we don't add a where clause since we want all statuses that are not 0 or 1
        // But actually, we need to filter to show only non-standard statuses
        where.status = { notIn: [0, 1] }
      }
    }

    if (amountMin && amountMin !== '') {
      where.total = { gte: parseFloat(amountMin as string) }
    }

    if (amountMax && amountMax !== '') {
      where.total = where.total ? { ...where.total, lte: parseFloat(amountMax as string) } : { lte: parseFloat(amountMax as string) }
    }

    // Vendor filtering is complex because vendor names are looked up after fetching
    // For now, we'll skip vendor filtering as it requires joining with vendor_details table
    // This would need to be implemented with a JOIN operation

    // Get purchase invoices with related vendor data
    const [purchaseInvoices, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        include: {
          vendor: {
            select: {
              vendor_name: true,
              tax_id: true
            }
          }
        },
        skip,
        take: limitNum,
        orderBy: { invoice_date: 'desc' }, // Order by date descending (newest first)
      }),
      prisma.purchase.count({ where })
    ])

    // Get item counts in batch queries (vendor info will be fetched individually when needed)
    const invoiceIds = purchaseInvoices.map((inv: { id: any }) => inv.id)

    const [itemCounts] = await Promise.all([
      // Get all item counts in one query
      prisma.purchaseitems.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      })
    ])

    // Create lookup maps for fast access
    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))

    // Enhanced purchase invoices using maps
    const enhancedPurchases = purchaseInvoices.map((invoice: any) => {
      // Handle date format for purchases - could be string dates or Unix timestamps
      let formattedDate: string | null = null
      try {
        if (invoice.invoice_date) {
          let dateObj: Date

          // Check if it's a Unix timestamp (integer) or string date
          if (typeof invoice.invoice_date === 'string') {
            if (invoice.invoice_date.trim() === '') {
              // Empty string - skip
            } else {
              // Try parsing as string date like "2025-01-15"
              dateObj = new Date(invoice.invoice_date)
              if (!isNaN(dateObj.getTime())) {
                formattedDate = dateObj.toLocaleDateString('en-IN')
              }
            }
          } else if (typeof invoice.invoice_date === 'number') {
            // Unix timestamp in seconds
            dateObj = new Date(invoice.invoice_date * 1000)
            if (!isNaN(dateObj.getTime())) {
              formattedDate = dateObj.toLocaleDateString('en-IN')
            }
          }
        }
      } catch (error) {
        console.warn('Invalid date format for purchase:', invoice.invoice_date, error)
      }

      return {
        id: invoice.id,
        invoice_no: invoice.invoice_no,
        bill_reference: invoice.bill_reference, // Bill reference (separate from vendor)
        vendor_name: invoice.vendor?.vendor_name || 'Unknown Vendor', // ✅ Vendor name from JOIN
        vendor_gstin: invoice.vendor?.tax_id || '', // ✅ GSTIN from JOIN
        items_total: invoice.items_total || 0,
        freight: invoice.freight || 0,
        total_taxable_value: invoice.total_taxable_value,
        taxrate: invoice.taxrate || 0,
        total_cgst: invoice.total_cgst || 0,
        total_sgst: invoice.total_sgst || 0,
        total_igst: invoice.total_igst || 0,
        total_tax: invoice.total_tax || 0,
        total: invoice.total,
        notes: invoice.notes || '',
        invoice_date: invoice.invoice_date, // Raw date - let frontend format it
        status: invoice.status || 0,
        payment_mode: invoice.payment_mode || 0,
        fy: invoice.fy,
        transport: invoice.transport || '',
        type: 'purchase',
        item_count: itemCountMap.get(invoice.id) || 0,
        // Remove formattedDate - frontend handles formatting
        formattedTotal: invoice.total.toLocaleString('en-IN', {
          style: 'currency',
          currency: 'INR'
        })
      }
    })

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      purchases: enhancedPurchases,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Purchases fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch purchases data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      // ===== MAIN PURCHASE TABLE FIELDS (ALL STORED) =====
      invoice_number,           // ✓ Purchase.invoice_no
      bill_reference,           // ✓ Purchase.bill_reference
      staff_details,            // ✓ Purchase.staff_details (string for backward compatibility)
      staff_id,                 // ✓ Purchase.staff_id (FK to staff table, optional)
      date,                     // ✓ Purchase.invoice_date

      // ===== VENDOR RELATIONSHIP (ONLY FK STORED - NO VENDOR MANAGEMENT HERE) =====
      vendor_id,                // ✓ Purchase.vendor_id (FK to vendor_details)

      // ===== TRANSPORT FIELDS (ALL STORED) =====
      transport_name,           // ✓ Purchase.transport_name
      vehicle_number,           // ✓ Purchase.vehicle_number
      transport_cost,           // ✓ Purchase.freight

      // ===== ITEMS AND CALCULATIONS (ALL STORED) =====
      items,                    // ✓ PurchaseItems table (multiple records)
      descriptions,             // ✓ Purchase.descriptions
      packing_forwarding_qty,   // ✓ Purchase.packing_forwarding_qty
      packing_forwarding_rate,  // ✓ Purchase.packing_forwarding_rate
      packing_forwarding_total, // ✓ Purchase.packing_forwarding_total
      tax_rate,                 // ✓ Purchase.taxrate
      basic_value,              // ✓ Purchase.basic_value
      total_cgst,               // ✓ Purchase.total_cgst
      total_sgst,               // ✓ Purchase.total_sgst
      total_igst,               // ✓ Purchase.total_igst
      notes,                    // ✓ Purchase.notes
      total_tax,                // ✓ Purchase.total_tax
      payment_status,           // ✓ Purchase.status
      payment_mode,             // ✓ Purchase.payment_mode
      grand_total,              // ❌ NOT STORED (calculated field)

      // ===== LEGACY FIELDS (UNCLEAR PURPOSE - STILL STORED) =====
      bill,                     // ✓ Purchase.bill - meaning unclear, kept for compatibility
      tax,                      // ✓ Purchase.tax - meaning unclear, kept for compatibility
    } = req.body

    console.log('📝 API Received POST data:', req.body);

    // ===== FUTURE SCHEMA EXPANSION FIELDS =====
    // These fields don't exist in current Purchase/PurchaseItems tables, similar to Product API approach:
    // TODO: Add these fields to Purchase/PurchaseItems schemas when ready:
    // - approved_by: String? (user who approved the purchase)
    // - approval_date: DateTime? (when purchase was approved)
    // - expected_delivery_date: DateTime? (for purchase order tracking)
    // - supplier_rating: Int? (1-5 star supplier performance)
    // - purchase_order_no: String? (link to PO system)
    // - delivery_status: String? ("pending", "partial", "complete")
    // - quality_check_status: String? ("pending", "passed", "failed")
    // - payment_terms: String? ("net_30", "net_60", custom terms)
    // - discount_amount: Float? (separate from item-level discounts)
    // - additional_charges: Json? (misc fees, insurance, etc.)
    // - internal_notes: String? (separate from customer-facing notes)

    // ===== VALIDATION =====
    if (!invoice_number || !vendor_id || !items || items.length === 0) {
      return res.status(400).json({
        message: 'Missing required fields: invoice_number, vendor_id, or items'
      })
    }

    // Validate payment_status and payment_mode are valid integers
    const validPaymentStatuses = [0, 1];
    const validPaymentModes = [1, 2, 3];

    console.log('🔍 DEBUG - Received payment values:', { payment_status, payment_mode, payment_status_type: typeof payment_status, payment_mode_type: typeof payment_mode });

    if (!validPaymentStatuses.includes(payment_status)) {
      console.log('❌ DEBUG - Invalid payment_status:', payment_status);
      return res.status(400).json({
        message: 'Invalid payment_status: must be 0 (Unpaid) or 1 (Paid)'
      })
    }

    if (!validPaymentModes.includes(payment_mode)) {
      console.log('❌ DEBUG - Invalid payment_mode:', payment_mode);
      return res.status(400).json({
        message: 'Invalid payment_mode: must be 1 (Cash), 2 (Cheque), or 3 (Online)'
      })
    }

    console.log('✅ DEBUG - Payment validation passed');

    // ===== VALIDATE VENDOR EXISTS =====
    // Vendor must already exist - purchase only stores the relationship
    const existingVendor = await prisma.vendor_details.findUnique({
      where: { id: parseInt(vendor_id) }
    })

    if (!existingVendor) {
      return res.status(400).json({
        message: 'Invalid vendor selected - vendor does not exist'
      })
    }

    console.log('🏗️ Purchase Table Data: All main fields are stored');
    console.log('🏗️ Vendor Relationship: Using existing vendor ID:', vendor_id);

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert date to Unix timestamp
    const invoiceDate = new Date(date).getTime() / 1000

    // Calculate totals
    const itemsTotal = items.reduce((sum: number, item: any) => sum + (item.qty * item.rate), 0)
    const calculatedGrandTotal = itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0)

    // Create purchase record
    const purchase = await prisma.purchase.create({
      data: {
        invoice_no: parseInt(invoice_number),
        bill_reference: bill_reference, // Keep bill reference separate from vendor name
        staff_details: staff_details,    // Keep for backward compatibility
        staff_id: staff_id ? parseInt(staff_id) : null, // FK to staff table (optional)
        vendor_id: parseInt(vendor_id), // ✅ Save vendor ID as FK
        items_total: itemsTotal,
        freight: transport_cost || 0,
        total_taxable_value: itemsTotal,
        taxrate: tax_rate || 0,
        total_cgst: total_cgst || 0,
        total_sgst: total_sgst || 0,
        total_igst: total_igst || 0,
        total_tax: total_tax || 0,
        total: calculatedGrandTotal,
        notes: notes || '',
        descriptions: descriptions,
        packing_forwarding_qty: packing_forwarding_qty || 0,
        packing_forwarding_rate: packing_forwarding_rate || 0,
        packing_forwarding_total: packing_forwarding_total || 0,
        basic_value: basic_value || 0,
        bill: bill,
        tax: tax,
        invoice_date: new Date(invoiceDate * 1000).toISOString().split('T')[0], // Convert to date string
        updated_at: new Date().toISOString().split('T')[0], // Current date
        status: payment_status,
        payment_mode: payment_mode,
        fy: financialYear,
        transport: transport_name || '',
        transport_name: transport_name,
        vehicle_number: vehicle_number
      }
    })

    // Create purchase items
    for (const item of items) {
      // Fetch product details from database
      const product = await prisma.product.findUnique({
        where: { id: parseInt(item.product_id) }
      })

      if (!product) {
        throw new Error(`Product with ID ${item.product_id} not found`)
      }

      // Get product details from database
      const productName = product.product_name || ''
      const categoryId = product.product_category_id || 0
      const subcategoryId = product.product_subcategory_id || 0
      const hsn = product.hsn || ''
      const part = product.part_no || ''
      const modelId = 0 // For now, we'll use 0 since it's not directly available

      // For company_id in purchase_items, we'll use a default or try to map from company name
      // Since company is just a string field, we'll set company_id to 0 for now
      const companyId = 0

      await prisma.purchaseitems.create({
        data: {
          invoice_no: purchase.invoice_no,
          name_of_product: productName,
          category_id: categoryId,
          subcategory_id: subcategoryId,
          model_id: modelId,
          company_id: companyId,
          car_model: '', // For now, empty string since we don't have direct car model mapping
          vendor_id: parseInt(vendor_id), // ✅ Save vendor ID in purchase items as well
          hsn: hsn,
          part: part,
          qty: item.qty,
          unit: 1, // Default unit
          rate: item.rate,
          tax: item.tax || 0,
          subtotal: item.total,
          fy: financialYear,
          invoice_date: invoiceDate
        }
      })

      // Increase product stock when purchase is created
      await prisma.product.update({
        where: { id: parseInt(item.product_id) },
        data: {
          stock: {
            increment: item.qty
          }
        }
      })
    }

    res.status(201).json({
      message: 'Purchase created successfully',
      purchase: {
        id: purchase.id,
        invoice_no: purchase.invoice_no,
        total: purchase.total,
        vendor_name: existingVendor.vendor_name
      }
    })

  } catch (error) {
    console.error('Purchase creation error:', error)
    res.status(500).json({
      message: 'Failed to create purchase',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

function getPaymentModeId(paymentMode: string): number {
  const paymentModes: { [key: string]: number } = {
    'cash': 1,
    'card': 2,
    'bank_transfer': 3,
    'cheque': 4
  }
  return paymentModes[paymentMode] || 1
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    if (!id) {
      return res.status(400).json({ message: 'Purchase ID is required' })
    }

    const {
      // ===== MAIN PURCHASE TABLE FIELDS (ALL STORED) =====
      invoice_number,           // ✓ Purchase.invoice_no
      bill_reference,           // ✓ Purchase.bill_reference
      staff_details,            // ✓ Purchase.staff_details (string for backward compatibility)
      staff_id,                 // ✓ Purchase.staff_id (FK to staff table, optional)
      date,                     // ✓ Purchase.invoice_date

      // ===== VENDOR RELATIONSHIP (ONLY FK STORED - NO VENDOR MANAGEMENT HERE) =====
      vendor_id,                // ✓ Purchase.vendor_id (FK to vendor_details)

      // ===== TRANSPORT FIELDS (ALL STORED) =====
      transport_name,           // ✓ Purchase.transport_name
      vehicle_number,           // ✓ Purchase.vehicle_number
      transport_cost,           // ✓ Purchase.freight

      // ===== ITEMS AND CALCULATIONS (ALL STORED) =====
      items,                    // ✓ PurchaseItems table (multiple records)
      descriptions,             // ✓ Purchase.descriptions
      packing_forwarding_qty,   // ✓ Purchase.packing_forwarding_qty
      packing_forwarding_rate,  // ✓ Purchase.packing_forwarding_rate
      packing_forwarding_total, // ✓ Purchase.packing_forwarding_total
      tax_rate,                 // ✓ Purchase.taxrate
      basic_value,              // ✓ Purchase.basic_value
      total_cgst,               // ✓ Purchase.total_cgst
      total_sgst,               // ✓ Purchase.total_sgst
      total_igst,               // ✓ Purchase.total_igst
      notes,                    // ✓ Purchase.notes
      total_tax,                // ✓ Purchase.total_tax
      payment_status,           // ✓ Purchase.status
      payment_mode,             // ✓ Purchase.payment_mode
      grand_total,              // ❌ NOT STORED (calculated field)

      // ===== LEGACY FIELDS (UNCLEAR PURPOSE - STILL STORED) =====
      bill,                     // ✓ Purchase.bill - meaning unclear, kept for compatibility
      tax,                      // ✓ Purchase.tax - meaning unclear, kept for compatibility
    } = req.body

    console.log('🔄 API Received PUT data:', req.body);

    // ===== VALIDATION =====
    if (!invoice_number || !vendor_id) {
      return res.status(400).json({
        message: 'Missing required fields: invoice_number or vendor_id'
      })
    }

    // ===== VALIDATE VENDOR EXISTS =====
    const existingVendor = await prisma.vendor_details.findUnique({
      where: { id: parseInt(vendor_id) }
    })

    if (!existingVendor) {
      return res.status(400).json({
        message: 'Invalid vendor selected - vendor does not exist'
      })
    }

    // ===== VALIDATE PURCHASE EXISTS =====
    const existingPurchase = await prisma.purchase.findUnique({
      where: { id: parseInt(id as string) }
    })

    if (!existingPurchase) {
      return res.status(404).json({
        message: 'Purchase not found'
      })
    }

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert date to Unix timestamp
    const invoiceDate = new Date(date).getTime() / 1000

    // Calculate totals
    const itemsTotal = items ? items.reduce((sum: number, item: any) => sum + (item.qty * item.rate), 0) : 0
    const calculatedGrandTotal = itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0)

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Get existing purchase items for stock adjustment
      const existingItems = await tx.purchaseitems.findMany({
        where: { invoice_no: existingPurchase.invoice_no }
      })

      // Create a map of existing items for quick lookup
      const existingItemsMap = new Map()
      existingItems.forEach(item => {
        existingItemsMap.set(item.name_of_product, {
          qty: item.qty || 0,
          item: item
        })
      })

      // Update purchase record
      const purchase = await tx.purchase.update({
        where: { id: parseInt(id as string) },
        data: {
          invoice_no: parseInt(invoice_number),
          bill_reference: bill_reference, // Keep bill reference separate from vendor name
          staff_details: staff_details,    // Keep for backward compatibility
          staff_id: staff_id ? parseInt(staff_id) : null, // FK to staff table (optional)
          vendor_id: parseInt(vendor_id), // ✅ Save vendor ID as FK
          items_total: itemsTotal,
          freight: transport_cost || 0,
          total_taxable_value: itemsTotal,
          taxrate: tax_rate || 0,
          total_cgst: total_cgst || 0,
          total_sgst: total_sgst || 0,
          total_igst: total_igst || 0,
          total_tax: total_tax || 0,
          total: calculatedGrandTotal,
          notes: notes || '',
          descriptions: descriptions,
          packing_forwarding_qty: packing_forwarding_qty || 0,
          packing_forwarding_rate: packing_forwarding_rate || 0,
          packing_forwarding_total: packing_forwarding_total || 0,
          basic_value: basic_value || 0,
          bill: bill,
          tax: tax,
          invoice_date: new Date(invoiceDate * 1000).toISOString().split('T')[0], // Convert to date string
          updated_at: new Date().toISOString().split('T')[0], // Current date
          status: payment_status,
          payment_mode: payment_mode,
          fy: financialYear,
          transport: transport_name || '',
          transport_name: transport_name,
          vehicle_number: vehicle_number
        }
      })

      // Delete existing purchase items if items are provided
      if (items) {
        // First, subtract stock from existing items (removed/modified products)
        // Note: Since items don't have product_id, we can't adjust stock

        await tx.purchaseitems.deleteMany({
          where: { invoice_no: purchase.invoice_no }
        })

        // Create new purchase items
        for (const item of items) {
          await tx.purchaseitems.create({
            data: {
              invoice_no: purchase.invoice_no,
              name_of_product: item.product_name,
              category_id: item.category_id,
              subcategory_id: item.subcategory_id,
              model_id: item.model_id,
              company_id: item.company_id,
              car_model: item.car_model,
              vendor_id: parseInt(vendor_id), // ✅ Save vendor ID in purchase items as well
              hsn: item.hsn,
              part: item.part_number,
              qty: item.qty,
              unit: 1, // Default unit
              rate: item.rate,
              tax: item.tax || 0,
              subtotal: item.total,
              fy: financialYear,
              invoice_date: invoiceDate
            }
          })

          // Add stock back for new items
          if (item.product_id) {
            await tx.product.update({
              where: { id: parseInt(item.product_id) },
              data: {
                stock: {
                  increment: item.qty
                }
              }
            })
          }
        }
      }

      return purchase
    })

    res.status(200).json({
      message: 'Purchase updated successfully',
      purchase: {
        id: result.id,
        invoice_no: result.invoice_no,
        total: result.total,
        vendor_name: existingVendor.vendor_name
      }
    })

  } catch (error) {
    console.error('Purchase update error:', error)
    res.status(500).json({
      message: 'Failed to update purchase',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
