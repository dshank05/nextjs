import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { getNextInvoiceNumber } from '../../../lib/invoice-counter'
import { withObservability } from '../../../lib/withObservability'
import { convertDateToTimestamp, parseDateRange } from '../../../lib/date-utils'
import { customerBalanceHandler } from '../../../lib/customer-balance-handler'
import { customerLedgerService } from '../../../lib/customer-ledger-service'
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
 * POST /api/salex
 * Create a new salex with items, stock updates, and optional payment
 * ✅ REFACTORED: Uses customer handlers for transaction safety
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { nextInvoiceNo, currentFy } = await getNextInvoiceNumber('invoicex')

    const {
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
      discount = 0,
      staff_details,
      staff_id,
      mechanic_id,
      commission,
      bill_reference,
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,
      customer_id,
      useShippingAddress
    } = req.body

    // Validation
    if (!invoice_date || !invoiceItems || invoiceItems.length === 0) {
      return res.status(400).json({ message: 'Missing required fields' })
    }

    if (!req.body.customer_name || !req.body.contact_number || !req.body.state) {
      return res.status(400).json({ message: 'Customer name, contact number, and state are required' })
    }

    const invoiceDateTimestamp = typeof invoice_date === 'number' && invoice_date > 1000000000
      ? Math.floor(invoice_date)
      : convertDateToTimestamp(invoice_date)

    // Validate payment fields
    const validPaymentStatuses = [0, 1, 2] // Accept 0=Unpaid, 1=Paid, 2=Partially Paid (set by refunds/payments)
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

    // ✅ REFACTORED: Use transaction with customer handlers
    const invoice = await prisma.$transaction(async (tx) => {
      // 1. Create salex record
      const invoice = await tx.invoicex.create({
        data: {
          invoice_no: nextInvoiceNo,
          select_customer: parseInt(select_customer),
          items_total: parseFloat(items_total) || 0,
          freight: parseFloat(freight) || 0,
          total_taxable_value: parseFloat(total_taxable_value),
          taxrate: 0,
          total_cgst: 0,
          total_sgst: 0,
          total_igst: 0,
          total_tax: 0,
          total: parseFloat(total),
          notes: notes || '',
          descriptions: descriptions || '',
          bill_reference: bill_reference || '',
          discount: parseFloat(discount) || 0,
          invoice_date: invoiceDateTimestamp,
          updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          payment_status: parsedPaymentStatus,
          payment_mode: parsedPaymentMode,
          fy: currentFy,
          staff_details,
          staff_id: staff_id ? parseInt(staff_id) : null,
          mechanic_id: mechanic_id ? parseInt(mechanic_id) : null,
          commission: commission || 0,
          packing_forwarding_qty: packing_forwarding_qty ? parseFloat(packing_forwarding_qty) : null,
          packing_forwarding_rate: packing_forwarding_rate ? parseFloat(packing_forwarding_rate) : null,
          packing_forwarding_total: packing_forwarding_total ? parseFloat(packing_forwarding_total) : null
        }
      })

      // 2. Batch load products
      const productIds = invoiceItems.map(item => parseInt(item.product_id))
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
      for (const item of invoiceItems) {
        const productId = parseInt(item.product_id)
        const product = productMap.get(productId)

        if (!product) {
          throw new Error(`Product with ID ${productId} not found`)
        }

        if (product.stock < item.qty) {
          throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested ${item.qty}`)
        }
      }

      // 4. Create salex items and update stock
      for (const item of invoiceItems) {
        const productId = parseInt(item.product_id)
        const product = productMap.get(productId)!

        await tx.invoice_itemsx.create({
          data: {
            product_id: productId,
            invoice_no: invoice.id,
            name_of_product: item.name_of_product,
            qty: parseFloat(item.qty),
            rate: parseFloat(item.rate),
            subtotal: parseFloat(item.subtotal),
            discount: parseFloat(item.discount) || 0,
            discountrate: parseFloat(item.discountrate) || 0,
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

        await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: Number(item.qty) || 0 } }
        })
      }

      // 5. Create customer relationship
      await tx.bill_tosalesx.create({
        data: {
          invoice_no: invoice.id,
          billing_name: req.body.customer_name,
          contact_no: req.body.contact_number || '',
          email: req.body.email_id || '',
          billing_address: req.body.address || '',
          billing_address2: req.body.address_2 || '',
          billing_city: req.body.city || '',
          billing_state: req.body.state || '',
          billing_state_code: req.body.state_code || null,
          billing_gstin: req.body.gst_number || ''
        }
      })

      // 6. Create shipping details
      await tx.shiptox.create({
        data: {
          invoice_no: invoice.id,
          shipping_name: req.body.customer_name,
          shipping_address: req.body.address || '',
          shipping_address2: req.body.address_2 || '',
          shipping_city: req.body.city || '',
          shipping_state: req.body.state || '',
          shipping_state_code: req.body.state_code || null,
          shipping_gstin: req.body.gst_number || '',
          shipping: true
        }
      })

      // 7. Create transport details
      if (transportDetails) {
        await tx.transport_detailsx.create({
          data: {
            invoice_id: invoice.id,
            trans_mode: transportDetails.trans_mode || null,
            vehicle_no: transportDetails.vehicle_no || null,
            supply_date: transportDetails.supply_date || null
          }
        })
      }

      // 8. Create SALEX ledger entry (debit - customer owes money)
      if (parseInt(select_customer) !== 0) {
        const totalAmount = parseFloat(total);
        await customerLedgerService.createEntry({
          customer_id: parseInt(select_customer),
          transaction_date: invoiceDateTimestamp,
          transaction_type: 'SALE',
          reference_type: 'salex',
          reference_id: invoice.id,
          reference_no: invoice.invoice_no.toString(),
          debit: totalAmount,
          credit: 0,
          payment_mode: null,
          payment_status: parsedPaymentStatus,
          payment_date: null,
          notes: `Salex INV-${invoice.invoice_no}`,
          fy: currentFy,
          transaction_id: null
        }, tx);
      }

      // 9. Handle payment if paid (create payment records like purchase does)
      if (parsedPaymentStatus === 1 && parseInt(select_customer) !== 0) {
        // Fetch customer balance for smart advance allocation
        const customer = await tx.customer_details.findUnique({
          where: { id: parseInt(select_customer) },
          select: {
            total_paid: true,
            total_allocated: true,
            total_refunded: true,
            total_refund_allocated: true
          }
        });

        const totalAmount = parseFloat(total);

        // Calculate advance balance (money customer has already paid)
        const advanceBalance = customer 
          ? (Number(customer.total_paid) - Number(customer.total_allocated)) + 
            (Number(customer.total_refunded) - Number(customer.total_refund_allocated))
          : 0;
        
        const advanceUsed = Math.min(Math.max(0, advanceBalance), totalAmount);
        const newPayment = totalAmount - advanceUsed;

        // Create payment record for advance portion if any
        if (advanceUsed > 0) {
          const advancePayment = await tx.customer_payments.create({
            data: {
              customer_id: parseInt(select_customer),
              payment_date: invoiceDateTimestamp,
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
              invoicex_id: invoice.id,
              allocated_amount: advanceUsed,
              allocation_date: invoiceDateTimestamp,
              notes: 'Allocated from existing advance balance'
            }
          });
        }

        // Create payment record for new payment portion if any
        let newPaymentId: number | undefined;
        if (newPayment > 0) {
          const payment = await tx.customer_payments.create({
            data: {
              customer_id: parseInt(select_customer),
              payment_date: invoiceDateTimestamp,
              payment_amount: newPayment,
              payment_mode: parsedPaymentMode,
              payment_type: 'BILL_SPECIFIC',
              notes: advanceUsed > 0
                ? `New payment for salex ${invoice.invoice_no}: ₹${newPayment.toFixed(2)}`
                : `Payment for salex ${invoice.invoice_no}`,
              fy: currentFy
            }
          });

          newPaymentId = payment.id;

          await tx.customer_payment_allocations.create({
            data: {
              payment_id: payment.id,
              invoicex_id: invoice.id,
              allocated_amount: newPayment,
              allocation_date: invoiceDateTimestamp,
              notes: 'Allocated during salex creation'
            }
          });
        }

        // Create PAYMENT_RECEIVED ledger entry (credit - reduces customer debt)
        if (newPayment > 0 && newPaymentId) {
          await customerLedgerService.createEntry({
            customer_id: parseInt(select_customer),
            transaction_date: invoiceDateTimestamp,
            transaction_type: 'PAYMENT_RECEIVED',
            reference_type: 'salex',
            reference_id: invoice.id,
            reference_no: invoice.invoice_no.toString(),
            debit: 0,
            credit: newPayment,
            payment_mode: parsedPaymentMode,
            payment_status: 1,
            payment_date: invoiceDateTimestamp,
            notes: `Payment ₹${newPayment} for salex INV-${invoice.invoice_no} via Payment #${newPaymentId}`,
            fy: currentFy,
            transaction_id: newPaymentId
          }, tx);
        }

        // Update customer balance using handler (with logging)
        await customerBalanceHandler.incrementBalanceInTransaction(
          tx,
          parseInt(select_customer),
          {
            total_paid: newPayment,
            total_allocated: totalAmount
          },
          {
            type: 'salex_create',
            id: invoice.id,
            reference_no: invoice.invoice_no.toString(),
            notes: `Salex ${invoice.invoice_no} created`
          }
        );
      }

      return invoice
    }, {
      timeout: 30000
    })

    res.status(201).json({
      message: 'Salex invoice created successfully',
      salex: {
        id: invoice.id,
        invoice_no: invoice.invoice_no,
        total: invoice.total,
        customer_name: req.body.customer_name
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

/**
 * GET /api/salex
 * List salex with filters and pagination
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
      customer = '',
      amountMin = '',
      amountMax = '',
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
      where.id = parseInt(uid as string)
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

    if (customer && customer !== '') {
      where.select_customer = parseInt(customer as string)
    }

    if (amountMin && amountMin !== '') {
      where.total = { ...where.total, gte: parseFloat(amountMin as string) }
    }

    if (amountMax && amountMax !== '') {
      where.total = { ...where.total, lte: parseFloat(amountMax as string) }
    }

    const itemsFilter = items && items !== '' ? parseInt(items as string) : null

    const validSortFields = [
      'id', 'invoice_no', 'customer_name', 'total', 'invoice_date',
      'payment_status', 'fy', 'bill_reference', 'item_count',
      'total_tax', 'packing_forwarding_total', 'payment_mode', 'notes'
    ]
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'invoice_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    const needsPostSorting = sortField === 'customer_name' || sortField === 'item_count'

    let salexInvoices: any[]
    let total: number

    if (needsPostSorting) {
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
            return_status: true,
            packing_forwarding_total: true
          }
        }),
        prisma.invoicex.count({ where })
      ])
      salexInvoices = result[0]
      total = result[1]
    } else {
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
            return_status: true,
            packing_forwarding_total: true
          }
        }),
        prisma.invoicex.count({ where })
      ])
      salexInvoices = result[0]
      total = result[1]
    }

    const invoiceIds = salexInvoices.map((inv: { id: any }) => inv.id)
    const otherCustomerInvoices = salexInvoices.filter((inv: any) => inv.select_customer === 0).map((inv: any) => inv.id)

    const [customerData, itemCounts, billToData] = await Promise.all([
      prisma.invoicex.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, select_customer: true }
      }),

      prisma.invoice_itemsx.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      }),

      otherCustomerInvoices.length > 0 ? prisma.bill_tosalesx.findMany({
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

    let enhancedSalex = salexInvoices.map((invoice: any) => {
      let formattedDate = 'Invalid Date'
      try {
        if (invoice.invoice_date) {
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
        customer_name: customerMap.get(invoice.id) || billToMap.get(invoice.id)?.billing_name || 'Other',
        total_tax: invoice.total_tax || 0,
        notes: invoice.notes || '',
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
        packing_forwarding_total: invoice.packing_forwarding_total || 0,
        total_paid: 0,
        outstanding_amount: Number(invoice.total),
      }
    })

    if (itemsFilter !== null && !isNaN(itemsFilter)) {
      enhancedSalex = enhancedSalex.filter(salex => (salex.item_count || 0) >= itemsFilter!)
    }

    if (needsPostSorting) {
      enhancedSalex.sort((a, b) => {
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

export default withObservability(handler)
