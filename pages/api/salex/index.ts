import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

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
        where.status = parseInt(status)
      } else if (status === 'unknown') {
        // For unknown status, show statuses that are not 0, 1, or 2 (2 is cancelled for salex)
        where.status = { notIn: [0, 1, 2] }
      }
    }

    if (amountMin && amountMin !== '') {
      where.total = { gte: parseFloat(amountMin as string) }
    }

    if (amountMax && amountMax !== '') {
      where.total = where.total ? { ...where.total, lte: parseFloat(amountMax as string) } : { lte: parseFloat(amountMax as string) }
    }

    // Get salex invoices with related data
    const [salexInvoices, total] = await Promise.all([
      prisma.invoicex.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { invoice_date: 'desc' }, // Order by date descending (newest first)
      }),
      prisma.invoicex.count({ where })
    ])

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
    const customerMap = new Map(customerData.map((c: any) => [c.invoice_no, c.customer?.billing_name || 'N/A']))
    const gstinMap = new Map(customerData.map((c: any) => [c.invoice_no, c.customer?.billing_gstin || '']))
    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))

    // Enhanced salex invoices using maps
    const enhancedSalex = salexInvoices.map((invoice: any) => {
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
        select_customer: invoice.select_customer,
        customer_name: customerMap.get(invoice.id) || 'N/A',
        customer_gstin: gstinMap.get(invoice.id) || '',
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
        bill_reference: invoice.bill_reference || '',
        invoice_date: invoice.invoice_date,
        status: invoice.status || 0,
        payment_mode: invoice.payment_mode || 0,
        fy: invoice.fy,
        mode: invoice.mode || 0,
        type: invoice.type || 'salex',
        item_count: itemCountMap.get(invoice.id) || 0,
        formattedDate,
        formattedTotal: invoice.total.toLocaleString('en-IN', {
          style: 'currency',
          currency: 'INR'
        })
      }
    })

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
    const {
      invoice_no,
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
    if (!invoice_no || !invoice_date || !select_customer || !invoiceItems || invoiceItems.length === 0) {
      return res.status(400).json({ message: 'Missing required fields' })
    }

    // Convert date to timestamp
    const invoiceDateTimestamp = Math.floor(new Date(invoice_date).getTime() / 1000)
    const fy = new Date().getFullYear()

    // Process operations sequentially to avoid transaction timeout
    // 1. Create main invoice record in invoicex table
    const finalNotes = notes || '';
    const finalDescriptions = descriptions || '';

    const invoice = await prisma.invoicex.create({
      data: {
      invoice_no: parseInt(invoice_no),
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
      fy: fy,
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

      // 2. Create invoice items in invoice_itemsx table
      if (invoiceItems && invoiceItems.length > 0) {
        await prisma.invoice_itemsx.createMany({
          data: invoiceItems.map((item: any) => ({
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
            fy: fy,
            invoice_date: invoiceDateTimestamp
          }))
        })
      }

      // 3. Create customer reference in bill_tosalesx table
      if (customer_id) {
        await prisma.bill_tosalesx.create({
          data: {
            invoice_no: invoice.id,
            customer_id: parseInt(customer_id)
          }
        })
      }

      // 4. Create shipping reference in shiptox table
      if (customer_id) {
        await prisma.shiptox.create({
          data: {
            invoice_no: invoice.id,
            customer_id: parseInt(customer_id),
            shipping: useShippingAddress
          }
        })
      }

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
      invoice: invoice
    })
  } catch (error) {
    console.error('Salex creation error:', error)
    res.status(500).json({
      message: 'Failed to create salex invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    return handleGet(req, res)
  } else if (req.method === 'POST') {
    return handlePost(req, res)
  } else {
    return res.status(405).json({ message: 'Method not allowed' })
  }
}
