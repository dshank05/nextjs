import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'

async function handler(
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
    const [billingDetails, shippingDetails, transportDetailsResult, invoiceItems, transactions, billToData, staffDetails, mechanicDetails, returnHistory] = await Promise.all([
      prisma.bill_tosales.findFirst({
        where: { invoice_no: invoice.id }
      }),
      prisma.shipto.findFirst({
        where: { invoice_no: invoice.id }
      }),
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
      prisma.incexp.findMany({ where: { invoice_id: invoice.id } }),
      // Always fetch customer data from bill_to table (manual entry)
      prisma.bill_to.findFirst({
        where: { invoice_no: invoice.id },
        select: {
          vendor_name: true,
          contact_no: true,
          email: true,
          address: true,
          address2: true,
          city: true,
          state: true,
          gstin: true,
          pin_code: true
        }
      }),
      // Fetch complete staff data from staff table
      invoice.staff_id ? prisma.staff.findUnique({
        where: { id: invoice.staff_id },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true
        }
      }) : Promise.resolve(null),
      // Fetch complete mechanic data from mechanic table
      invoice.mechanic_id ? prisma.mechanic.findUnique({
        where: { id: invoice.mechanic_id },
        select: {
          id: true,
          name: true,
          phone: true
        }
      }) : Promise.resolve(null),

      // Get return history for this invoice
      prisma.sale_returns.findMany({
        where: { invoice_id: parseInt(invoiceId) },
        select: {
          id: true,
          return_date: true,
          total_amount: true,
          total_tax: true,
          refund_amount: true,
          status: true,
          payment_status: true,
          notes: true,
          fy: true,
          created_at: true
        },
        orderBy: { return_date: 'desc' }
      })
    ])

    // Handle null transportDetails properly
    const transportDetails = transportDetailsResult || null

    // Return data in the same structure that POST/PUT expect for edit mode compatibility
    res.status(200).json({
      // Main invoice fields (same as POST/PUT input)
      invoice_no: invoice.invoice_no,
      invoice_date: invoice.invoice_date,
      select_customer: invoice.select_customer,
      customer_id: invoice.select_customer?.toString(), // Add top-level customer_id for backward compatibility
      items_total: invoice.items_total,
      freight: invoice.freight,
      total_taxable_value: invoice.total_taxable_value,
      total_cgst: invoice.total_cgst,
      total_sgst: invoice.total_sgst,
      total_igst: invoice.total_igst,
      total_tax: invoice.total_tax,
      total: invoice.total,
      notes: invoice.notes,
      descriptions: invoice.descriptions,
      fy: invoice.fy,
      bill_reference: invoice.bill_reference,
      payment_mode: invoice.payment_mode,
      payment_status: invoice.payment_status,
      return_status: invoice.return_status, // Add return status

      // Related entity IDs
      staff_details: invoice.staff_details,
      staff_id: staffDetails?.id || invoice.staff?.id,
      mechanic_id: mechanicDetails?.id || invoice.mechanic?.id,
      commission: invoice.commission,

      // Invoice-level financial fields
      discount: invoice.discount,
      packing_forwarding_qty: invoice.packing_forwarding_qty,
      packing_forwarding_rate: invoice.packing_forwarding_rate,
      packing_forwarding_total: invoice.packing_forwarding_total,

      // Top-level fields expected by UI
      customer_name: billToData?.vendor_name || '',
      vehicle_number: transportDetails?.vehicle_no || '',
      transport_name: transportDetails?.trans_mode || '',

      // Related data arrays
      invoiceItems,
      billingDetails: {
        customer_id: '0' // Always 0 for manual entry
      },
      shippingDetails: shippingDetails ? {
        id: shippingDetails.id,
        invoice_no: shippingDetails.invoice_no,
        shipping: shippingDetails.shipping
      } : null,
      transportDetails,
      transactions,
      returnHistory, // Add return history

      // Complete entity data for UI compatibility (from bill_to table)
      customer: billToData ? {
        id: '0', // Manual entry customer
        billing_name: billToData.vendor_name,
        billing_address: billToData.address || '',
        billing_address_2: billToData.address2 || '',
        billing_city: billToData.city || '',
        billing_state: billToData.state || '',
        billing_state_code: null, // Not stored in bill_to
        billing_gstin: billToData.gstin || '',
        contact_no: billToData.contact_no || '',
        email: billToData.email || '',
        shipping_name: billToData.vendor_name || '',
        shipping_address: billToData.address || '',
        shipping_address_2: billToData.address2 || '',
        shipping_city: billToData.city || '',
        shipping_state: billToData.state || '',
        shipping_state_code: null, // Not stored in bill_to
        shipping_gstin: billToData.gstin || ''
      } : null,
      staff: staffDetails,
      mechanic: mechanicDetails
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
      payment_status,
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

    // Block editing if invoice is fully returned
    if (currentInvoice.return_status === 2) {
      return res.status(400).json({
        message: 'Cannot edit a fully returned invoice. All items have been returned.',
        error_code: 'FULLY_RETURNED_INVOICE_EDIT_BLOCKED',
        suggestion: 'Create a new invoice if additional items need to be sold'
      })
    }

    // ===== SINGLE OPTIMIZED TRANSACTION TO PREVENT TIMEOUT =====

    console.log('💰 UPDATE: INVOICE-LEVEL DISCOUNT FROM UI:', {
      discount_received: discount || 0,
      note: 'UI sends calculated total discount, API saves it directly'
    });

    // Always use customer ID = 0 for manual entry (no customer selection)
    const customerId = 0;
    console.log('🎯 FINAL CUSTOMER ID FOR UPDATE:', customerId);

    // Single comprehensive transaction with proper timeout and error handling
    const updatedInvoice = await prisma.$transaction(async (tx: any) => {
      // 1. Update main invoice data
      const invoiceUpdate = await tx.invoice.update({
        where: { id: parseInt(invoiceId) },
        data: {
          invoice_no,
          invoice_date: typeof invoice_date === 'number' && invoice_date > 1000000000
            ? Math.floor(invoice_date) // Already a Unix timestamp in seconds
            : Math.floor(new Date(invoice_date).getTime() / 1000), // Convert date string to timestamp
          select_customer: 0, // Always 0 for manual entry
          items_total: items_total || 0,
          freight: freight || 0,
          total_taxable_value,
          total_cgst: total_cgst || 0,
          total_sgst: total_sgst || 0,
          total_igst: total_igst || 0,
          total_tax: total_tax || 0,
          total,
          notes,
          fy,
          payment_status,
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
          discount: parseFloat(discount?.toString()) || 0, // Invoice.discount (from UI - calculated sum of item discounts)
          discount_percentage: items_total > 0 ? (parseFloat(discount?.toString() || '0') / items_total) * 100 : 0, // Invoice.discount_percentage (calculated discount percentage)
          taxrate: Math.round((total_tax / items_total) * 100),    // Invoice.taxrate (calculated tax rate percentage)
          packing_forwarding_qty: packing_forwarding_qty || 0,
          packing_forwarding_rate: packing_forwarding_rate || 0,
          packing_forwarding_total: packing_forwarding_total || 0
        }
      });

      // 2. Handle stock adjustments and invoice items (optimized)
      if (invoiceItems && invoiceItems.length > 0) {
        // Pre-calculate stock adjustments to avoid multiple loops
        const stockAdjustments = new Map<number, number>();

        // Calculate reversals for old items
        for (const oldItem of currentInvoiceItems) {
          const productId = parseInt(oldItem.product_id?.toString() || oldItem.name_of_product?.toString() || '0');
          if (productId > 0) {
            const currentAdjustment = stockAdjustments.get(productId) || 0;
            stockAdjustments.set(productId, currentAdjustment + oldItem.qty);
          }
        }

        // Calculate deductions for new items
        for (const newItem of invoiceItems) {
          const productId = parseInt(newItem.product_id?.toString() || '0');
          if (productId > 0) {
            const currentAdjustment = stockAdjustments.get(productId) || 0;
            stockAdjustments.set(productId, currentAdjustment - newItem.qty);
          }
        }

        // Execute all stock adjustments in batch
        const stockUpdatePromises = Array.from(stockAdjustments.entries()).map(([productId, adjustment]) =>
          tx.product.update({
            where: { id: productId },
            data: { stock: { increment: adjustment } }
          })
        );

        // Delete old invoice items and update stock in parallel
        const [deleteResult] = await Promise.all([
          tx.invoiceitems.deleteMany({ where: { invoice_no: parseInt(invoiceId) } }),
          ...stockUpdatePromises
        ]);

        // Create new invoice items in batch
        const newItemsData = invoiceItems.map(item => ({
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
          invoice_date: invoiceUpdate.invoice_date,
          fy: invoiceUpdate.fy
        }));

        await tx.invoiceitems.createMany({
          data: newItemsData
        });
      }

      // 3. Update related tables (billing, shipping, transport) - all in same transaction
      const relatedTablePromises = [];

      // Update billing details
      relatedTablePromises.push(
        tx.bill_tosales.upsert({
          where: { invoice_no: parseInt(invoiceId) },
          update: { customer_id: customerId },
          create: {
            invoice_no: parseInt(invoiceId),
            customer_id: customerId
          }
        })
      );

      // Update shipping details
      relatedTablePromises.push(
        tx.shipto.upsert({
          where: { invoice_no: parseInt(invoiceId) },
          update: {
            shipping: !!shippingDetails
          },
          create: {
            invoice_no: parseInt(invoiceId),
            shipping: !!shippingDetails
          }
        })
      );

      // Update transport details if provided
      if (transportDetails) {
        relatedTablePromises.push(
          tx.transport_details.upsert({
            where: { invoice_id: parseInt(invoiceId) },
            update: {
              trans_mode: transportDetails.trans_mode,
              vehicle_no: transportDetails.vehicle_no,
              supply_date: transportDetails.supply_date
            },
            create: {
              invoice_id: parseInt(invoiceId),
              trans_mode: transportDetails.trans_mode,
              vehicle_no: transportDetails.vehicle_no,
              supply_date: transportDetails.supply_date
            }
          })
        );
      }

      // Execute all related table updates in parallel
      await Promise.all(relatedTablePromises);

      return invoiceUpdate;
    }, {
      timeout: 30000 // Increased timeout to 30 seconds for the comprehensive transaction
    });

    // Update transaction record (outside transaction since it's not critical)
    await prisma.incexp.updateMany({
      where: { invoice_id: parseInt(invoiceId) },
      data: {
        amt: updatedInvoice.total,
        payment_mode: updatedInvoice.payment_mode,
        notes: updatedInvoice.notes
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
      await tx.shipto.deleteMany({ where: { invoice_no: parseInt(invoiceId) } })
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


export default withObservability(handler)
