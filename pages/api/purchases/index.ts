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
      fy = ''
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
      // For purchases, dates are stored as strings, so we filter as strings
      where.invoice_date = {
        gte: startDate as string,
        lte: endDate as string
      }
    }

    // Get purchase invoices with related data
    const [purchaseInvoices, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { id: 'desc' },
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
      // Handle string date format for purchases
      let formattedDate = 'Invalid Date'
      try {
        if (invoice.invoice_date) {
          // Purchase dates are stored as strings like "2025-01-15"
          const dateObj = new Date(invoice.invoice_date)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        }
      } catch (error) {
        console.warn('Invalid date format for purchase:', invoice.invoice_date)
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
        invoice_date: invoice.invoice_date,
        status: invoice.status || 0,
        payment_mode: invoice.payment_mode || 0,
        fy: invoice.fy,
        transport: invoice.transport || '',
        type: 'purchase',
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
