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
