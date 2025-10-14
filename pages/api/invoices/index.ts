import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(
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
      fy = ''
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}
    
    if (search) {
      where.OR = [
        { invoice_no: { contains: search as string } },
        { notes: { contains: search as string } },
      ]
    }

    if (fy && fy !== '') {
      where.fy = parseInt(fy as string)
    }

    if (startDate && endDate) {
      const startTimestamp = Math.floor(new Date(startDate as string).getTime() / 1000)
      const endTimestamp = Math.floor(new Date(endDate as string).getTime() / 1000)
      where.invoice_date = {
        gte: startTimestamp,
        lte: endTimestamp
      }
    }

    // Get invoices with related data
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { id: 'desc' },
        // Note: Relations may not exist in current schema, let's fetch separately
      }),
      prisma.invoice.count({ where })
    ])

    // OPTIMIZED: Get customer names and item counts in batch queries
    const invoiceIds = invoices.map((inv: { id: any }) => inv.id)
    
    const [customerData, itemCounts] = await Promise.all([
      // Get all customer names in one query
      prisma.bill_tosales.findMany({
        where: { invoice_no: { in: invoiceIds } },
        select: { invoice_no: true, user_name: true }
      }),
      
      // Get all item counts in one query
      prisma.invoiceitems.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      })
    ])

    // Create lookup maps for fast access
    const customerMap = new Map(customerData.map((c: { invoice_no: any; user_name: any }) => [c.invoice_no, c.user_name]))
    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))

    // Enhanced invoices using maps (fast, no individual queries)
    const enhancedInvoices = invoices.map((invoice: any) => ({
      ...invoice,
      customerName: customerMap.get(invoice.id) || 'N/A',
      itemCount: itemCountMap.get(invoice.id) || 0,
      formattedDate: new Date(invoice.invoice_date * 1000).toLocaleDateString('en-IN'),
      formattedTotal: invoice.total.toLocaleString('en-IN', {
        style: 'currency',
        currency: 'INR'
      })
    }))

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      invoices: enhancedInvoices,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Invoices fetch error:', error)
    res.status(500).json({ 
      message: 'Failed to fetch invoices',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      // ===== MAIN INVOICE FIELDS (CURRENTLY STORED IN DATABASE) =====
      invoice_no,                        // ✓ Invoice.invoice_no
      invoice_date,                      // ✓ Invoice.invoice_date (converted to timestamp)
      select_customer,                   // ✓ Invoice.select_customer
      items_total,                       // ✓ Invoice.items_total
      freight,                           // ✓ Invoice.freight
      total_taxable_value,               // ✓ Invoice.total_taxable_value
      total_cgst,                        // ✓ Invoice.total_cgst
      total_sgst,                        // ✓ Invoice.total_sgst
      total_igst,                        // ✓ Invoice.total_igst
      total_tax,                         // ✓ Invoice.total_tax
      total,                             // ✓ Invoice.total
      notes,                             // ✓ Invoice.notes
      descriptions,                      // ✓ Invoice.descriptions (NOW IN SCHEMA)
      fy,                                // ✓ Invoice.fy
      bill_reference,                    // ✓ Invoice.bill_reference (NOW IN SCHEMA)
      payment_mode,                      // ✓ Invoice.payment_mode (NEWLY ADDED)
      updated_at,                        // ✓ Invoice.updated_at (NEWLY ADDED)

      // ===== RELATIONAL DATA (CURRENTLY STORED IN DATABASE) =====
      invoiceItems,                      // ✓ InvoiceItems table (multiple records) - WITH product_id FK
      billingDetails,                    // ✓ BillToSales table (single record)
      shippingDetails,                   // ✓ ShipTo table (single record)
      transportDetails,                  // ✓ TransportDetails table (single record)

      // ===== FIELDS COLLECTED BUT NOW READY TO BE SAVED =====
      // These fields NOW exist in schema and should be saved:
      staff_details,                     // ✅ NOW SAVED - Invoice.staff_details
      staff_id,                          // ✅ NOW SAVED - Invoice.staff_id (FK to staff table)
      mechanic_id,                       // ✅ NOW SAVED - Invoice.mechanic_id (FK to mechanic table)
      commission,                        // ✅ NOW SAVED - Invoice.commission

      // ===== FIELDS COLLECTED BUT NOT YET SAVED IN DATABASE =====
      // These fields are collected in UI but schema still doesn't have them:
      discount,                          // ❌ NOT SAVED - Future: Invoice.discount (invoice-level)
      tax,                               // ❌ NOT SAVED - Future: Invoice.tax_description
      packing_forwarding_qty,            // ❌ NOT SAVED - Future: Invoice.packing_forwarding_qty
      packing_forwarding_rate,           // ❌ NOT SAVED - Future: Invoice.packing_forwarding_rate
      packing_forwarding_total,          // ❌ NOT SAVED - Future: Invoice.packing_forwarding_total

      // ===== FIELDS MARKED FOR REMOVAL (legacy fields no longer needed) =====
      tax_rate,                          // 🗑️ MARKED FOR REMOVAL - Legacy field, no longer used in UI
      basic_value,                       // 🗑️ MARKED FOR REMOVAL - Legacy field, no longer used in UI

      // ===== DEPRECATED PAYMENT FIELDS (replaced by payment_mode) =====
      payment_status,                    // ✅ ACTIVE - Use this field (maps to Invoice.status)

      // ===== CALCULATED FIELDS (client-side calculations, not stored) =====
      // 🗑️ MARKED FOR REMOVAL - These are calculated on client-side:
      // - total_discount: Calculated from item-level discounts
      // - subtotal: Same as items_total (sum of item subtotals)
      // - grand_total: Same as total (items_total + freight + taxes)
      total_discount,
      subtotal,
      grand_total
    } = req.body

    // Validate required fields
    if (!invoice_no || !total_taxable_value || !total || !invoice_date) {
      return res.status(400).json({ message: 'Required fields missing' })
    }

    console.log('� INVOICE API RECEIVED PAYLOAD:');
    console.log('✅ FIELDS BEING STORED IN DATABASE:', {
      invoice_no, invoice_date, select_customer, items_total, freight,
      total_taxable_value, total_cgst, total_sgst, total_igst, total_tax, total, notes, descriptions, fy, bill_reference, payment_mode,
      has_billing_details: !!billingDetails, has_shipping_details: !!shippingDetails, has_transport_details: !!transportDetails, has_invoice_items: !!invoiceItems
    });
    console.log('❌ FIELDS COLLECTED BUT NOT CURRENTLY SAVED:', {
      staff_details, staff_id, mechanic_id, commission, discount, tax,
      packing_forwarding_qty, packing_forwarding_rate, packing_forwarding_total,
      tax_rate, basic_value, payment_status, total_discount, subtotal, grand_total
    });

    // ===== FUTURE SCHEMA EXPANSION FIELDS =====
    // These fields don't exist in current Invoice/InvoiceItems tables, similar to Product API approach:
    // TODO: Add these fields to Invoice/InvoiceItems schemas when ready:
    // - approved_by: String? (user who approved the invoice)
    // - approval_date: DateTime? (when invoice was approved)
    // - delivery_status: String? ("pending", "shipped", "delivered")
    // - payment_terms: String? ("net_15", "net_30", "cod")
    // - invoice_discount: Float? (separate from item-level discounts)
    // - due_date: DateTime? (calculated based on payment terms)
    // - eway_bill_no: String? (for interstate sales)
    // - credit_period_days: Int? (number of days for credit)
    // - salesperson_id: Int? (who sold this invoice)
    // - delivery_notes: String? (separate from general notes)
    // - quality_check_status: String? ("pending", "passed", "failed")
    // - return_policy: String? (terms for returns/exchanges)
    // - warranty_period: String? (warranty information)

    // ===== DATABASE CREATION MAPPING =====
    // Start transaction with 8-second timeout for remote database latency
    const result = await prisma.$transaction(async (tx: any) => {
      // ===== INVOICE TABLE CREATION =====
      // Maps to: Invoice table
      const invoice = await tx.invoice.create({
        data: {
          invoice_no,                                    // Invoice.invoice_no
          invoice_date: Math.floor(new Date(invoice_date).getTime() / 1000), // Invoice.invoice_date (converted to timestamp)
          select_customer,                               // Invoice.select_customer
          items_total: items_total || 0,                 // Invoice.items_total
          freight: freight || 0,                         // Invoice.freight
          total_taxable_value,                           // Invoice.total_taxable_value
          total_cgst: total_cgst || 0,                   // Invoice.total_cgst
          total_sgst: total_sgst || 0,                   // Invoice.total_sgst
          total_igst: total_igst || 0,                   // Invoice.total_igst
          total_tax: total_tax || 0,                     // Invoice.total_tax
          total,                                         // Invoice.total
          notes,                                         // Invoice.notes
          descriptions,                                  // Invoice.descriptions (NEWLY ADDED)
          fy,                                            // Invoice.fy
          bill_reference,                                // Invoice.bill_reference (NEWLY ADDED)
          status: payment_status ? parseInt(payment_status) : 0,                   // Invoice.status (from UI payment_status: 0=Unpaid, 1=Paid)
          payment_mode: payment_mode ? parseInt(payment_mode) : 1,               // Invoice.payment_mode (from UI: 1=Cash, 2=Bank)
          updated_at: new Date().toISOString(),          // Invoice.updated_at
          staff_details,                                 // Invoice.staff_details (optional, for backward compatibility)
          staff_id: staff_id ? parseInt(staff_id) : null, // Invoice.staff_id (optional, FK to staff table)
          mechanic_id: mechanic_id ? parseInt(mechanic_id) : null, // Invoice.mechanic_id (optional, FK to mechanic table)
          commission: commission || 0                    // Invoice.commission (optional, commission amount)
        }
      })

      // ===== PHASE 1: PARALLEL CREATION OF RELATED RECORDS =====
      // Create incexp, billing, shipping, and transport details in parallel
      const parallelOperations = [
        // Record income transaction in incexp table
        tx.incexp.create({
          data: {
            invoice_id: invoice.id,
            user_id: 1, // TODO: Get from authentication context
            amt: invoice.total,
            payment_mode: invoice.payment_mode,
            type: 1, // 1 = Income
            incexp_date: new Date().toISOString().split('T')[0],
            fy: invoice.fy,
            notes: `Invoice #${invoice.invoice_no} - Sale Transaction`
          }
        }),

        // Billing details creation
        billingDetails ? tx.bill_tosales.create({
          data: {
            invoice_no: invoice.id,                       // BillToSales.invoice_no (FK to invoice)
            user_name: billingDetails.user_name,          // BillToSales.user_name
            address: billingDetails.address,              // BillToSales.address
            address2: billingDetails.address2,            // BillToSales.address2
            mobile: billingDetails.mobile,                // BillToSales.mobile
            email: billingDetails.email,                  // BillToSales.email
            state: billingDetails.state,                  // BillToSales.state
            state_code: billingDetails.state_code,        // BillToSales.state_code
            gstin: billingDetails.gstin                   // BillToSales.gstin
          }
        }) : Promise.resolve(null),

        // Shipping details creation
        shippingDetails ? tx.ship_to.create({
          data: {
            invoice_no: invoice.id,                       // ShipTo.invoice_no (FK to invoice)
            user_name: shippingDetails.user_name,          // ShipTo.user_name
            address: shippingDetails.address,              // ShipTo.address
            state: shippingDetails.state,                  // ShipTo.state
            state_code: shippingDetails.state_code,        // ShipTo.state_code
            gstin: shippingDetails.gstin                   // ShipTo.gstin
          }
        }) : Promise.resolve(null),

        // Transport details creation
        transportDetails ? tx.transport_details.create({
          data: {
            invoice_id: invoice.id,                       // TransportDetails.invoice_id (FK to invoice)
            trans_mode: transportDetails.trans_mode || '', // TransportDetails.trans_mode
            vehicle_no: transportDetails.vehicle_no || ''  // TransportDetails.vehicle_no
            // supply_date and place_of_supply are optional and not provided in current payload
          }
        }) : Promise.resolve(null)
      ];

      // Execute all parallel operations
      await Promise.all(parallelOperations);

      // ===== INVOICE ITEMS CREATION =====
      // Maps to: InvoiceItems table (multiple records) - BATCH INSERT OPTIMIZATION
      if (invoiceItems && invoiceItems.length > 0) {
        // Prepare batch data for invoice items
        const invoiceItemData = invoiceItems.map(item => ({
          product_id : item.product_id,
          invoice_no: invoice.id,                     // InvoiceItems.invoice_no (FK to invoice)
          name_of_product: item.name_of_product, // InvoiceItems.name_of_product (product name/ID)
          qty: item.qty,                              // InvoiceItems.qty
          rate: item.rate,                            // InvoiceItems.rate
          subtotal: item.subtotal,                    // InvoiceItems.subtotal
          hsn: item.hsn,                              // InvoiceItems.hsn
          part: item.part,                            // InvoiceItems.part
          category_id: item.category_id,              // InvoiceItems.category_id
          model_id: parseInt(item.model_id),                    // InvoiceItems.model_id
          company_id: item.company_id,                // InvoiceItems.company_id
          invoice_date: invoice.invoice_date,         // copied from invoice
          fy: invoice.fy                             // copied from invoice
        }));

        // Batch create all invoice items
        await tx.invoiceitems.createMany({
          data: invoiceItemData
        });

        // ===== STOCK MANAGEMENT =====
        // Batch update product stock (decrease for sales) - OPTIMIZED
        const stockUpdates = invoiceItems.map(item => ({
          id: item.product_id,
          qty: item.qty
        }));

        // Execute stock updates in parallel for better performance
        await Promise.all(
          stockUpdates.map(({ id, qty }) =>
            tx.product.update({
              where: { id },
              data: {
                stock: { decrement: qty }
              }
            })
          )
        );
      }

      return invoice
    },{ timeout: 8000 })

    console.log('✅ INVOICE CREATED SUCCESSFULLY:', { id: result.id, invoice_no: result.invoice_no, total: result.total });

    res.status(201).json(result)
  } catch (error) {
    console.error('Invoice creation error:', error)
    res.status(500).json({ 
      message: 'Failed to create invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
