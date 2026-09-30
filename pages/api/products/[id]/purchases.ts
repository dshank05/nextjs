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

    // Purchase lines carry the human invoice number AND the financial year; the
    // number alone repeats across years, so the header is matched on both
    // (PQ-03, the L-1 class).
    const headerKey = (invoiceNo: number, fy: number) => `${invoiceNo}:${fy}`
    const vendorIds = Array.from(new Set(purchaseItems.map(item => item.vendor_id).filter(Boolean)))

    const [purchaseInvoices, vendors] = await Promise.all([
      prisma.purchase.findMany({
        where: {
          OR: purchaseItems.map(item => ({ invoice_no: item.invoice_no, fy: item.fy }))
        },
        select: {
          invoice_no: true,
          fy: true,
          bill_reference: true,
          bill_reference_date: true,
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
      purchaseInvoices.map(inv => [headerKey(inv.invoice_no, inv.fy), inv])
    )
    const vendorMap = new Map(
      vendors.map(vendor => [vendor.id, vendor])
    )

    // Format the results for display
    const results = purchaseItems.map((item, index) => {
      const invoice = invoiceMap.get(headerKey(item.invoice_no, item.fy))
      const vendor = vendorMap.get(item.vendor_id)

      // ISO, formatted once in the browser (PQ-01).
      const date = invoice?.invoice_date ? new Date(invoice.invoice_date * 1000).toISOString() : null
      const billRefDate = invoice?.bill_reference_date ? new Date(invoice.bill_reference_date).toISOString() : null

      return {
        sn: index + 1,
        invoice_number: item.invoice_no?.toString() || '-',
        bill_reference: invoice?.bill_reference || '-',
        bill_reference_date: billRefDate,
        vendor: vendor?.vendor_name || '-',
        qty: item.qty || 0,
        rate: item.rate || 0,
        amount: (item.qty || 0) * (item.rate || 0),
        date
      }
    })

    res.status(200).json(results)
  } catch (error) {
    console.error('Error fetching product purchases:', error)
    res.status(500).json({
      message: 'Failed to fetch product purchases'
    })
  }
}
