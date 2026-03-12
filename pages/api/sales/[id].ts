import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { convertDateToTimestamp } from '../../../lib/date-utils'
import { customerTransactionHandler } from '../../../lib/customer-transaction-handler'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions)

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { id } = req.query

  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'PUT':
      return handlePut(req, res)
    case 'DELETE':
      return handleDelete(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

/**
 * GET /api/sales/[id]
 * Get a single sale by ID
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    const saleId = parseInt(id as string)
    if (isNaN(saleId)) {
      return res.status(400).json({ message: 'Invalid sale ID' })
    }

    const sale = await prisma.invoice.findUnique({
      where: { id: saleId }
    })

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' })
    }

    const saleItems = await prisma.invoiceitems.findMany({
      where: { invoice_no: sale.id },
      include: {
        product: {
          select: {
            display_name: true
          }
        }
      }
    })

    let customerData = null
    if (sale.select_customer === 0) {
      const billToData = await prisma.bill_tosales.findUnique({
        where: { invoice_no: sale.id }
      })
      if (billToData) {
        customerData = {
          id: 0,
          billing_name: billToData.billing_name || '',
          billing_address: billToData.billing_address || '',
          billing_gstin: billToData.billing_gstin || '',
          contact_no: billToData.contact_no || '',
          email: billToData.email || ''
        }
      }
    } else if (sale.select_customer) {
      customerData = await prisma.customer_details.findUnique({
        where: { id: sale.select_customer },
        select: {
          id: true,
          billing_name: true,
          billing_address: true,
          billing_gstin: true,
          contact_no: true,
          email: true
        }
      })
    }

    const transportDetails = await prisma.transport_details.findFirst({
      where: { invoice_id: sale.id }
    })

    let staffData = null
    if (sale.staff_id) {
      staffData = await prisma.staff.findUnique({
        where: { id: sale.staff_id },
        select: { id: true, name: true, phone: true, email: true }
      })
    }

    let mechanicData = null
    if (sale.mechanic_id) {
      mechanicData = await prisma.mechanic.findUnique({
        where: { id: sale.mechanic_id },
        select: { id: true, name: true, phone: true }
      })
    }

    // Get payment allocation history
    const paymentAllocations = await prisma.customer_payment_allocations.findMany({
      where: { invoice_id: saleId },
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
    const remainingAmount = sale.total - totalPaid

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

    const transformedSale = {
      invoice_no: sale.invoice_no,
      invoice_date: sale.invoice_date,
      select_customer: sale.select_customer,
      customer_name: customerData?.billing_name || '',
      contact_number: customerData?.contact_no || '',
      email_id: customerData?.email || '',
      address: customerData?.billing_address || '',
      address_2: '',
      city: '',
      state: '',
      pin_code: '',
      gst_number: customerData?.billing_gstin || '',
      items_total: sale.items_total || 0,
      freight: sale.freight || 0,
      total_taxable_value: sale.total_taxable_value || 0,
      total_cgst: sale.total_cgst || 0,
      total_sgst: sale.total_sgst || 0,
      total_igst: sale.total_igst || 0,
      total_tax: sale.total_tax || 0,
      total: sale.total || 0,
      bill_reference: sale.bill_reference || '',
      staff_id: sale.staff_id || null,
      staff_details: staffData?.name || '',
      mechanic_id: sale.mechanic_id || null,
      commission: sale.commission || 0,
      discount: sale.discount || 0,
      tax: sale.notes || '',
      packing_forwarding_qty: sale.packing_forwarding_qty !== null && sale.packing_forwarding_qty !== undefined ? sale.packing_forwarding_qty : 0,
      packing_forwarding_rate: sale.packing_forwarding_rate !== null && sale.packing_forwarding_rate !== undefined ? sale.packing_forwarding_rate : 0,
      packing_forwarding_total: sale.packing_forwarding_total !== null && sale.packing_forwarding_total !== undefined ? sale.packing_forwarding_total : 0,
      payment_status: sale.payment_status !== null && sale.payment_status !== undefined ? sale.payment_status : 1,
      payment_mode: sale.payment_mode !== null && sale.payment_mode !== undefined ? sale.payment_mode : 1,
      notes: sale.notes || '',
      descriptions: sale.descriptions || '',
      fy: sale.fy,
      updated_at: sale.updated_at,
      invoiceItems: saleItems.map(item => ({
        product_id: item.product_id,
        name_of_product: item.product?.display_name || item.name_of_product,
        display_name: item.product?.display_name || item.name_of_product,
        qty: item.qty,
        rate: item.rate,
        subtotal: item.subtotal,
        gst_percentage: item.gst_percentage || 0,
        cgst: item.cgst || 0,
        sgst: item.sgst || 0,
        igst: item.igst || 0,
        tax: item.tax || 0,
        discount: item.discount || 0,
        discountrate: item.discountrate || 0,
        hsn: item.hsn || '',
        part: item.part,
        category_id: item.category_id,
        subcategory_id: item.subcategory_id,
        model_id: item.model_id,
        company_id: item.company_id,
        invoice_date: item.invoice_date,
        fy: item.fy
      })),
      customer_id: sale.select_customer,
      customer: customerData,
      billingDetails: sale.select_customer === 0 ? {
        customer_name: customerData?.billing_name || '',
        contact_number: customerData?.contact_no || '',
        email_id: customerData?.email || '',
        address: customerData?.billing_address || '',
        address_2: '',
        city: '',
        state: '',
        gst_number: customerData?.billing_gstin || '',
        billing_pin_code: ''
      } : null,
      staff: staffData,
      mechanic: mechanicData,
      shippingDetails: customerData ? {
        user_name: customerData.billing_name,
        address: customerData.billing_address,
        gstin: customerData.billing_gstin || ''
      } : null,
      useShippingAddress: false,
      transportDetails: {
        trans_mode: transportDetails?.trans_mode || '',
        vehicle_no: transportDetails?.vehicle_no || ''
      },
      // Payment allocation summary and history
      payment_summary: {
        total_bill: sale.total,
        total_paid: totalPaid,
        remaining_amount: remainingAmount,
        payment_count: paymentAllocations.length,
        is_fully_paid: totalPaid >= sale.total,
        is_partially_paid: totalPaid > 0 && totalPaid < sale.total
      },
      payment_history: paymentHistory
    }

    res.status(200).json(transformedSale)

  } catch (error) {
    console.error('Get sale error:', error)
    res.status(500).json({ message: 'Failed to fetch sale', error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

/**
 * PUT /api/sales/[id]
 * Update a sale
 * ✅ REFACTORED: Uses customer transaction handler for complex edits
 */
async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    const saleId = parseInt(id as string)
    if (isNaN(saleId)) {
      return res.status(400).json({ message: 'Invalid sale ID' })
    }

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

    // Validation
    if (!invoiceNumber || select_customer === undefined || select_customer === null) {
      return res.status(400).json({
        message: 'Missing required fields: invoice_no or select_customer'
      })
    }

    // Validate customer exists
    let existingCustomer = null
    if (parseInt(select_customer) !== 0) {
      existingCustomer = await prisma.customer_details.findUnique({
        where: { id: parseInt(select_customer) }
      })

      if (!existingCustomer) {
        return res.status(400).json({
          message: 'Invalid customer selected - customer does not exist'
        })
      }
    }

    // Validate sale exists
    const existingSale = await prisma.invoice.findUnique({
      where: { id: saleId }
    })

    if (!existingSale) {
      return res.status(404).json({
        message: 'Sale not found'
      })
    }

    // Validate payment fields
    const validPaymentStatuses = [0, 1, 2]
    const validPaymentModes = [0, 1]

    const parsedPaymentStatus = payment_status !== undefined && payment_status !== null
      ? parseInt(payment_status.toString())
      : 0

    const parsedPaymentMode = payment_mode !== undefined && payment_mode !== null
      ? parseInt(payment_mode.toString())
      : 1

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

    const invoiceDate = convertDateToTimestamp(dateValue)

    let itemsTotal = 0
    if (itemsArray && itemsArray.length > 0) {
      itemsTotal = itemsArray.reduce((sum, item) => sum + (item.qty * item.rate), 0)
    }

    const calculatedGrandTotal = itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0)

    // Start transaction - ALL operations inside
    const result = await prisma.$transaction(async (tx) => {
      // ✅ Use customer transaction handler for ALL edits (not just payment status changes)
      const oldPaymentStatus = existingSale.payment_status
      const newPaymentStatus = parsedPaymentStatus

      // Always use transaction handler for ledger/balance operations (like purchase does)
      if (parseInt(select_customer) !== 0) {
        const operations = await customerTransactionHandler.handleSaleEdit({
          type: 'sale',
          oldStatus: oldPaymentStatus,
          newStatus: newPaymentStatus,
          oldTotal: Number(existingSale.total),
          newTotal: calculatedGrandTotal,
          customerId: parseInt(select_customer),
          invoiceId: saleId,
          invoiceNo: invoiceNumber.toString(),
          paymentMode: parsedPaymentMode,
          paymentDate: Math.floor(invoiceDate),
          fy: financialYear
        })

        // Execute handler operations inside same transaction
        await customerTransactionHandler.executeInTransaction(tx, operations)
      }

      // Update sale record
      const saleUpdateData: any = {
        bill_reference: bill_reference || '',
        commission: commission || 0,
        items_total: itemsTotal,
        freight: transport_cost || 0,
        total_taxable_value: itemsTotal,
        total_cgst: total_cgst || 0,
        total_sgst: total_sgst || 0,
        total_igst: total_igst || 0,
        total_tax: total_tax || 0,
        total: calculatedGrandTotal,
        notes: notes || '',
        descriptions: descriptions || '',
        packing_forwarding_qty: packing_forwarding_qty || 0,
        packing_forwarding_rate: packing_forwarding_rate || 0,
        packing_forwarding_total: packing_forwarding_total || 0,
        invoice_date: Math.floor(invoiceDate),
        payment_status: parsedPaymentStatus,
        payment_mode: parsedPaymentMode,
        fy: financialYear
      }

      if (staff_id) {
        saleUpdateData.staff = { connect: { id: parseInt(staff_id) } }
      } else {
        saleUpdateData.staff = { disconnect: true }
      }

      if (mechanic_id) {
        saleUpdateData.mechanic = { connect: { id: parseInt(mechanic_id) } }
      } else {
        saleUpdateData.mechanic = { disconnect: true }
      }

      const sale = await tx.invoice.update({
        where: { id: saleId },
        data: saleUpdateData
      })

      // Handle item updates
      if (itemsArray && itemsArray.length > 0) {
        const existingItems = await tx.invoiceitems.findMany({
          where: { invoice_no: sale.id }
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
            await tx.invoiceitems.delete({
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

            await tx.invoiceitems.create({
              data: {
                invoice_no: sale.id,
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

              await tx.invoiceitems.update({
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

      // Update customer relationship
      await tx.bill_tosales.upsert({
        where: { invoice_no: sale.id },
        update: {
          billing_name: req.body.customer_name || existingCustomer?.billing_name || 'Other',
          contact_no: req.body.contact_number || existingCustomer?.contact_no || '',
          email: req.body.email_id || existingCustomer?.email || '',
          billing_address: req.body.address || existingCustomer?.billing_address || '',
          billing_address2: existingCustomer?.billing_address_2 || '',
          billing_city: req.body.city || existingCustomer?.billing_city || '',
          billing_state: req.body.state || existingCustomer?.billing_state || '',
          billing_state_code: req.body.state_code || existingCustomer?.billing_state_code || null,
          billing_gstin: req.body.gst_number || existingCustomer?.billing_gstin || ''
        },
        create: {
          invoice_no: sale.id,
          billing_name: req.body.customer_name || existingCustomer?.billing_name || 'Other',
          contact_no: req.body.contact_number || existingCustomer?.contact_no || '',
          email: req.body.email_id || existingCustomer?.email || '',
          billing_address: req.body.address || existingCustomer?.billing_address || '',
          billing_address2: existingCustomer?.billing_address_2 || '',
          billing_city: req.body.city || existingCustomer?.billing_city || '',
          billing_state: req.body.state || existingCustomer?.billing_state || '',
          billing_state_code: req.body.state_code || existingCustomer?.billing_state_code || null,
          billing_gstin: req.body.gst_number || existingCustomer?.billing_gstin || ''
        }
      })

      // Update shipping details
      await tx.shipto.upsert({
        where: { invoice_no: sale.id },
        update: {
          shipping_name: req.body.customer_name || existingCustomer?.shipping_name || existingCustomer?.billing_name || 'Other',
          shipping_address: req.body.address || existingCustomer?.shipping_address || existingCustomer?.billing_address || '',
          shipping_address2: existingCustomer?.shipping_address_2 || existingCustomer?.billing_address_2 || '',
          shipping_city: req.body.city || existingCustomer?.shipping_city || existingCustomer?.billing_city || '',
          shipping_state: req.body.state || existingCustomer?.shipping_state || existingCustomer?.billing_state || '',
          shipping_state_code: existingCustomer?.shipping_state_code || existingCustomer?.billing_state_code || null,
          shipping_gstin: req.body.gst_number || existingCustomer?.shipping_gstin || existingCustomer?.billing_gstin || '',
          shipping: true
        },
        create: {
          invoice_no: sale.id,
          shipping_name: req.body.customer_name || existingCustomer?.shipping_name || existingCustomer?.billing_name || 'Other',
          shipping_address: req.body.address || existingCustomer?.shipping_address || existingCustomer?.billing_address || '',
          shipping_address2: existingCustomer?.shipping_address_2 || existingCustomer?.billing_address_2 || '',
          shipping_city: req.body.city || existingCustomer?.shipping_city || existingCustomer?.billing_city || '',
          shipping_state: req.body.state || existingCustomer?.shipping_state || existingCustomer?.billing_state || '',
          shipping_state_code: existingCustomer?.shipping_state_code || existingCustomer?.billing_state_code || null,
          shipping_gstin: req.body.gst_number || existingCustomer?.shipping_gstin || existingCustomer?.billing_gstin || '',
          shipping: true
        }
      })

      // Update transport details if provided
      if (transportDetails) {
        await tx.transport_details.upsert({
          where: { invoice_id: sale.id },
          update: {
            trans_mode: transportDetails.trans_mode || '',
            vehicle_no: transportDetails.vehicle_no || ''
          },
          create: {
            invoice_id: sale.id,
            trans_mode: transportDetails.trans_mode || '',
            vehicle_no: transportDetails.vehicle_no || ''
          }
        })
      }

      return sale
    }, {
      timeout: 30000
    })

    res.status(200).json({
      message: 'Sale updated successfully',
      sale: {
        id: result.id,
        invoice_no: result.invoice_no,
        total: result.total,
        customer_name: existingCustomer?.billing_name || req.body.customer_name || 'Other'
      }
    })

  } catch (error) {
    console.error('Sale update error:', error)
    res.status(500).json({
      message: 'Failed to update sale',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * DELETE /api/sales/[id]
 * Delete a sale
 * ✅ NEW: Uses customer transaction handler for safe deletion
 */
async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    const saleId = parseInt(id as string)
    if (isNaN(saleId)) {
      return res.status(400).json({ message: 'Invalid sale ID' })
    }

    // Get sale details
    const sale = await prisma.invoice.findUnique({
      where: { id: saleId },
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

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' })
    }

    // ✅ Use customer transaction handler for deletion
    if (sale.select_customer && sale.select_customer !== 0) {
      const operations = await customerTransactionHandler.handleSaleDelete({
        type: 'sale',
        invoiceId: saleId,
        customerId: sale.select_customer,
        invoiceNo: sale.invoice_no,
        paymentStatus: sale.payment_status,
        returnStatus: sale.return_status || 0
      })

      await prisma.$transaction(async (tx) => {
        await customerTransactionHandler.executeDeleteInTransaction(tx, operations)
      })
    } else {
      // For "Other" customer, just delete the sale
      await prisma.$transaction(async (tx) => {
        // Restore stock
        const items = await tx.invoiceitems.findMany({
          where: { invoice_no: saleId }
        })

        for (const item of items) {
          await tx.product.update({
            where: { id: item.product_id },
            data: { stock: { increment: Number(item.qty) || 0 } }
          })
        }

        // Delete related records
        await tx.invoiceitems.deleteMany({ where: { invoice_no: saleId } })
        await tx.bill_tosales.deleteMany({ where: { invoice_no: saleId } })
        await tx.shipto.deleteMany({ where: { invoice_no: saleId } })
        await tx.invoice.delete({ where: { id: saleId } })
      })
    }

    res.status(200).json({
      message: 'Sale deleted successfully',
      sale_id: saleId
    })

  } catch (error) {
    console.error('Sale deletion error:', error)
    res.status(500).json({
      message: 'Failed to delete sale',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
