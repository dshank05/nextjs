import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'Invalid invoice ID' })
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

async function handleGet(req: NextApiRequest, res: NextApiResponse, invoiceId: string) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: parseInt(invoiceId) },
      include: {
        mechanic: true,
        staff: true
      }
    })

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' })
    }

    // Get related data
    const [billingDetails, shippingDetails, transportDetails, invoiceItems, transactions] = await Promise.all([
      prisma.bill_tosales.findFirst({ where: { invoice_no: invoice.id } }),
      prisma.ship_to.findFirst({ where: { invoice_no: invoice.id } }),
      prisma.transport_details.findFirst({ where: { invoice_id: invoice.id } }),
      prisma.invoiceitems.findMany({
        where: { invoice_no: invoice.id },
        select: {
          id: true,
          product_id: true,
          invoice_no: true,
          name_of_product: true,
          qty: true,
          rate: true,
          subtotal: true,
          gst_percentage: true,
          cgst: true,
          sgst: true,
          igst: true,
          tax: true,
          discount: true,          // Item-level discount amount
          discountrate: true,      // Item-level discount percentage
          hsn: true,
          part: true,
          category_id: true,
          subcategory_id: true,    // Added subcategory_id field
          model_id: true,
          company_id: true,
          invoice_date: true,
          fy: true
        }
      }),
      prisma.incexp.findMany({ where: { invoice_id: invoice.id } })
    ])

    res.status(200).json({
      invoice: {
        ...invoice,
        // Add fields that UI expects
        customer_id: invoice.select_customer, // UI expects customer_id field
        customer_name: billingDetails?.user_name || '',
        contact_number: billingDetails?.mobile || '',
        email_id: billingDetails?.email || '',
        address: billingDetails?.address || '',
        gst_number: billingDetails?.gstin || '',
        vehicle_number: transportDetails?.vehicle_no || '',
        transport_name: transportDetails?.trans_mode || '',
        // Now use actual database values for packing/forwarding fields
        packing_forwarding_qty: invoice.packing_forwarding_qty?.toString() || '0',
        packing_forwarding_rate: invoice.packing_forwarding_rate?.toString() || '0',
        packing_forwarding_total: invoice.packing_forwarding_total?.toString() || '0',
      },
      billingDetails,
      shippingDetails,
      transportDetails,
      invoiceItems,
      transactions
    })
  } catch (error) {
    console.error('Invoice fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}


async function handlePut(req: NextApiRequest, res: NextApiResponse, invoiceId: string) {
  try {
    const {
      // Main invoice fields
      invoice_no,
      invoice_date,
      select_customer,
      items_total,
      freight,
      total_taxable_value,
      total_cgst,
      total_sgst,
      total_igst,
      total_tax,
      total,
      notes,
      fy,
      status,
      payment_mode,

      // New fields
      bill_reference,
      descriptions,
      staff_details,
      staff_id,
      mechanic_id,
      commission,

      // Newly stored invoice-level fields
      discount,
      tax,
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,

      // Related data
      invoiceItems,
      billingDetails,
      shippingDetails,
      transportDetails
    } = req.body

    // Validate required fields
    if (!invoice_no || !total_taxable_value || !total) {
      return res.status(400).json({ message: 'Required fields missing' })
    }

    // Get current invoice data for stock adjustments
    const [currentInvoice, currentInvoiceItems] = await Promise.all([
      prisma.invoice.findUnique({
        where: { id: parseInt(invoiceId) }
      }),
      prisma.invoiceitems.findMany({
        where: { invoice_no: parseInt(invoiceId) }
      })
    ])

    if (!currentInvoice) {
      return res.status(404).json({ message: 'Invoice not found' })
    }

    // ===== SPLIT INTO MULTIPLE TRANSACTIONS TO AVOID TIMEOUT =====

    // Transaction 1: Update main invoice data
    const totalItemDiscount = invoiceItems.reduce((sum, item) => sum + (parseFloat(item.discount?.toString()) || 0), 0);
    const discountPercentage = items_total > 0 ? (totalItemDiscount / items_total) * 100 : 0;

    console.log('💰 UPDATE: INVOICE-LEVEL DISCOUNT CALCULATIONS:', {
      totalItemDiscount,
      items_total,
      discountPercentage,
      taxrate: discountPercentage > 0 ? (total_tax / (items_total - totalItemDiscount)) * 100 : (total_tax / items_total) * 100
    });

    const updatedInvoice = await prisma.$transaction(async (tx: any) => {
      return await tx.invoice.update({
        where: { id: parseInt(invoiceId) },
        data: {
          invoice_no,
          invoice_date: Math.floor(new Date(invoice_date).getTime() / 1000),
          select_customer,
          items_total: items_total || 0,
          freight: freight || 0,
          total_taxable_value,
          taxrate: discountPercentage > 0 ? Math.round((total_tax / (items_total - totalItemDiscount)) * 100) : Math.round((total_tax / items_total) * 100),
          total_cgst: total_cgst || 0,
          total_sgst: total_sgst || 0,
          total_igst: total_igst || 0,
          total_tax: total_tax || 0,
          total,
          notes,
          fy,
          status,
          payment_mode,
          updated_at: new Date().toISOString(),

          // New fields
          bill_reference: bill_reference || null,
          descriptions: descriptions || null,
          staff_details,
          staff: staff_id ? { connect: { id: parseInt(staff_id) } } : undefined,
          mechanic: mechanic_id ? { connect: { id: parseInt(mechanic_id) } } : undefined,
          commission: commission || 0,

          // Newly stored invoice-level fields
          discount: totalItemDiscount,
          discount_percentage: discountPercentage,
          packing_forwarding_qty: packing_forwarding_qty || 0,
          packing_forwarding_rate: packing_forwarding_rate || 0,
          packing_forwarding_total: packing_forwarding_total || 0
        }
      })
    },{ timeout: 15000 }) //  15 seconds timeout

    // Transaction 2: Handle stock adjustments and invoice items (most expensive operation)
    if (invoiceItems && invoiceItems.length > 0) {
      await prisma.$transaction(async (tx: any) => {
        // First, reverse previous stock changes
        for (const oldItem of currentInvoiceItems) {
          const productId = parseInt(oldItem.product_id?.toString() || oldItem.name_of_product?.toString() || '0');
          if (productId > 0) {
            await tx.product.update({
              where: { id: productId },
              data: {
                stock: { increment: oldItem.qty } // Add back the stock that was deducted
              }
            })
          }
        }

        // Delete old invoice items
        await tx.invoiceitems.deleteMany({
          where: { invoice_no: parseInt(invoiceId) }
        })

        // Create new invoice items
        for (const item of invoiceItems) {
          await tx.invoiceitems.create({
            data: {
              product_id: item.product_id,
              invoice_no: parseInt(invoiceId),
              name_of_product: item.name_of_product,
              qty: item.qty,
              rate: item.rate,
              subtotal: item.subtotal,
              gst_percentage: item.gst_percentage,
              cgst: item.cgst,
              sgst: item.sgst,
              igst: item.igst,
              tax: item.tax,
              discount: item.discount || 0,
              discountrate: item.discountrate || 0,
              hsn: item.hsn,
              part: item.part,
              category_id: item.category_id,
              subcategory_id: item.subcategory_id,
              model_id: item.model_id,
              company_id: item.company_id,
              invoice_date: updatedInvoice.invoice_date,
              fy: updatedInvoice.fy
            }
          })
        }

        // Deduct new stock for all new items
        for (const item of invoiceItems) {
          await tx.product.update({
            where: { id: parseInt(item.product_id.toString()) },
            data: {
              stock: { decrement: item.qty }
            }
          })
        }
      })
    }

    // Transaction 3: Update related tables (separate transaction)
    await prisma.$transaction(async (tx: any) => {
      // Update billing details
      if (billingDetails) {
        await tx.billtosales.upsert({
          where: { invoice_no: parseInt(invoiceId) },
          update: {
            user_name: billingDetails.user_name,
            address: billingDetails.address,
            address2: billingDetails.address2,
            mobile: billingDetails.mobile,
            email: billingDetails.email,
            state: billingDetails.state,
            state_code: billingDetails.state_code,
            gstin: billingDetails.gstin
          },
          create: {
            invoice_no: parseInt(invoiceId),
            user_name: billingDetails.user_name,
            address: billingDetails.address,
            address2: billingDetails.address2,
            mobile: billingDetails.mobile,
            email: billingDetails.email,
            state: billingDetails.state,
            state_code: billingDetails.state_code,
            gstin: billingDetails.gstin
          }
        })
      }

      // Update shipping details
      if (shippingDetails) {
        await tx.ship_to.upsert({
          where: { invoice_no: parseInt(invoiceId) },
          update: {
            user_name: shippingDetails.user_name,
            address: shippingDetails.address,
            state: shippingDetails.state,
            state_code: shippingDetails.state_code,
            gstin: shippingDetails.gstin
          },
          create: {
            invoice_no: parseInt(invoiceId),
            user_name: shippingDetails.user_name,
            address: shippingDetails.address,
            state: shippingDetails.state,
            state_code: shippingDetails.state_code,
            gstin: shippingDetails.gstin
          }
        })
      }

      // Update transport details
      if (transportDetails) {
        await tx.transportdetails.upsert({
          where: { invoice_id: parseInt(invoiceId) },
          update: {
            trans_mode: transportDetails.trans_mode,
            vehicle_no: transportDetails.vehicle_no,
            supply_date: transportDetails.supply_date,
            place_of_supply: transportDetails.place_of_supply
          },
          create: {
            invoice_id: parseInt(invoiceId),
            trans_mode: transportDetails.trans_mode,
            vehicle_no: transportDetails.vehicle_no,
            supply_date: transportDetails.supply_date,
            place_of_supply: transportDetails.place_of_supply
          }
        })
      }
    })

    // Update transaction record (outside transaction since it's not critical)
    await prisma.incexp.updateMany({
      where: { invoice_id: parseInt(invoiceId) },
      data: {
        amt: updatedInvoice.total,
        payment_mode: updatedInvoice.payment_mode,
        notes: `Invoice #${updatedInvoice.invoice_no} - Updated Transaction`
      }
    })

    res.status(200).json(updatedInvoice)
  } catch (error) {
    console.error('Invoice update error:', error)
    res.status(500).json({
      message: 'Failed to update invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, invoiceId: string) {
  try {
    // Get invoice items for stock rollback
    const invoiceItems = await prisma.invoiceitems.findMany({
      where: { invoice_no: parseInt(invoiceId) }
    })

    // Delete in transaction to handle stock rollback
    await prisma.$transaction(async (tx: any) => {
      // Return stock for all invoice items
      for (const item of invoiceItems) {
        const productId = parseInt(item.product_id?.toString() || item.name_of_product?.toString() || '0');
        if (productId > 0) {
          await tx.product.update({
            where: { id: productId },
            data: {
              stock: { increment: item.qty }
            }
          })
        }
      }

      // Delete related records
      await tx.transport_details.deleteMany({ where: { invoice_id: parseInt(invoiceId) } })
      await tx.ship_to.deleteMany({ where: { invoice_no: parseInt(invoiceId) } })
      await tx.bill_tosales.deleteMany({ where: { invoice_no: parseInt(invoiceId) } })
      await tx.invoiceitems.deleteMany({ where: { invoice_no: parseInt(invoiceId) } })
      await tx.incexp.deleteMany({ where: { invoice_id: parseInt(invoiceId) } })

      // Delete main invoice
      await tx.invoice.delete({ where: { id: parseInt(invoiceId) } })
    })

    res.status(200).json({ message: 'Invoice deleted successfully' })
  } catch (error) {
    console.error('Invoice deletion error:', error)
    res.status(500).json({
      message: 'Failed to delete invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
