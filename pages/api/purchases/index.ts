import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

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

    // Get purchase invoices with related data
    const [purchaseInvoices, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
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
        vendor_name: 'Loading...', // Vendor name will be fetched via individual API call
        vendor_gstin: '', // GSTIN will be fetched via individual API call
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
      invoice_number,
      bill_reference,
      staff_details,
      date,
      vendor_id, // Now receiving vendor ID
      vendor_name,
      contact_number,
      email_id,
      address,
      city,
      state,
      gst_number,
      transport_name,
      vehicle_number,
      transport_cost,
      bill,
      tax,
      items,
      descriptions,
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,
      tax_rate,
      basic_value,
      total_cgst,
      total_sgst,
      total_igst,
      notes,
      total_tax,
      payment_status,
      payment_mode,
      grand_total
    } = req.body

    // Validate required fields
    if (!invoice_number || !vendor_name || !items || items.length === 0) {
      return res.status(400).json({
        message: 'Missing required fields: invoice_number, vendor_name, or items'
      })
    }

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert date to Unix timestamp
    const invoiceDate = new Date(date).getTime() / 1000

    // Calculate totals
    const itemsTotal = items.reduce((sum: number, item: any) => sum + (item.qty * item.rate), 0)
    const calculatedGrandTotal = itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0)

    // Create or update vendor
    let vendorId: number
    const existingVendor = await prisma.vendor_details.findFirst({
      where: { vendor_name: vendor_name }
    })

    if (existingVendor) {
      vendorId = existingVendor.id
      // Update vendor details if provided
      await prisma.vendor_details.update({
        where: { id: vendorId },
        data: {
          contact_no: contact_number || existingVendor.contact_no,
          email: email_id || existingVendor.email,
          address: address || existingVendor.address,
          tax_id: gst_number || existingVendor.tax_id
        }
      })
    } else {
      const newVendor = await prisma.vendor_details.create({
        data: {
          vendor_name: vendor_name,
          contact_no: contact_number,
          email: email_id,
          address: address,
          tax_id: gst_number
        }
      })
      vendorId = newVendor.id
    }

    // Create purchase record
    const purchase = await prisma.purchase.create({
      data: {
        invoice_no: parseInt(invoice_number),
        bill_reference: bill_reference, // Keep bill reference separate from vendor name
        staff_details: staff_details,
        vendor_id: vendorId, // ✅ Save vendor ID as FK
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
        status: payment_status === 'paid' ? 1 : 0,
        payment_mode: getPaymentModeId(payment_mode),
        fy: financialYear,
        transport: transport_name || '',
        transport_name: transport_name,
        vehicle_number: vehicle_number
      }
    })

    // Create purchase items
    for (const item of items) {
      await prisma.purchaseitems.create({
        data: {
          invoice_no: purchase.invoice_no,
          name_of_product: item.product_name,
          category_id: item.category_id,
          subcategory_id: item.subcategory_id,
          model_id: item.model_id,
          company_id: item.company_id,
          car_model: item.car_model,
          vendor_id: vendorId, // ✅ Save vendor ID in purchase items as well
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
    }

    res.status(201).json({
      message: 'Purchase created successfully',
      purchase: {
        id: purchase.id,
        invoice_no: purchase.invoice_no,
        total: purchase.total,
        vendor_name: vendor_name
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
o
function getPaymentModeId(paymentMode: string): number {
  const paymentModes: { [key: string]: number } = {
    'cash': 1,
    'card': 2,
    'bank_transfer': 3,
    'cheque': 4
  }
  return paymentModes[paymentMode] || 1
}
