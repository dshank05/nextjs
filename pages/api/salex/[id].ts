import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { convertDateToTimestamp } from '../../../lib/date-utils'
import { withObservability } from '../../../lib/withObservability'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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

async function handleGet(req: NextApiRequest, res: NextApiResponse, salexId: string) {
  try {
    const salex = await prisma.invoicex.findUnique({
      where: { id: parseInt(salexId) }
    })

    if (!salex) {
      return res.status(404).json({ message: 'Salex not found' })
    }

    // Get related data separately
    const [customerData, staffData, mechanicData, returnData, paymentAllocations] = await Promise.all([
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

      // Note: customer_payment_allocations relation doesn't exist in current Prisma client
      // This will be available after prisma generate
      Promise.resolve([])
    ])

    if (!salex) {
      return res.status(404).json({ message: 'Salex not found' })
    }

    // Get item count
    const itemCount = await prisma.invoice_itemsx.count({
      where: { invoice_no: salex.id }
    })

    // Format date
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

    // Calculate payment summary (will be 0 until prisma generate is fixed)
    const totalAllocated = 0 // paymentAllocations.reduce((sum, alloc) => sum + Number(alloc.allocated_amount), 0)

    const enhancedSalex = {
      id: salex.id,
      invoice_no: salex.invoice_no,
      customer_id: salex.select_customer,
      customer_name: customerData?.billing_name || 'Other',
      customer_gstin: customerData?.billing_gstin || '',
      invoice_date: salex.invoice_date,
      formattedDate: formattedDate,
      items_total: salex.items_total,
      freight: salex.freight,
      total_taxable_value: salex.total_taxable_value,
      total_tax: salex.total_tax,
      total: salex.total,
      notes: salex.notes,
      descriptions: salex.descriptions,
      payment_status: salex.payment_status,
      payment_mode: salex.payment_mode,
      return_status: salex.return_status,
      fy: salex.fy,
      staff_id: salex.staff_id,
      staff_name: staffData?.name,
      mechanic_id: salex.mechanic_id,
      mechanic_name: mechanicData?.name,
      bill_reference: salex.bill_reference,
      discount: salex.discount,
      packing_forwarding_total: salex.packing_forwarding_total,
      item_count: itemCount,
      return_count: returnData.length,
      total_allocated: totalAllocated,
      outstanding_amount: salex.total - totalAllocated,
      created_at: salex.updated_at,
      updated_at: salex.updated_at
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

async function handlePut(req: NextApiRequest, res: NextApiResponse, salexId: string) {
  try {
    const {
      bill_reference,
      staff_id,
      mechanic_id,
      commission,
      date,
      customer_id,
      transport_cost,
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

    // Validation - customer data should be in request body
    if (!req.body.customer_name || !req.body.contact_number || !req.body.state) {
      return res.status(400).json({
        message: 'Customer name, contact number, and state are required'
      })
    }

    // Check if salex exists
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

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert date to Unix timestamp
    const invoiceDate = date ? convertDateToTimestamp(date) : existingSalex.invoice_date

    // Calculate totals if items provided
    let itemsTotal = existingSalex.items_total
    let totalTaxable = existingSalex.total_taxable_value

    if (items && items.length > 0) {
      itemsTotal = items.reduce((sum, item) => sum + (item.qty * item.rate), 0)
      totalTaxable = itemsTotal
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update salex record
      const salexUpdateData: any = {
        select_customer: parseInt(customer_id),
        bill_reference: bill_reference || existingSalex.bill_reference,
        commission: commission !== undefined ? commission : existingSalex.commission,
        items_total: itemsTotal,
        freight: transport_cost !== undefined ? transport_cost : existingSalex.freight,
        total_taxable_value: totalTaxable,
        total_cgst: total_cgst !== undefined ? total_cgst : existingSalex.total_cgst,
        total_sgst: total_sgst !== undefined ? total_sgst : existingSalex.total_sgst,
        total_igst: total_igst !== undefined ? total_igst : existingSalex.total_igst,
        total_tax: total_tax !== undefined ? total_tax : existingSalex.total_tax,
        total: itemsTotal + (packing_forwarding_total || existingSalex.packing_forwarding_total || 0) + (transport_cost || existingSalex.freight || 0) + (total_tax || existingSalex.total_tax || 0),
        notes: notes !== undefined ? notes : existingSalex.notes,
        descriptions: descriptions !== undefined ? descriptions : existingSalex.descriptions,
        packing_forwarding_qty: packing_forwarding_qty !== undefined ? packing_forwarding_qty : existingSalex.packing_forwarding_qty,
        packing_forwarding_rate: packing_forwarding_rate !== undefined ? packing_forwarding_rate : existingSalex.packing_forwarding_rate,
        packing_forwarding_total: packing_forwarding_total !== undefined ? packing_forwarding_total : existingSalex.packing_forwarding_total,
        invoice_date: invoiceDate,
        payment_status: parsedPaymentStatus,
        payment_mode: parsedPaymentMode,
        fy: financialYear,
        updated_at: new Date()
      };

      // Handle staff and mechanic relations
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

      // Handle item-level updates if items provided
      if (items && items.length > 0) {
        // Get existing salex items for comparison
        const existingItems = await tx.invoice_itemsx.findMany({
          where: { invoice_no: salex.id }
        })

        // Create maps for efficient lookup using product_id
        const existingItemsMap = new Map<number, any>()
        const newItemsMap = new Map<number, any>()

        existingItems.forEach(item => {
          existingItemsMap.set(item.product_id, {
            id: item.id,
            qty: item.qty || 0,
            item: item
          })
        })

        items.forEach(item => {
          newItemsMap.set(parseInt(item.product_id), {
            qty: item.qty || 0,
            rate: item.rate || 0,
            product_id: parseInt(item.product_id),
            item: item
          })
        })

        // Process deletions: items that exist in DB but not in new list
        for (const [productId, existingData] of Array.from(existingItemsMap.entries())) {
          if (!newItemsMap.has(productId)) {
            // Item was removed - increase stock (return sold items)
            const validatedExistingQty = Number(existingData.qty) || 0;
            if (validatedExistingQty > 0) {
              await tx.product.update({
                where: { id: productId },
                data: {
                  stock: {
                    increment: validatedExistingQty
                  }
                }
              })
            }
            // Delete the item
            await tx.invoice_itemsx.delete({
              where: { id: existingData.id }
            })
          }
        }

        // Process additions and updates
        for (const [productId, newData] of Array.from(newItemsMap.entries())) {
          const existingData = existingItemsMap.get(productId)

          if (!existingData) {
            // New item - create it and decrease stock
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

            // Check stock availability for new items
            if (product.stock < newData.qty) {
              throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested ${newData.qty}`)
            }

            const modelId = newData.item.model_id ? parseInt(newData.item.model_id) : null;

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

            // Decrease stock for new salex sales
            const validatedNewQty = Number(newData.qty) || 0;
            await tx.product.update({
              where: { id: productId },
              data: {
                stock: {
                  decrement: validatedNewQty
                }
              }
            })
          } else {
            // Existing item - check if quantity changed
            const validatedNewQty = Number(newData.qty) || 0;
            const validatedExistingQty = Number(existingData.qty) || 0;
            const qtyDifference = validatedNewQty - validatedExistingQty;

            if (Math.abs(qtyDifference) > 0.001) {
              // Check stock availability for increased quantity
              if (qtyDifference > 0) {
                const product = await tx.product.findUnique({
                  where: { id: productId },
                  select: { stock: true, product_name: true }
                })

                if (product && product.stock < qtyDifference) {
                  throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested additional ${qtyDifference}`)
                }
              }

              // Update quantity and adjust stock
              await tx.invoice_itemsx.update({
                where: { id: existingData.id },
                data: {
                  qty: newData.qty,
                  rate: newData.rate,
                  subtotal: newData.qty * newData.rate
                }
              })

              // Adjust stock based on quantity difference
              await tx.product.update({
                where: { id: productId },
                data: {
                  stock: {
                    increment: -qtyDifference // Negative because salex sales decrease stock
                  }
                }
              })
            }
          }
        }
      }

      return salex
    })

    // Update customer data in bill_tosalesx
    await prisma.bill_tosalesx.upsert({
      where: { invoice_no: result.id },
      update: {
        billing_name: req.body.customer_name,
        contact_no: req.body.contact_number || '',
        email: req.body.email_id || '',
        billing_address: req.body.address || '',
        billing_city: req.body.city || '',
        billing_state: req.body.state || '',
        billing_state_code: req.body.state_code || null,
        billing_gstin: req.body.gst_number || ''
      },
      create: {
        invoice_no: result.id,
        billing_name: req.body.customer_name,
        contact_no: req.body.contact_number || '',
        email: req.body.email_id || '',
        billing_address: req.body.address || '',
        billing_city: req.body.city || '',
        billing_state: req.body.state || '',
        billing_state_code: req.body.state_code || null,
        billing_gstin: req.body.gst_number || ''
      }
    })

    // Update shipping data in shiptox
    await prisma.shiptox.upsert({
      where: { invoice_no: result.id },
      update: {
        shipping_name: req.body.customer_name,
        shipping_address: req.body.address || '',
        shipping_city: req.body.city || '',
        shipping_state: req.body.state || '',
        shipping_state_code: req.body.state_code || null,
        shipping_gstin: req.body.gst_number || ''
      },
      create: {
        invoice_no: result.id,
        shipping_name: req.body.customer_name,
        shipping_address: req.body.address || '',
        shipping_city: req.body.city || '',
        shipping_state: req.body.state || '',
        shipping_state_code: req.body.state_code || null,
        shipping_gstin: req.body.gst_number || ''
      }
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

async function handleDelete(req: NextApiRequest, res: NextApiResponse, salexId: string) {
  try {
    // Check if salex exists
    const existingSalex = await prisma.invoicex.findUnique({
      where: { id: parseInt(salexId) }
    })

    if (!existingSalex) {
      return res.status(404).json({ message: 'Salex not found' })
    }

    // Check for dependencies separately
    const returnCount = await prisma.salex_returns.count({
      where: { invoicex_id: parseInt(salexId) }
    })

    if (returnCount > 0) {
      return res.status(400).json({
        message: 'Cannot delete salex with existing returns. Delete returns first.'
      })
    }

    // Note: customer_payment_allocations check will be added after prisma generate
    // For now, we'll allow deletion but it may fail if allocations exist

    // Use database transaction for salex deletion and stock restoration
    await prisma.$transaction(async (tx) => {
      // Get all salex items to restore stock
      const salexItems = await tx.invoice_itemsx.findMany({
        where: { invoice_no: parseInt(salexId) }
      })

      // Restore stock for all items
      for (const item of salexItems) {
        const validatedQty = Number(item.qty) || 0;
        if (validatedQty > 0) {
          await tx.product.update({
            where: { id: item.product_id },
            data: {
              stock: {
                increment: validatedQty
              }
            }
          })
        }
      }

      // Delete related records
      await tx.invoice_itemsx.deleteMany({
        where: { invoice_no: parseInt(salexId) }
      })

      await tx.transport_detailsx.deleteMany({
        where: { invoice_id: parseInt(salexId) }
      })

      await tx.shiptox.deleteMany({
        where: { invoice_no: parseInt(salexId) }
      })

      await tx.bill_tosalesx.deleteMany({
        where: { invoice_no: parseInt(salexId) }
      })

      await tx.incexpx.deleteMany({
        where: { invoice_id: parseInt(salexId) }
      })

      // Delete the salex
      await tx.invoicex.delete({
        where: { id: parseInt(salexId) }
      })
    })

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
