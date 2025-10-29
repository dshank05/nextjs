import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { getNextInvoiceNumber } from '../../../lib/invoice-counter'

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

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    // ===== INVOICE NUMBERING =====
    // Get next invoice number based on current financial year
    const { nextInvoiceNo, currentFy } = await getNextInvoiceNumber('invoice');

    const {
      // ===== MAIN SALE TABLE FIELDS (ALL STORED) =====
      // invoice_number is now auto-generated based on FY
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

    console.log('📝 API Received POST data for sale:', req.body);

    // ===== VALIDATION =====
    if (!customer_id || !items || items.length === 0) {
      return res.status(400).json({
        message: 'Missing required fields: customer_id, or items'
      })
    }

    // ===== VALIDATE CUSTOMER EXISTS =====
    const existingCustomer = await prisma.customer_details.findUnique({
      where: { id: parseInt(customer_id) }
    })

    if (!existingCustomer) {
      return res.status(400).json({
        message: 'Invalid customer selected - customer does not exist'
      })
    }

    // Validate payment_status and payment_mode
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

    console.log('✅ Payment validation passed');
    console.log('📋 Auto-generated invoice number:', nextInvoiceNo, 'for FY:', currentFy);

    // Convert date to Unix timestamp
    const invoiceDate = new Date(date).getTime() / 1000

    // Calculate totals
    const itemsTotal = items.reduce((sum, item) => sum + (item.qty * item.rate), 0)
    const calculatedGrandTotal = itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0)

    // Create sale record
    const saleData: any = {
      invoice_no: nextInvoiceNo,
      bill_reference: bill_reference || '',
      commission: commission || 0,
      items_total: itemsTotal,
      freight: transport_cost || 0,
      total_taxable_value: itemsTotal,
      total_cgst: total_cgst || 0,
      total_sgst: total_sgst || 0,
      total_igst: total_igst || 0,
      total_tax: total_tax || 0,
      total: calculatedGrandTotal,
      notes: notes || '',
      descriptions: descriptions || '',
      packing_forwarding_qty: packing_forwarding_qty || 0,
      packing_forwarding_rate: packing_forwarding_rate || 0,
      packing_forwarding_total: packing_forwarding_total || 0,
      invoice_date: Math.floor(invoiceDate),
      payment_status: parsedPaymentStatus,
      payment_mode: parsedPaymentMode,
      fy: currentFy
    };

    // Add staff and mechanic relations if provided
    if (staff_id) {
      saleData.staff = { connect: { id: parseInt(staff_id) } };
    }
    if (mechanic_id) {
      saleData.mechanic = { connect: { id: parseInt(mechanic_id) } };
    }

    const sale = await prisma.invoice.create({
      data: saleData
    })

    // Create sale items
    for (const item of items) {
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

      const modelId = item.model_id ? parseInt(item.model_id) : null;

      await prisma.invoiceitems.create({
        data: {
          invoice_no: sale.id,
          product_id: parseInt(item.product_id),
          name_of_product: item.product_name || product.product_name || '',
          category_id: product.product_category_id,
          subcategory_id: product.product_subcategory_id,
          model_id: modelId,
          company_id: product.company_id,
          hsn: product.hsn,
          part: item.part || '',
          qty: item.qty,
          rate: item.rate,
          subtotal: item.qty * item.rate,
          gst_percentage: item.gst_percentage || 0,
          cgst: item.cgst || 0,
          sgst: item.sgst || 0,
          igst: item.igst || 0,
          tax: item.tax || 0,
          fy: currentFy,
          invoice_date: invoiceDate
        }
      })

      // Decrease product stock
      await prisma.product.update({
        where: { id: parseInt(item.product_id) },
        data: {
          stock: {
            decrement: item.qty
          }
        }
      })
    }

    // Create customer relationship
    await prisma.bill_tosales.create({
      data: {
        invoice_no: sale.id,
        customer_id: parseInt(customer_id)
      }
    })

    // Create income transaction
    await prisma.incexp.create({
      data: {
        invoice_id: sale.id,
        user_id: 1, // TODO: Get from authentication context
        amt: sale.total,
        payment_mode: sale.payment_mode,
        type: 0, // 0 = Income
        incexp_date: new Date().toISOString().split('T')[0],
        fy: sale.fy,
        notes: sale.notes || `Sale invoice #${sale.invoice_no}`
      }
    })

    res.status(201).json({
      message: 'Sale created successfully',
      sale: {
        id: sale.id,
        invoice_no: sale.invoice_no,
        total: sale.total,
        customer_name: existingCustomer.billing_name
      }
    })

  } catch (error) {
    console.error('Sale creation error:', error)
    res.status(500).json({
      message: 'Failed to create sale',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query

    const saleId = parseInt(id as string)
    if (isNaN(saleId)) {
      return res.status(400).json({ message: 'Invalid sale ID' })
    }

    const {
      // ===== MAIN SALE TABLE FIELDS (ALL STORED) =====
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
    if (!invoice_number || !customer_id) {
      return res.status(400).json({
        message: 'Missing required fields: invoice_number or customer_id'
      })
    }

    // ===== VALIDATE CUSTOMER EXISTS =====
    const existingCustomer = await prisma.customer_details.findUnique({
      where: { id: parseInt(customer_id) }
    })

    if (!existingCustomer) {
      return res.status(400).json({
        message: 'Invalid customer selected - customer does not exist'
      })
    }

    // ===== VALIDATE SALE EXISTS =====
    const existingSale = await prisma.invoice.findUnique({
      where: { id: saleId }
    })

    if (!existingSale) {
      return res.status(404).json({
        message: 'Sale not found'
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
    const invoiceDate = new Date(date).getTime() / 1000

    // Calculate totals if items provided
    let itemsTotal = 0
    if (items && items.length > 0) {
      itemsTotal = items.reduce((sum, item) => sum + (item.qty * item.rate), 0)
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update sale record
      const saleUpdateData: any = {
        bill_reference: bill_reference || '',
        commission: commission || 0,
        items_total: itemsTotal,
        freight: transport_cost || 0,
        total_taxable_value: itemsTotal,
        total_cgst: total_cgst || 0,
        total_sgst: total_sgst || 0,
        total_igst: total_igst || 0,
        total_tax: total_tax || 0,
        total: itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0),
        notes: notes || '',
        descriptions: descriptions || '',
        packing_forwarding_qty: packing_forwarding_qty || 0,
        packing_forwarding_rate: packing_forwarding_rate || 0,
        packing_forwarding_total: packing_forwarding_total || 0,
        invoice_date: Math.floor(invoiceDate),
        payment_status: parsedPaymentStatus,
        payment_mode: parsedPaymentMode,
        fy: financialYear
      };

      // Handle staff and mechanic relations
      if (staff_id) {
        saleUpdateData.staff = { connect: { id: parseInt(staff_id) } };
      } else {
        saleUpdateData.staff = { disconnect: true };
      }

      if (mechanic_id) {
        saleUpdateData.mechanic = { connect: { id: parseInt(mechanic_id) } };
      } else {
        saleUpdateData.mechanic = { disconnect: true };
      }

      const sale = await tx.invoice.update({
        where: { id: saleId },
        data: saleUpdateData
      })

      // Handle item-level updates if items provided
      if (items && items.length > 0) {
        // Get existing sale items for comparison
        const existingItems = await tx.invoiceitems.findMany({
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
            // Item was removed - increase stock (return sold items)
            if (existingData.qty > 0) {
              await tx.product.update({
                where: { id: productId },
                data: {
                  stock: {
                    increment: existingData.qty
                  }
                }
              })
            }
            // Delete the item
            await tx.invoiceitems.delete({
              where: { id: existingData.id }
            })
          }
        }

        // Process additions and updates
        for (const [productId, newData] of Array.from(newItemsMap.entries())) {
          const existingData = existingItemsMap.get(productId)

          if (!existingData) {
            // New item - create it and decrease stock
            // Fetch product details from database
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

            await tx.invoiceitems.create({
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

            // Decrease stock for new sales
            await tx.product.update({
              where: { id: productId },
              data: {
                stock: {
                  decrement: newData.qty
                }
              }
            })
          } else {
            // Existing item - check if quantity changed
            const qtyDifference = newData.qty - existingData.qty

            if (Math.abs(qtyDifference) > 0.001) { // Allow for small floating point differences
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

              // Update quantity and adjust stock
              await tx.invoiceitems.update({
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
                    increment: -qtyDifference // Negative because sales decrease stock
                  }
                }
              })
            }
          }
        }
      }

      // Update customer relationship
      await tx.bill_tosales.upsert({
        where: { invoice_no: sale.id },
        update: { customer_id: parseInt(customer_id) },
        create: {
          invoice_no: sale.id,
          customer_id: parseInt(customer_id)
        }
      })

      return sale
    })

    res.status(200).json({
      message: 'Sale updated successfully',
      sale: {
        id: result.id,
        invoice_no: result.invoice_no,
        total: result.total,
        customer_name: existingCustomer.billing_name
      }
    })

  } catch (error) {
    console.error('Sale update error:', error)
    res.status(500).json({
      message: 'Failed to update sale',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
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
        // For unknown status, show statuses that are not 0, 1, or 2 (2 is cancelled for sales)
        where.payment_status = { notIn: [0, 1, 2] }
      }
    }

    if (amountMin && amountMin !== '') {
      where.total = { gte: parseFloat(amountMin as string) }
    }

    if (amountMax && amountMax !== '') {
      where.total = where.total ? { ...where.total, lte: parseFloat(amountMax as string) } : { lte: parseFloat(amountMax as string) }
    }

    // Get sales invoices with related data
    const [salesInvoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { invoice_date: 'desc' }, // Order by date descending (newest first)
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
      prisma.invoice.count({ where })
    ])

    // Get customer names and item counts in batch queries
    const invoiceIds = salesInvoices.map((inv: { id: any }) => inv.id)

    const [customerData, itemCounts] = await Promise.all([
      // Get all customer names in one query
      prisma.customer_details.findMany({
        where: {
          bill_tosales: {
            some: {
              invoice_no: { in: invoiceIds }
            }
          }
        },
        select: {
          id: true,
          billing_name: true,
          billing_gstin: true,
          bill_tosales: {
            select: {
              invoice_no: true
            }
          }
        }
      }),

      // Get all item counts in one query
      prisma.invoiceitems.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      })
    ])

    // Create lookup maps for fast access
    const customerMap = new Map()
    const gstinMap = new Map()

    customerData.forEach(customer => {
      customer.bill_tosales.forEach(billToRecord => {
        const invoiceNo = billToRecord.invoice_no
        customerMap.set(invoiceNo, customer.billing_name)
        gstinMap.set(invoiceNo, customer.billing_gstin)
      })
    })

    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))

    // Enhanced sales invoices using maps
    const enhancedSales = salesInvoices.map((invoice: any) => {

      // Handle integer timestamp format for sales
      let formattedDate = 'Invalid Date'
      try {
        if (invoice.invoice_date) {
          // Sales dates are stored as integer timestamps
          const dateObj = new Date(invoice.invoice_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        }
      } catch (error) {
        console.warn('Invalid date format for sale:', invoice.invoice_date)
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
        // transport: '', // Not fetched in sales API
        // items: [], // Never populated in GET response
        total: invoice.total,
        bill_reference: invoice.bill_reference || '',
        invoice_date: invoice.invoice_date,
        payment_status: invoice.payment_status || 0,
        payment_mode: invoice.payment_mode || 0,
        return_status: invoice.return_status || 0,
        fy: invoice.fy,
        type: invoice.type || 'sale',
        item_count: itemCountMap.get(invoice.id) || 0,
        // OPTIMIZATION: Commented out unused formatted fields - frontend handles formatting
        // formattedDate,
        // formattedTotal: invoice.total.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })
      }
    })

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      sales: enhancedSales,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Sales fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch sales data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
