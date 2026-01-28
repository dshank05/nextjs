import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { getNextInvoiceNumber } from '../../../lib/invoice-counter'
import { ledgerService } from '../../../lib/ledger-service'
import { balanceHandler } from '../../../lib/balance-handler'

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
      startDate = '',
      endDate = '',
      fy = '',
      status = '',
      amountMin = '',
      amountMax = '',
      vendor = '',
      uid = '', // NEW: Filter by purchase ID
      billReference = '', // NEW: Filter by bill reference
      itemCount = '', // NEW: Filter by item count
      paymentMode = '', // NEW: Filter by payment mode
      totalTax = '', // NEW: Filter by total tax amount
      packingForwardingTotal = '', // NEW: Filter by packing/forwarding total
      sortBy = 'invoice_date', // NEW: Sort field (default: invoice_date)
      sortOrder = 'desc' // NEW: Sort order (default: desc)
    } = req.query



    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Handle UID filtering - filter by invoice_no for "Invoice No" filter
    if (uid && uid !== '') {
      where.invoice_no = parseInt(uid as string)
    }

    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      const searchNum = parseInt(searchStr);
      where.OR = [
        !isNaN(searchNum) ? { invoice_no: searchNum } : undefined,
        { notes: { contains: searchStr } },
      ].filter(Boolean) // Remove undefined values
    }

    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    if (startDate && endDate) {
      // Handle both string dates and Unix timestamps
      // Convert input dates to appropriate format for comparison
      try {
        // Always try to parse input dates as standard date strings
        const startDateObj = new Date(startDate as string);
        const endDateObj = new Date(endDate as string);

        if (!isNaN(startDateObj.getTime()) && !isNaN(endDateObj.getTime())) {
          // Convert to Unix timestamps for comparison (assuming data is stored as integers)
          const startTimestamp = Math.floor(startDateObj.getTime() / 1000);
          const endTimestamp = Math.floor(endDateObj.getTime() / 1000);

          where.invoice_date = {
            gte: startTimestamp,
            lte: endTimestamp
          };
        }
      } catch (error) {
        console.warn('Error parsing filter dates:', error);
      }
    }

    if (status && status !== '') {
      if (status === '0' || status === '1' || status === '2') {
        where.payment_status = parseInt(status)
      } else if (status === 'unknown') {
        // For unknown status, filter for statuses that are not 0, 1, or 2
        where.payment_status = { notIn: [0, 1, 2] }
      }
    }

    if (amountMin && amountMin !== '') {
      where.total = { gte: parseFloat(amountMin as string) }
    }

    if (amountMax && amountMax !== '') {
      where.total = where.total ? { ...where.total, lte: parseFloat(amountMax as string) } : { lte: parseFloat(amountMax as string) }
    }

    // Vendor filter - CRITICAL FIX
    if (vendor && vendor !== '') {
      where.vendor_id = parseInt(vendor as string)
    }

    // Bill Reference filter
    if (billReference && billReference !== '') {
      where.bill_reference = { contains: billReference as string }
    }

    // Payment Mode filter
    if (paymentMode && paymentMode !== '') {
      where.payment_mode = parseInt(paymentMode as string)
    }

    // Total Tax filter
    if (totalTax && totalTax !== '') {
      where.total_tax = parseFloat(totalTax as string)
    }

    // Packing/Forwarding Total filter
    if (packingForwardingTotal && packingForwardingTotal !== '') {
      where.packing_forwarding_total = parseFloat(packingForwardingTotal as string)
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'invoice_no', 'vendor_name', 'total', 'total_tax', 'packing_forwarding_total', 'invoice_date', 'payment_status', 'payment_mode', 'fy', 'bill_reference', 'item_count']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'invoice_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // For vendor_name and item_count sorting, we need to fetch all data first and sort in JavaScript
    // For other fields, we can sort at database level
    const needsPostSorting = sortField === 'vendor_name' || sortField === 'item_count'

    let purchaseInvoices: any[] = []
    let total: number = 0

    if (needsPostSorting) {
      // Get all purchase invoices without sorting (we'll sort after fetching vendor names)
      const result = await Promise.all([
        prisma.purchase.findMany({
          where,
          select: {
            id: true,
            invoice_no: true,
            bill_reference: true,
            items_total: true,
            freight: true,
            total_taxable_value: true,
            packing_forwarding_total: true,
            taxrate: true,
            total_cgst: true,
            total_sgst: true,
            total_igst: true,
            total_tax: true,
            total: true,
            notes: true,
            invoice_date: true,
            payment_mode: true,
            payment_status: true,
            fy: true,
            transport: true,
            vendor_id: true,
            return_status: true // Include return status for client-side indicators
          }
        }),
        prisma.purchase.count({ where })
      ])
      purchaseInvoices = result[0]
      total = result[1]
    } else {
      // Get purchase invoices with database-level sorting
      const result = await Promise.all([
        prisma.purchase.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { [sortField]: sortDirection },
          select: {
            id: true,
            invoice_no: true,
            bill_reference: true,
            items_total: true,
            freight: true,
            total_taxable_value: true,
            packing_forwarding_total: true,
            taxrate: true,
            total_cgst: true,
            total_sgst: true,
            total_igst: true,
            total_tax: true,
            total: true,
            notes: true,
            invoice_date: true,
            payment_mode: true,
            payment_status: true,
            fy: true,
            transport: true,
            vendor_id: true,
            return_status: true // Include return status for client-side indicators
          }
        }),
        prisma.purchase.count({ where })
      ])
      purchaseInvoices = result[0]
      total = result[1]
    }

    // Get item counts, vendor info, staff info, bill_to info, and payment allocations in batch queries
    const invoiceNos = purchaseInvoices.map((inv: { invoice_no: any }) => inv.invoice_no)
    const purchaseIds = purchaseInvoices.map((inv: any) => inv.id)
    const vendorIds = Array.from(new Set(purchaseInvoices.map((inv: any) => inv.vendor_id).filter(Boolean)))
    const staffIds = Array.from(new Set(purchaseInvoices.map((inv: any) => inv.staff_id).filter(Boolean)))
    // Get bill_to data for "Other" vendors (vendor_id = 0)
    const otherVendorInvoices = purchaseInvoices.filter((inv: any) => inv.vendor_id === 0).map((inv: any) => inv.invoice_no)

    const [itemCounts, vendorData, staffData, billToData, paymentAllocations] = await Promise.all([
      // Get all item counts in one query
      prisma.purchaseitems.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceNos } },
        _count: { id: true }
      }),
      // Get vendor names for all purchases
      vendorIds.length > 0 ? prisma.vendor_details.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, vendor_name: true, address: true, tax_id: true }
      }) : Promise.resolve([]),
      // Get staff details for all purchases
      staffIds.length > 0 ? prisma.staff.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true, phone: true, email: true }
      }) : Promise.resolve([]),
      // Get bill_to data for "Other" vendors
      otherVendorInvoices.length > 0 ? prisma.bill_to.findMany({
        where: { invoice_no: { in: otherVendorInvoices } },
        select: { invoice_no: true, vendor_name: true, contact_no: true, email: true, address: true, address2: true, city: true, state: true, gstin: true }
      }) : Promise.resolve([]),
      // Get payment allocations for all purchases
      purchaseIds.length > 0 ? prisma.payment_allocations.groupBy({
        by: ['purchase_id'],
        where: { purchase_id: { in: purchaseIds } },
        _sum: { allocated_amount: true }
      }) : Promise.resolve([])
    ])

    // Create lookup maps for fast access
    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))
    const vendorMap = new Map(vendorData.map(vendor => [vendor.id, vendor]))
    const staffMap = new Map(staffData.map(staff => [staff.id, staff]))
    const billToMap = new Map(billToData.map(billTo => [billTo.invoice_no, billTo]))
    const paymentMap = new Map(paymentAllocations.map((payment: any) => [payment.purchase_id, Number(payment._sum.allocated_amount || 0)]))

    // Enhanced purchase invoices using maps
    let enhancedPurchases = purchaseInvoices.map((invoice: any) => {
      // Handle date format for purchases - could be string dates or Unix timestamps
      let formattedDate: string | null = null
      try {
        if (invoice.invoice_date) {
          let dateObj: Date

          // Check if it's a Unix timestamp (integer) or string date
          if (typeof invoice.invoice_date === 'string') {
            if (invoice.invoice_date.trim() === '') {
              // Empty string - skip
            } else {
              // Try parsing as string date like "2025-01-15"
              dateObj = new Date(invoice.invoice_date)
              if (!isNaN(dateObj.getTime())) {
                formattedDate = dateObj.toLocaleDateString('en-IN')
              }
            }
          } else if (typeof invoice.invoice_date === 'number') {
            // Unix timestamp in seconds
            dateObj = new Date(invoice.invoice_date * 1000)
            if (!isNaN(dateObj.getTime())) {
              formattedDate = dateObj.toLocaleDateString('en-IN')
            }
          }
        }
      } catch (error) {
        console.warn('Invalid date format for purchase:', invoice.invoice_date, error)
      }

      const vendorInfo = vendorMap.get(invoice.vendor_id)
      const billToInfo = billToMap.get(invoice.invoice_no)
      const staffInfo = staffMap.get(invoice.staff_id)
      // ✅ Calculate taxrate as total_tax/total_taxable_value (invoice level)
      const calculatedTaxrate = invoice.total_taxable_value > 0 ? invoice.total_tax / invoice.total_taxable_value : 0;

      return {
        id: invoice.id,
        invoice_no: invoice.invoice_no,
        bill_reference: invoice.bill_reference, // Bill reference (separate from vendor)
        vendor_id: invoice.vendor_id,
        vendor_name: vendorInfo?.vendor_name || billToInfo?.vendor_name || 'Other',
        vendor_address: vendorInfo?.address || billToInfo?.address || '',
        vendor_gstin: vendorInfo?.tax_id || billToInfo?.gstin || '',
        staff_name: staffInfo?.name,
        staff_phone: staffInfo?.phone || '',
        staff_email: staffInfo?.email || '',
        taxrate: calculatedTaxrate, // ✅ Calculated taxrate
        // OPTIMIZATION: Commented out fields only used in removed expanded details
        // items_total: invoice.items_total || 0,
        // freight: invoice.freight || 0,
        // total_taxable_value: invoice.total_taxable_value,
        // total_cgst: invoice.total_cgst || 0,
        // total_sgst: invoice.total_sgst || 0,
        // total_igst: invoice.total_igst || 0,
        total_tax: invoice.total_tax || 0, // ✅ Include total_tax for display and filtering
        packing_forwarding_total: invoice.packing_forwarding_total || 0, // ✅ Include packing/forwarding total
        // notes: invoice.notes || '',
        // transport: invoice.transport || '',
        // items: [], // Never populated in GET response
        total: invoice.total,
        invoice_date: invoice.invoice_date, // Raw date - let frontend format it
        payment_status: invoice.payment_status || 0,
        payment_mode: invoice.payment_mode || 0,
        fy: invoice.fy,
        item_count: itemCountMap.get(invoice.invoice_no) || 0,
        return_status: invoice.return_status || 0, // ✅ Include return status
        // Payment allocation summary
        total_paid: paymentMap.get(invoice.id) || 0,
        remaining_amount: invoice.total - (paymentMap.get(invoice.id) || 0),
        // OPTIMIZATION: Commented out unused fields - uncomment if needed
        // type: 'purchase',
        // formattedDate: formattedDate, // Frontend handles formatting
        // formattedTotal: invoice.total?.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })
      }
    })

    // Apply item count filtering if specified
    if (itemCount && itemCount !== '') {
      const itemCountNum = parseInt(itemCount as string)
      enhancedPurchases = enhancedPurchases.filter(purchase => purchase.item_count === itemCountNum)
    }

    // Apply post-sorting for vendor_name or item_count if needed
    if (needsPostSorting) {
      enhancedPurchases.sort((a, b) => {
        let aValue: any
        let bValue: any

        if (sortField === 'vendor_name') {
          aValue = (a.vendor_name || '').toString().toLowerCase()
          bValue = (b.vendor_name || '').toString().toLowerCase()
        } else if (sortField === 'item_count') {
          aValue = a.item_count || 0
          bValue = b.item_count || 0
        }

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
        return 0
      })

      // Apply pagination after sorting
      enhancedPurchases = enhancedPurchases.slice(skip, skip + limitNum)
    }

    const totalPages = Math.ceil(total / limitNum)



    res.status(200).json({
      purchases: enhancedPurchases,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Purchases fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch purchases data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const startTime = Date.now();

  try {
    const { nextInvoiceNo, currentFy } = await getNextInvoiceNumber('purchase');

    const {
      bill_reference,
      bill_reference_date,
      staff_id,
      date,
      vendor_id,
      items,
      descriptions,
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,
      total_cgst,
      total_sgst,
      total_igst,
      notes,
      total_tax,
      payment_status,
      payment_mode
    } = req.body

    // ===== STEP 2: VALIDATION =====
    if (vendor_id === undefined || vendor_id === null || !items || items.length === 0) {
      return res.status(400).json({
        message: 'Missing required fields: vendor_id, or items'
      })
    }

    if (parseInt(vendor_id) === 0) {
      if (!req.body.contact_number || req.body.contact_number.trim() === '') {
        return res.status(400).json({
          message: 'Phone number is required for "Other" vendor selection'
        })
      }
    }

    // Removed rate validation to allow 0 or empty rates

    const validPaymentStatuses = [0, 1];
    const validPaymentModes = [0, 1];

    if (!validPaymentStatuses.includes(payment_status)) {
      return res.status(400).json({
        message: 'Invalid payment_status: must be 0 (Unpaid) or 1 (Paid)'
      })
    }

    if (payment_status === 1 && (payment_mode === undefined || payment_mode === null)) {
      return res.status(400).json({
        message: 'Payment mode (Cash/Bank) is required for paid purchases'
      })
    }

    if (payment_mode !== undefined && payment_mode !== null && !validPaymentModes.includes(payment_mode)) {
      return res.status(400).json({
        message: 'Invalid payment_mode: must be 0 (Cash) or 1 (Bank)'
      })
    }

    let existingVendor = null;
    if (parseInt(vendor_id) !== 0) {
      existingVendor = await prisma.vendor_details.findUnique({
        where: { id: parseInt(vendor_id) }
      })

      if (!existingVendor) {
        return res.status(400).json({
          message: 'Invalid vendor selected - vendor does not exist'
        })
      }
    }

    // ===== STEP 3: DATA PREPARATION ===== 
    // ✅ TIMEZONE SAFE: Add T12:00:00 to avoid timezone shift
    const invoiceDate = new Date(date + 'T12:00:00').getTime() / 1000
    const itemsTotal = items.reduce((sum: number, item: any) => sum + (item.qty * item.rate), 0)
    const calculatedGrandTotal = itemsTotal +
      parseFloat(packing_forwarding_total?.toString()) +
      parseFloat(total_tax?.toString())
    // Note: Freight (transport_cost) is stored separately but NOT included in total

    // ===== STEP 4: OPTIMIZED DATABASE TRANSACTION =====
    const purchase = await prisma.$transaction(async (tx) => {
      // ===== DB OPERATION 1: Create purchase record =====
      const purchase = await tx.purchase.create({
        data: {
          invoice_no: nextInvoiceNo,
          bill_reference: bill_reference,
          bill_reference_date: bill_reference_date ? new Date(bill_reference_date).toISOString() : null,
          staff_id: staff_id ? parseInt(staff_id) : null,
          vendor_id: parseInt(vendor_id),
          items_total: itemsTotal,
          freight: parseFloat(req.body.transport_cost?.toString()) || 0,
          total_taxable_value: itemsTotal,
          total_cgst: parseFloat(total_cgst?.toString()) || 0,
          total_sgst: parseFloat(total_sgst?.toString()) || 0,
          total_igst: parseFloat(total_igst?.toString()) || 0,
          total_tax: parseFloat(total_tax?.toString()) || 0,
          total: calculatedGrandTotal,
          notes: notes || '',
          descriptions: descriptions,
          packing_forwarding_qty: parseFloat(packing_forwarding_qty?.toString()) || 0,
          packing_forwarding_rate: parseFloat(packing_forwarding_rate?.toString()) || 0,
          packing_forwarding_total: parseFloat(packing_forwarding_total?.toString()) || 0,
          invoice_date: Math.floor(invoiceDate),
          updated_at: new Date().toISOString().split('T')[0],
          payment_status: payment_status || 0,
          payment_mode: payment_mode,
          fy: currentFy,
          transport: req.body.transport_name || '',
          transport_name: req.body.transport_name,
          vehicle_number: req.body.vehicle_number,
          return_status: 0
        }
      });

      // ===== DB OPERATION 2: Create bill_to record =====
      await tx.bill_to.create({
        data: {
          invoice_no: nextInvoiceNo,
          vendor_name: req.body.vendor_name ?? existingVendor?.vendor_name ?? '',
          contact_no: req.body.contact_number ?? existingVendor?.contact_no ?? '',
          email: req.body.email_id ?? existingVendor?.email ?? '',
          address: req.body.address ?? existingVendor?.address ?? '',
          address2: req.body.address_2 ?? existingVendor?.address_2 ?? '',
          city: req.body.city ?? existingVendor?.city ?? '',
          state: req.body.state ?? existingVendor?.state ?? '',
          state_code: req.body.state_code ?? existingVendor?.state_code ?? null,
          gstin: req.body.gst_number ?? existingVendor?.tax_id ?? '',
          pin_code: req.body.pin_code ?? existingVendor?.pin_code ?? ''
        }
      });

      // ===== DB OPERATION 3: Batch load all products =====
      const productIds = items.map(item => parseInt(item.product_id));
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          product_name: true,
          product_category_id: true,
          product_subcategory_id: true,
          company_id: true,
          hsn: true
        }
      });

      // Create product lookup map for O(1) access
      const productMap = new Map(products.map(product => [product.id, product]));

      // ===== DB OPERATION 4: Validate products exist =====
      for (const item of items) {
        const productId = parseInt(item.product_id);
        if (!productMap.has(productId)) {
          throw new Error(`Product with ID ${productId} not found`);
        }
      }

      // ===== OPTIMIZED DB OPERATION 5: Bulk insert purchase items =====
      const bulkInsertData = items.map(item => {
        const productId = parseInt(item.product_id);
        const product = productMap.get(productId)!;

        const modelId = item.model_id ? parseInt(item.model_id) : null;
        const companyId = item.company_id ? parseInt(item.company_id) : null;

        return {
          invoice_no: purchase.invoice_no,
          product_id: productId,
          name_of_product: product.product_name,
          category_id: product.product_category_id || 0,
          subcategory_id: product.product_subcategory_id || 0,
          model_id: modelId,
          company_id: companyId,
          car_model: item.car_model || '',
          vendor_id: parseInt(vendor_id),
          part: item.part || '',
          qty: parseFloat(item.qty),
          rate: parseFloat(item.rate),
          subtotal: parseFloat(item.total),
          gst_percentage: parseFloat(item.gst_percentage) || 0,
          cgst: parseFloat(item.cgst) || 0,
          sgst: parseFloat(item.sgst) || 0,
          igst: parseFloat(item.igst) || 0,
          tax: parseFloat(item.tax) || 0,
          fy: currentFy,
          invoice_date: invoiceDate
        };
      });

      // Use Prisma's createMany for bulk insert
      await tx.purchaseitems.createMany({
        data: bulkInsertData
      });

      // ===== OPTIMIZED: Parallel stock updates and ledger creation =====
      await Promise.all([
        // Stock updates (parallel)
        Promise.all(
          items.map(async (item) => {
            const productId = parseInt(item.product_id);
            const validatedQty = Number(item.qty) || 0;

            return tx.product.update({
              where: { id: productId },
              data: {
                stock: {
                  increment: validatedQty
                },
                latest_purchase_rate: parseFloat(item.rate) || 0,
                last_purchase_date: invoiceDate
              }
            });
          })
        ),
        // Ledger entry (parallel with stock updates)
        ledgerService.createPurchaseEntry({
          id: purchase.id,
          vendor_id: parseInt(vendor_id),
          invoice_no: purchase.invoice_no,
          invoice_date: Math.floor(invoiceDate),
          total: calculatedGrandTotal,
          fy: currentFy
        }, tx)
      ]);

      // ===== PAYMENT OPERATIONS (if paid) =====
      if (payment_status === 1) {
        // ✅ FETCH VENDOR BALANCE FOR SMART ADVANCE ALLOCATION
        const vendor = await tx.vendor_details.findUnique({
          where: { id: parseInt(vendor_id) },
          select: {
            total_paid: true,
            total_allocated: true,
            total_refunded: true,
            total_refund_allocated: true
          }
        });

        // ✅ USE BALANCE HANDLER FOR SMART ALLOCATION (handles vendor_id = 0)
        const balanceOp = balanceHandler.getCreateBalanceOps({
          vendorId: parseInt(vendor_id),
          total: calculatedGrandTotal,
          currentBalance: vendor ? {
            total_paid: Number(vendor.total_paid),
            total_allocated: Number(vendor.total_allocated),
            total_refunded: Number(vendor.total_refunded),
            total_refund_allocated: Number(vendor.total_refund_allocated)
          } : undefined,
          type: 'PURCHASE'
        });

        // Calculate advance for ledger notes
        const advanceBalance = vendor 
          ? Number(vendor.total_paid) - Number(vendor.total_allocated)
          : 0;

        // Create PAYMENT ledger entry
        await ledgerService.createEntry({
          vendor_id: parseInt(vendor_id),
          transaction_date: Math.floor(invoiceDate),
          transaction_type: 'PAYMENT',
          reference_type: 'purchase',
          reference_id: purchase.id,
          reference_no: purchase.invoice_no.toString(),
          debit: 0,
          credit: calculatedGrandTotal,
          payment_mode: payment_mode,
          payment_status: 1,
          payment_date: Math.floor(invoiceDate),
          notes: advanceBalance > 0 
            ? `Payment for purchase ${purchase.invoice_no} (₹${advanceBalance >= calculatedGrandTotal ? calculatedGrandTotal : advanceBalance} from advance${advanceBalance < calculatedGrandTotal ? `, ₹${calculatedGrandTotal - advanceBalance} new payment` : ''})`
            : `Payment made for purchase ${purchase.invoice_no}`,
          fy: currentFy
        }, tx);

        // Create payment allocation records
        const payment = await tx.vendor_payments.create({
          data: {
            vendor_id: parseInt(vendor_id),
            payment_date: Math.floor(invoiceDate),
            payment_amount: calculatedGrandTotal,
            payment_mode: payment_mode,
            payment_type: 'BILL_SPECIFIC',
            notes: advanceBalance > 0
              ? `Payment for purchase ${purchase.invoice_no} (using ₹${Math.min(advanceBalance, calculatedGrandTotal)} advance)`
              : `Payment for purchase ${purchase.invoice_no}`,
            fy: currentFy
          }
        });

        await tx.payment_allocations.create({
          data: {
            payment_id: payment.id,
            purchase_id: purchase.id,
            allocated_amount: calculatedGrandTotal,
            allocation_date: Math.floor(invoiceDate),
            notes: 'Allocated during purchase creation'
          }
        });

        // ✅ UPDATE VENDOR BALANCE (skips vendor_id = 0 automatically)
        if (balanceOp) {
          await balanceHandler.incrementBalanceInTransaction(tx, balanceOp.vendorId, balanceOp.update);
        }
      }

      return purchase;
    }, { timeout: 45000 });

    // No operations outside transaction - everything is atomic!

    const totalTime = Date.now() - startTime;

    res.status(201).json({
      message: 'Purchase created successfully',
      purchase: {
        id: purchase.id,
        invoice_no: purchase.invoice_no,
        total: purchase.total,
        vendor_name: existingVendor?.vendor_name || req.body.vendor_name || 'Other'
      }
    })

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`Purchase creation failed after ${totalTime}ms:`, error);
    res.status(500).json({
      message: 'Failed to create purchase',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}





export default withObservability(handler)
