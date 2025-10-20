import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const productId = parseInt(id as string)
    if (isNaN(productId)) {
      return res.status(400).json({ message: 'Invalid product ID' })
    }

    // First get invoice items for this product
    const productInvoiceItems = await prisma.invoiceitems.findMany({
      where: {
        product_id: productId
      },
      select: {
        id: true,
        invoice_no: true
      }
    })

    const invoiceItemIds = productInvoiceItems.map(item => item.id)

    // Get sale return items that reference these invoice items
    const saleReturnItems = await prisma.sale_return_items.findMany({
      where: {
        invoice_item_id: { in: invoiceItemIds },
        return_qty: { gt: 0 } // Only consider valid returns
      },
      orderBy: {
        sale_return_id: 'desc'
      },
      take: 5
    })

    // Get sale return details
    const saleReturnIds = saleReturnItems.map(item => item.sale_return_id)
    const saleReturns = await prisma.sale_returns.findMany({
      where: {
        id: { in: saleReturnIds }
      },
      select: {
        id: true,
        return_date: true,
        invoice_id: true
      }
    })

    // Get invoice details
    const invoiceIds = saleReturns.map(sr => sr.invoice_id)
    const invoices = await prisma.invoice.findMany({
      where: {
        id: { in: invoiceIds }
      },
      select: {
        id: true,
        invoice_no: true,
        select_customer: true
      }
    })

    // Get customer details
    const customerIds = invoices.map(inv => inv.select_customer).filter(id => id)
    const customers = await prisma.customer_details.findMany({
      where: {
        id: { in: customerIds }
      },
      select: {
        id: true,
        billing_name: true
      }
    })

    // Create lookup maps
    const saleReturnMap = new Map(saleReturns.map(sr => [sr.id, sr]))
    const invoiceMap = new Map(invoices.map(inv => [inv.id, inv]))
    const customerMap = new Map(customers.map(cust => [cust.id, cust]))

    // Format the results for display
    const results = saleReturnItems.map((item, index) => {
      const saleReturn = saleReturnMap.get(item.sale_return_id)
      const invoice = saleReturn ? invoiceMap.get(saleReturn.invoice_id) : null
      const customerInfo = invoice ? customerMap.get(invoice.select_customer) : null

      // Format date
      let formattedDate = '-'
      if (saleReturn?.return_date) {
        try {
          const dateObj = new Date(saleReturn.return_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        } catch (error) {
          console.warn('Error formatting sale return date:', error)
        }
      }

      return {
        sn: index + 1,
        voucher_number: saleReturn?.id?.toString() || '-',
        customer: customerInfo?.billing_name || '-',
        qty: item.return_qty || 0,
        rate: item.unit_price || 0,
        amount: (item.return_qty || 0) * (item.unit_price || 0),
        date: formattedDate
      }
    })

    res.status(200).json(results)
  } catch (error) {
    console.error('Error fetching product sale returns:', error)
    res.status(500).json({
      message: 'Failed to fetch product sale returns',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
