import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { convertDateToTimestamp } from '../../../lib/date-utils'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const {
      startDate = '',
      endDate = '',
      fy = '',
      reportType = 'summary' // summary, detailed, customer, product
    } = req.query

    const startDateStr = Array.isArray(startDate) ? startDate[0] : startDate
    const endDateStr = Array.isArray(endDate) ? endDate[0] : endDate
    const fyStr = Array.isArray(fy) ? fy[0] : fy
    const reportTypeStr = Array.isArray(reportType) ? reportType[0] : reportType

    // Build date filters
    const dateFilter: any = {}
    if (startDateStr && startDateStr.trim()) {
      dateFilter.invoice_date = { ...dateFilter.invoice_date, gte: convertDateToTimestamp(startDateStr) }
    }
    if (endDateStr && endDateStr.trim()) {
      dateFilter.invoice_date = { ...dateFilter.invoice_date, lte: convertDateToTimestamp(endDateStr) }
    }

    // Financial year filter
    if (fyStr && fyStr.trim()) {
      dateFilter.fy = parseInt(fyStr)
    }

    let reportData

    switch (reportTypeStr) {
      case 'summary':
        reportData = await generateSummaryReport(dateFilter)
        break
      case 'customer':
        reportData = await generateCustomerReport(dateFilter)
        break
      case 'product':
        reportData = await generateProductReport(dateFilter)
        break
      case 'detailed':
      default:
        reportData = await generateDetailedReport(dateFilter)
        break
    }

    res.status(200).json({
      reportType: reportTypeStr,
      dateRange: { startDate: startDateStr, endDate: endDateStr, fy: fyStr },
      data: reportData
    })
  } catch (error) {
    console.error('Sales report error:', error)
    res.status(500).json({
      message: 'Failed to generate sales report',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function generateSummaryReport(dateFilter: any) {
  // Get totals for regular invoices
  const regularStats = await prisma.invoice.aggregate({
    where: dateFilter,
    _count: { id: true },
    _sum: {
      total: true,
      total_tax: true,
      total_cgst: true,
      total_sgst: true,
      total_igst: true
    }
  })

  // Get totals for tax-exempt invoices
  const exemptStats = await prisma.invoicex.aggregate({
    where: dateFilter,
    _count: { id: true },
    _sum: {
      total: true
    }
  })

  // Get transaction summary
  const [incomeStats, expenseStats] = await Promise.all([
    prisma.incexp.aggregate({
      where: { type: 1, fy: dateFilter.fy },
      _sum: { amt: true }
    }),
    prisma.incexp.aggregate({
      where: { type: 2, fy: dateFilter.fy },
      _sum: { amt: true }
    })
  ])

  return {
    totalInvoices: regularStats._count.id + exemptStats._count.id,
    regularInvoices: {
      count: regularStats._count.id,
      total: regularStats._sum.total || 0,
      taxCollected: regularStats._sum.total_tax || 0,
      gstBreakdown: {
        cgst: regularStats._sum.total_cgst || 0,
        sgst: regularStats._sum.total_sgst || 0,
        igst: regularStats._sum.total_igst || 0
      }
    },
    taxExemptInvoices: {
      count: exemptStats._count.id,
      total: exemptStats._sum.total || 0
    },
    transactions: {
      totalIncome: incomeStats._sum.amt || 0,
      totalExpenses: expenseStats._sum.amt || 0,
      netAmount: (incomeStats._sum.amt || 0) - (expenseStats._sum.amt || 0)
    }
  }
}

async function generateCustomerReport(dateFilter: any) {
  // Get customer sales by aggregating from billing tables
  const customers = await prisma.$queryRaw`
    SELECT
      user_name as customer_name,
      gstin,
      COUNT(DISTINCT invoice_no) as invoice_count,
      SUM(total) as total_amount,
      SUM(total_tax) as total_tax,
      'regular' as invoice_type
    FROM bill_tosales b
    INNER JOIN invoice i ON i.id = b.invoice_no
    WHERE i.invoice_date >= ${dateFilter.invoice_date?.gte || 0}
      AND i.invoice_date <= ${dateFilter.invoice_date?.lte || Date.now()}
      ${dateFilter.fy ? `AND i.fy = ${dateFilter.fy}` : ''}
    GROUP BY b.user_name, b.gstin

    UNION ALL

    SELECT
      user_name as customer_name,
      gstin,
      COUNT(DISTINCT invoice_no) as invoice_count,
      SUM(total) as total_amount,
      0 as total_tax,
      'tax_exempt' as invoice_type
    FROM bill_tosalesx b
    INNER JOIN invoicex i ON i.id = b.invoice_no
    WHERE i.invoice_date >= ${dateFilter.invoice_date?.gte || 0}
      AND i.invoice_date <= ${dateFilter.invoice_date?.lte || Date.now()}
      ${dateFilter.fy ? `AND i.fy = ${dateFilter.fy}` : ''}
    GROUP BY b.user_name, b.gstin
  ` as any[]

  return {
    customers: customers.sort((a, b) => parseFloat(b.total_amount || '0') - parseFloat(a.total_amount || '0'))
  }
}

async function generateProductReport(dateFilter: any) {
  // Use raw queries for product reports to avoid complex relations
  const products = await prisma.$queryRaw`
    SELECT
      p.product_name,
      p.hsn,
      p.id as product_id,
      SUM(ii.qty) as qty_sold,
      SUM(ii.subtotal) as total_amount,
      COUNT(DISTINCT ii.invoice_no) as invoice_count,
      'regular' as type
    FROM product p
    LEFT JOIN invoice_items ii ON ii.name_of_product = p.id::varchar
    LEFT JOIN invoice i ON ii.invoice_no = i.id
    WHERE i.invoice_date >= ${dateFilter.invoice_date?.gte || 0}
      AND i.invoice_date <= ${dateFilter.invoice_date?.lte || Date.now()}
      ${dateFilter.fy ? `AND i.fy = ${dateFilter.fy}` : ''}
    GROUP BY p.id, p.product_name, p.hsn

    UNION ALL

    SELECT
      p.product_name,
      p.hsn,
      p.id as product_id,
      SUM(ii.qty) as qty_sold,
      SUM(ii.subtotal) as total_amount,
      COUNT(DISTINCT ii.invoice_no) as invoice_count,
      'tax_exempt' as type
    FROM product p
    LEFT JOIN invoice_itemsx ii ON ii.name_of_product = p.id::varchar
    LEFT JOIN invoicex i ON ii.invoice_no = i.id
    WHERE i.invoice_date >= ${dateFilter.invoice_date?.gte || 0}
      AND i.invoice_date <= ${dateFilter.invoice_date?.lte || Date.now()}
      ${dateFilter.fy ? `AND i.fy = ${dateFilter.fy}` : ''}
    GROUP BY p.id, p.product_name, p.hsn
  ` as any[]

  return {
    products: products.sort((a, b) => parseFloat(b.total_amount || '0') - parseFloat(a.total_amount || '0'))
  }
}

async function generateDetailedReport(dateFilter: any) {
  // Get detailed invoice lists
  const [regularInvoices, exemptInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: dateFilter,
      orderBy: { invoice_date: 'desc' }
    }),
    prisma.invoicex.findMany({
      where: dateFilter,
      orderBy: { invoice_date: 'desc' }
    })
  ])

  // Get unique customer IDs from invoices
  const regularCustomerIds = Array.from(new Set(regularInvoices.map(inv => inv.select_customer).filter(Boolean)))
  const exemptCustomerIds = Array.from(new Set(exemptInvoices.map(inv => inv.select_customer).filter(Boolean)))
  const allCustomerIds = Array.from(new Set([...regularCustomerIds, ...exemptCustomerIds]))

  // Fetch customer details in one query
  const customers = await prisma.customer_details.findMany({
    where: { id: { in: allCustomerIds } },
    select: {
      id: true,
      billing_name: true,
      billing_gstin: true
    }
  })

  // Create customer lookup map
  const customerMap = new Map(customers.map(c => [c.id, c]))

  return {
    regularInvoices: regularInvoices.map(inv => {
      const customer = inv.select_customer ? customerMap.get(inv.select_customer) : null
      return {
        ...inv,
        customer_name: customer?.billing_name || '',
        customer_gstin: customer?.billing_gstin || '',
        type: 'regular'
      }
    }),
    taxExemptInvoices: exemptInvoices.map(inv => {
      const customer = inv.select_customer ? customerMap.get(inv.select_customer) : null
      return {
        ...inv,
        customer_name: customer?.billing_name || '',
        customer_gstin: customer?.billing_gstin || '',
        type: 'tax_exempt'
      }
    })
  }
}


export default withObservability(handler)
