import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { getNextInvoiceNumber } from '../../../lib/invoice-counter'
import { withObservability } from '../../../lib/withObservability'
import { convertDateToTimestamp, parseDateRange } from '../../../lib/date-utils'
import { customerBalanceHandler } from '../../../lib/customer-balance-handler'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions)

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

/**
 * POST /api/sales
 * Create a new sale with items, stock updates, and optional payment
 * ✅ REFACTORED: Uses customer handlers for transaction safety
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { nextInvoiceNo, currentFy } = await getNextInvoiceNumber('invoice')

    const {
      bill_reference,
      staff_id,
      mechanic_id,
      commission,
      date,
      customer_id,
      transport_cost,
      items,
      descriptions,
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,
      total_cgst,
      total_sgst,
      total_igst,
      notes,
      total_tax,
      payment_status,
      payment_mode
    } = req.body

    // Validation
    if (customer_id === undefined || customer_id === null || !items || items.length === 0) {
      return res.status(400).json({
        message: 'Missing required fields: customer_id, or items'
      })
    }

    // Validate customer exists (if not "Other")
    let existingCustomer = null
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

    // Validate payment fields
    const validPaymentStatuses = [0, 1, 2]
    const validPaymentModes = [0, 1]

    const parsedPaymentStatus = payment_status !== undefined && payment_status !== null
      ? parseInt(payment_status.toString())
      : 0

    const parsedPaymentMode = payment_mode !== undefined && payment_mode !== null
      ? parseInt(payment_mode.toString())
      : 0

    if (!validPaymentStatuses.includes(parsedPaymentStatus)) {
      return res.status(400).json({
        message: 'Invalid payment_status: must be 0 (Unpaid), 1 (Paid), or 2 (Partially Paid)'
      })
    }

    if (!validPaymentModes.includes(parsedPaymentMode)) {
      return res.status(400).json({
        message: 'Invalid payment_mode: must be 0 (Cash) or 1 (Bank)'
      })
    }

    const invoiceDate = convertDateToTimestamp(date)
    const itemsTotal = items.reduce((sum, item) => sum + (item.qty * item.rate), 0)
    const calculatedGrandTotal = itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0)

    // ✅ REFACTORED: Use transaction with customer handlers
    const sale = await prisma.$transaction(async (tx) => {
      // 1. Create sale record
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
      }

      if (staff_id) {
        saleData.staff = { connect: { id: parseInt(staff_id) } }
      }
      if (mechanic_id) {
        saleData.mechanic = { connect: { id: parseInt(mechanic_id) } }
      }

      const sale = await tx.invoice.create({ data: saleData })

      // 2. Batch load products
      const productIds = items.map(item => parseInt(item.product_id))
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          product_name: true,
          hsn: true,
          product_category_id: true,
          product_subcategory_id: true,
          company_id: true,
          stock: true
        }
      })

      const productMap = new Map(products.map(product => [product.id, product]))

      // 3. Validate stock availability
      for (const item of items) {
        const productId = parseInt(item.product_id)
        const product = productMap.get(productId)

        if (!product) {
          throw new Error(`Product with ID ${productId} not found`)
        }

        if (product.stock < item.qty) {
          throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested ${item.qty}`)
        }
      }

      // 4. Create sale items and update stock
      for (const item of items) {
        const productId = parseInt(item.product_id)
        const product = productMap.get(productId)!
        const modelId = item.model_id ? parseInt(item.model_id) : null

        await tx.invoiceitems.create({
          data: {
            invoice_no: sale.id,
            product_id: productId,
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

        await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: Number(item.qty) || 0 } }
        })
      }

      // 5. Create customer relationship
      await tx.bill_tosales.create({
        data: {
          invoice_no: sale.id,
          billing_name: req.body.customer_name || existingCustomer?.billing_name || 'Other',
          contact_no: req.body.contact_number || existingCustomer?.contact_no || '',
          email: req.body.email_id || existingCustomer?.email || '',
          billing_address: req.body.address || existingCustomer?.billing_address || '',
          billing_address2: existingCustomer?.billing_address_2 || '',
          billing_city: req.body.city || existingCustomer?.billing_city || '',
          billing_state: req.body.state || existingCustomer?.billing_state || '',
          billing_state_code: req.body.state_code || existingCustomer?.billing_state_code || null,
          billing_gstin: req.body.gst_number || existingCustomer?.billing_gstin || ''
        }
      })

      // 6. Create shipping details
      await tx.shipto.create({
        data: {
          invoice_no: sale.id,
          shipping_name: req.body.customer_name || existingCustomer?.shipping_name || existingCustomer?.billing_name || 'Other',
          shipping_address: req.body.address || existingCustomer?.shipping_address || existingCustomer?.billing_address || '',
          shipping_address2: existingCustomer?.shipping_address_2 || existingCustomer?.billing_address_2 || '',
          shipping_city: req.body.city || existingCustomer?.shipping_city || existingCustomer?.billing_city || '',
          shipping_state: req.body.state || existingCustomer?.shipping_state || existingCustomer?.billing_state || '',
          shipping_state_code: existingCustomer?.shipping_state_code || existingCustomer?.billing_state_code || null,
          shipping_gstin: req.body.gst_number || existingCustomer?.shipping_gstin || existingCustomer?.billing_gstin || '',
          shipping: true
        }
      })

      // 7. Handle payment if paid (create payment records like purchase does)
      if (parsedPaymentStatus === 1 && parseInt(customer_id) !== 0) {
        // Fetch customer balance for smart advance allocation
        const customer = await tx.customer_details.findUnique({
          where: { id: parseInt(customer_id) },
          select: {
            total_paid: true,
            total_allocated: true,
            total_refunded: true,
            total_refund_allocated: true
          }
        });

        // Calculate advance balance (money customer has already paid)
        const advanceBalance = customer 
          ? (Number(customer.total_paid) - Number(customer.total_allocated)) + 
            (Number(customer.total_refunded) - Number(customer.total_refund_allocated))
          : 0;
        
        const advanceUsed = Math.min(Math.max(0, advanceBalance), calculatedGrandTotal);
        const newPayment = calculatedGrandTotal - advanceUsed;

        // Create payment record for advance portion if any
        if (advanceUsed > 0) {
          const advancePayment = await tx.customer_payments.create({
            data: {
              customer_id: parseInt(customer_id),
              payment_date: Math.floor(invoiceDate),
              payment_amount: advanceUsed,
              payment_mode: parsedPaymentMode,
              payment_type: 'BILL_SPECIFIC',
              notes: `Allocated from advance balance: ₹${advanceUsed.toFixed(2)}`,
              fy: currentFy
            }
          });

          await tx.customer_payment_allocations.create({
            data: {
              payment_id: advancePayment.id,
              invoice_id: sale.id,
              allocated_amount: advanceUsed,
              allocation_date: Math.floor(invoiceDate),
              notes: 'Allocated from existing advance balance'
            }
          });
        }

        // Create payment record for new payment portion if any
        if (newPayment > 0) {
          const payment = await tx.customer_payments.create({
            data: {
              customer_id: parseInt(customer_id),
              payment_date: Math.floor(invoiceDate),
              payment_amount: newPayment,
              payment_mode: parsedPaymentMode,
              payment_type: 'BILL_SPECIFIC',
              notes: advanceUsed > 0
                ? `New payment for sale ${sale.invoice_no}: ₹${newPayment.toFixed(2)}`
                : `Payment for sale ${sale.invoice_no}`,
              fy: currentFy
            }
          });

          await tx.customer_payment_allocations.create({
            data: {
              payment_id: payment.id,
              invoice_id: sale.id,
              allocated_amount: newPayment,
              allocation_date: Math.floor(invoiceDate),
              notes: 'Allocated during sale creation'
            }
          });
        }

        // Update customer balance
        await tx.customer_details.update({
          where: { id: parseInt(customer_id) },
          data: {
            total_paid: { increment: newPayment },
            total_allocated: { increment: calculatedGrandTotal }
          }
        });
      }

      return sale
    }, {
      timeout: 30000
    })

    res.status(201).json({
      message: 'Sale created successfully',
      sale: {
        id: sale.id,
        invoice_no: sale.invoice_no,
        total: sale.total,
        customer_name: existingCustomer?.billing_name || req.body.customer_name || 'Other'
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

/**
 * GET /api/sales
 * List sales with filters and pagination
 */
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
      uid = '',
      billRef = '',
      items = '',
      taxAmount = '',
      pf = '',
      paymentMode = '',
      sortBy = 'invoice_date',
      sortOrder = 'desc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    const where: any = {}

    if (uid && uid !== '') {
      where.invoice_no = parseInt(uid as string)
    }

    if (billRef && billRef !== '') {
      where.bill_reference = { contains: billRef as string }
    }

    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search
      const searchNum = parseInt(searchStr)
      where.OR = [
        !isNaN(searchNum) ? { invoice_no: searchNum } : undefined,
        { notes: { contains: searchStr } },
      ].filter(Boolean)
    }

    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    if (startDate && endDate) {
      const { startTimestamp, endTimestamp } = parseDateRange(
        startDate as string,
        endDate as string
      )
      where.invoice_date = {
        gte: startTimestamp,
        lte: endTimestamp
      }
    }

    if (status && status !== '') {
      if (status === '1' || status === '0') {
        where.payment_status = parseInt(status)
      } else if (status === 'unknown') {
        where.payment_status = { notIn: [0, 1, 2] }
      }
    }

    if (paymentMode && paymentMode !== '') {
      where.payment_mode = parseInt(paymentMode as string)
    }

    if (taxAmount && taxAmount !== '') {
      where.total_tax = { gte: parseFloat(taxAmount as string) }
    }

    if (pf && pf !== '') {
      where.packing_forwarding_total = { gte: parseFloat(pf as string) }
    }

    const itemsFilter = items && items !== '' ? parseInt(items as string) : null

    const validSortFields = [
      'id', 'invoice_no', 'customer_name', 'total', 'invoice_date',
      'payment_status', 'fy', 'bill_reference', 'item_count',
      'total_tax', 'packing_forwarding_total', 'payment_mode'
    ]
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'invoice_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    const needsPostSorting = sortField === 'customer_name' || sortField === 'item_count'

    let salesInvoices: any[]
    let total: number

    if (needsPostSorting) {
      const result = await Promise.all([
        prisma.invoice.findMany({
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
            return_status: true,
            packing_forwarding_total: true
          }
        }),
        prisma.invoice.count({ where })
      ])
      salesInvoices = result[0]
      total = result[1]
    } else {
      const result = await Promise.all([
        prisma.invoice.findMany({
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
            return_status: true,
            packing_forwarding_total: true
          }
        }),
        prisma.invoice.count({ where })
      ])
      salesInvoices = result[0]
      total = result[1]
    }

    const invoiceIds = salesInvoices.map((inv: { id: any }) => inv.id)
    const otherCustomerInvoices = salesInvoices.filter((inv: any) => inv.select_customer === 0).map((inv: any) => inv.id)

    let paymentAllocations: any[] = []
    try {
      if (invoiceIds.length > 0) {
        paymentAllocations = await (prisma.customer_payment_allocations.groupBy as any)({
          by: ['invoice_id'],
          where: { invoice_id: { in: invoiceIds } },
          _sum: { allocated_amount: true }
        })
      }
    } catch (error) {
      console.warn('customer_payment_allocations table not found, skipping payment data')
    }

    const [customerData, itemCounts, billToData] = await Promise.all([
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, select_customer: true }
      }),

      prisma.invoiceitems.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      }),

      otherCustomerInvoices.length > 0 ? prisma.bill_tosales.findMany({
        where: { invoice_no: { in: otherCustomerInvoices } },
        select: { invoice_no: true, billing_name: true, contact_no: true, email: true, billing_address: true, billing_address2: true, billing_city: true, billing_state: true, billing_gstin: true }
      }) : Promise.resolve([])
    ])

    const customerIds = customerData
      .map(inv => inv.select_customer)
      .filter(id => id !== null && id !== 0)

    const customerDetails = customerIds.length > 0 ? await prisma.customer_details.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, billing_name: true, billing_gstin: true }
    }) : []

    const customerMap = new Map()
    const gstinMap = new Map()
    const billToMap = new Map(billToData.map(billTo => [billTo.invoice_no, billTo]))
    const customerLookupMap = new Map(customerDetails.map(cust => [cust.id, cust]))

    customerData.forEach(invoice => {
      const customer = customerLookupMap.get(invoice.select_customer)
      if (customer) {
        customerMap.set(invoice.id, customer.billing_name)
        gstinMap.set(invoice.id, customer.billing_gstin)
      }
    })

    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))
    const paymentMap = new Map(paymentAllocations.map((payment: any) => [payment.invoice_id, Number(payment._sum.allocated_amount || 0)]))

    let enhancedSales = salesInvoices.map((invoice: any) => {
      const totalPaid = paymentMap.get(invoice.id) || 0
      const outstandingAmount = Number(invoice.total) - totalPaid

      let formattedDate = 'Invalid Date'
      try {
        if (invoice.invoice_date) {
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
        customer_name: customerMap.get(invoice.id) || billToMap.get(invoice.id)?.billing_name || 'Other',
        total_tax: invoice.total_tax || 0,
        total: invoice.total,
        bill_reference: invoice.bill_reference || '',
        invoice_date: invoice.invoice_date,
        payment_status: invoice.payment_status || 0,
        payment_mode: invoice.payment_mode || 0,
        return_status: invoice.return_status || 0,
        fy: invoice.fy,
        type: invoice.type || 'sale',
        item_count: itemCountMap.get(invoice.id) || 0,
        packing_forwarding_total: invoice.packing_forwarding_total || 0,
        total_paid: totalPaid,
        outstanding_amount: outstandingAmount,
      }
    })

    if (itemsFilter !== null && !isNaN(itemsFilter)) {
      enhancedSales = enhancedSales.filter(sale => (sale.item_count || 0) >= itemsFilter!)
    }

    if (needsPostSorting) {
      enhancedSales.sort((a, b) => {
        if (sortField === 'item_count') {
          const aValue = Number(a.item_count) || 0
          const bValue = Number(b.item_count) || 0
          return sortDirection === 'asc' ? aValue - bValue : bValue - aValue
        } else {
          const aValue = (a.customer_name || '').toString().toLowerCase()
          const bValue = (b.customer_name || '').toString().toLowerCase()

          if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
          if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
          return 0
        }
      })

      enhancedSales = enhancedSales.slice(skip, skip + limitNum)
    }

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

export default withObservability(handler)
