import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { parseDateRange } from '../../../lib/date-utils'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      page = '1',
      limit = '50',
      search = '',
      customer = '',
      status = '',
      dateFrom = '',
      dateTo = '',
      amountMin = '',
      amountMax = '',
      fy = '',
      sortBy = 'return_date',
      sortOrder = 'desc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Search filter - search across return_no, customer_name, notes
    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      const searchNum = parseInt(searchStr);
      where.OR = [
        !isNaN(searchNum) ? { id: searchNum } : undefined,
        { notes: { contains: searchStr } },
      ].filter(Boolean) // Remove undefined values
    }

    // Financial year filter
    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    // Status filter
    if (status && status !== '') {
      where.status = status as string
    }

    // Amount range filters
    if (amountMin && amountMin !== '') {
      where.total_amount = { gte: parseFloat(amountMin as string) }
    }
    if (amountMax && amountMax !== '') {
      where.total_amount = where.total_amount
        ? { ...where.total_amount, lte: parseFloat(amountMax as string) }
        : { lte: parseFloat(amountMax as string) }
    }

    // Date range filters
    if (dateFrom && dateTo) {
      try {
        const { startTimestamp, endTimestamp } = parseDateRange(
          dateFrom as string,
          dateTo as string
        );

        where.return_date = {
          gte: startTimestamp,
          lte: endTimestamp
        };
      } catch (error) {
        console.warn('Error parsing filter dates:', error);
      }
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'return_date', 'total_amount', 'total_tax', 'status', 'fy', 'customer_name']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'return_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // Sale and Invoice C returns are two tables; paging each separately
    // returned up to twice the page size, counted only the page, skipped rows
    // of the other table, and filtered by customer after paging. Both are read
    // whole, merged, filtered, sorted and then paged.
    const [saleReturns, salexReturns] = await Promise.all([
      prisma.sale_returns.findMany({
        where,
        select: { id: true, invoice_id: true, total_tax: true, return_date: true, total_amount: true, status: true, notes: true, fy: true,
        payment_status: true, payment_mode: true, payment_date: true, refund_amount: true,
        created_at: true, updated_at: true }
      }),
      prisma.salex_returns.findMany({
        where,
        select: { id: true, invoicex_id: true, return_date: true, total_amount: true, status: true, notes: true, fy: true,
        payment_status: true, payment_mode: true, payment_date: true, refund_amount: true,
        created_at: true, updated_at: true }
      })
    ])

    // Mark returns with their type
    const returns = [
      ...saleReturns.map(r => ({ ...r, invoice_type: 'invoice' as const, total_tax: r.total_tax || 0 })),
      ...salexReturns.map(r => ({ ...r, invoice_type: 'invoicex' as const, invoice_id: r.invoicex_id, total_tax: 0 }))
    ]

    // Get customer info and item counts
    const invoiceIds = Array.from(new Set(saleReturns.map(r => r.invoice_id).filter(Boolean)))
    const invoicexIds = Array.from(new Set(salexReturns.map(r => r.invoicex_id).filter(Boolean)))
    const saleReturnIds = saleReturns.map(r => r.id)
    const salexReturnIds = salexReturns.map(r => r.id)

    // Get invoice and customer details
    const [invoiceData, invoicexData, saleItemCounts, salexItemCounts] = await Promise.all([
      // Get invoice details
      invoiceIds.length > 0 ? prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
          id: true,
          invoice_no: true,
          select_customer: true
        }
      }) : Promise.resolve([]),

      // Get invoicex details
      invoicexIds.length > 0 ? prisma.invoicex.findMany({
        where: { id: { in: invoicexIds } },
        select: {
          id: true,
          invoice_no: true,
          select_customer: true
        }
      }) : Promise.resolve([]),

      // Get item counts for sale returns
      saleReturnIds.length > 0 ? prisma.sale_return_items.groupBy({
        by: ['sale_return_id'],
        where: { sale_return_id: { in: saleReturnIds } },
        _count: { id: true }
      }) : Promise.resolve([]),

      // Get item counts for salex returns
      salexReturnIds.length > 0 ? prisma.salex_return_items.groupBy({
        by: ['salex_return_id'],
        where: { salex_return_id: { in: salexReturnIds } },
        _count: { id: true }
      }) : Promise.resolve([])
    ])

    // Get customer IDs from both invoice types
    const customerIds = Array.from(new Set([
      ...invoiceData.map(inv => inv.select_customer),
      ...invoicexData.map(inv => inv.select_customer)
    ].filter(Boolean)))

    // Get customer details
    const customerData = customerIds.length > 0 ? await prisma.customer_details.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        billing_name: true,
        billing_gstin: true
      }
    }) : []

    // Create lookup maps
    const invoiceMap = new Map(invoiceData.map(inv => [inv.id, inv]))
    const invoicexMap = new Map(invoicexData.map(inv => [inv.id, inv]))
    const customerMap = new Map(customerData.map(cust => [cust.id, cust]))
    const saleItemCountMap = new Map(saleItemCounts.map(ic => [ic.sale_return_id, ic._count.id]))
    const salexItemCountMap = new Map(salexItemCounts.map(ic => [ic.salex_return_id, ic._count.id]))

    // Enhanced returns with customer info
    let enhancedReturns = returns.map((returnRecord) => {
      const isInvoicex = returnRecord.invoice_type === 'invoicex'
      const invoice = isInvoicex ? invoicexMap.get(returnRecord.invoice_id) : invoiceMap.get(returnRecord.invoice_id)

      // Format date
      let formattedDate: string | null = null
      try {
        if (returnRecord.return_date) {
          const dateObj = new Date(returnRecord.return_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        }
      } catch (error) {
        console.warn('Invalid date format for return:', returnRecord.return_date, error)
      }

      const returnPrefix = isInvoicex ? 'SXR' : 'SR'
      const itemCount = isInvoicex ? salexItemCountMap.get(returnRecord.id) || 0 : saleItemCountMap.get(returnRecord.id) || 0

      return {
        id: returnRecord.id,
        invoice_id: returnRecord.invoice_id,
        invoice_type: returnRecord.invoice_type,
        return_no: `${returnPrefix}-${String(returnRecord.id).padStart(3, '0')}`,
        customer_name: invoice ? customerMap.get(invoice.select_customer)?.billing_name || 'Unknown Customer' : 'Unknown Customer',
        customer_gstin: invoice ? customerMap.get(invoice.select_customer)?.billing_gstin || '' : '',
        invoice_no: invoice?.invoice_no?.toString() || 'N/A',
        total_amount: returnRecord.total_amount || 0,
        total_tax: returnRecord.total_tax || 0,
        refund_amount: returnRecord.refund_amount || (returnRecord.total_amount + returnRecord.total_tax),
        status: returnRecord.status || 'Completed',
        payment_status: returnRecord.payment_status ?? 0,
        payment_mode: returnRecord.payment_mode ?? 1,
        payment_date: returnRecord.payment_date,
        return_date: returnRecord.return_date,
        formattedDate: formattedDate,
        item_count: itemCount,
        notes: returnRecord.notes || '',
        fy: returnRecord.fy,
        created_at: returnRecord.created_at,
        updated_at: returnRecord.updated_at
      }
    })

    // Apply customer filter (after data enhancement)
    if (customer && customer !== '') {
      const customerStr = Array.isArray(customer) ? customer[0] : customer;
      const customerNum = parseInt(customerStr);

      // If it's a number, filter by customer_id, otherwise by customer_name
      if (!isNaN(customerNum)) {
        // Filter by customer ID through invoice (check both types)
        enhancedReturns = enhancedReturns.filter(ret => {
          const invoice = ret.invoice_type === 'invoicex'
            ? invoicexData.find(inv => inv.id === ret.invoice_id)
            : invoiceData.find(inv => inv.id === ret.invoice_id);
          return invoice && invoice.select_customer === customerNum;
        });
      } else {
        // Filter by customer name
        enhancedReturns = enhancedReturns.filter(ret =>
          ret.customer_name.toLowerCase().includes(customerStr.toLowerCase())
        );
      }
    }

    const key = (r: any) => {
      const v = r[sortField]
      return typeof v === 'string' ? v.toLowerCase() : (v ?? 0)
    }
    enhancedReturns.sort((a, b) => {
      const aValue = key(a)
      const bValue = key(b)
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      // Same value: newest first, sale before Invoice C, for a stable order
      return (b.id - a.id) || (a.invoice_type < b.invoice_type ? -1 : 1)
    })
    const total = enhancedReturns.length
    enhancedReturns = enhancedReturns.slice(skip, skip + limitNum)

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      returns: enhancedReturns,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Sale returns fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch sale returns data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
