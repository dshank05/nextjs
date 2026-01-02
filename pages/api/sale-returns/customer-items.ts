import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const {
      customer_id,
      page = '1',
      limit = '50',
      search = '',
      from_date = '',
      to_date = ''
    } = req.query

    if (!customer_id) {
      return res.status(400).json({ message: 'Customer ID is required' })
    }

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum
    const customerId = parseInt(customer_id as string)

    // Build date filter
    let dateFilter: any = {}
    if (from_date && to_date) {
      try {
        const startDateObj = new Date(from_date as string)
        const endDateObj = new Date(to_date as string)

        if (!isNaN(startDateObj.getTime()) && !isNaN(endDateObj.getTime())) {
          const startTimestamp = Math.floor(startDateObj.getTime() / 1000)
          const endTimestamp = Math.floor(endDateObj.getTime() / 1000)

          dateFilter = {
            invoice_date: {
              gte: startTimestamp,
              lte: endTimestamp
            }
          }
        }
      } catch (error) {
        console.warn('Error parsing filter dates:', error)
      }
    }

    // Fetch Invoice (regular sales) data
    const invoices = await prisma.invoice.findMany({
      where: {
        select_customer: customerId,
        ...dateFilter,
        ...(search && {
          OR: [
            { invoice_no: { contains: search as string } }
          ]
        })
      },
      select: {
        id: true,
        invoice_no: true,
        invoice_date: true,
        total: true,
        payment_status: true
      },
      orderBy: { invoice_date: 'desc' }
    })

    // Fetch Invoicex (salex) data
    const invoicexs = await prisma.invoicex.findMany({
      where: {
        select_customer: customerId,
        ...dateFilter,
        ...(search && {
          OR: [
            { invoice_no: { contains: search as string } }
          ]
        })
      },
      select: {
        id: true,
        invoice_no: true,
        invoice_date: true,
        total: true,
        payment_status: true
      },
      orderBy: { invoice_date: 'desc' }
    })

    // Get invoice IDs
    const invoiceIds = invoices.map(inv => inv.id)
    const invoicexIds = invoicexs.map(inv => inv.id)

    // Fetch items for Invoice
    const invoiceItems = invoiceIds.length > 0 ? await prisma.invoiceitems.findMany({
      where: {
        invoice_no: { in: invoices.map(inv => inv.invoice_no) }
      },
      select: {
        id: true,
        invoice_no: true,
        name_of_product: true,
        part: true,
        qty: true,
        rate: true
      }
    }) : []

    // Fetch items for Invoicex
    const invoicexItems = invoicexIds.length > 0 ? await prisma.invoice_itemsx.findMany({
      where: {
        invoice_no: { in: invoicexs.map(inv => inv.invoice_no) }
      },
      select: {
        id: true,
        invoice_no: true,
        name_of_product: true,
        part: true,
        qty: true,
        rate: true
      }
    }) : []

    // Get returned quantities for Invoice items
    const invoiceItemIds = invoiceItems.map(item => item.id)
    const returnedInvoiceItems = invoiceItemIds.length > 0 ? await prisma.sale_return_items.groupBy({
      by: ['invoice_item_id'],
      where: { invoice_item_id: { in: invoiceItemIds } },
      _sum: { return_qty: true }
    }) : []

    // Get returned quantities for Invoicex items
    const invoicexItemIds = invoicexItems.map(item => item.id)
    const returnedInvoicexItems = invoicexItemIds.length > 0 ? await prisma.salex_return_items.groupBy({
      by: ['invoice_itemx_id'],
      where: { invoice_itemx_id: { in: invoicexItemIds } },
      _sum: { return_qty: true }
    }) : []

    // Create return maps
    const invoiceReturnMap = new Map(
      returnedInvoiceItems.map(r => [r.invoice_item_id, r._sum.return_qty || 0])
    )
    const invoicexReturnMap = new Map(
      returnedInvoicexItems.map(r => [r.invoice_itemx_id, r._sum.return_qty || 0])
    )

    // Build bills array for Invoice
    const invoiceBills = invoices.map(invoice => {
      const items = invoiceItems
        .filter(item => item.invoice_no === invoice.invoice_no)
        .map(item => {
          const returnedQty = invoiceReturnMap.get(item.id) || 0
          const availableQty = (item.qty || 0) - returnedQty

          return {
            id: item.id.toString(),
            sale_item_id: item.id,
            product_id: 0, // Not needed for return selection
            product_name: item.name_of_product || '',
            part_number: item.part || '',
            original_qty: item.qty || 0,
            available_qty: availableQty,
            unit_price: item.rate || 0,
            tax_rate: 0, // Tax rate will be calculated from invoice level if needed
            bill_reference: `INV-${invoice.invoice_no}`,
            invoice_date: new Date(invoice.invoice_date * 1000).toISOString()
          }
        })
        .filter(item => item.available_qty > 0)

      return {
        id: invoice.id.toString(),
        invoice_no: invoice.invoice_no.toString(),
        bill_reference: `INV-${invoice.invoice_no}`,
        invoice_date: new Date(invoice.invoice_date * 1000).toISOString(),
        total_amount: invoice.total || 0,
        has_tax: true,
        items,
        available_items: items.length,
        total_items: invoiceItems.filter(item => item.invoice_no === invoice.invoice_no).length,
        payment_status: invoice.payment_status ?? 0,
        outstanding_amount: 0,
        invoice_type: 'invoice'
      }
    }).filter(bill => bill.available_items > 0)

    // Build bills array for Invoicex
    const invoicexBills = invoicexs.map(invoicex => {
      const items = invoicexItems
        .filter(item => item.invoice_no === invoicex.invoice_no)
        .map(item => {
          const returnedQty = invoicexReturnMap.get(item.id) || 0
          const availableQty = (item.qty || 0) - returnedQty

          return {
            id: item.id.toString(),
            sale_item_id: item.id,
            product_id: 0,
            product_name: item.name_of_product || '',
            part_number: item.part || '',
            original_qty: item.qty || 0,
            available_qty: availableQty,
            unit_price: item.rate || 0,
            tax_rate: 0, // No tax for salex
            bill_reference: `INVX-${invoicex.invoice_no}`,
            invoice_date: new Date(invoicex.invoice_date * 1000).toISOString()
          }
        })
        .filter(item => item.available_qty > 0)

      return {
        id: invoicex.id.toString(),
        invoice_no: invoicex.invoice_no.toString(),
        bill_reference: `INVX-${invoicex.invoice_no}`,
        invoice_date: new Date(invoicex.invoice_date * 1000).toISOString(),
        total_amount: invoicex.total || 0,
        has_tax: false,
        items,
        available_items: items.length,
        total_items: invoicexItems.filter(item => item.invoice_no === invoicex.invoice_no).length,
        payment_status: invoicex.payment_status ?? 0,
        outstanding_amount: 0,
        invoice_type: 'invoicex'
      }
    }).filter(bill => bill.available_items > 0)

    // Combine and sort by date
    const allBills = [...invoiceBills, ...invoicexBills].sort((a, b) => {
      return new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime()
    })

    // Apply pagination
    const total = allBills.length
    const paginatedBills = allBills.slice(skip, skip + limitNum)
    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      success: true,
      data: {
        bills: paginatedBills,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        },
        filters: {
          applied: {
            search: search || '',
            from_date: from_date || '',
            to_date: to_date || ''
          }
        }
      }
    })

  } catch (error) {
    console.error('Customer items fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch customer items',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
