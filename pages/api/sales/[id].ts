import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'PUT':
      return handlePut(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    const saleId = parseInt(id as string)
    if (isNaN(saleId)) {
      return res.status(400).json({ message: 'Invalid sale ID' })
    }

    // Get the sale record
    const sale = await prisma.invoice.findUnique({
      where: { id: saleId }
    })

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' })
    }

    // Get the sale items for this invoice with product display_name
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

    // Get complete customer data from customer_details table or bill_tosales table for "Other" customers
    let customerData = null
    if (sale.select_customer === 0) {
      // "Other" customer - get data from bill_tosales table
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

    // Get transport details
    const transportDetails = await prisma.transport_details.findFirst({
      where: { invoice_id: sale.id }
    })

    // Get staff details if staff_id exists
    let staffData = null
    if (sale.staff_id) {
      staffData = await prisma.staff.findUnique({
        where: { id: sale.staff_id },
        select: { id: true, name: true, phone: true, email: true }
      })
    }

    // Get mechanic details if mechanic_id exists
    let mechanicData = null
    if (sale.mechanic_id) {
      mechanicData = await prisma.mechanic.findUnique({
        where: { id: sale.mechanic_id },
        select: { id: true, name: true, phone: true }
      })
    }

    // Transform to mirror POST payload structure exactly
    const transformedSale = {
      // ===== MAIN INVOICE FIELDS (mirror POST structure) =====
      invoice_no: sale.invoice_no,
      invoice_date: sale.invoice_date, // Unix timestamp
      select_customer: sale.select_customer,

      // ===== CALCULATED TOTALS =====
      items_total: sale.items_total || 0,
      freight: sale.freight || 0,
      total_taxable_value: sale.total_taxable_value || 0,
      total_cgst: sale.total_cgst || 0,
      total_sgst: sale.total_sgst || 0,
      total_igst: sale.total_igst || 0,
      total_tax: sale.total_tax || 0,
      total: sale.total || 0,

      // ===== INVOICE-LEVEL FIELDS =====
      bill_reference: sale.bill_reference || '',
      staff_id: sale.staff_id || null,
      staff_details: staffData?.name || '',
      mechanic_id: sale.mechanic_id || null,
      commission: sale.commission || 0,
      discount: sale.discount || 0,
      tax: sale.notes || '', // Using notes as tax field for compatibility
      packing_forwarding_qty: sale.packing_forwarding_qty || 0,
      packing_forwarding_rate: sale.packing_forwarding_rate || 0,
      packing_forwarding_total: sale.packing_forwarding_total || 0,

      // ===== PAYMENT FIELDS =====
      payment_status: sale.payment_status || 1,
      payment_mode: sale.payment_mode || 1,

      // ===== MISC FIELDS =====
      notes: sale.notes || '',
      descriptions: sale.descriptions || '',
      fy: sale.fy,
      updated_at: sale.updated_at,

      // ===== ITEM DATA (mirror POST invoiceItems structure) =====
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

      // ===== CUSTOMER ID =====
      customer_id: sale.select_customer,

      // ===== CUSTOMER, STAFF, MECHANIC DETAILS =====
      customer: customerData,
      staff: staffData,
      mechanic: mechanicData,

      // ===== SHIPPING DETAILS =====
      shippingDetails: customerData ? {
        user_name: customerData.billing_name,
        address: customerData.billing_address,
        gstin: customerData.billing_gstin || ''
      } : null,

      // ===== SHIPPING FLAG =====
      useShippingAddress: false, // Default to false for now

      // ===== TRANSPORT DETAILS =====
      transportDetails: {
        trans_mode: transportDetails?.trans_mode || '',
        vehicle_no: transportDetails?.vehicle_no || ''
      }
    }

    res.status(200).json(transformedSale)

  } catch (error) {
    console.error('Get sale error:', error)
    res.status(500).json({ message: 'Failed to fetch sale', error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query
    const saleId = parseInt(id as string)
    if (isNaN(saleId)) {
      return res.status(400).json({ message: 'Invalid sale ID' })
    }

    const {
      // ===== MAIN SALE TABLE FIELDS (ALL STORED) =====
      invoice_number,
      bill_reference,
      staff_id,
      mechanic_id,
      commission,
      date,

      // ===== CUSTOMER RELATIONSHIP (ONLY FK STORED) =====
      customer_id,

      // ===== TRANSPORT FIELDS (ALL STORED) =====
      transport_name,
      vehicle_number,
      transport_cost,

      // ===== ITEMS AND CALCULATIONS =====
      items,
      descriptions,
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,

      // ===== TAX FIELDS =====
      total_cgst,
      total_sgst,
      total_igst,
      notes,
      total_tax,
      payment_status,
      payment_mode
    } = req.body

    console.log('🔄 API Received PUT data for sale:', req.body);

    // ===== VALIDATION =====
    if (!invoice_number || !customer_id) {
      return res.status(400).json({
        message: 'Missing required fields: invoice_number or customer_id'
      })
    }

    // ===== VALIDATE CUSTOMER EXISTS =====
    const existingCustomer = await prisma.customer_details.findUnique({
      where: { id: parseInt(customer_id) }
    })

    if (!existingCustomer) {
      return res.status(400).json({
        message: 'Invalid customer selected - customer does not exist'
      })
    }

    // ===== VALIDATE SALE EXISTS =====
    const existingSale = await prisma.invoice.findUnique({
      where: { id: saleId }
    })

    if (!existingSale) {
      return res.status(404).json({
        message: 'Sale not found'
      })
    }

    // Get current financial year
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear()
    const financialYear = currentDate.getMonth() >= 3 ? currentYear : currentYear - 1

    // Convert date to Unix timestamp
    const invoiceDate = new Date(date).getTime() / 1000

    // Calculate totals if items provided
    let itemsTotal = 0
    if (items && items.length > 0) {
      itemsTotal = items.reduce((sum, item) => sum + (item.qty * item.rate), 0)
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update sale record
      const sale = await tx.invoice.update({
        where: { id: saleId },
        data: {
          bill_reference: bill_reference || '',
          staff_id: staff_id ? parseInt(staff_id) : null,
          mechanic_id: mechanic_id ? parseInt(mechanic_id) : null,
          commission: commission || 0,
          items_total: itemsTotal,
          freight: transport_cost || 0,
          total_taxable_value: itemsTotal,
          total_cgst: total_cgst || 0,
          total_sgst: total_sgst || 0,
          total_igst: total_igst || 0,
          total_tax: total_tax || 0,
          total: itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0),
          notes: notes || '',
          descriptions: descriptions || '',
          packing_forwarding_qty: packing_forwarding_qty || 0,
          packing_forwarding_rate: packing_forwarding_rate || 0,
          packing_forwarding_total: packing_forwarding_total || 0,
          invoice_date: Math.floor(invoiceDate / 1000), // Store as Unix timestamp
          payment_status: payment_status || 0,
          payment_mode: payment_mode || 1,
          fy: financialYear
        }
      })

      // Handle item-level updates using product_id matching
      if (items && items.length > 0) {
        // Get existing sale items
        const existingItems = await tx.invoiceitems.findMany({
          where: { invoice_no: sale.id }
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
            category_id: item.category_id,
            subcategory_id: item.subcategory_id,
            company_id: item.company_id,
            model_id: item.model_id,
            car_model: item.car_model || '',
            part: item.part || '',
            rate: item.rate,
            total: item.total,
            gst_percentage: item.gst_percentage || 0,
            cgst: item.cgst || 0,
            sgst: item.sgst || 0,
            igst: item.igst || 0,
            tax: item.tax || 0,
            product_id: parseInt(item.product_id),
            item: item
          })
        })

        // Process deletions: items that exist in DB but not in new list
        for (const [productId, existingData] of Array.from(existingItemsMap.entries())) {
          if (!newItemsMap.has(productId)) {
            // Item was removed - increase stock (return sold items)
            if (existingData.qty > 0) {
              await tx.product.update({
                where: { id: productId },
                data: {
                  stock: {
                    increment: existingData.qty
                  }
                }
              })
            }
            // Delete the item
            await tx.invoiceitems.delete({
              where: { id: existingData.id }
            })
          }
        }

        // Process additions and updates
        for (const [productId, newData] of Array.from(newItemsMap.entries())) {
          const existingData = existingItemsMap.get(productId)

          if (!existingData) {
            // New item - create it and decrease stock
            // Fetch product details from database
            const product = await tx.product.findUnique({
              where: { id: productId },
              select: {
                product_name: true,
                hsn: true,
                product_category_id: true,
                product_subcategory_id: true,
                company_id: true
              }
            })

            if (!product) {
              throw new Error(`Product with ID ${productId} not found`)
            }

            await tx.invoiceitems.create({
              data: {
                invoice_no: sale.id,
                product_id: productId,
                name_of_product: newData.product_name || product.product_name || '',
                category_id: product.product_category_id,
                subcategory_id: product.product_subcategory_id,
                model_id: newData.model_id ? parseInt(newData.model_id.toString()) : null,
                company_id: product.company_id,
                hsn: product.hsn,
                part: newData.part || '',
                qty: newData.qty,
                rate: newData.rate,
                subtotal: newData.qty * newData.rate,
                gst_percentage: newData.gst_percentage || 0,
                cgst: newData.cgst || 0,
                sgst: newData.sgst || 0,
                igst: newData.igst || 0,
                tax: newData.tax || 0,
                fy: financialYear,
                invoice_date: invoiceDate
              }
            })

            // Decrease stock for sales
            await tx.product.update({
              where: { id: productId },
              data: {
                stock: {
                  decrement: newData.qty
                }
              }
            })
          } else {
            // Existing item - check if quantity changed
            const qtyDifference = newData.qty - existingData.qty

            if (Math.abs(qtyDifference) > .001) { // Allow for small floating point differences
              // Update quantity and adjust stock
              await tx.invoiceitems.update({
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
                    increment: -qtyDifference // Negative because sales decrease stock (opposite of purchases)
                  }
                }
              })
            }
          }
        }
      }

      // Update customer relationship
      if (parseInt(customer_id) === 0) {
        // "Other" customer - data should already be in bill_tosales from POST
        // No need to update here as PUT doesn't receive customer details
      } else {
        // Existing customer - update bill_tosales with customer data
        await tx.bill_tosales.upsert({
          where: { invoice_no: sale.id },
          update: {
            billing_name: existingCustomer.billing_name,
            contact_no: existingCustomer.contact_no || '',
            email: existingCustomer.email || '',
            billing_address: existingCustomer.billing_address,
            billing_address2: existingCustomer.billing_address_2 || '',
            billing_city: existingCustomer.billing_city || '',
            billing_state: existingCustomer.billing_state || '',
            billing_state_code: existingCustomer.billing_state_code || null,
            billing_gstin: existingCustomer.billing_gstin || ''
          },
          create: {
            invoice_no: sale.id,
            billing_name: existingCustomer.billing_name,
            contact_no: existingCustomer.contact_no || '',
            email: existingCustomer.email || '',
            billing_address: existingCustomer.billing_address,
            billing_address2: existingCustomer.billing_address_2 || '',
            billing_city: existingCustomer.billing_city || '',
            billing_state: existingCustomer.billing_state || '',
            billing_state_code: existingCustomer.billing_state_code || null,
            billing_gstin: existingCustomer.billing_gstin || ''
          }
        })
      }

      return sale
    })

    res.status(200).json({
      message: 'Sale updated successfully',
      sale: {
        id: result.id,
        invoice_no: result.invoice_no,
        total: result.total,
        customer_name: existingCustomer.billing_name
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
