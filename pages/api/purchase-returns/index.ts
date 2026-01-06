import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
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
      vendor = '',
      status = '',
      dateFrom = '',
      dateTo = '',
      amountMin = '',
      amountMax = '',
      uid = '',
      itemCount = '',
      paymentMode = '',
      packingForwardingTotal = '',
      fy = '',
      sortBy = 'return_date',
      sortOrder = 'desc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Search filter - search across return_no, vendor_name, notes
    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      const searchNum = parseInt(searchStr);
      where.OR = [
        !isNaN(searchNum) ? { id: searchNum } : undefined,
        { return_no: { contains: searchStr } },  // Add return_no search
        { notes: { contains: searchStr } },
      ].filter(Boolean) // Remove undefined values
    }

    // Financial year filter
    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    // Status filter - convert UI strings to DB integers
    if (status && status !== '') {
      where.status = parseInt(status as string);
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
        const startDateObj = new Date(dateFrom as string);
        const endDateObj = new Date(dateTo as string);

        if (!isNaN(startDateObj.getTime()) && !isNaN(endDateObj.getTime())) {
          const startTimestamp = Math.floor(startDateObj.getTime() / 1000);
          const endTimestamp = Math.floor(endDateObj.getTime() / 1000);

          where.return_date = {
            gte: startTimestamp,
            lte: endTimestamp
          };
        }
      } catch (error) {
        console.warn('Error parsing filter dates:', error);
      }
    }

    // Invoice No filter (uid) - filter by purchase invoice_no
    if (uid && uid !== '') {
      // This requires joining with purchases table, so we'll filter after data enhancement
      // For now, we'll collect purchase_ids that match the invoice_no
    }

    // Item Count filter - filter by aggregated item count
    if (itemCount && itemCount !== '') {
      // This requires aggregation, so we'll filter after data enhancement
    }

    // Payment Mode filter
    if (paymentMode && paymentMode !== '') {
      where.payment_mode = parseInt(paymentMode as string)
    }

    // Packing/Forwarding Total filter
    if (packingForwardingTotal && packingForwardingTotal !== '') {
      where.packing_forwarding_amount = parseFloat(packingForwardingTotal as string)
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'return_date', 'total_amount', 'total_tax', 'status', 'fy', 'vendor_name', 'invoice_no', 'item_count', 'payment_mode', 'packing_forwarding_amount']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'return_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // For computed fields, we need to fetch all data first and sort in JavaScript
    const needsPostSorting = ['vendor_name', 'invoice_no', 'item_count', 'payment_mode', 'packing_forwarding_amount'].includes(sortField)

    let returns: any[] = []
    let total: number = 0

    if (needsPostSorting) {
      // Get all returns without sorting (we'll sort after fetching vendor names)
      const result = await Promise.all([
        prisma.purchase_returns.findMany({
          where,
          select: {
            id: true,
            vendor_id: true,
            purchase_id: true,
            return_date: true,
            total_amount: true,
            total_tax: true,
            status: true,
            notes: true,
            fy: true,
            payment_status: true,
            payment_mode: true,
            payment_date: true,
            refund_amount: true,
            created_at: true,
            updated_at: true
          }
        }),
        prisma.purchase_returns.count({ where })
      ])
      returns = result[0]
      total = result[1]
    } else {
      // Get returns with database-level sorting
      const result = await Promise.all([
        prisma.purchase_returns.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { [sortField]: sortDirection },
          select: {
            id: true,
            vendor_id: true,
            purchase_id: true,
            return_date: true,
            total_amount: true,
            total_tax: true,
            status: true,
            notes: true,
            fy: true,
            payment_status: true,
            payment_mode: true,
            payment_date: true,
            refund_amount: true,
            created_at: true,
            updated_at: true
          }
        }),
        prisma.purchase_returns.count({ where })
      ])
      returns = result[0]
      total = result[1]
    }

    // Get vendor info, item counts, refund allocations, and purchase info in batch queries
    const vendorIds = Array.from(new Set(returns.map(r => r.vendor_id).filter(Boolean)))
    const returnIds = returns.map(r => r.id)
    const purchaseIds = Array.from(new Set(returns.map(r => r.purchase_id).filter(Boolean)))

    // Get vendor details, purchase info, item counts, and refund allocations
    const [vendorData, purchaseData, returnItemsData, itemCounts, refundAllocations] = await Promise.all([
      // Get vendor details using vendor_ids from returns
      vendorIds.length > 0 ? prisma.vendor_details.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, vendor_name: true, tax_id: true, address: true }
      }) : Promise.resolve([]),

      // Get purchase details for invoice numbers (for returns with single purchase_id)
      purchaseIds.length > 0 ? prisma.purchase.findMany({
        where: { id: { in: purchaseIds } },
        select: { id: true, invoice_no: true }
      }) : Promise.resolve([]),

      // Get ALL purchase invoice numbers for returns (via return items -> purchase items)
      returnIds.length > 0 ? prisma.purchase_return_items.findMany({
        where: { purchase_return_id: { in: returnIds } },
        select: {
          purchase_return_id: true,
          purchase_item: {
            select: { invoice_no: true }
          }
        }
      }) : Promise.resolve([]),

      // Get item counts for each return
      returnIds.length > 0 ? prisma.purchase_return_items.groupBy({
        by: ['purchase_return_id'],
        where: { purchase_return_id: { in: returnIds } },
        _count: { id: true }
      }) : Promise.resolve([]),

      // Get refund allocations for each return
      returnIds.length > 0 ? prisma.refund_allocations.groupBy({
        by: ['return_id'],
        where: { return_id: { in: returnIds } },
        _sum: { allocated_amount: true }
      }) : Promise.resolve([])
    ])

    // Create lookup maps
    const vendorMap = new Map(vendorData.map(v => [v.id, v]))
    const purchaseMap = new Map(purchaseData.map(p => [p.id, p]))
    const itemCountMap = new Map(itemCounts.map(ic => [ic.purchase_return_id, ic._count.id]))
    const refundMap = new Map(refundAllocations.map((r: any) => [r.return_id, Number(r._sum.allocated_amount || 0)]))

    // Create invoice numbers map for returns (collect all invoice numbers from return items)
    const invoiceNumbersMap = new Map<number, Set<number>>()
    returnItemsData.forEach((item: any) => {
      const returnId = item.purchase_return_id
      const invoiceNo = item.purchase_item?.invoice_no

      if (!invoiceNumbersMap.has(returnId)) {
        invoiceNumbersMap.set(returnId, new Set())
      }

      if (invoiceNo) {
        invoiceNumbersMap.get(returnId)!.add(invoiceNo)
      }
    })

    // Enhanced returns with vendor info (direct relationship)
    let enhancedReturns = returns.map((returnRecord) => {
      const vendor = vendorMap.get(returnRecord.vendor_id)
      const purchase = purchaseMap.get(returnRecord.purchase_id)

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

      // Get all invoice numbers for this return (from return items)
      const allInvoiceNumbers = invoiceNumbersMap.get(returnRecord.id)
      const invoiceNumbersArray = allInvoiceNumbers ? Array.from(allInvoiceNumbers).sort() : []

      // Join with commas, or use single invoice, or undefined
      const displayInvoiceNo = invoiceNumbersArray.length > 0
        ? invoiceNumbersArray.join(', ')
        : purchase?.invoice_no || undefined

      return {
        id: returnRecord.id,
        return_no: `PR-${String(returnRecord.id).padStart(3, '0')}`, // Generate return number
        invoice_no: displayInvoiceNo, // Show all invoice numbers joined with commas
        vendor_name: vendor?.vendor_name || 'Unknown Vendor',
        vendor_gstin: vendor?.tax_id || '',
        vendor_address: vendor?.address || '',
        total_amount: returnRecord.total_amount || 0,
        total_tax: returnRecord.total_tax || 0,
        refund_amount: returnRecord.refund_amount || (returnRecord.total_amount + returnRecord.total_tax),
        status: returnRecord.status || 1,
        payment_status: returnRecord.payment_status ?? 0,
        payment_mode: returnRecord.payment_mode ?? 1,
        payment_date: returnRecord.payment_date,
        return_date: returnRecord.return_date,
        formattedDate: formattedDate,
        item_count: itemCountMap.get(returnRecord.id) || 0,
        packing_forwarding_total: returnRecord.packing_forwarding_amount || 0, // P/F amount
        notes: returnRecord.notes || '',
        fy: returnRecord.fy,
        created_at: returnRecord.created_at,
        updated_at: returnRecord.updated_at,
        // Refund allocation summary
        total_refunded: refundMap.get(returnRecord.id) || 0,
        remaining_refund: (returnRecord.refund_amount || (returnRecord.total_amount + returnRecord.total_tax)) - (refundMap.get(returnRecord.id) || 0)
      }
    })

    // Apply additional filters (after data enhancement)
    if (vendor && vendor !== '') {
      const vendorStr = Array.isArray(vendor) ? vendor[0] : vendor;
      const vendorNum = parseInt(vendorStr);

      // If it's a number, filter by vendor_id, otherwise by vendor_name
      if (!isNaN(vendorNum)) {
        // Filter by vendor ID
        const vendorIds = returns.map(r => r.vendor_id);
        enhancedReturns = enhancedReturns.filter(ret => {
          const originalReturn = returns.find(r => r.id === ret.id);
          return originalReturn && originalReturn.vendor_id === vendorNum;
        });
      } else {
        // Filter by vendor name (string search)
        enhancedReturns = enhancedReturns.filter(ret =>
          ret.vendor_name.toLowerCase().includes(vendorStr.toLowerCase())
        );
      }
    }

    // Apply Invoice No filter (uid)
    if (uid && uid !== '') {
      const uidStr = Array.isArray(uid) ? uid[0] : uid;
      enhancedReturns = enhancedReturns.filter(ret =>
        ret.invoice_no && ret.invoice_no.toString().includes(uidStr)
      );
    }

    // Apply Item Count filter
    if (itemCount && itemCount !== '') {
      const itemCountNum = parseInt(itemCount as string);
      enhancedReturns = enhancedReturns.filter(ret =>
        ret.item_count === itemCountNum
      );
    }

    // Apply post-sorting for computed fields if needed
    if (needsPostSorting) {
      enhancedReturns.sort((a, b) => {
        let aValue: any, bValue: any;

        switch (sortField) {
          case 'vendor_name':
            aValue = (a.vendor_name || '').toString().toLowerCase();
            bValue = (b.vendor_name || '').toString().toLowerCase();
            break;
          case 'invoice_no':
            aValue = a.invoice_no || '';
            bValue = b.invoice_no || '';
            break;
          case 'item_count':
            aValue = a.item_count || 0;
            bValue = b.item_count || 0;
            break;
          case 'payment_mode':
            aValue = a.payment_mode || 0;
            bValue = b.payment_mode || 0;
            break;
          case 'packing_forwarding_amount':
            aValue = a.packing_forwarding_total || 0;
            bValue = b.packing_forwarding_total || 0;
            break;
          default:
            aValue = '';
            bValue = '';
        }

        // Handle string comparison
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });

      // Apply pagination after sorting
      enhancedReturns = enhancedReturns.slice(skip, skip + limitNum);
    }

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
    console.error('Purchase returns fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch purchase returns data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    // TODO: Implement return creation logic
    // This will handle creating new purchase returns
    res.status(501).json({ message: 'Return creation not implemented yet' })
  } catch (error) {
    console.error('Purchase return creation error:', error)
    res.status(500).json({
      message: 'Failed to create purchase return',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
