import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { getNextInvoiceNumber } from '../../../lib/invoice-counter'
import { withObservability } from '../../../lib/withObservability'

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      page = '1',
      limit = '50',
      search = '',
      startDate = '',
      endDate = '',
      fy = '',
      status = '',
      amountMin = '',
      amountMax = '',
      vendor = '',
      uid = '', // NEW: Filter by salex ID
      sortBy = 'invoice_date', // NEW: Sort field (default: invoice_date)
      sortOrder = 'desc' // NEW: Sort order (default: desc)
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Handle UID filtering
    if (uid && uid !== '') {
      where.id = parseInt(uid as string)
    }

    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      const searchNum = parseInt(searchStr);
      where.OR = [
        !isNaN(searchNum) ? { invoice_no: searchNum } : undefined,
        { notes: { contains: searchStr } },
      ].filter(Boolean) // Remove undefined values
    }

    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    if (startDate && endDate) {
      const startTimestamp = Math.floor(new Date(startDate as string).getTime() / 1000)
      const endTimestamp = Math.floor(new Date(endDate as string).getTime() / 1000)
      where.invoice_date = {
        gte: startTimestamp,
        lte: endTimestamp
      }
    }

    if (status && status !== '') {
      if (status === '1' || status === '0') {
        where.payment_status = parseInt(status)
      } else if (status === 'unknown') {
        // For unknown status, show statuses that are not 0, 1, or 2 (2 is cancelled for salex)
        where.payment_status = { notIn: [0, 1, 2] }
      }
    }

    if (amountMin && amountMin !== '') {
      where.total = { gte: parseFloat(amountMin as string) }
    }

    if (amountMax && amountMax !== '') {
      where.total = where.total ? { ...where.total, lte: parseFloat(amountMax as string) } : { lte: parseFloat(amountMax as string) }
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'invoice_no', 'customer_name', 'total', 'invoice_date', 'payment_status', 'fy', 'bill_reference']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'invoice_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // For customer_name sorting, we need to fetch all data first and sort in JavaScript
    // For other fields, we can sort at database level
    const needsPostSorting = sortField === 'customer_name'

    let salexInvoices: any[]
    let total: number

    if (needsPostSorting) {
      // Get all salex invoices without sorting (we'll sort after fetching customer names)
      const result = await Promise.all([
        prisma.invoicex.findMany({
          where,
          select: {
            id: true,
            invoice_no: true,
            select_customer: true,
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
            payment_status: true,
            payment_mode: true,
            fy: true,
            bill_reference: true,
            return_status: true
          }
        }),
        prisma.invoicex.count({ where })
      ])
      salexInvoices = result[0]
      total = result[1]
    } else {
      // Get salex invoices with database-level sorting
      const result = await Promise.all([
        prisma.invoicex.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { [sortField]: sortDirection },
          select: {
            id: true,
            invoice_no: true,
            select_customer: true,
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
            payment_status: true,
            payment_mode: true,
            fy: true,
            bill_reference: true,
            return_status: true
          }
        }),
        prisma.invoicex.count({ where })
      ])
      salexInvoices = result[0]
      total = result[1]
    }

    // Get customer names and item counts in batch queries
    const invoiceIds = salexInvoices.map((inv: { id: any }) => inv.id)

    const [customerData, itemCounts] = await Promise.all([
      // Get all customer names by joining with customer_details
      prisma.bill_tosalesx.findMany({
        where: { invoice_no: { in: invoiceIds } },
        include: { customer: { select: { billing_name: true, billing_gstin: true } } }
      }),

      // Get all item counts in one query
      prisma.invoice_itemsx.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      })
    ])

    // Create lookup maps for fast access
    const customerMap = new Map(customerData.map((c: any) => [c.invoice_no, c.customer?.billing_name]))
    const gstinMap = new Map(customerData.map((c: any) => [c.invoice_no, c.customer?.billing_gstin || '']))
    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))

    // Enhanced salex invoices using maps
    let enhancedSalex = salexInvoices.map((invoice: any) => {
      // Handle integer timestamp format for salex
      let formattedDate = 'Invalid Date'
      try {
        if (invoice.invoice_date) {
          // Salex dates are stored as integer timestamps
          const dateObj = new Date(invoice.invoice_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        }
      } catch (error) {
        console.warn('Invalid date format for salex:', invoice.invoice_date)
      }

      return {
        id: invoice.id,
        invoice_no: invoice.invoice_no,
        // OPTIMIZATION: Commented out unused customer ID field
        // select_customer: invoice.select_customer,
        customer_name: customerMap.get(invoice.id),
        // OPTIMIZATION: Removed customer_gstin as it's always empty
        // OPTIMIZATION: Commented out fields only used in removed expanded details
        // items_total: invoice.items_total || 0,
        // freight: invoice.freight || 0,
        // total_taxable_value: invoice.total_taxable_value,
        // taxrate: invoice.taxrate || 0,
        // total_cgst: invoice.total_cgst || 0,
        // total_sgst: invoice.total_sgst || 0,
        // total_igst: invoice.total_igst || 0,
        // total_tax: invoice.total_tax || 0,
        // notes: invoice.notes || '',
        // transport: '', // Not fetched in salex API
        // items: [], // Never populated in GET response
        total: invoice.total,
        bill_reference: invoice.bill_reference || '',
        invoice_date: invoice.invoice_date,
        payment_status: invoice.payment_status || 0,
        payment_mode: invoice.payment_mode || 0,
        return_status: invoice.return_status || 0,
        fy: invoice.fy,
        mode: invoice.mode || 0,
        type: invoice.type || 'salex',
        item_count: itemCountMap.get(invoice.id) || 0,
        // OPTIMIZATION: Commented out unused formatted fields - frontend handles formatting
        // formattedDate,
        // formattedTotal: invoice.total.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })
      }
    })

    // Apply post-sorting for customer_name if needed
    if (needsPostSorting) {
      enhancedSalex.sort((a, b) => {
        const aValue = (a.customer_name || '').toString().toLowerCase()
        const bValue = (b.customer_name || '').toString().toLowerCase()

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
        return 0
      })

      // Apply pagination after sorting
      enhancedSalex = enhancedSalex.slice(skip, skip + limitNum)
    }

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      salex: enhancedSalex,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Salex fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch salex data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    // ===== INVOICE NUMBERING =====
    // Get next invoice number based on current financial year
    const { nextInvoiceNo, currentFy } = await getNextInvoiceNumber('invoicex');

    const {
      // invoice_no is now auto-generated based on FY
      invoice_date,
      select_customer,
      invoiceItems,
      shippingDetails,
      transportDetails,
      items_total,
      freight = 0,
      total_taxable_value,
      total,
      notes = '',
      payment_status = 1,
      payment_mode = 1,
      descriptions = '',
      discount = 0,      // Invoice-level discount amount
      staff_details,     // ✅ TO BE SAVED - InvoiceX.staff_details (exists)
      staff_id,          // ✅ TO BE SAVED - InvoiceX.staff_id (FK field)
      mechanic_id,       // ✅ TO BE SAVED - InvoiceX.mechanic_id (FK field)
      commission,        // ✅ TO BE SAVED - InvoiceX.commission (exists)
      bill_reference,    // ✅ TO BE SAVED - Schema has InvoiceX.bill_reference
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,
      customer_id,
      useShippingAddress,

      // ===== UNUSED FIELDS (removed from UI, kept for API backward compatibility) =====
      // tax_rate,         // ❌ UNUSED - Removed from salex create UI, kept for backward compatibility
      // basic_value       // ❌ UNUSED - Removed from salex create UI, kept for backward compatibility
    } = req.body

    // Validate required fields
    // Allow select_customer to be 0 (Other)
    if (!invoice_date || select_customer === undefined || select_customer === null || !invoiceItems || invoiceItems.length === 0) {
      return res.status(400).json({ message: 'Missing required fields' })
    }

    // ===== VALIDATE CUSTOMER EXISTS =====
    let existingCustomer = null;
    if (parseInt(select_customer) !== 0) {
      existingCustomer = await prisma.customer_details.findUnique({
        where: { id: parseInt(select_customer) }
      })

      if (!existingCustomer) {
        return res.status(400).json({
          message: 'Invalid customer selected - customer does not exist'
        })
      }
    }

    console.log('📋 Auto-generated invoice number:', nextInvoiceNo, 'for FY:', currentFy);

    // Convert date to timestamp
    const invoiceDateTimestamp = typeof invoice_date === 'number' && invoice_date > 1000000000
      ? Math.floor(invoice_date) // Already a Unix timestamp in seconds
      : Math.floor(new Date(invoice_date).getTime() / 1000); // Convert date string to timestamp

    // Process operations sequentially to avoid transaction timeout
    // 1. Create main invoice record in invoicex table
    const finalNotes = notes || '';
    const finalDescriptions = descriptions || '';

    const invoice = await prisma.invoicex.create({
      data: {
        invoice_no: nextInvoiceNo,
        select_customer: parseInt(select_customer),
        items_total: parseFloat(items_total) || 0,
        freight: parseFloat(freight) || 0,
        total_taxable_value: parseFloat(total_taxable_value),
        taxrate: 0, // No tax for salex
        total_cgst: 0,
        total_sgst: 0,
        total_igst: 0,
        total_tax: 0,
        total: parseFloat(total),
        notes: finalNotes,                          // Separate notes field
        descriptions: finalDescriptions,             // Separate descriptions field
        bill_reference: bill_reference || '',        // Bill reference field
        discount: parseFloat(discount) || 0,         // Invoice-level discount amount
        invoice_date: invoiceDateTimestamp,
        updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '), // Format: YYYY-MM-DD HH:MM:SS
        payment_status: parseInt(payment_status),
        payment_mode: parseInt(payment_mode),
        fy: currentFy,
        staff_details,                             // Optional string field for backward compatibility
        staff_id: staff_id ? parseInt(staff_id) : null, // Optional FK to staff table
        mechanic_id: mechanic_id ? parseInt(mechanic_id) : null, // Optional FK to mechanic table
        commission: commission || 0,               // Optional commission amount
        packing_forwarding_qty: packing_forwarding_qty ? parseFloat(packing_forwarding_qty) : null, // Packing qty
        packing_forwarding_rate: packing_forwarding_rate ? parseFloat(packing_forwarding_rate) : null, // Packing rate
        packing_forwarding_total: packing_forwarding_total ? parseFloat(packing_forwarding_total) : null // Packing total
      }
    })

    try {
      // ===== PHASE 1: TRANSACTION RECORDING =====
      // Record income transaction in incexpx table
      await prisma.incexpx.create({
        data: {
          invoice_id: invoice.id,
          user_id: 1, // TODO: Get from authentication context
          amt: invoice.total,
          payment_mode: invoice.payment_mode,
          type: 1, // 1 = Income (for salex/invoice exempt)
          incexp_date: new Date().toISOString().split('T')[0],
          fy: invoice.fy,
          notes: invoice.notes
        }
      })

      // 2. Create invoice items in invoice_itemsx table and update stock
      if (invoiceItems && invoiceItems.length > 0) {
        for (const item of invoiceItems) {
          // Fetch product details from database
          const product = await prisma.product.findUnique({
            where: { id: parseInt(item.product_id) },
            select: {
              product_name: true,
              hsn: true,
              product_category_id: true,
              product_subcategory_id: true,
              company_id: true,
              stock: true
            }
          })

          if (!product) {
            throw new Error(`Product with ID ${item.product_id} not found`)
          }

          // Check stock availability
          if (product.stock < item.qty) {
            throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested ${item.qty}`)
          }

          // Create invoice item
          await prisma.invoice_itemsx.create({
            data: {
              product_id: item.product_id, // Required foreign key to Product table
              invoice_no: invoice.id, // Use the created invoice ID
              name_of_product: item.name_of_product,
              qty: parseFloat(item.qty),
              rate: parseFloat(item.rate),
              subtotal: parseFloat(item.subtotal),
              discount: parseFloat(item.discount) || 0,         // Item-level discount amount
              discountrate: parseFloat(item.discountrate) || 0, // Item-level discount percentage
              hsn: item.hsn || '',
              part: item.part || '',
              category_id: item.category_id || null,
              subcategory_id: item.subcategory_id || null,
              model_id: item.model_id ? parseInt(item.model_id) : null,
              company_id: item.company_id || null,
              fy: currentFy,
              invoice_date: invoiceDateTimestamp
            }
          })

          // Validate and convert quantity to number to prevent null/undefined/0 issues
          const validatedQty = Number(item.qty) || 0;

          // Decrease product stock for salex sales
          await prisma.product.update({
            where: { id: parseInt(item.product_id) },
            data: {
              stock: {
                decrement: validatedQty
              }
            }
          })
        }
      }

      // 3. Create customer reference in bill_tosalesx table
      await prisma.bill_tosalesx.create({
        data: {
          invoice_no: invoice.id,
          billing_name: req.body.customer_name || existingCustomer?.billing_name || 'Other',
          contact_no: req.body.contact_number || existingCustomer?.contact_no || '',
          email: req.body.email_id || existingCustomer?.email || '',
          billing_address: req.body.address || existingCustomer?.billing_address || '',
          billing_address2: existingCustomer?.billing_address_2 || '',
          billing_city: req.body.city || existingCustomer?.billing_city || '',
          billing_state: req.body.state || existingCustomer?.billing_state || '',
          billing_state_code: existingCustomer?.billing_state_code || null,
          billing_gstin: req.body.gst_number || existingCustomer?.billing_gstin || '',
          billing_pin_code: req.body.pin_code || existingCustomer?.billing_pin_code || ''
        }
      })

      // 4. Create shipping reference in shiptox table
      await prisma.shiptox.create({
        data: {
          invoice_no: invoice.id,
          shipping_name: req.body.customer_name || existingCustomer?.shipping_name || existingCustomer?.billing_name || 'Other',
          shipping_address: req.body.address || existingCustomer?.shipping_address || existingCustomer?.billing_address || '',
          shipping_address2: existingCustomer?.shipping_address_2 || existingCustomer?.billing_address_2 || '',
          shipping_city: req.body.city || existingCustomer?.shipping_city || existingCustomer?.billing_city || '',
          shipping_state: req.body.state || existingCustomer?.shipping_state || existingCustomer?.billing_state || '',
          shipping_state_code: existingCustomer?.shipping_state_code || existingCustomer?.billing_state_code || null,
          shipping_gstin: req.body.gst_number || existingCustomer?.shipping_gstin || existingCustomer?.billing_gstin || '',
          shipping_pin_code: req.body.pin_code || existingCustomer?.shipping_pin_code || existingCustomer?.billing_pin_code || '',
          shipping: useShippingAddress || true
        }
      })

      // 5. Create transport details in transport_detailsx table
      if (transportDetails) {
        await prisma.transport_detailsx.create({
          data: {
            invoice_id: invoice.id,
            trans_mode: transportDetails.trans_mode || null,
            vehicle_no: transportDetails.vehicle_no || null,
            supply_date: transportDetails.supply_date || null
          }
        })
      }
    } catch (subError) {
      console.error('Error in dependent operations, invoice created but related records may be incomplete:', subError)
      // Invoice was created, but some related records failed
      // You might want to delete the invoice or flag it for review
      throw subError
    }

    res.status(201).json({
      message: 'Salex invoice created successfully',
      salex: {
        id: invoice.id,
        invoice_no: invoice.invoice_no,
        total: invoice.total,
        customer_name: existingCustomer?.billing_name || req.body.customer_name || 'Other'
      }
    })
  } catch (error) {
    console.error('Salex creation error:', error)
    res.status(500).json({
      message: 'Failed to create salex invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

// PUT handler for updating salex invoices (needed for consistency)
async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query

    if (!id) {
      return res.status(400).json({ message: 'Sale ID is required' })
    }

    const {
      // ===== MAIN SALEX TABLE FIELDS (ALL STORED) =====
      invoice_number,
      bill_reference,
      staff_id,
      mechanic_id,
      commission,
      date,

      // ===== CUSTOMER RELATIONSHIP (ONLY FK STORED) =====
      customer_id,

      // ===== TRANSPORT FIELDS =====
      transport_cost,

      // ===== ITEMS AND CALCULATIONS =====
      items,
      descriptions,
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,

      // ===== TAX FIELDS =====
      total_cgst,
      total_sgst,
      total_igst,
      notes,
      total_tax,
      payment_status,
      payment_mode
    } = req.body

    // ===== VALIDATION =====
    if (!invoice_number || customer_id === undefined || customer_id === null) {
      return res.status(400).json({
        message: 'Missing required fields: invoice_number or customer_id'
      })
    }

    // ===== VALIDATE CUSTOMER EXISTS =====
    let existingCustomer = null;
    if (parseInt(customer_id) !== 0) {
      existingCustomer = await prisma.customer_details.findUnique({
        where: { id: parseInt(customer_id) }
      })

      if (!existingCustomer) {
        return res.status(400).json({
          message: 'Invalid customer selected - customer does not exist'
        })
      }
    }

    // ===== VALIDATE SALEX EXISTS =====
    const existingSalex = await prisma.invoicex.findUnique({
      where: { id: parseInt(id as string) }
    })

    if (!existingSalex) {
      return res.status(404).json({
        message: 'Salex not found'
      })
    }

    // ===== VALIDATE PAYMENT FIELDS =====
    const validPaymentStatuses = [0, 1];
    const validPaymentModes = [0, 1];

    const parsedPaymentStatus = payment_status !== undefined && payment_status !== null
      ? parseInt(payment_status.toString())
      : 0;

    const parsedPaymentMode = payment_mode !== undefined && payment_mode !== null
      ? parseInt(payment_mode.toString())
      : 1;

    if (!validPaymentStatuses.includes(parsedPaymentStatus)) {
      return res.status(400).json({
        message: 'Invalid payment_status: must be 0 (Unpaid) or 1 (Paid)'
      })
    }

    if (!validPaymentModes.includes(parsedPaymentMode)) {
      return res.status(400).json({
        message: 'Invalid payment_mode: must be 0 (Cash) or 1 (Bank)'
      })
    }

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert date to Unix timestamp
    const invoiceDate = typeof date === 'number' && date > 1000000000
      ? Math.floor(date) // Already a Unix timestamp in seconds
      : Math.floor(new Date(date).getTime() / 1000); // Convert date string to timestamp

    // Calculate totals if items provided
    let itemsTotal = 0
    let totalTaxable = 0
    if (items && items.length > 0) {
      itemsTotal = items.reduce((sum, item) => sum + (item.qty * item.rate), 0)
      totalTaxable = itemsTotal
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update salex record
      const sale = await tx.invoicex.update({
        where: { id: parseInt(id as string) },
        data: {
          invoice_no: parseInt(invoice_number),
          select_customer: parseInt(customer_id),
          bill_reference: bill_reference || '',
          staff_id: staff_id ? parseInt(staff_id) : null,
          mechanic_id: mechanic_id ? parseInt(mechanic_id) : null,
          commission: commission || 0,
          items_total: itemsTotal,
          freight: transport_cost || 0,
          total_taxable_value: totalTaxable,
          taxrate: 0, // No tax for salex
          total_cgst: total_cgst || 0,
          total_sgst: total_sgst || 0,
          total_igst: total_igst || 0,
          total_tax: total_tax || 0,
          total: itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0),
          notes: notes || '',
          descriptions: descriptions || '',
          packing_forwarding_qty: packing_forwarding_qty || null,
          packing_forwarding_rate: packing_forwarding_rate || null,
          packing_forwarding_total: packing_forwarding_total || null,
          invoice_date: Math.floor(invoiceDate),
          payment_status: parsedPaymentStatus,
          payment_mode: parsedPaymentMode,
          fy: financialYear,
          updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
        }
      })

      // Handle item-level updates if items provided
      if (items && items.length > 0) {
        // Get existing salex items for comparison
        const existingItems = await tx.invoice_itemsx.findMany({
          where: { invoice_no: sale.id }
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
            rate: item.rate || 0,
            product_id: parseInt(item.product_id),
            item: item
          })
        })

        // Process deletions: items that exist in DB but not in new list
        for (const [productId, existingData] of Array.from(existingItemsMap.entries())) {
          if (!newItemsMap.has(productId)) {
            // Item was removed - return stock (increase stock since salex sale is cancelled)
            const validatedExistingQty = Number(existingData.qty) || 0;
            if (validatedExistingQty > 0) {
              await tx.product.update({
                where: { id: productId },
                data: {
                  stock: {
                    increment: validatedExistingQty
                  }
                }
              })
            }
            // Delete the item
            await tx.invoice_itemsx.delete({
              where: { id: existingData.id }
            })
          }
        }

        // Process additions and updates
        for (const [productId, newData] of Array.from(newItemsMap.entries())) {
          const existingData = existingItemsMap.get(productId)

          if (!existingData) {
            // New item - create it and decrease stock
            const product = await tx.product.findUnique({
              where: { id: productId },
              select: {
                product_name: true,
                hsn: true,
                product_category_id: true,
                product_subcategory_id: true,
                company_id: true,
                stock: true
              }
            })

            if (!product) {
              throw new Error(`Product with ID ${productId} not found`)
            }

            // Check stock availability for new items
            if (product.stock < newData.qty) {
              throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested ${newData.qty}`)
            }

            const modelId = newData.item.model_id ? parseInt(newData.item.model_id) : null;

            await tx.invoice_itemsx.create({
              data: {
                invoice_no: sale.id,
                product_id: productId,
                name_of_product: newData.item.product_name || product.product_name || '',
                category_id: product.product_category_id,
                subcategory_id: product.product_subcategory_id,
                model_id: modelId,
                company_id: product.company_id,
                hsn: product.hsn,
                part: newData.item.part || '',
                qty: newData.qty,
                rate: newData.rate,
                subtotal: newData.qty * newData.rate,
                gst_percentage: newData.item.gst_percentage || 0,
                cgst: newData.item.cgst || 0,
                sgst: newData.item.sgst || 0,
                igst: newData.item.igst || 0,
                tax: newData.item.tax || 0,
                fy: financialYear,
                invoice_date: invoiceDate
              }
            })

            // Validate and convert quantity to number to prevent null/undefined/0 issues
            const validatedNewQty = Number(newData.qty) || 0;

            // Decrease stock for new salex sales
            await tx.product.update({
              where: { id: productId },
              data: {
                stock: {
                  decrement: validatedNewQty
                }
              }
            })
          } else {
            // Existing item - check if quantity changed
            const validatedNewQty = Number(newData.qty) || 0;
            const validatedExistingQty = Number(existingData.qty) || 0;
            const qtyDifference = validatedNewQty - validatedExistingQty;

            if (Math.abs(qtyDifference) > 0.001) {
              // Check stock availability for increased quantity
              if (qtyDifference > 0) {
                const product = await tx.product.findUnique({
                  where: { id: productId },
                  select: { stock: true, product_name: true }
                })

                if (product && product.stock < qtyDifference) {
                  throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested additional ${qtyDifference}`)
                }
              }

              // Update quantity and subtotal
              await tx.invoice_itemsx.update({
                where: { id: existingData.id },
                data: {
                  qty: newData.qty,
                  rate: newData.rate,
                  subtotal: newData.qty * newData.rate
                }
              })

              // Adjust stock based on quantity difference
              await tx.product.update({
                where: { id: productId },
                data: {
                  stock: {
                    increment: -qtyDifference // Negative because salex sales decrease stock
                  }
                }
              })
            }
          }
        }
      }

      // Update customer relationship
      await tx.bill_tosalesx.upsert({
        where: { invoice_no: sale.id },
        update: {
          billing_name: req.body.customer_name || existingCustomer?.billing_name || 'Other',
          contact_no: req.body.contact_number || existingCustomer?.contact_no || '',
          email: req.body.email_id || existingCustomer?.email || '',
          billing_address: req.body.address || existingCustomer?.billing_address || '',
          billing_address2: existingCustomer?.billing_address_2 || '',
          billing_city: req.body.city || existingCustomer?.billing_city || '',
          billing_state: req.body.state || existingCustomer?.billing_state || '',
          billing_state_code: existingCustomer?.billing_state_code || null,
          billing_gstin: req.body.gst_number || existingCustomer?.billing_gstin || '',
          billing_pin_code: req.body.pin_code || existingCustomer?.billing_pin_code || ''
        },
        create: {
          invoice_no: sale.id,
          billing_name: req.body.customer_name || existingCustomer?.billing_name || 'Other',
          contact_no: req.body.contact_number || existingCustomer?.contact_no || '',
          email: req.body.email_id || existingCustomer?.email || '',
          billing_address: req.body.address || existingCustomer?.billing_address || '',
          billing_address2: existingCustomer?.billing_address_2 || '',
          billing_city: req.body.city || existingCustomer?.billing_city || '',
          billing_state: req.body.state || existingCustomer?.billing_state || '',
          billing_state_code: existingCustomer?.billing_state_code || null,
          billing_gstin: req.body.gst_number || existingCustomer?.billing_gstin || '',
          billing_pin_code: req.body.pin_code || existingCustomer?.billing_pin_code || ''
        }
      })

      // Update shipping details
      await tx.shiptox.upsert({
        where: { invoice_no: sale.id },
        update: {
          shipping_name: req.body.customer_name || existingCustomer?.shipping_name || existingCustomer?.billing_name || 'Other',
          shipping_address: req.body.address || existingCustomer?.shipping_address || existingCustomer?.billing_address || '',
          shipping_address2: existingCustomer?.shipping_address_2 || existingCustomer?.billing_address_2 || '',
          shipping_city: req.body.city || existingCustomer?.shipping_city || existingCustomer?.billing_city || '',
          shipping_state: req.body.state || existingCustomer?.shipping_state || existingCustomer?.billing_state || '',
          shipping_state_code: existingCustomer?.shipping_state_code || existingCustomer?.billing_state_code || null,
          shipping_gstin: req.body.gst_number || existingCustomer?.shipping_gstin || existingCustomer?.billing_gstin || '',
          shipping_pin_code: req.body.pin_code || existingCustomer?.shipping_pin_code || existingCustomer?.billing_pin_code || '',
          shipping: true
        },
        create: {
          invoice_no: sale.id,
          shipping_name: req.body.customer_name || existingCustomer?.shipping_name || existingCustomer?.billing_name || 'Other',
          shipping_address: req.body.address || existingCustomer?.shipping_address || existingCustomer?.billing_address || '',
          shipping_address2: existingCustomer?.shipping_address_2 || existingCustomer?.billing_address_2 || '',
          shipping_city: req.body.city || existingCustomer?.shipping_city || existingCustomer?.billing_city || '',
          shipping_state: req.body.state || existingCustomer?.shipping_state || existingCustomer?.billing_state || '',
          shipping_state_code: existingCustomer?.shipping_state_code || existingCustomer?.billing_state_code || null,
          shipping_gstin: req.body.gst_number || existingCustomer?.shipping_gstin || existingCustomer?.billing_gstin || '',
          shipping_pin_code: req.body.pin_code || existingCustomer?.shipping_pin_code || existingCustomer?.billing_pin_code || '',
          shipping: true
        }
      })

      return sale
    })

    res.status(200).json({
      message: 'Salex updated successfully',
      sale: {
        id: result.id,
        invoice_no: result.invoice_no,
        total: result.total,
        customer_name: existingCustomer.billing_name
      }
    })

  } catch (error) {
    console.error('Salex update error:', error)
    res.status(500).json({
      message: 'Failed to update salex',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handler(
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

export default withObservability(handler)
