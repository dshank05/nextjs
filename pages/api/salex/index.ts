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
      // Get all customer names in one query
      prisma.bill_tosalesx.findMany({
        where: { invoice_no: { in: invoiceIds } },
        select: { invoice_no: true, user_name: true, gstin: true }
      }),

      // Get all item counts in one query
      prisma.invoice_itemsx.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      })
    ])

    // Create lookup maps for fast access
    const customerMap = new Map(customerData.map((c: { invoice_no: any; user_name: any; gstin: any }) => [c.invoice_no, c.user_name]))
    const gstinMap = new Map(customerData.map((c: { invoice_no: any; gstin: any }) => [c.invoice_no, c.gstin]))
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
      billingDetails,
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
      staff_details,     // ✅ TO BE SAVED - InvoiceX.staff_details (exists)
      staff_id,          // ✅ TO BE SAVED - InvoiceX.staff_id (FK field)
      mechanic_id,       // ✅ TO BE SAVED - InvoiceX.mechanic_id (FK field)
      commission,        // ✅ TO BE SAVED - InvoiceX.commission (exists)
      bill_reference,    // ❌ NOT SAVED - Schema missing: InvoiceX.bill_reference

      // ===== UNUSED FIELDS (removed from UI, kept for API backward compatibility) =====
      tax_rate,         // ❌ UNUSED - Removed from salex create UI, kept for backward compatibility
      basic_value       // ❌ UNUSED - Removed from salex create UI, kept for backward compatibility
    } = req.body

    // Validate required fields
    if (!invoice_no || !invoice_date || !select_customer || !invoiceItems || invoiceItems.length === 0) {
      return res.status(400).json({ message: 'Missing required fields' })
    }

    // Convert date to timestamp
    const invoiceDateTimestamp = Math.floor(new Date(invoice_date).getTime() / 1000)
    const fy = new Date().getFullYear()

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create main invoice record in invoicex table
      const combinedNotes = descriptions ? `${notes || ''}\n\nDescriptions: ${descriptions}`.trim() : (notes || '');
      const invoice = await tx.invoicex.create({
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
          notes: combinedNotes,                       // Combine notes and descriptions
          // Note: invoicex table doesn't have bill_reference field in current schema
          invoice_date: invoiceDateTimestamp,
          updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '), // Format: YYYY-MM-DD HH:MM:SS
          status: parseInt(payment_status),
          payment_mode: parseInt(payment_mode),
          fy: fy,
          staff_details,                             // Optional string field for backward compatibility
          staff_id: staff_id ? parseInt(staff_id) : null, // Optional FK to staff table
          mechanic_id: mechanic_id ? parseInt(mechanic_id) : null, // Optional FK to mechanic table
          commission: commission || 0                // Optional commission amount
        }
      })

      // ===== PHASE 1: TRANSACTION RECORDING =====
      // Record income transaction in incexpx table
      await tx.incexpx.create({
        data: {
          invoice_id: invoice.id,
          user_id: 1, // TODO: Get from authentication context
          amt: invoice.total,
          payment_mode: invoice.payment_mode,
          type: 1, // 1 = Income (for salex/invoice exempt)
          incexp_date: new Date().toISOString().split('T')[0],
          fy: invoice.fy,
          notes: `InvoiceX #${invoice.invoice_no} - Tax-exempt Sale Transaction`
        }
      })

      // 2. Create invoice items in invoice_itemsx table
      if (invoiceItems && invoiceItems.length > 0) {
        await tx.invoice_itemsx.createMany({
          data: invoiceItems.map((item: any) => ({
            invoice_no: invoice.id, // Use the created invoice ID
            name_of_product: item.name_of_product,
            qty: parseFloat(item.qty),
            rate: parseFloat(item.rate),
            subtotal: parseFloat(item.subtotal),
            hsn: item.hsn || '',
            part: item.part || '',
            category_id: item.category_id || null,
            model_id: item.model_id || null,
            company_id: item.company_id || null,
            fy: fy,
            invoice_date: invoiceDateTimestamp
          }))
        })
      }

      // 3. Create billing details in bill_tosalesx table
      if (billingDetails) {
        await tx.bill_tosalesx.create({
          data: {
            invoice_no: invoice.id,
            user_name: billingDetails.user_name,
            address: billingDetails.address,
            address2: billingDetails.address2 || null,
            mobile: billingDetails.mobile || null,
            email: billingDetails.email || null,
            state: billingDetails.state || null,
            state_code: billingDetails.state_code || null,
            gstin: billingDetails.gstin || null
          }
        })
      }

      // 4. Create shipping details in ship_tox table
      if (shippingDetails) {
        await tx.ship_tox.create({
          data: {
            invoice_no: invoice.id,
            user_name: shippingDetails.user_name,
            address: shippingDetails.address,
            state: shippingDetails.state || null,
            state_code: shippingDetails.state_code || null,
            gstin: shippingDetails.gstin || null
          }
        })
      }

      // 5. Create transport details in transport_detailsx table
      if (transportDetails) {
        await tx.transport_detailsx.create({
          data: {
            invoice_id: invoice.id,
            trans_mode: transportDetails.trans_mode || null,
            vehicle_no: transportDetails.vehicle_no || null,
            supply_date: transportDetails.supply_date || null,
            place_of_supply: transportDetails.place_of_supply || null
          }
        })
      }

      return invoice
    })

    res.status(201).json({
      message: 'Salex invoice created successfully',
      invoice: result
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
