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
    const salexId = parseInt(invoiceId)
    if (isNaN(salexId)) {
      return res.status(400).json({ message: 'Invalid salex ID' })
    }

    // Get the salex record
    const salex = await prisma.invoicex.findUnique({
      where: { id: salexId }
    })

    if (!salex) {
      return res.status(404).json({ message: 'Salex not found' })
    }

    // Get the salex items for this invoice
    const salexItems = await prisma.invoice_itemsx.findMany({
      where: { invoice_no: salex.id }
    })

    // Get customer data via bill_tosalesx relationship
    let customerData = null
    const billToSalex = await prisma.bill_tosalesx.findFirst({
      where: { invoice_no: salex.id },
      include: { customer: true }
    })

    if (billToSalex?.customer) {
      customerData = {
        id: billToSalex.customer.id,
        billing_name: billToSalex.customer.billing_name,
        billing_address: billToSalex.customer.billing_address,
        billing_gstin: billToSalex.customer.billing_gstin,
        contact_no: billToSalex.customer.contact_no || '',
        email: billToSalex.customer.email || ''
      }
    }

    // Get transport details
    const transportDetails = await prisma.transport_detailsx.findFirst({
      where: { invoice_id: salex.id }
    })

    // Get staff details if staff_id exists
    let staffData = null
    if (salex.staff_id) {
      staffData = await prisma.staff.findUnique({
        where: { id: salex.staff_id },
        select: { id: true, name: true, phone: true, email: true }
      })
    }

    // Get mechanic details if mechanic_id exists
    let mechanicData = null
    if (salex.mechanic_id) {
      mechanicData = await prisma.mechanic.findUnique({
        where: { id: salex.mechanic_id },
        select: { id: true, name: true, phone: true }
      })
    }

    // Transform to POST/PUT compatible structure
    const transformedSalex = {
      // Main salex fields - ensure all required fields are populated
      id: salex.id,
      invoice_number: salex.invoice_no?.toString() || '',
      bill_reference: salex.bill_reference || '',
      staff_id: salex.staff_id || null,
      mechanic_id: salex.mechanic_id || null,
      commission: salex.commission || 0,
      date: salex.invoice_date,  // Keep as number for proper formatting
      customer_id: billToSalex?.customer_id || null,
      transport_cost: salex.freight || 0,

      // Financial summary fields - ensure these are populated
      items_total: salex.items_total || 0,
      total_taxable_value: salex.total_taxable_value || salex.items_total || 0,
      total_tax: salex.total_tax || 0,
      total: salex.total || (salex.items_total + (salex.total_tax || 0)),
      freight: salex.freight || 0,

      // Transform items to POST structure
      items: salexItems.map(item => ({
        product_id: item.product_id,
        product_name: item.name_of_product || 'Unknown Product',
        category_id: item.category_id,
        subcategory_id: item.subcategory_id,
        company_id: item.company_id,
        model_id: item.model_id,
        part: item.part || '',
        qty: item.qty,
        rate: item.rate,
        gst_percentage: item.gst_percentage || 0,
        cgst: item.cgst || 0,
        sgst: item.sgst || 0,
        igst: item.igst || 0,
        tax: item.tax || 0,
        total: item.subtotal || (item.qty * item.rate),
        subtotal: item.subtotal || (item.qty * item.rate),
        hsn: item.hsn || ''
      })),

      // Additional fields
      descriptions: salex.descriptions || '',
      packing_forwarding_qty: salex.packing_forwarding_qty || 0,
      packing_forwarding_rate: salex.packing_forwarding_rate || 0,
      packing_forwarding_total: salex.packing_forwarding_total || 0,

      // Tax summary fields
      total_cgst: salex.total_cgst || 0,
      total_sgst: salex.total_sgst || 0,
      total_igst: salex.total_igst || 0,
      notes: salex.notes || '',

      // Payment fields
      payment_status: salex.payment_status || 0,
      payment_mode: salex.payment_mode || 1,

      // Metadata
      fy: salex.fy,
      item_count: salexItems.length,

      // Backward compatibility
      select_customer: billToSalex?.customer_id || null,
      customer: customerData,
      staff: staffData,
      mechanic: mechanicData,

      // Transport details for UI compatibility
      transportDetails: {
        vehicle_no: transportDetails?.vehicle_no || '',
        trans_mode: transportDetails?.trans_mode || ''
      }
    }

    res.status(200).json(transformedSalex)

  } catch (error) {
    console.error('Get salex error:', error)
    res.status(500).json({ message: 'Failed to fetch salex', error: error instanceof Error ? error.message : 'Unknown error' })
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
      payment_status,
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

    // ===== SPLIT INTO MULTIPLE TRANSACTIONS TO AVOID TIMEOUT =====

    // Transaction 1: Update main invoice data
    const updatedInvoice = await prisma.$transaction(async (tx: any) => {
      // Convert date to timestamp
      const invoiceDateTimestamp = Math.floor(new Date(invoice_date).getTime() / 1000)
      const fy = new Date().getFullYear()

      return await tx.invoicex.update({
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
          notes: notes || '',
          descriptions: descriptions || '', // Add descriptions field
          bill_reference: bill_reference || '', // Add bill_reference field
          invoice_date: invoiceDateTimestamp,
          updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          payment_status: parseInt(payment_status),
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
    }, { timeout: 15000 }) // 15 seconds timeout

    // Transaction 2: Handle invoice items (salex doesn't affect stock)
    if (invoiceItems && invoiceItems.length > 0) {
      await prisma.$transaction(async (tx: any) => {
        // Delete old invoice items
        await tx.invoice_itemsx.deleteMany({
          where: { invoice_no: parseInt(invoiceId) }
        })

        // Create new invoice items
        const invoiceDateTimestamp = Math.floor(new Date(invoice_date).getTime() / 1000)
        const fy = new Date().getFullYear()

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
            discount: parseFloat(item.discount) || 0, // Item-level discount amount
            discountrate: parseFloat(item.discountrate) || 0, // Item-level discount percentage
            fy: fy,
            invoice_date: invoiceDateTimestamp
          }))
        })
      }, { timeout: 15000 }) // 15 seconds timeout
    }

    // Transaction 3: Update related tables (separate transaction)
    await prisma.$transaction(async (tx: any) => {
      // Update billing details (now uses customer_id foreign key)
      await tx.bill_tosalesx.upsert({
        where: { invoice_no: parseInt(invoiceId) },
        update: {
          customer_id: parseInt(select_customer)
        },
        create: {
          invoice_no: parseInt(invoiceId),
          customer_id: parseInt(select_customer)
        }
      })

      // Update shipping details (now uses customer_id foreign key)
      if (shippingDetails && shippingDetails !== null) {
        await tx.shiptox.upsert({
          where: { invoice_no: parseInt(invoiceId) },
          update: {
            customer_id: parseInt(select_customer),
            shipping: shippingDetails.useShippingAddress !== undefined ? shippingDetails.useShippingAddress : false
          },
          create: {
            invoice_no: parseInt(invoiceId),
            customer_id: parseInt(select_customer),
            shipping: shippingDetails.useShippingAddress !== undefined ? shippingDetails.useShippingAddress : false
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
            supply_date: transportDetails.supply_date
          },
          create: {
            invoice_id: parseInt(invoiceId),
            trans_mode: transportDetails.trans_mode,
            vehicle_no: transportDetails.vehicle_no,
            supply_date: transportDetails.supply_date
          }
        })
      }
    }, { timeout: 10000 }) // 10 seconds timeout

    // Update transaction record (outside transaction since it's not critical)
    await prisma.incexpx.updateMany({
      where: { invoice_id: parseInt(invoiceId) },
      data: {
        amt: updatedInvoice.total,
        payment_mode: updatedInvoice.payment_mode,
        notes: updatedInvoice.notes
      }
    })

    res.status(200).json(updatedInvoice)
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

export default withObservability(handler)
