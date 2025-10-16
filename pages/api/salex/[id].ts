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
    const invoice = await prisma.invoicex.findUnique({
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
      prisma.bill_tosalesx.findFirst({ where: { invoice_no: invoice.id } }),
      prisma.ship_tox.findFirst({ where: { invoice_no: invoice.id } }),
      prisma.transport_detailsx.findFirst({ where: { invoice_id: invoice.id } }),
      prisma.invoice_itemsx.findMany({ where: { invoice_no: invoice.id } }),
      prisma.incexpx.findMany({ where: { invoice_id: invoice.id } })
    ])

    res.status(200).json({
      invoice,
      billingDetails,
      shippingDetails,
      transportDetails,
      invoiceItems,
      transactions
    })
  } catch (error) {
    console.error('Salex invoice fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, invoiceId: string) {
  try {
    const {
      invoice_no,
      invoice_date,
      select_customer,
      items_total = 0,
      freight = 0,
      total_taxable_value,
      total,
      notes = '',
      status,
      payment_mode,

      // Additional fields from UI
      descriptions = '',
      discount = 0,      // Invoice-level discount amount
      staff_details,
      staff_id,
      mechanic_id,
      commission,
      bill_reference,

      // Packing & forwarding fields
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,

      invoiceItems,
      billingDetails,
      shippingDetails,
      transportDetails
    } = req.body

    // Validate required fields
    if (!invoice_no || !invoice_date || !select_customer) {
      return res.status(400).json({ message: 'Required fields missing' })
    }

    // Get current invoice data for stock adjustments (salex doesn't affect stock)
    const currentInvoice = await prisma.invoicex.findUnique({
      where: { id: parseInt(invoiceId) }
    })

    if (!currentInvoice) {
      return res.status(404).json({ message: 'Invoice not found' })
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // Convert date to timestamp
      const invoiceDateTimestamp = Math.floor(new Date(invoice_date).getTime() / 1000)
      const fy = new Date().getFullYear()

      // Update main salex invoice
      const combinedNotes = notes ? notes : '';
      const updatedInvoice = await tx.invoicex.update({
        where: { id: parseInt(invoiceId) },
        data: {
          invoice_no: parseInt(invoice_no),
          select_customer: parseInt(select_customer),
          items_total: parseFloat(items_total),
          freight: parseFloat(freight),
          total_taxable_value: parseFloat(total_taxable_value),
          taxrate: 0, // No tax for salex
          total_cgst: 0,
          total_sgst: 0,
          total_igst: 0,
          total_tax: 0,
          total: parseFloat(total),
          notes: combinedNotes,
          descriptions: descriptions || '', // Add descriptions field
          bill_reference: bill_reference || '', // Add bill_reference field
          invoice_date: invoiceDateTimestamp,
          updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          status: parseInt(status),
          payment_mode: parseInt(payment_mode),
          fy: fy,
          staff_details,
          staff_id: staff_id ? parseInt(staff_id) : null,
          mechanic_id: mechanic_id ? parseInt(mechanic_id) : null,
          commission: commission || 0,
          // Add packing and forwarding fields
          packing_forwarding_qty: packing_forwarding_qty ? parseFloat(packing_forwarding_qty) : null,
          packing_forwarding_rate: packing_forwarding_rate ? parseFloat(packing_forwarding_rate) : null,
          packing_forwarding_total: packing_forwarding_total ? parseFloat(packing_forwarding_total) : null
        }
      })

      // Handle invoice items update (salex doesn't affect stock)
      if (invoiceItems && invoiceItems.length > 0) {
        // Delete old invoice items
        await tx.invoice_itemsx.deleteMany({
          where: { invoice_no: parseInt(invoiceId) }
        })

        // Create new invoice items
        await tx.invoice_itemsx.createMany({
          data: invoiceItems.map((item: any) => ({
            product_id: item.product_id, // Required foreign key to Product table
            invoice_no: parseInt(invoiceId),
            name_of_product: item.name_of_product,
            qty: parseFloat(item.qty),
            rate: parseFloat(item.rate),
            subtotal: parseFloat(item.subtotal),
            hsn: item.hsn || '',
            part: item.part,
            category_id: item.category_id || null,
            subcategory_id: item.subcategory_id || null,
            model_id: item.model_id ? parseInt(item.model_id) : null, // Convert to integer
            company_id: item.company_id || null,
            fy: fy,
            invoice_date: invoiceDateTimestamp
          }))
        })
      }

      // Update billing details
      if (billingDetails) {
        await tx.bill_tosalesx.upsert({
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
        await tx.ship_tox.upsert({
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
        await tx.transport_detailsx.upsert({
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

      // Update transaction record
      await tx.incexpx.updateMany({
        where: { invoice_id: parseInt(invoiceId) },
        data: {
          amt: updatedInvoice.total,
          payment_mode: updatedInvoice.payment_mode,
          notes: `InvoiceX #${updatedInvoice.invoice_no} - Updated Transaction`
        }
      })

      return updatedInvoice
    })

    res.status(200).json(result)
  } catch (error) {
    console.error('Salex invoice update error:', error)
    res.status(500).json({
      message: 'Failed to update invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, invoiceId: string) {
  try {
    // Delete in transaction (salex doesn't affect stock)
    await prisma.$transaction(async (tx: any) => {
      // Delete related records
      await tx.transport_detailsx.deleteMany({ where: { invoice_id: parseInt(invoiceId) } })
      await tx.ship_tox.deleteMany({ where: { invoice_no: parseInt(invoiceId) } })
      await tx.bill_tosalesx.deleteMany({ where: { invoice_no: parseInt(invoiceId) } })
      await tx.invoice_itemsx.deleteMany({ where: { invoice_no: parseInt(invoiceId) } })
      await tx.incexpx.deleteMany({ where: { invoice_id: parseInt(invoiceId) } })

      // Delete main invoice
      await tx.invoicex.delete({ where: { id: parseInt(invoiceId) } })
    })

    res.status(200).json({ message: 'Salex invoice deleted successfully' })
  } catch (error) {
    console.error('Salex invoice deletion error:', error)
    res.status(500).json({
      message: 'Failed to delete invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
