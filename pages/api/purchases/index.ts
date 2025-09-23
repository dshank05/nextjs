import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

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

    // Get vendor names and item counts in batch queries
    const invoiceIds = purchaseInvoices.map((inv: { id: any }) => inv.id)

    const [vendorData, itemCounts] = await Promise.all([
      // Get all vendor names in one query
      prisma.vendor_details.findMany({
        where: { id: { in: purchaseInvoices.map(inv => inv.id).filter(id => id) } },
        select: { id: true, vendor_name: true, tax_id: true }
      }),

      // Get all item counts in one query
      prisma.purchaseitems.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      })
    ])

    // Create lookup maps for fast access
    const vendorMap = new Map(vendorData.map((v: { id: any; vendor_name: any; tax_id: any }) => [v.id, v.vendor_name]))
    const taxIdMap = new Map(vendorData.map((v: { id: any; tax_id: any }) => [v.id, v.tax_id]))
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
        select_vendor: invoice.id, // Using invoice id as vendor reference
        vendor_name: vendorMap.get(invoice.id) || 'N/A',
        vendor_gstin: taxIdMap.get(invoice.id) || '',
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
