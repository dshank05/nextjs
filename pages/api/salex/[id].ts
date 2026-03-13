import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { convertDateToTimestamp } from '../../../lib/date-utils'
import { withObservability } from '../../../lib/withObservability'
import { customerTransactionHandler } from '../../../lib/customer-transaction-handler'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions)

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { id } = req.query

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Invalid salex ID' })
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, id)
    case 'PUT':
      return handlePut(req, res, id)
    case 'DELETE':
      return handleDelete(req, res, id)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

/**
 * GET /api/salex/[id]
 * Get a single salex by ID
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse, salexId: string) {
  try {
    const salex = await prisma.invoicex.findUnique({
      where: { id: parseInt(salexId) }
    })

    if (!salex) {
      return res.status(404).json({ message: 'Salex not found' })
    }

    const [customerData, staffData, mechanicData, returnData, billToData, transportDetails, salexItems] = await Promise.all([
      salex.select_customer && salex.select_customer !== 0 ?
        prisma.customer_details.findUnique({
          where: { id: salex.select_customer },
          select: { id: true, billing_name: true, billing_gstin: true }
        }) : Promise.resolve(null),

      salex.staff_id ?
        prisma.staff.findUnique({
          where: { id: salex.staff_id },
          select: { id: true, name: true }
        }) : Promise.resolve(null),

      salex.mechanic_id ?
        prisma.mechanic.findUnique({
          where: { id: salex.mechanic_id },
          select: { id: true, name: true }
        }) : Promise.resolve(null),

      prisma.salex_returns.findMany({
        where: { invoicex_id: salex.id },
        select: {
          id: true,
          return_date: true,
          total_amount: true,
          status: true
        }
      }),

      // Fetch customer data from bill_tosalesx table (manual entry)
      prisma.bill_tosalesx.findFirst({
        where: { invoice_no: salex.id },
        select: {
          billing_name: true,
          contact_no: true,
          email: true,
          billing_address: true,
          billing_address2: true,
          billing_city: true,
          billing_state: true,
          billing_state_code: true,
          billing_gstin: true
        }
      }),

      // Fetch transport details
      prisma.transport_detailsx.findFirst({
        where: { invoice_id: salex.id }
      }),

      // Fetch salex items
      prisma.invoice_itemsx.findMany({
        where: { invoice_no: salex.id },
        include: {
          product: {
            select: {
              display_name: true
            }
          }
        }
      })
    ])

    // Get return status for each salex item
    const salexItemIds = salexItems.map(item => item.id)
    const returnItems = await prisma.salex_return_items.findMany({
      where: { invoice_itemx_id: { in: salexItemIds } },
      include: {
        salex_return: {
          select: {
            id: true,
            return_date: true,
            status: true
          }
        }
      }
    })

    // Group return items by invoice_itemx_id and calculate totals
    const returnSummaryMap = new Map<number, {
      returned_qty: number
      return_history: Array<{
        return_id: string
        return_no: string
        qty: number
        date: number
        unit_price: number
        reason_id: number
        notes: string
      }>
    }>()

    returnItems.forEach(returnItem => {
      const itemId = returnItem.invoice_itemx_id
      const existing = returnSummaryMap.get(itemId) || { returned_qty: 0, return_history: [] }

      existing.returned_qty += returnItem.return_qty
      existing.return_history.push({
        return_id: returnItem.salex_return.id.toString(),
        return_no: `SXR-${returnItem.salex_return.id.toString().padStart(3, '0')}`,
        qty: returnItem.return_qty,
        date: returnItem.salex_return.return_date,
        unit_price: returnItem.unit_price,
        reason_id: returnItem.return_reason_id,
        notes: returnItem.notes || ''
      })

      returnSummaryMap.set(itemId, existing)
    })

    // Calculate return status for items
    let fullyReturnedItems = 0
    const itemsWithReturnStatus = salexItems.map(item => {
      const returnData = returnSummaryMap.get(item.id) || { returned_qty: 0, return_history: [] }
      const originalQty = item.qty || 0
      const returnedQty = returnData.returned_qty
      const availableQty = Math.max(0, originalQty - returnedQty)
      const isFullyReturned = returnedQty >= originalQty

      if (isFullyReturned) {
        fullyReturnedItems++
      }

      return {
        id: item.id,
        product_id: item.product_id,
        name_of_product: item.product?.display_name || item.name_of_product,
        display_name: item.product?.display_name || item.name_of_product,
        qty: item.qty,
        rate: item.rate,
        subtotal: item.subtotal,
        discount: item.discount || 0,
        discountrate: item.discountrate || 0,
        hsn: item.hsn || '',
        part: item.part,
        category_id: item.category_id,
        subcategory_id: item.subcategory_id,
        model_id: item.model_id,
        company_id: item.company_id,
        invoice_date: item.invoice_date,
        fy: item.fy,
        // Return status fields
        original_qty: originalQty,
        returned_qty: returnedQty,
        available_qty: availableQty,
        is_fully_returned: isFullyReturned,
        return_history: returnData.return_history
      }
    })

    // Calculate overall salex return status
    const hasReturns = fullyReturnedItems > 0 || returnItems.length > 0
    const isFullyReturned = fullyReturnedItems === salexItems.length
    const returnStatus = isFullyReturned ? 'FULLY_RETURNED' :
                       hasReturns ? 'PARTIAL_RETURN' : 'NO_RETURNS'

    // Get return transaction details
    const uniqueReturnIds = new Set<number>()
    returnItems.forEach(item => {
      uniqueReturnIds.add(item.salex_return.id)
    })

    const returnTransactions = await prisma.salex_returns.findMany({
      where: { id: { in: Array.from(uniqueReturnIds) } },
      select: {
        id: true,
        return_date: true,
        total_amount: true,
        refund_amount: true,
        payment_status: true,
        payment_mode: true,
        payment_date: true,
        notes: true
      }
    })

    // Build return transactions with items
    const returns = returnTransactions.map(ret => {
      const retItems = returnItems
        .filter(item => item.salex_return.id === ret.id)
        .map(item => {
          const salexItem = salexItems.find(si => si.id === item.invoice_itemx_id)
          return {
            id: item.id,
            invoice_itemx_id: item.invoice_itemx_id,
            product_name: salexItem?.product?.display_name || salexItem?.name_of_product || 'Unknown',
            return_qty: item.return_qty,
            unit_price: item.unit_price,
            subtotal: item.return_qty * item.unit_price,
            total: item.return_qty * item.unit_price,
            return_reason_id: item.return_reason_id,
            notes: item.notes
          }
        })

      return {
        id: ret.id,
        return_no: `SXR-${ret.id.toString().padStart(3, '0')}`,
        return_date: ret.return_date,
        total_amount: ret.total_amount,
        refund_amount: ret.refund_amount,
        payment_status: ret.payment_status,
        payment_mode: ret.payment_mode,
        payment_date: ret.payment_date,
        notes: ret.notes,
        items: retItems,
        item_count: retItems.length,
        total_qty: retItems.reduce((sum, item) => sum + item.return_qty, 0)
      }
    })

    const itemCount = await prisma.invoice_itemsx.count({
      where: { invoice_no: salex.id }
    })

    let formattedDate: string | null = null
    try {
      if (salex.invoice_date) {
        const dateObj = new Date(salex.invoice_date * 1000)
        if (!isNaN(dateObj.getTime())) {
          formattedDate = dateObj.toLocaleDateString('en-IN')
        }
      }
    } catch (error) {
      console.warn('Invalid date format for salex:', salex.invoice_date, error)
    }

    const totalAllocated = 0

    // Get payment allocation history
    const paymentAllocations = await prisma.customer_payment_allocations.findMany({
      where: { invoicex_id: parseInt(salexId) },
      include: {
        payment: {
          select: {
            id: true,
            payment_date: true,
            payment_amount: true,
            payment_mode: true,
            payment_type: true,
            notes: true,
            created_at: true
          }
        }
      },
      orderBy: {
        allocation_date: 'desc'
      }
    })

    // Calculate payment summary
    const totalPaid = paymentAllocations.reduce(
      (sum, alloc) => sum + Number(alloc.allocated_amount),
      0
    )
    const remainingAmount = salex.total - totalPaid

    // Format payment history
    const paymentHistory = paymentAllocations.map(alloc => ({
      allocation_id: alloc.id,
      payment_id: alloc.payment_id,
      allocated_amount: Number(alloc.allocated_amount),
      allocation_date: alloc.allocation_date,
      allocation_notes: alloc.notes,
      payment_date: alloc.payment.payment_date,
      payment_amount: Number(alloc.payment.payment_amount),
      payment_mode: alloc.payment.payment_mode,
      payment_mode_text: alloc.payment.payment_mode === 0 ? 'Cash' : 'Bank',
      payment_type: alloc.payment.payment_type,
      payment_notes: alloc.payment.notes,
      created_at: alloc.payment.created_at
    }))

    const enhancedSalex = {
      id: salex.id,
      invoice_no: salex.invoice_no,
      select_customer: salex.select_customer,
      customer_id: salex.select_customer,
      customer_name: billToData?.billing_name || customerData?.billing_name || '',
      contact_number: billToData?.contact_no || '',
      email_id: billToData?.email || '',
      address: billToData?.billing_address || '',
      address_2: billToData?.billing_address2 || '',
      city: billToData?.billing_city || '',
      state: billToData?.billing_state || '',
      state_code: billToData?.billing_state_code || undefined,
      pin_code: '', // Not stored in bill_tosalesx
      gst_number: billToData?.billing_gstin || '',
      customer_gstin: billToData?.billing_gstin || customerData?.billing_gstin || '',
      // Transport details
      vehicle_number: transportDetails?.vehicle_no || '',
      transport_name: transportDetails?.trans_mode || '',
      invoice_date: salex.invoice_date,
      date: salex.invoice_date,
      formattedDate: formattedDate,
      items_total: salex.items_total,
      freight: salex.freight,
      total_taxable_value: salex.total_taxable_value,
      total_tax: salex.total_tax,
      subtotal: salex.items_total,
      total: salex.total,
      notes: salex.notes,
      descriptions: salex.descriptions,
      payment_status: salex.payment_status !== null && salex.payment_status !== undefined ? salex.payment_status : 0,
      payment_mode: salex.payment_mode !== null && salex.payment_mode !== undefined ? salex.payment_mode : 0,
      fy: salex.fy,
      staff_id: salex.staff_id,
      staff_name: staffData?.name,
      staff_details: staffData?.name || '',
      mechanic_id: salex.mechanic_id,
      mechanic_name: mechanicData?.name,
      bill_reference: salex.bill_reference,
      discount: salex.discount,
      commission: salex.commission || 0,
      packing_forwarding_qty: salex.packing_forwarding_qty !== null && salex.packing_forwarding_qty !== undefined ? salex.packing_forwarding_qty : 0,
      packing_forwarding_rate: salex.packing_forwarding_rate !== null && salex.packing_forwarding_rate !== undefined ? salex.packing_forwarding_rate : 0,
      packing_forwarding_total: salex.packing_forwarding_total !== null && salex.packing_forwarding_total !== undefined ? salex.packing_forwarding_total : 0,
      item_count: itemCount,
      return_count: returns.length,
      total_allocated: totalAllocated,
      outstanding_amount: salex.total - totalAllocated,
      created_at: salex.updated_at,
      updated_at: salex.updated_at,
      // Return status
      return_status: {
        has_returns: hasReturns,
        fully_returned_items: fullyReturnedItems,
        total_items: salexItems.length,
        is_fully_returned: isFullyReturned,
        status: returnStatus
      },
      returns: returns,
      // Items array
      items: itemsWithReturnStatus,
      invoiceItems: itemsWithReturnStatus,
      // Complete customer object for dropdown selection
      customer: customerData ? {
        ...customerData,
        id: customerData.id.toString(), // Convert to string for frontend
        billing_name: customerData.billing_name,
        billing_gstin: customerData.billing_gstin
      } : (billToData ? {
        id: '0',
        billing_name: billToData.billing_name,
        billing_address: billToData.billing_address || '',
        billing_address_2: billToData.billing_address2 || '',
        billing_city: billToData.billing_city || '',
        billing_state: billToData.billing_state || '',
        billing_state_code: billToData.billing_state_code || null,
        billing_gstin: billToData.billing_gstin || '',
        billing_pin_code: '', // Not stored in bill_tosalesx
        contact_no: billToData.contact_no || '',
        email: billToData.email || ''
      } : null),
      billingDetails: salex.select_customer === 0 ? {
        customer_name: billToData?.billing_name || '',
        contact_number: billToData?.contact_no || '',
        email_id: billToData?.email || '',
        address: billToData?.billing_address || '',
        address_2: billToData?.billing_address2 || '',
        city: billToData?.billing_city || '',
        state: billToData?.billing_state || '',
        gst_number: billToData?.billing_gstin || '',
        billing_pin_code: ''
      } : null,
      staff: staffData,
      mechanic: mechanicData,
      transportDetails: {
        trans_mode: transportDetails?.trans_mode || '',
        vehicle_no: transportDetails?.vehicle_no || ''
      },
      // Payment allocation summary and history
      payment_summary: {
        total_bill: salex.total,
        total_paid: totalPaid,
        remaining_amount: remainingAmount,
        payment_count: paymentAllocations.length,
        is_fully_paid: totalPaid >= salex.total,
        is_partially_paid: totalPaid > 0 && totalPaid < salex.total
      },
      payment_history: paymentHistory
    }

    res.status(200).json(enhancedSalex)
  } catch (error) {
    console.error('Salex fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch salex',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * PUT /api/salex/[id]
 * Update a salex
 * ✅ REFACTORED: Uses customer transaction handler for complex edits
 */
