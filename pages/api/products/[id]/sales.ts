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

    // Sale lines store the HEADER'S PRIMARY KEY in invoice_no (sales/index.ts
    // writes `invoice_no: sale.id`), so the header is found by id. This matched
    // it against the header's own invoice_no - a different number - and showed
    // some other invoice's number and customer (PQ-02).
    const headerIds = salesItems.map(item => item.invoice_no)
    const invoices = await prisma.invoice.findMany({
      where: {
        id: { in: headerIds }
      },
      select: {
        id: true,
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
      invoices.map(inv => [inv.id, inv])
    )
    const customerMap = new Map(
      customers.map(cust => [cust.id, cust])
    )

    // Format the results for display
    const results = salesItems.map((item, index) => {
      const invoice = invoiceMap.get(item.invoice_no)
      const customerInfo = invoice ? customerMap.get(invoice.select_customer) : null

      // ISO, formatted once in the browser. This sent an already-formatted
      // d/m/yyyy string that the page parsed and formatted again (PQ-01).
      const date = item.invoice_date ? new Date(item.invoice_date * 1000).toISOString() : null

      return {
        sn: index + 1,
        invoice_number: invoice?.invoice_no?.toString() || '-',
        customer: customerInfo?.billing_name || '-',
        qty: item.qty || 0,
        rate: item.rate || 0,
        amount: (item.qty || 0) * (item.rate || 0),
        date
      }
    })

    res.status(200).json(results)
  } catch (error) {
    console.error('Error fetching product sales:', error)
    res.status(500).json({
      message: 'Failed to fetch product sales'
    })
  }
}
