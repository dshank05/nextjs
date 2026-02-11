import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { generateNoteNumber } from '../../../lib/note-counter'
import { recordReturnTransaction } from '../../../lib/customer-ledger-service'
import { parseDateRange, convertDateToTimestamp } from '../../../lib/date-utils'

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
      customer = '',
      status = '',
      dateFrom = '',
      dateTo = '',
      amountMin = '',
      amountMax = '',
      fy = '',
      sortBy = 'return_date',
      sortOrder = 'desc'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Search filter - search across return_no, customer_name, notes
    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      const searchNum = parseInt(searchStr);
      where.OR = [
        !isNaN(searchNum) ? { id: searchNum } : undefined,
        { notes: { contains: searchStr } },
      ].filter(Boolean) // Remove undefined values
    }

    // Financial year filter
    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    // Status filter
    if (status && status !== '') {
      where.status = status as string
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
        const { startTimestamp, endTimestamp } = parseDateRange(
          dateFrom as string,
          dateTo as string
        );

        where.return_date = {
          gte: startTimestamp,
          lte: endTimestamp
        };
      } catch (error) {
        console.warn('Error parsing filter dates:', error);
      }
    }

    // Validate and set sort parameters
    const validSortFields = ['id', 'return_date', 'total_amount', 'total_tax', 'status', 'fy', 'customer_name']
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'return_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // For customer_name sorting, we need to fetch all data first and sort in JavaScript
    const needsPostSorting = sortField === 'customer_name'

    // Fetch from both sale_returns and salex_returns tables
    const [saleReturns, salexReturns] = await Promise.all([
      needsPostSorting
        ? prisma.sale_returns.findMany({
            where,
            select: {
              id: true,
              invoice_id: true,
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
          })
        : prisma.sale_returns.findMany({
            where,
            skip: needsPostSorting ? undefined : skip,
            take: needsPostSorting ? undefined : limitNum,
            orderBy: needsPostSorting ? undefined : { [sortField]: sortDirection },
            select: {
              id: true,
              invoice_id: true,
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
      needsPostSorting
        ? prisma.salex_returns.findMany({
            where,
            select: {
              id: true,
              invoicex_id: true,
              return_date: true,
              total_amount: true,
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
          })
        : prisma.salex_returns.findMany({
            where,
            skip: needsPostSorting ? undefined : skip,
            take: needsPostSorting ? undefined : limitNum,
            orderBy: needsPostSorting ? undefined : { [sortField]: sortDirection },
            select: {
              id: true,
              invoicex_id: true,
              return_date: true,
              total_amount: true,
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
          })
    ])

    // Mark returns with their type
    const returns = [
      ...saleReturns.map(r => ({ ...r, invoice_type: 'invoice' as const, total_tax: r.total_tax || 0 })),
      ...salexReturns.map(r => ({ ...r, invoice_type: 'invoicex' as const, invoice_id: r.invoicex_id, total_tax: 0 }))
    ]

    const total = returns.length

    // Get customer info and item counts
    const invoiceIds = Array.from(new Set(saleReturns.map(r => r.invoice_id).filter(Boolean)))
    const invoicexIds = Array.from(new Set(salexReturns.map(r => r.invoicex_id).filter(Boolean)))
    const saleReturnIds = saleReturns.map(r => r.id)
    const salexReturnIds = salexReturns.map(r => r.id)

    // Get invoice and customer details
    const [invoiceData, invoicexData, saleItemCounts, salexItemCounts] = await Promise.all([
      // Get invoice details
      invoiceIds.length > 0 ? prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
          id: true,
          invoice_no: true,
          select_customer: true
        }
      }) : Promise.resolve([]),

      // Get invoicex details
      invoicexIds.length > 0 ? prisma.invoicex.findMany({
        where: { id: { in: invoicexIds } },
        select: {
          id: true,
          invoice_no: true,
          select_customer: true
        }
      }) : Promise.resolve([]),

      // Get item counts for sale returns
      saleReturnIds.length > 0 ? prisma.sale_return_items.groupBy({
        by: ['sale_return_id'],
        where: { sale_return_id: { in: saleReturnIds } },
        _count: { id: true }
      }) : Promise.resolve([]),

      // Get item counts for salex returns
      salexReturnIds.length > 0 ? prisma.salex_return_items.groupBy({
        by: ['salex_return_id'],
        where: { salex_return_id: { in: salexReturnIds } },
        _count: { id: true }
      }) : Promise.resolve([])
    ])

    // Get customer IDs from both invoice types
    const customerIds = Array.from(new Set([
      ...invoiceData.map(inv => inv.select_customer),
      ...invoicexData.map(inv => inv.select_customer)
    ].filter(Boolean)))

    // Get customer details
    const customerData = customerIds.length > 0 ? await prisma.customer_details.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        billing_name: true,
        billing_gstin: true
      }
    }) : []

    // Create lookup maps
    const invoiceMap = new Map(invoiceData.map(inv => [inv.id, inv]))
    const invoicexMap = new Map(invoicexData.map(inv => [inv.id, inv]))
    const customerMap = new Map(customerData.map(cust => [cust.id, cust]))
    const saleItemCountMap = new Map(saleItemCounts.map(ic => [ic.sale_return_id, ic._count.id]))
    const salexItemCountMap = new Map(salexItemCounts.map(ic => [ic.salex_return_id, ic._count.id]))

    // Enhanced returns with customer info
    let enhancedReturns = returns.map((returnRecord) => {
      const isInvoicex = returnRecord.invoice_type === 'invoicex'
      const invoice = isInvoicex ? invoicexMap.get(returnRecord.invoice_id) : invoiceMap.get(returnRecord.invoice_id)

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

      const returnPrefix = isInvoicex ? 'SXR' : 'SR'
      const itemCount = isInvoicex ? salexItemCountMap.get(returnRecord.id) || 0 : saleItemCountMap.get(returnRecord.id) || 0

      return {
        id: returnRecord.id,
        invoice_id: returnRecord.invoice_id,
        invoice_type: returnRecord.invoice_type,
        return_no: `${returnPrefix}-${String(returnRecord.id).padStart(3, '0')}`,
        customer_name: invoice ? customerMap.get(invoice.select_customer)?.billing_name || 'Unknown Customer' : 'Unknown Customer',
        customer_gstin: invoice ? customerMap.get(invoice.select_customer)?.billing_gstin || '' : '',
        invoice_no: invoice?.invoice_no?.toString() || 'N/A',
        total_amount: returnRecord.total_amount || 0,
        total_tax: returnRecord.total_tax || 0,
        refund_amount: returnRecord.refund_amount || (returnRecord.total_amount + returnRecord.total_tax),
        status: returnRecord.status || 'Completed',
        payment_status: returnRecord.payment_status ?? 0,
        payment_mode: returnRecord.payment_mode ?? 1,
        payment_date: returnRecord.payment_date,
        return_date: returnRecord.return_date,
        formattedDate: formattedDate,
        item_count: itemCount,
        notes: returnRecord.notes || '',
        fy: returnRecord.fy,
        created_at: returnRecord.created_at,
        updated_at: returnRecord.updated_at
      }
    })

    // Apply customer filter (after data enhancement)
    if (customer && customer !== '') {
      const customerStr = Array.isArray(customer) ? customer[0] : customer;
      const customerNum = parseInt(customerStr);

      // If it's a number, filter by customer_id, otherwise by customer_name
      if (!isNaN(customerNum)) {
        // Filter by customer ID through invoice (check both types)
        enhancedReturns = enhancedReturns.filter(ret => {
          const invoice = ret.invoice_type === 'invoicex'
            ? invoicexData.find(inv => inv.id === ret.invoice_id)
            : invoiceData.find(inv => inv.id === ret.invoice_id);
          return invoice && invoice.select_customer === customerNum;
        });
      } else {
        // Filter by customer name
        enhancedReturns = enhancedReturns.filter(ret =>
          ret.customer_name.toLowerCase().includes(customerStr.toLowerCase())
        );
      }
    }

    // Apply post-sorting for customer_name if needed
    if (needsPostSorting) {
      enhancedReturns.sort((a, b) => {
        const aValue = (a.customer_name || '').toString().toLowerCase()
        const bValue = (b.customer_name || '').toString().toLowerCase()

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
        return 0
      })

      // Apply pagination after sorting
      enhancedReturns = enhancedReturns.slice(skip, skip + limitNum)
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
    console.error('Sale returns fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch sale returns data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      invoice_id,
      invoicex_id,
      invoice_type, // 'invoice' or 'invoicex'
      return_date,
      return_notes,
      payment_status, // 0=Unpaid/Pending Refund, 1=Paid/Refunded (optional, defaults to 0)
      payment_mode,   // 0=Cash, 1=Bank (optional, defaults to 1)
      payment_date,   // Unix timestamp (optional)
      items // Array of { invoice_item_id, return_qty, return_reason_id, unit_price, tax_rate?, notes? }
    } = req.body

    // Determine invoice type
    const isInvoicex = invoicex_id || invoice_type === 'invoicex'
    const invoiceIdValue = isInvoicex ? invoicex_id : invoice_id

    // Validation
    if (!invoiceIdValue || !items || items.length === 0) {
      return res.status(400).json({
        message: 'Invoice ID and items are required'
      })
    }

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert return date to Unix timestamp
    const returnDateTimestamp = return_date ? convertDateToTimestamp(return_date) : Math.floor(Date.now() / 1000)

    // Get invoice details based on type
    const invoice = isInvoicex
      ? await prisma.invoicex.findUnique({
          where: { id: parseInt(invoiceIdValue) },
          select: {
            id: true,
            invoice_no: true,
            select_customer: true,
            invoice_date: true,
            fy: true
          }
        })
      : await prisma.invoice.findUnique({
          where: { id: parseInt(invoiceIdValue) },
          select: {
            id: true,
            invoice_no: true,
            select_customer: true,
            invoice_date: true,
            fy: true
          }
        })

    if (!invoice) {
      return res.status(400).json({
        message: `Invalid ${isInvoicex ? 'invoicex' : 'invoice'} selected - invoice does not exist`
      })
    }

    // Get customer details for tax calculations
    const customer = invoice.select_customer ? await prisma.customer_details.findUnique({
      where: { id: invoice.select_customer },
      select: { billing_state_code: true }
    }) : null

    // Calculate totals
    let totalAmount = 0
    let totalTax = 0

    // Process items and calculate totals
    const processedItems = []
    for (const item of items) {
      const subtotal = item.return_qty * item.unit_price
      const taxAmount = isInvoicex ? 0 : ((subtotal * (item.tax_rate || 0)) / 100)

      totalAmount += subtotal
      totalTax += taxAmount

      processedItems.push({
        invoice_item_id: parseInt(item.invoice_item_id),
        return_qty: item.return_qty,
        return_reason_id: parseInt(item.return_reason_id),
        unit_price: item.unit_price,
        tax_amount: taxAmount,
        notes: item.notes || ''
      })
    }

    // Generate credit note number (outside transaction)
    const creditNoteNo = await generateNoteNumber('CREDIT', financialYear)

    // Process payment tracking fields (before transaction)
    const paymentStatusValue = payment_status !== undefined ? parseInt(payment_status) : 0 // Default: Unpaid
    const paymentModeValue = payment_mode !== undefined ? parseInt(payment_mode) : 1 // Default: Bank
    const paymentDateValue = payment_date ? parseInt(payment_date) : null

    // Calculate refund amount (before transaction for use in ledger entry)
    const refundAmount = totalAmount + totalTax

    // Use database transaction with increased timeout for return processing
    const result = await prisma.$transaction(async (tx) => {
      // Get affected invoice items based on type
      const invoiceItemIds = items.map((item: any) => parseInt(item.invoice_item_id))
      const invoiceItems = isInvoicex
        ? await tx.invoice_itemsx.findMany({
            where: { id: { in: invoiceItemIds } },
            select: { id: true, product_id: true, qty: true }
          })
        : await tx.invoiceitems.findMany({
            where: { id: { in: invoiceItemIds } },
            select: { id: true, product_id: true, qty: true }
          })

      // Create the main return record based on type
      const returnRecord = isInvoicex
        ? await tx.salex_returns.create({
            data: {
              invoicex_id: parseInt(invoiceIdValue),
              return_date: returnDateTimestamp,
              total_amount: totalAmount,
              status: 'Completed',
              notes: return_notes || '',
              fy: financialYear,
              payment_status: paymentStatusValue,
              payment_mode: paymentModeValue,
              payment_date: paymentDateValue,
              refund_amount: refundAmount
            }
          })
        : await tx.sale_returns.create({
            data: {
              invoice_id: parseInt(invoiceIdValue),
              return_date: returnDateTimestamp,
              total_amount: totalAmount,
              total_tax: totalTax,
              status: 'Completed',
              notes: return_notes || '',
              fy: financialYear,
              payment_status: paymentStatusValue,
              payment_mode: paymentModeValue,
              payment_date: paymentDateValue,
              refund_amount: refundAmount
            }
          })

      // Create return items and update product stock based on type
      for (const item of processedItems) {
        // Create return item record
        if (isInvoicex) {
          await tx.salex_return_items.create({
            data: {
              salex_return_id: returnRecord.id,
              invoice_itemx_id: item.invoice_item_id,
              return_qty: item.return_qty,
              return_reason_id: item.return_reason_id,
              unit_price: item.unit_price,
              notes: item.notes
            }
          })
        } else {
          await tx.sale_return_items.create({
            data: {
              sale_return_id: returnRecord.id,
              invoice_item_id: item.invoice_item_id,
              return_qty: item.return_qty,
              return_reason_id: item.return_reason_id,
              unit_price: item.unit_price,
              tax_amount: item.tax_amount,
              notes: item.notes
            }
          })
        }

        // Update product stock (INCREASE stock since we're returning items to inventory)
        const invoiceItem = invoiceItems.find(ii => ii.id === item.invoice_item_id)
        if (invoiceItem?.product_id) {
          await tx.product.update({
            where: { id: invoiceItem.product_id },
            data: {
              stock: {
                increment: item.return_qty
              }
            }
          })
        }
      }

      // Update return_status for the invoice based on type
      if (isInvoicex) {
        // Get all items for this invoicex
        const allInvoiceItems = await tx.invoice_itemsx.findMany({
          where: { invoice_no: invoice.invoice_no },
          select: { id: true, qty: true }
        })

        // Get all returns for these items
        const allReturns = await tx.salex_return_items.findMany({
          where: { invoice_itemx_id: { in: allInvoiceItems.map(ii => ii.id) } },
          select: { invoice_itemx_id: true, return_qty: true }
        })

        // Calculate return status
        const returnMap = new Map()
        allReturns.forEach(r => {
          const existing = returnMap.get(r.invoice_itemx_id) || { qty: 0 }
          existing.qty += r.return_qty
          returnMap.set(r.invoice_itemx_id, existing)
        })

        let fullyReturnedCount = 0
        let hasAnyReturns = false
        for (const item of allInvoiceItems) {
          const returnData = returnMap.get(item.id)
          if (returnData && returnData.qty > 0) {
            hasAnyReturns = true
            if (returnData.qty >= (item.qty || 0)) {
              fullyReturnedCount++
            }
          }
        }

        const returnStatus = !hasAnyReturns ? 0 : (fullyReturnedCount === allInvoiceItems.length ? 2 : 1)

        await tx.invoicex.update({
          where: { id: parseInt(invoiceIdValue) },
          data: { return_status: returnStatus }
        })
      } else {
        // Get all items for this invoice
        const allInvoiceItems = await tx.invoiceitems.findMany({
          where: { invoice_no: invoice.invoice_no },
          select: { id: true, qty: true }
        })

        // Get all returns for these items
        const allReturns = await tx.sale_return_items.findMany({
          where: { invoice_item_id: { in: allInvoiceItems.map(ii => ii.id) } },
          select: { invoice_item_id: true, return_qty: true }
        })

        // Calculate return status
        const returnMap = new Map()
        allReturns.forEach(r => {
          const existing = returnMap.get(r.invoice_item_id) || { qty: 0 }
          existing.qty += r.return_qty
          returnMap.set(r.invoice_item_id, existing)
        })

        let fullyReturnedCount = 0
        let hasAnyReturns = false
        for (const item of allInvoiceItems) {
          const returnData = returnMap.get(item.id)
          if (returnData && returnData.qty > 0) {
            hasAnyReturns = true
            if (returnData.qty >= (item.qty || 0)) {
              fullyReturnedCount++
            }
          }
        }

        const returnStatus = !hasAnyReturns ? 0 : (fullyReturnedCount === allInvoiceItems.length ? 2 : 1)

        await tx.invoice.update({
          where: { id: parseInt(invoiceIdValue) },
          data: { return_status: returnStatus }
        })
      }

      return returnRecord
    }, {
      timeout: 15000 // 15 seconds timeout for complex return processing
    })

    // Create customer ledger entry for credit note (outside transaction)
    try {
      if (isInvoicex) {
        const { recordSalexReturnTransaction, recordRefundPaidTransaction } = await import('../../../lib/customer-ledger-service')
        
        await recordSalexReturnTransaction(
          invoice.select_customer,
          result.id,
          `SXR-${String(result.id).padStart(3, '0')}`,
          refundAmount,
          returnDateTimestamp,
          financialYear,
          return_notes || `Return for salex invoice ${invoice.invoice_no}`
        )

        // If refunded immediately, create refund ledger entry
        if (paymentStatusValue === 1) {
          await recordRefundPaidTransaction(
            invoice.select_customer,
            result.id,
            `REF-${String(result.id).padStart(3, '0')}`,
            refundAmount,
            returnDateTimestamp,
            paymentModeValue,
            financialYear,
            `Refund for salex return SXR-${result.id}`
          )
        }
      } else {
        const { recordReturnTransaction, recordRefundPaidTransaction } = await import('../../../lib/customer-ledger-service')
        
        await recordReturnTransaction(
          invoice.select_customer,
          result.id,
          `SR-${String(result.id).padStart(3, '0')}`,
          refundAmount,
          returnDateTimestamp,
          financialYear,
          return_notes || `Return for invoice ${invoice.invoice_no}`
        )

        // If refunded immediately, create refund ledger entry
        if (paymentStatusValue === 1) {
          await recordRefundPaidTransaction(
            invoice.select_customer,
            result.id,
            `REF-${String(result.id).padStart(3, '0')}`,
            refundAmount,
            returnDateTimestamp,
            paymentModeValue,
            financialYear,
            `Refund for return SR-${result.id}`
          )
        }
      }
    } catch (ledgerError) {
      console.error('Failed to create customer ledger entry:', ledgerError)
      // Don't fail the return if ledger entry fails
    }

    const returnPrefix = isInvoicex ? 'SXR' : 'SR'
    res.status(201).json({
      success: true,
      message: 'Return processed successfully',
      data: {
        return: {
          id: result.id,
          credit_note_no: creditNoteNo,
          return_no: `${returnPrefix}-${String(result.id).padStart(3, '0')}`,
          total_amount: totalAmount,
          total_tax: totalTax,
          refund_amount: refundAmount,
          status: 'Completed',
          payment_status: result.payment_status,
          payment_mode: result.payment_mode,
          payment_date: result.payment_date,
          invoice_type: isInvoicex ? 'invoicex' : 'invoice'
        }
      }
    })

  } catch (error) {
    console.error('Sale return processing error:', error)
    res.status(500).json({
      message: 'Failed to process return',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
