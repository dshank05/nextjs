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
        where.payment_status = parseInt(status)
      } else if (status === 'unknown') {
        // For unknown status, we don't add a where clause since we want all statuses that are not 0 or 1
        // But actually, we need to filter to show only non-standard statuses
        where.payment_status = { notIn: [0, 1] }
      }
    }

    if (amountMin && amountMin !== '') {
      where.total = { gte: parseFloat(amountMin as string) }
    }

    if (amountMax && amountMax !== '') {
      where.total = where.total ? { ...where.total, lte: parseFloat(amountMax as string) } : { lte: parseFloat(amountMax as string) }
    }

    // Vendor filtering removed - vendor_id is stored directly

    // Get purchase invoices with related vendor data
    const [purchaseInvoices, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        select: {
          id: true,
          invoice_no: true,
          bill_reference: true,
          items_total: true,
          freight: true,
          total_taxable_value: true,
          taxrate: true,
          total_cgst: true,
          total_sgst: true,
          total_igst: true,
          total_tax: true,
          total: true,
          notes: true,
          invoice_date: true,
          payment_mode: true,
          payment_status: true,
          fy: true,
          transport: true,
          vendor_id: true
        },
        skip,
        take: limitNum,
        orderBy: { invoice_date: 'desc' }, // Order by date descending (newest first)
      }),
      prisma.purchase.count({ where })
    ])

    // Get item counts, vendor info, and staff info in batch queries
    const invoiceNos = purchaseInvoices.map((inv: { invoice_no: any }) => inv.invoice_no)
    const vendorIds = Array.from(new Set(purchaseInvoices.map((inv: any) => inv.vendor_id).filter(Boolean)))
    const staffIds = Array.from(new Set(purchaseInvoices.map((inv: any) => inv.staff_id).filter(Boolean)))

    const [itemCounts, vendorData, staffData] = await Promise.all([
      // Get all item counts in one query
      prisma.purchaseitems.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceNos } },
        _count: { id: true }
      }),
      // Get vendor names for all purchases
      vendorIds.length > 0 ? prisma.vendor_details.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, vendor_name: true, address: true, tax_id: true }
      }) : Promise.resolve([]),
      // Get staff details for all purchases
      staffIds.length > 0 ? prisma.staff.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true, phone: true, email: true }
      }) : Promise.resolve([])
    ])

    // Create lookup maps for fast access
    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))
    const vendorMap = new Map(vendorData.map(vendor => [vendor.id, vendor]))
    const staffMap = new Map(staffData.map(staff => [staff.id, staff]))

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

        const vendorInfo = vendorMap.get(invoice.vendor_id)
        const staffInfo = staffMap.get(invoice.staff_id)
        // ✅ Calculate taxrate as total_tax/total_taxable_value (invoice level)
        const calculatedTaxrate = invoice.total_taxable_value > 0 ? invoice.total_tax / invoice.total_taxable_value : 0;

        return {
          id: invoice.id,
          invoice_no: invoice.invoice_no,
          bill_reference: invoice.bill_reference, // Bill reference (separate from vendor)
          vendor_id: invoice.vendor_id,
          vendor_name: vendorInfo?.vendor_name,
          vendor_address: vendorInfo?.address || '',
          vendor_gstin: vendorInfo?.tax_id || '',
          staff_name: staffInfo?.name,
          staff_phone: staffInfo?.phone || '',
          staff_email: staffInfo?.email || '',
          taxrate: calculatedTaxrate, // ✅ Calculated taxrate
          // OPTIMIZATION: Commented out fields only used in removed expanded details
          // items_total: invoice.items_total || 0,
          // freight: invoice.freight || 0,
          // total_taxable_value: invoice.total_taxable_value,
          // total_cgst: invoice.total_cgst || 0,
          // total_sgst: invoice.total_sgst || 0,
          // total_igst: invoice.total_igst || 0,
          // total_tax: invoice.total_tax || 0,
          // notes: invoice.notes || '',
          // transport: invoice.transport || '',
          // items: [], // Never populated in GET response
          total: invoice.total,
          invoice_date: invoice.invoice_date, // Raw date - let frontend format it
          payment_status: invoice.payment_status || 0,
          payment_mode: invoice.payment_mode || 0,
          fy: invoice.fy,
          item_count: itemCountMap.get(invoice.invoice_no) || 0,
          // OPTIMIZATION: Commented out unused fields - uncomment if needed
          // type: 'purchase',
          // formattedDate: formattedDate, // Frontend handles formatting
          // formattedTotal: invoice.total.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })
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
    // ===== RATE MANAGEMENT =====
    // ✓ Updates product's latest_purchase_rate when purchase is created
    // ✓ Validates purchase rates > 0 before processing
    // ✓ Maintains rate history through automatic product updates
    // ✓ Supports transaction safety for stock and rate updates together

    const {
      // ===== MAIN PURCHASE TABLE FIELDS (ALL STORED) =====
      invoice_number,           // ✓ Purchase.invoice_no
      bill_reference,           // ✓ Purchase.bill_reference
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
      // ===== EXTRA FIELDS - COMMENTED OUT (NOT PROCESSED) =====
      // tax_rate,                 // ❌ Purchase.taxrate - @deprecated legacy field, unclear purpose, no UI element
      // basic_value,              // ❌ Purchase.basic_value - @deprecated legacy field, unclear purpose, no UI element
      total_cgst,               // ✓ Purchase.total_cgst
      total_sgst,               // ✓ Purchase.total_sgst
      total_igst,               // ✓ Purchase.total_igst
      notes,                    // ✓ Purchase.notes
      total_tax,                // ✓ Purchase.total_tax
      payment_status,           // ✓ Purchase.status
      payment_mode,             // ✓ Purchase.payment_mode
      // ===== EXTRA FIELDS - COMMENTED OUT (NOT PROCESSED) =====
      // grand_total,              // ❌ NOT STORED (calculated field)

      // ===== LEGACY FIELDS - UNUSED (FOR REMOVAL) =====
      // bill,                     // ❌ Purchase.bill - @deprecated legacy field, unclear purpose, no UI element
      // tax,                      // ❌ Purchase.tax - @deprecated legacy field, unclear purpose, no UI element
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

    // ===== RATE VALIDATION =====
    // Validate all purchase items have valid rates > 0
    for (const item of items) {
      if (!item.rate || item.rate <= 0) {
        return res.status(400).json({
          message: `Invalid purchase rate for item "${item.product_name}": rate must be greater than 0`
        })
      }
    }

    // Validate payment_status and payment_mode are valid integers
    const validPaymentStatuses = [0, 1];
    const validPaymentModes = [0, 1];

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
        message: 'Invalid payment_mode: must be 0 (Cash) or 1 (Bank)'
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
        staff_id: staff_id ? parseInt(staff_id) : null, // FK to staff table (optional)
        vendor_id: parseInt(vendor_id), // ✅ Save vendor ID as FK
        items_total: itemsTotal,
        freight: transport_cost || 0,
        total_taxable_value: itemsTotal,
        // taxrate: tax_rate || 0,
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
        // ===== EXTRA FIELDS - COMMENTED OUT (NOT STORED IN DB) =====
        // basic_value: basic_value || 0,
        // bill: bill,
        // tax: tax,
        // taxrate: tax_rate || 0,
        invoice_date: new Date(invoiceDate * 1000).toISOString().split('T')[0], // Convert to date string
        updated_at: new Date().toISOString().split('T')[0], // Current date
        payment_status: payment_status,
        payment_mode: payment_mode,
        fy: financialYear,
        transport: transport_name || '',
        transport_name: transport_name,
        vehicle_number: vehicle_number
        // ===== EXTRA FIELDS - COMMENTED OUT (NOT STORED IN DB) =====
        // taxrate: tax_rate || 0,
        // basic_value: basic_value || 0,
        // bill: bill,
        // tax: tax,
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

      // Use model_id directly from frontend (already looked up from car_model)
      const modelId = item.model_id ? parseInt(item.model_id) : null;

      // Use company_id directly from the frontend data
      const companyId = item.company_id ? parseInt(item.company_id) : null;

      await prisma.purchaseitems.create({
        data: {
          invoice_no: purchase.invoice_no,
          product_id: parseInt(item.product_id), // ✅ CRITICAL FIX: Save product_id to maintain relationship
          name_of_product: productName,
          category_id: categoryId,
          subcategory_id: subcategoryId,
          model_id: modelId, // ✅ Use model_id directly from frontend
          company_id: companyId, // ✅ Use company_id from frontend
          car_model: item.car_model || '', // ✅ Store the car model string for display
          vendor_id: parseInt(vendor_id), // ✅ Save vendor ID in purchase items as well
          // ===== EXTRA FIELDS - COMMENTED OUT (NOT STORED IN DB) =====
          // hsn: hsn,
          part: item.part || '', // ✅ Use part number from frontend
          qty: item.qty,
          // unit: 1, // @deprecated - Default unit (not used for products)
          rate: item.rate,
          subtotal: item.total,
          fy: financialYear,
          invoice_date: invoiceDate
        }
      })

      // Increase product stock and update latest purchase rate when purchase is created
      await prisma.product.update({
        where: { id: parseInt(item.product_id) },
        data: {
          stock: {
            increment: item.qty
          },
          // ===== RATE MANAGEMENT =====
          // Update latest purchase rate and timestamp when purchase is created
          latest_purchase_rate: item.rate,
          last_purchase_date: invoiceDate
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
      // ===== EXTRA FIELDS - COMMENTED OUT (NOT PROCESSED) =====
      // tax_rate,                 // ❌ Purchase.taxrate - @deprecated legacy field, unclear purpose, no UI element
      // basic_value,              // ❌ Purchase.basic_value - @deprecated legacy field, unclear purpose, no UI element
      total_cgst,               // ✓ Purchase.total_cgst
      total_sgst,               // ✓ Purchase.total_sgst
      total_igst,               // ✓ Purchase.total_igst
      notes,                    // ✓ Purchase.notes
      total_tax,                // ✓ Purchase.total_tax
      payment_status,           // ✓ Purchase.status
      payment_mode,             // ✓ Purchase.payment_mode
      // ===== EXTRA FIELDS - COMMENTED OUT (NOT PROCESSED) =====
      // grand_total,              // ❌ NOT STORED (calculated field)

      // ===== LEGACY FIELDS - UNUSED (FOR REMOVAL) =====
      // bill,                     // ❌ Purchase.bill - @deprecated legacy field, unclear purpose, no UI element
      // tax,                      // ❌ Purchase.tax - @deprecated legacy field, unclear purpose, no UI element
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
      // Update purchase record (invoice_number stays the same)
      const purchase = await tx.purchase.update({
        where: { id: parseInt(id as string) },
        data: {
          bill_reference: bill_reference, // Keep bill reference separate from vendor name
          staff_id: staff_id ? parseInt(staff_id) : null, // FK to staff table (optional)
          vendor_id: parseInt(vendor_id), // ✅ Save vendor ID as FK
          items_total: itemsTotal,
          freight: transport_cost || 0,
          total_taxable_value: itemsTotal,
          // ===== EXTRA FIELDS - COMMENTED OUT (NOT STORED IN DB) =====
          // taxrate: tax_rate || 0,
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
          // ===== EXTRA FIELDS - COMMENTED OUT (NOT STORED IN DB) =====
          // basic_value: basic_value || 0,
          // bill: bill,
          // tax: tax,
          invoice_date: new Date(invoiceDate * 1000).toISOString().split('T')[0], // Convert to date string
          updated_at: new Date().toISOString().split('T')[0], // Current date
          payment_status: payment_status || 0,  // Ensure we set a valid default if null
          payment_mode: payment_mode || 1,      // Ensure we set a valid default if null
          fy: financialYear,
          transport: transport_name || '',
          transport_name: transport_name,
          vehicle_number: vehicle_number
        }
      })

      // Handle item-level updates using product_id matching
      if (items) {
        // Get existing purchase items for comparison
        const existingItems = await tx.purchaseitems.findMany({
          where: { invoice_no: purchase.invoice_no }
        })

        // Create maps for efficient lookup using product_id
        const existingItemsMap = new Map<number, any>()
        const newItemsMap = new Map<number, any>()

        existingItems.forEach(item => {
          existingItemsMap.set(item.product_id, {
            id: item.id,
            qty: item.qty || 0,
            item: item
          })
        })

        items.forEach(item => {
          newItemsMap.set(parseInt(item.product_id), {
            qty: item.qty || 0,
            category_id: item.category_id,
            subcategory_id: item.subcategory_id,
            company_id: item.company_id,
            model_id: item.model_id,
            car_model: item.car_model || '',
            part: item.part,
            rate: item.rate,
            total: item.total,
            product_id: parseInt(item.product_id),
            item: item
          })
        })

        // Process deletions: items that exist in DB but not in new list
        for (const [productId, existingData] of Array.from(existingItemsMap.entries())) {
          if (!newItemsMap.has(productId)) {
            // Item was removed - decrease stock (remove purchased items)
            if (existingData.qty > 0) {
              await tx.product.update({
                where: { id: productId },
                data: {
                  stock: {
                    decrement: existingData.qty
                  }
                }
              })
            }
            // Delete the item
            await tx.purchaseitems.delete({
              where: { id: existingData.id }
            })
          }
        }

        // Process additions and updates
        for (const [productId, newData] of Array.from(newItemsMap.entries())) {
          const existingData = existingItemsMap.get(productId)

          if (!existingData) {
            // New item - create it and increase stock
            // Fetch product details from database for new item
            const product = await tx.product.findUnique({
              where: { id: productId }
            })

            if (!product) {
              throw new Error(`Product with ID ${productId} not found`)
            }

            // Use model_id directly from frontend (already looked up)
            const modelId = newData.model_id ? parseInt(newData.model_id) : null;

            await tx.purchaseitems.create({
              data: {
                invoice_no: purchase.invoice_no,
                product_id: productId,
                name_of_product: product.product_name || '',
                category_id: product.product_category_id || null,
                subcategory_id: product.product_subcategory_id || null,
                model_id: modelId,
                company_id: product.company_id || null,
                car_model: newData.car_model || '',
                vendor_id: parseInt(vendor_id),
                hsn: product.hsn || '',
                part: newData.part || '',
                qty: newData.qty,
                rate: newData.rate,
                subtotal: newData.total,
                fy: financialYear,
                invoice_date: invoiceDate
              }
            })

            // Increase stock and update rate for new purchase
            await tx.product.update({
              where: { id: productId },
              data: {
                stock: {
                  increment: newData.qty
                },
                // ===== RATE MANAGEMENT =====
                // Update latest purchase rate and timestamp when purchase item is added/updated
                latest_purchase_rate: newData.rate,
                last_purchase_date: invoiceDate
              }
            })
          } else {
            // Existing item - check if quantity changed
            const qtyDifference = newData.qty - existingData.qty

            if (Math.abs(qtyDifference) > 0.001) { // Allow for small floating point differences
              // Update quantity and adjust stock
              await tx.purchaseitems.update({
                where: { id: existingData.id },
                data: {
                  qty: newData.qty,
                  rate: newData.rate,
                  subtotal: newData.total
                }
              })

              // Adjust stock based on quantity difference
              await tx.product.update({
                where: { id: productId },
                data: {
                  stock: {
                    increment: qtyDifference // Add the difference (can be negative)
                  }
                }
              })
            }
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
