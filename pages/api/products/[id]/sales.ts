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

    // Get last 5 sales for this product
    const salesItems = await prisma.invoiceitems.findMany({
      where: {
        product_id: productId,
        qty: { gt: 0 } // Only consider valid sales
      },
      orderBy: { invoice_date: 'desc' },
      take: 5
    })

    // Get invoice details for the sales
    const invoiceNos = salesItems.map(item => item.invoice_no)
    const invoices = await prisma.invoice.findMany({
      where: {
        invoice_no: { in: invoiceNos }
      },
      select: {
        invoice_no: true,
        invoice_date: true,
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
        billing_name: true,
        billing_address: true
      }
    })

    // Create lookup maps
    const invoiceMap = new Map(
      invoices.map(inv => [inv.invoice_no, inv])
    )
    const customerMap = new Map(
      customers.map(cust => [cust.id, cust])
    )

    // Format the results for display
    const results = salesItems.map((item, index) => {
      const invoice = invoiceMap.get(item.invoice_no)
      const customerInfo = invoice ? customerMap.get(invoice.select_customer) : null

      // Format date
      let formattedDate = '-'
      if (item.invoice_date) {
        try {
          const dateObj = new Date(item.invoice_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        } catch (error) {
          console.warn('Error formatting sales date:', error)
        }
      }

      return {
        sn: index + 1,
        invoice_number: invoice?.invoice_no?.toString() || '-',
        customer: customerInfo?.billing_name || '-',
        qty: item.qty || 0,
        rate: item.rate || 0,
        amount: (item.qty || 0) * (item.rate || 0),
        date: formattedDate
      }
    })

    res.status(200).json(results)
  } catch (error) {
    console.error('Error fetching product sales:', error)
    res.status(500).json({
      message: 'Failed to fetch product sales',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
