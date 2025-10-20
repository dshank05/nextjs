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

    // First get purchase items for this product
    const productPurchaseItems = await prisma.purchaseitems.findMany({
      where: {
        product_id: productId
      },
      select: {
        id: true,
        invoice_no: true
      }
    })

    const purchaseItemIds = productPurchaseItems.map(item => item.id)

    // Get purchase return items that reference these purchase items
    const purchaseReturnItems = await prisma.purchase_return_items.findMany({
      where: {
        purchase_item_id: { in: purchaseItemIds },
        return_qty: { gt: 0 } // Only consider valid returns
      },
      orderBy: {
        purchase_return_id: 'desc'
      },
      take: 5
    })

    // Get purchase return details
    const purchaseReturnIds = purchaseReturnItems.map(item => item.purchase_return_id)
    const purchaseReturns = await prisma.purchase_returns.findMany({
      where: {
        id: { in: purchaseReturnIds }
      },
      select: {
        id: true,
        return_date: true,
        purchase_id: true
      }
    })

    // Get purchase details
    const purchaseIds = purchaseReturns.map(pr => pr.purchase_id)
    const purchases = await prisma.purchase.findMany({
      where: {
        id: { in: purchaseIds }
      },
      select: {
        id: true,
        invoice_no: true,
        vendor_id: true
      }
    })

    // Get vendor details
    const vendorIds = purchases.map(p => p.vendor_id).filter(id => id)
    const vendors = await prisma.vendor_details.findMany({
      where: {
        id: { in: vendorIds }
      },
      select: {
        id: true,
        vendor_name: true
      }
    })

    // Create lookup maps
    const purchaseReturnMap = new Map(purchaseReturns.map(pr => [pr.id, pr]))
    const purchaseMap = new Map(purchases.map(p => [p.id, p]))
    const vendorMap = new Map(vendors.map(v => [v.id, v]))

    // Format the results for display
    const results = purchaseReturnItems.map((item, index) => {
      const purchaseReturn = purchaseReturnMap.get(item.purchase_return_id)
      const purchase = purchaseReturn ? purchaseMap.get(purchaseReturn.purchase_id) : null
      const vendorInfo = purchase ? vendorMap.get(purchase.vendor_id) : null

      // Format date
      let formattedDate = '-'
      if (purchaseReturn?.return_date) {
        try {
          const dateObj = new Date(Number(purchaseReturn.return_date) * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        } catch (error) {
          console.warn('Error formatting purchase return date:', error)
        }
      }

      return {
        sn: index + 1,
        voucher_number: purchaseReturn?.id?.toString() || '-',
        vendor: vendorInfo?.vendor_name || '-',
        qty: item.return_qty || 0,
        rate: item.unit_price || 0,
        amount: Number(item.return_qty || 0) * Number(item.unit_price || 0),
        date: formattedDate
      }
    })

    res.status(200).json(results)
  } catch (error) {
    console.error('Error fetching product purchase returns:', error)
    res.status(500).json({
      message: 'Failed to fetch product purchase returns',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
