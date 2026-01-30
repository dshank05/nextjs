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
      vendor_id,
      page = '1',
      limit = '50', // Increased default for bulk returns
      search = '',
      item_search = '', // NEW: Search within product names, part numbers
      from_date = '',
      to_date = ''
    } = req.query

    if (!vendor_id) {
      return res.status(400).json({ message: 'Vendor ID is required' })
    }

    const pageNum = parseInt(page as string) || 1
    const limitNum = parseInt(limit as string) || 10
    const offset = (pageNum - 1) * limitNum

    // Get vendor info
    const vendor = await prisma.vendor_details.findUnique({
      where: { id: parseInt(vendor_id as string) },
      select: {
        id: true,
        vendor_name: true,
        state: true,
        state_code: true,
        tax_id: true
      }
    })

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' })
    }

    // Build where clause for purchases with filtering
    const purchaseWhere: any = {
      vendor_id: parseInt(vendor_id as string),
      return_status: { not: 2 } // Exclude fully returned purchases
    }

    // Add search filter - handle integer vs string fields properly
    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      const searchNum = parseInt(searchStr);
      purchaseWhere.OR = [
        !isNaN(searchNum) ? { invoice_no: searchNum } : undefined, // Exact match for invoice numbers
        { bill_reference: { contains: searchStr } } // Contains for bill references
      ].filter(Boolean) // Remove undefined values
    }

    // Add date range filter
    if (from_date && to_date) {
      const { startTimestamp, endTimestamp } = parseDateRange(
        from_date as string,
        to_date as string
      );
      purchaseWhere.invoice_date = {
        gte: startTimestamp,
        lte: endTimestamp
      };
    }

    // Get total count for pagination
    const totalPurchases = await prisma.purchase.count({
      where: purchaseWhere
    })

    // Get paginated purchases
    const purchases = await prisma.purchase.findMany({
      where: purchaseWhere,
      select: {
        id: true,
        invoice_no: true,
        bill_reference: true,
        bill_reference_date: true,
        invoice_date: true,
        total: true,
        items_total: true,
        total_taxable_value: true,
        total_tax: true,
        total_cgst: true,
        total_sgst: true,
        total_igst: true
      },
      orderBy: {
        invoice_date: 'desc'
      },
      skip: offset,
      take: limitNum
    })

    const totalPages = Math.ceil(totalPurchases / limitNum)

    // Get all purchase items for these purchases
    const purchaseIds = purchases.map(p => p.id)
    const purchaseItems = await prisma.purchaseitems.findMany({
      where: {
        invoice_no: {
          in: purchases.map(p => p.invoice_no)
        }
      },
      select: {
        id: true,
        invoice_no: true,
        product_id: true,
        name_of_product: true,
        part: true,
        qty: true,
        rate: true,
        subtotal: true,
        gst_percentage: true,
        cgst: true,
        sgst: true,
        igst: true,
        tax: true
      }
    })

    // Get product details separately (including current stock)
    const productIds = Array.from(new Set(purchaseItems.map(item => item.product_id).filter(Boolean)))
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds }
      },
      select: {
        id: true,
        display_name: true,
        part_no: true,
        stock: true  // ✅ Current stock for validation
      }
    })

    // Create product lookup map
    const productMap = new Map(products.map(p => [p.id, p]))

    // Get already returned quantities for these items
    const returnedQuantities = await prisma.purchase_return_items.groupBy({
      by: ['purchase_item_id'],
      where: {
        purchase_return: {
          purchase_id: {
            in: purchaseIds
          }
        }
      },
      _sum: {
        return_qty: true
      }
    })

    // Create lookup map for returned quantities
    const returnedQtyMap = new Map(
      returnedQuantities.map(item => [item.purchase_item_id, item._sum.return_qty || 0])
    )

    // Group items by invoice/bill
    const billsMap = new Map()

    purchases.forEach(purchase => {
      const billItems = purchaseItems.filter(item => item.invoice_no === purchase.invoice_no)

      const availableItems = billItems.map(item => {
        const alreadyReturned = returnedQtyMap.get(item.id) || 0
        const availableQty = (item.qty || 0) - alreadyReturned
        const product = productMap.get(item.product_id)

        return {
          id: item.id.toString(),
          purchase_item_id: item.id, // Add this for frontend compatibility
          product_id: item.product_id,
          product_name: product?.display_name || item.name_of_product || 'Unknown Product',
          display_name: product?.display_name || item.name_of_product,
          part_number: product?.part_no || item.part,
          original_qty: item.qty || 0, // ✅ Original purchase quantity
          already_returned: alreadyReturned, // ✅ How much was already returned
          available_qty: Math.max(0, availableQty), // Available for return
          is_fully_returned: availableQty <= 0, // ✅ Flag for UI
          unit_price: item.rate || 0,
          tax_rate: item.gst_percentage || 0,
          bill_reference: purchase.bill_reference || '',
          invoice_date: purchase.invoice_date ? new Date(purchase.invoice_date * 1000).toISOString().split('T')[0] : '',
          current_stock: product?.stock || 0  // Current stock from product table
        }
      })
      // ✅ SHOW ALL ITEMS (don't filter by available_qty)
      // .filter(item => item.available_qty > 0)

      if (availableItems.length > 0) {
        billsMap.set(purchase.invoice_no, {
          id: purchase.id.toString(),
          invoice_no: purchase.invoice_no.toString(),
          bill_reference: purchase.bill_reference || `BILL-${purchase.invoice_no}`,
          invoice_date: purchase.invoice_date ? new Date(purchase.invoice_date * 1000).toISOString().split('T')[0] : '',
          total_amount: purchase.total || 0,
          has_tax: (purchase.total_tax || 0) > 0,
          available_items: availableItems.length,
          total_items: billItems.length,
          items: availableItems
        })
      }
    })

    const bills = Array.from(billsMap.values())

    res.status(200).json({
      success: true,
      data: {
        vendor: {
          id: vendor.id,
          name: vendor.vendor_name,
          state: vendor.state,
          state_code: vendor.state_code,
          gstin: vendor.tax_id
        },
        bills: bills,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalPurchases,
          totalPages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        },
        filters: {
          applied: {
            search: search || null,
            from_date: from_date || null,
            to_date: to_date || null
          }
        },
        summary: {
          total_bills: totalPurchases, // Total bills available (not just current page)
          total_items: bills.reduce((sum, bill) => sum + bill.available_items, 0),
          total_value: bills.reduce((sum, bill) => sum + bill.total_amount, 0)
        }
      }
    })
  } catch (error) {
    console.error('Vendor items fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch vendor items',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
