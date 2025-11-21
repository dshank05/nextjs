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

    // Get last 5 purchases for this product
    const purchaseItems = await prisma.purchaseitems.findMany({
      where: {
        product_id: productId,
        qty: { gt: 0 } // Only consider valid purchases
      },
      orderBy: { invoice_date: 'desc' },
      take: 5
    })

    // Get purchase invoice details and vendor IDs
    const invoiceNos = purchaseItems.map(item => item.invoice_no)
    const vendorIds = Array.from(new Set(purchaseItems.map(item => item.vendor_id).filter(Boolean)))

    const [purchaseInvoices, vendors] = await Promise.all([
      prisma.purchase.findMany({
        where: {
          invoice_no: { in: invoiceNos }
        },
        select: {
          invoice_no: true,
          bill_reference: true,
          invoice_date: true,
          total: true,
          vendor_id: true
        }
      }),
      vendorIds.length > 0 ? prisma.vendor_details.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, vendor_name: true, address: true }
      }) : Promise.resolve([])
    ])

    // Create lookup maps for invoice details and vendors
    const invoiceMap = new Map(
      purchaseInvoices.map(inv => [inv.invoice_no, inv])
    )
    const vendorMap = new Map(
      vendors.map(vendor => [vendor.id, vendor])
    )

    // Format the results for display
    const results = purchaseItems.map((item, index) => {
      const invoice = invoiceMap.get(item.invoice_no)
      const vendor = vendorMap.get(item.vendor_id)

      // Format date
      let formattedDate = '-'
      if (invoice?.invoice_date) {
        try {
          if (typeof invoice.invoice_date === 'string') {
            const dateObj = new Date(invoice.invoice_date)
            if (!isNaN(dateObj.getTime())) {
              formattedDate = dateObj.toLocaleDateString('en-IN')
            }
          } else if (typeof invoice.invoice_date === 'number') {
            const dateObj = new Date(invoice.invoice_date * 1000)
            if (!isNaN(dateObj.getTime())) {
              formattedDate = dateObj.toLocaleDateString('en-IN')
            }
          }
        } catch (error) {
          console.warn('Error formatting purchase date:', error)
        }
      }

      return {
        sn: index + 1,
        invoice_number: item.invoice_no?.toString() || '-',
        vendor: vendor?.vendor_name || '-',
        qty: item.qty || 0,
        rate: item.rate || 0,
        amount: (item.qty || 0) * (item.rate || 0),
        date: formattedDate
      }
    })

    res.status(200).json(results)
  } catch (error) {
    console.error('Error fetching product purchases:', error)
    res.status(500).json({
      message: 'Failed to fetch product purchases',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