async function handlePut(req: NextApiRequest, res: NextApiResponse, salexId: string) {
  try {
    const {
      invoice_no,
      invoice_number,
      invoice_date,
      date,
      bill_reference,
      staff_id,
      mechanic_id,
      commission,
      select_customer,
      customer_id,
      transport_cost,
      items,
      invoiceItems,
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
      payment_mode,
      transportDetails
    } = req.body

    // Use invoice_no if provided, otherwise fall back to invoice_number
    const invoiceNumber = invoice_no || invoice_number
    
    // Use invoice_date if provided, otherwise fall back to date
    const dateValue = invoice_date || date
    
    // Use invoiceItems if provided, otherwise fall back to items
    const itemsArray = invoiceItems || items
    
    // Use select_customer if provided, otherwise fall back to customer_id
    const customerIdToUse = select_customer !== undefined ? select_customer : customer_id

    // Validation
    if (!req.body.customer_name || !req.body.contact_number || !req.body.state) {
      return res.status(400).json({
        message: 'Customer name, contact number, and state are required'
      })
    }

    const existingSalex = await prisma.invoicex.findUnique({
      where: { id: parseInt(salexId) }
    })

    if (!existingSalex) {
      return res.status(404).json({ message: 'Salex not found' })
    }

    // Validate payment fields
    const validPaymentStatuses = [0, 1, 2]
    const validPaymentModes = [0, 1]

    const parsedPaymentStatus = payment_status !== undefined && payment_status !== null
      ? parseInt(payment_status.toString())
      : existingSalex.payment_status

    const parsedPaymentMode = payment_mode !== undefined && payment_mode !== null
      ? parseInt(payment_mode.toString())
      : existingSalex.payment_mode

    if (!validPaymentStatuses.includes(parsedPaymentStatus)) {
      return res.status(400).json({
        message: 'Invalid payment_status: must be 0 (Unpaid), 1 (Partial), or 2 (Paid)'
      })
    }

    if (!validPaymentModes.includes(parsedPaymentMode)) {
      return res.status(400).json({
        message: 'Invalid payment_mode: must be 0 (Cash) or 1 (Bank)'
      })
    }

    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    const invoiceDate = dateValue ? convertDateToTimestamp(dateValue) : existingSalex.invoice_date

    let itemsTotal = existingSalex.items_total
    let totalTaxable = existingSalex.total_taxable_value

    if (itemsArray && itemsArray.length > 0) {
      itemsTotal = itemsArray.reduce((sum, item) => sum + (item.qty * item.rate), 0)
      totalTaxable = itemsTotal
    }

    const calculatedGrandTotal = itemsTotal + (packing_forwarding_total || existingSalex.packing_forwarding_total || 0) + (transport_cost || existingSalex.freight || 0) + (total_tax || existingSalex.total_tax || 0)

    // Update salex record and items - ALL operations inside transaction
    const result = await prisma.$transaction(async (tx) => {
      // ✅ Use customer transaction handler for ALL edits (not just payment status changes)
      const oldPaymentStatus = existingSalex.payment_status
      const newPaymentStatus = parsedPaymentStatus

      if (existingSalex.select_customer && existingSalex.select_customer !== 0) {
        const operations = await customerTransactionHandler.handleSaleEdit({
          type: 'salex',
          oldStatus: oldPaymentStatus,
          newStatus: newPaymentStatus,
          oldTotal: Number(existingSalex.total),
          newTotal: calculatedGrandTotal,
          customerId: existingSalex.select_customer,
          invoiceId: parseInt(salexId),
          invoiceNo: existingSalex.invoice_no.toString(),
          paymentMode: parsedPaymentMode,
          paymentDate: Math.floor(invoiceDate),
          fy: financialYear
        })

        // Execute handler operations inside same transaction
        await customerTransactionHandler.executeInTransaction(tx, operations)
      }

      // Update salex record
      const salexUpdateData: any = {
        select_customer: parseInt(customerIdToUse),
        bill_reference: bill_reference || existingSalex.bill_reference,
        commission: commission !== undefined ? commission : existingSalex.commission,
        items_total: itemsTotal,
        freight: transport_cost !== undefined ? transport_cost : existingSalex.freight,
        total_taxable_value: totalTaxable,
        total_cgst: total_cgst !== undefined ? total_cgst : existingSalex.total_cgst,
        total_sgst: total_sgst !== undefined ? total_sgst : existingSalex.total_sgst,
        total_igst: total_igst !== undefined ? total_igst : existingSalex.total_igst,
        total_tax: total_tax !== undefined ? total_tax : existingSalex.total_tax,
        total: calculatedGrandTotal,
        notes: notes !== undefined ? notes : existingSalex.notes,
        descriptions: descriptions !== undefined ? descriptions : existingSalex.descriptions,
        packing_forwarding_qty: packing_forwarding_qty !== undefined ? packing_forwarding_qty : existingSalex.packing_forwarding_qty,
        packing_forwarding_rate: packing_forwarding_rate !== undefined ? packing_forwarding_rate : existingSalex.packing_forwarding_rate,
        packing_forwarding_total: packing_forwarding_total !== undefined ? packing_forwarding_total : existingSalex.packing_forwarding_total,
        invoice_date: Math.floor(invoiceDate),
        payment_status: parsedPaymentStatus,
        payment_mode: parsedPaymentMode,
        fy: financialYear,
        updated_at: new Date().toISOString()
      }

      if (staff_id !== undefined) {
        salexUpdateData.staff_id = staff_id ? parseInt(staff_id) : null
      }

      if (mechanic_id !== undefined) {
        salexUpdateData.mechanic_id = mechanic_id ? parseInt(mechanic_id) : null
      }

      const salex = await tx.invoicex.update({
        where: { id: parseInt(salexId) },
        data: salexUpdateData
      })

      // Handle item updates
      if (itemsArray && itemsArray.length > 0) {
        const existingItems = await tx.invoice_itemsx.findMany({
          where: { invoice_no: salex.id }
        })

        const existingItemsMap = new Map<number, any>()
        const newItemsMap = new Map<number, any>()

        existingItems.forEach(item => {
          existingItemsMap.set(item.product_id, {
            id: item.id,
            qty: item.qty || 0,
            item: item
          })
        })

        itemsArray.forEach(item => {
          newItemsMap.set(parseInt(item.product_id), {
            qty: item.qty || 0,
            rate: item.rate || 0,
            product_id: parseInt(item.product_id),
            item: item
          })
        })

        // Process deletions
        for (const [productId, existingData] of Array.from(existingItemsMap.entries())) {
          if (!newItemsMap.has(productId)) {
            const validatedExistingQty = Number(existingData.qty) || 0
            if (validatedExistingQty > 0) {
              await tx.product.update({
                where: { id: productId },
                data: { stock: { increment: validatedExistingQty } }
              })
            }
            await tx.invoice_itemsx.delete({
              where: { id: existingData.id }
            })
          }
        }

        // Process additions and updates
        for (const [productId, newData] of Array.from(newItemsMap.entries())) {
          const existingData = existingItemsMap.get(productId)

          if (!existingData) {
            const product = await tx.product.findUnique({
              where: { id: productId },
              select: {
                product_name: true,
                hsn: true,
                product_category_id: true,
                product_subcategory_id: true,
                company_id: true,
                stock: true
              }
            })

            if (!product) {
              throw new Error(`Product with ID ${productId} not found`)
            }

            if (product.stock < newData.qty) {
              throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested ${newData.qty}`)
            }

            const modelId = newData.item.model_id ? parseInt(newData.item.model_id) : null

            await tx.invoice_itemsx.create({
              data: {
                invoice_no: salex.id,
                product_id: productId,
                name_of_product: newData.item.product_name || product.product_name || '',
                category_id: product.product_category_id,
                subcategory_id: product.product_subcategory_id,
                model_id: modelId,
                company_id: product.company_id,
                hsn: product.hsn,
                part: newData.item.part || '',
                qty: newData.qty,
                rate: newData.rate,
                subtotal: newData.qty * newData.rate,
                gst_percentage: newData.item.gst_percentage || 0,
                cgst: newData.item.cgst || 0,
                sgst: newData.item.sgst || 0,
                igst: newData.item.igst || 0,
                tax: newData.item.tax || 0,
                fy: financialYear,
                invoice_date: invoiceDate
              }
            })

            const validatedNewQty = Number(newData.qty) || 0
            await tx.product.update({
              where: { id: productId },
              data: { stock: { decrement: validatedNewQty } }
            })
          } else {
            const validatedNewQty = Number(newData.qty) || 0
            const validatedExistingQty = Number(existingData.qty) || 0
            const qtyDifference = validatedNewQty - validatedExistingQty

            if (Math.abs(qtyDifference) > 0.001) {
              if (qtyDifference > 0) {
                const product = await tx.product.findUnique({
                  where: { id: productId },
                  select: { stock: true, product_name: true }
                })

                if (product && product.stock < qtyDifference) {
                  throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested additional ${qtyDifference}`)
                }
              }

              await tx.invoice_itemsx.update({
                where: { id: existingData.id },
                data: {
                  qty: newData.qty,
                  rate: newData.rate,
                  subtotal: newData.qty * newData.rate
                }
              })

              await tx.product.update({
                where: { id: productId },
                data: { stock: { increment: -qtyDifference } }
              })
            }
          }
        }
      }

      // Update customer relationship records INSIDE transaction
      await tx.bill_tosalesx.upsert({
        where: { invoice_no: salex.id },
        update: {
          billing_name: req.body.customer_name,
          contact_no: req.body.contact_number || '',
          email: req.body.email_id || '',
          billing_address: req.body.address || '',
          billing_address2: req.body.address_2 || '',
          billing_city: req.body.city || '',
          billing_state: req.body.state || '',
          billing_state_code: req.body.state_code || null,
          billing_gstin: req.body.gst_number || ''
        },
        create: {
          invoice_no: salex.id,
          billing_name: req.body.customer_name,
          contact_no: req.body.contact_number || '',
          email: req.body.email_id || '',
          billing_address: req.body.address || '',
          billing_address2: req.body.address_2 || '',
          billing_city: req.body.city || '',
          billing_state: req.body.state || '',
          billing_state_code: req.body.state_code || null,
          billing_gstin: req.body.gst_number || ''
        }
      })

      await tx.shiptox.upsert({
        where: { invoice_no: salex.id },
        update: {
          shipping_name: req.body.customer_name,
          shipping_address: req.body.address || '',
          shipping_address2: req.body.address_2 || '',
          shipping_city: req.body.city || '',
          shipping_state: req.body.state || '',
          shipping_state_code: req.body.state_code || null,
          shipping_gstin: req.body.gst_number || ''
        },
        create: {
          invoice_no: salex.id,
          shipping_name: req.body.customer_name,
          shipping_address: req.body.address || '',
          shipping_address2: req.body.address_2 || '',
          shipping_city: req.body.city || '',
          shipping_state: req.body.state || '',
          shipping_state_code: req.body.state_code || null,
          shipping_gstin: req.body.gst_number || ''
        }
      })

      // Update transport details if provided
      if (transportDetails) {
        await tx.transport_detailsx.upsert({
          where: { invoice_id: salex.id },
          update: {
            trans_mode: transportDetails.trans_mode || '',
            vehicle_no: transportDetails.vehicle_no || ''
          },
          create: {
            invoice_id: salex.id,
            trans_mode: transportDetails.trans_mode || '',
            vehicle_no: transportDetails.vehicle_no || ''
          }
        })
      }

      return salex
    }, {
      timeout: 30000
    })

    res.status(200).json({
      message: 'Salex updated successfully',
      salex: {
        id: result.id,
        invoice_no: result.invoice_no,
        total: result.total,
        customer_name: req.body.customer_name
      }
    })

  } catch (error) {
    console.error('Salex update error:', error)
    res.status(500).json({
      message: 'Failed to update salex',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * DELETE /api/salex/[id]
 * Delete a salex
 * ✅ NEW: Uses customer transaction handler for safe deletion
 */
async function handleDelete(req: NextApiRequest, res: NextApiResponse, salexId: string) {
  try {
    const existingSalex = await prisma.invoicex.findUnique({
      where: { id: parseInt(salexId) },
      select: {
        id: true,
        invoice_no: true,
        select_customer: true,
        total: true,
        payment_status: true,
        return_status: true,
        fy: true
      }
    })

    if (!existingSalex) {
      return res.status(404).json({ message: 'Salex not found' })
    }

    // Check for dependencies
    const returnCount = await prisma.salex_returns.count({
      where: { invoicex_id: parseInt(salexId) }
    })

    if (returnCount > 0) {
      return res.status(400).json({
        message: 'Cannot delete salex with existing returns. Delete returns first.'
      })
    }

    // ✅ Use customer transaction handler for deletion
    if (existingSalex.select_customer && existingSalex.select_customer !== 0) {
      const operations = await customerTransactionHandler.handleSaleDelete({
        type: 'salex',
        invoiceId: parseInt(salexId),
        customerId: existingSalex.select_customer,
        invoiceNo: existingSalex.invoice_no,
        paymentStatus: existingSalex.payment_status,
        returnStatus: existingSalex.return_status || 0
      })

      await prisma.$transaction(async (tx) => {
        await customerTransactionHandler.executeDeleteInTransaction(tx, operations)
      })
    } else {
      // For "Other" customer, just delete the salex
      await prisma.$transaction(async (tx) => {
        // Restore stock
        const items = await tx.invoice_itemsx.findMany({
          where: { invoice_no: parseInt(salexId) }
        })

        for (const item of items) {
          await tx.product.update({
            where: { id: item.product_id },
            data: { stock: { increment: Number(item.qty) || 0 } }
          })
        }

        // Delete related records
        await tx.invoice_itemsx.deleteMany({ where: { invoice_no: parseInt(salexId) } })
        await tx.transport_detailsx.deleteMany({ where: { invoice_id: parseInt(salexId) } })
        await tx.shiptox.deleteMany({ where: { invoice_no: parseInt(salexId) } })
        await tx.bill_tosalesx.deleteMany({ where: { invoice_no: parseInt(salexId) } })
        await tx.incexpx.deleteMany({ where: { invoice_id: parseInt(salexId) } })
        await tx.invoicex.delete({ where: { id: parseInt(salexId) } })
      })
    }

    res.status(200).json({
      success: true,
      message: 'Salex deleted successfully'
    })

  } catch (error) {
    console.error('Salex deletion error:', error)
    res.status(500).json({
      message: 'Failed to delete salex',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
