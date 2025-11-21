import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { PrismaClient } from '@prisma/client'

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

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
    const customerIds = Array.from(new Set(invoices.map((inv: any) => inv.select_customer).filter(Boolean)))

    const [customerData, billToData, itemCounts] = await Promise.all([
      // Get customer names for regular customers
      customerIds.length > 0 ? prisma.customer_details.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, billing_name: true }
      }) : Promise.resolve([]),

      // Get bill_to data for "Other" customers (customer_id = 0)
      prisma.bill_to.findMany({
        where: { invoice_no: { in: invoiceIds } },
        select: { invoice_no: true, vendor_name: true, contact_no: true, email: true, address: true, address2: true, city: true, state: true, gstin: true }
      }),

      // Get all item counts in one query
      prisma.invoiceitems.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      })
    ])

    // Create lookup maps for fast access
    const customerMap = new Map(customerData.map(customer => [customer.id, customer]))
    const billToMap = new Map(billToData.map(billTo => [billTo.invoice_no, billTo]))
    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))

    // Enhanced invoices using maps (fast, no individual queries)
    const enhancedInvoices = invoices.map((invoice: any) => {
      // Get customer data - check both regular customers and "Other" customers
      const customerData = customerMap.get(invoice.select_customer)
      const billToData = billToMap.get(invoice.id)

      return {
        ...invoice,
        customerName: customerData?.billing_name || billToData?.vendor_name || 'Other',
        customer_id: invoice.select_customer || null,
        customer: customerData || null,
        itemCount: itemCountMap.get(invoice.id) || 0,
        formattedDate: new Date(invoice.invoice_date * 1000).toLocaleDateString('en-IN'),
        formattedTotal: invoice.total.toLocaleString('en-IN', {
          style: 'currency',
          currency: 'INR'
        }),
        // Map payment_status to status for TransactionTable compatibility
        status: invoice.payment_status,
        payment_status: invoice.payment_status,
        payment_mode: invoice.payment_mode,
        // Include newly added invoice-level fields in the response
        discount: invoice.discount || 0,
        tax: invoice.tax || null,
        packing_forwarding_qty: invoice.packing_forwarding_qty || 0,
        packing_forwarding_rate: invoice.packing_forwarding_rate || 0,
        packing_forwarding_total: invoice.packing_forwarding_total || 0
      }
    })

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
      customer_id,                       // Alternative customer ID location (for backward compatibility)
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
      staff_details,                     // NOW SAVED - Invoice.staff_details
      staff_id,                          // NOW SAVED - Invoice.staff_id (FK to staff table)
      mechanic_id,                       // NOW SAVED - Invoice.mechanic_id (FK to mechanic table)
      commission,                        // NOW SAVED - Invoice.commission

      // ===== FIELDS NOW SAVED AS INVOICE-LEVEL FIELDS =====
      // These fields are collected in UI and now stored in database:
      discount,                          // ✓ NOW SAVED - Invoice.discount (invoice-level discount amount)
      tax,                               // ✓ NOW SAVED - Invoice.tax (tax description/notes)
      packing_forwarding_qty,            // ✓ NOW SAVED - Invoice.packing_forwarding_qty
      packing_forwarding_rate,           // ✓ NOW SAVED - Invoice.packing_forwarding_rate
      packing_forwarding_total,          // ✓ NOW SAVED - Invoice.packing_forwarding_total

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

    console.log(' INVOICE API RECEIVED PAYLOAD:');
    console.log('✅ FIELDS BEING STORED IN DATABASE:', {
      invoice_no, invoice_date, select_customer, items_total, freight,
      total_taxable_value, total_cgst, total_sgst, total_igst, total_tax, total, notes, descriptions, fy, bill_reference, payment_mode,
      has_billing_details: !!billingDetails, has_shipping_details: !!shippingDetails, has_transport_details: !!transportDetails, has_invoice_items: !!invoiceItems,
      customer_id_sources: {
        select_customer: select_customer,
        customer_id: customer_id,
        billingDetails_customer_id: billingDetails?.customer_id
      }
    });
    console.log('💰 INVOICE-LEVEL DISCOUNT FROM UI:', {
      discount_received: discount || 0,
      note: 'UI sends calculated total discount, API saves it directly'
    });


    // ===== DATABASE CREATION MAPPING =====
    // Start transaction with 8-second timeout for remote database latency
    const result = await prisma.$transaction(async (tx: any) => {
      // ===== INVOICE TABLE CREATION =====
      // Maps to: Invoice table
      const invoice = await tx.invoice.create({
        data: {
          invoice_no,                                    // Invoice.invoice_no
          invoice_date: typeof invoice_date === 'number' && invoice_date > 1000000000
            ? Math.floor(invoice_date) // Already a Unix timestamp in seconds
            : Math.floor(new Date(invoice_date).getTime() / 1000), // Convert date string to timestamp
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
          payment_status: payment_status ? parseInt(payment_status) : 0,             // Invoice.payment_status (from UI payment_status: 0=Unpaid, 1=Paid)
          payment_mode: payment_mode ? parseInt(payment_mode) : 1,               // Invoice.payment_mode (from UI: 1=Cash, 2=Bank)
          updated_at: new Date().toISOString(),          // Invoice.updated_at
          staff_details,                                 // Invoice.staff_details (optional, for backward compatibility)
          staff: staff_id ? { connect: { id: parseInt(staff_id) } } : undefined, // Invoice.staff (relation)
          mechanic: mechanic_id ? { connect: { id: parseInt(mechanic_id) } } : undefined, // Invoice.mechanic (relation)
          commission: commission || 0,                   // Invoice.commission (optional, commission amount)

          // Newly stored invoice-level fields (added to schema)
          discount: parseFloat(discount?.toString()) || 0, // Invoice.discount (from UI - calculated sum of item discounts)
          discount_percentage: items_total > 0 ? (parseFloat(discount?.toString() || '0') / items_total) * 100 : 0, // Invoice.discount_percentage (calculated discount percentage)
          taxrate: Math.round((total_tax / items_total) * 100),    // Invoice.taxrate (calculated tax rate percentage)
          packing_forwarding_qty: packing_forwarding_qty || 0,     // Invoice.packing_forwarding_qty
          packing_forwarding_rate: packing_forwarding_rate || 0,   // Invoice.packing_forwarding_rate
          packing_forwarding_total: packing_forwarding_total || 0, // Invoice.packing_forwarding_total
        }
      })

      // ===== PHASE 1: PARALLEL CREATION OF RELATED RECORDS =====
      // Validate required customer data - accept from either location for backward compatibility
      let customerIdSource: string | undefined;
      if (billingDetails?.customer_id) {
        customerIdSource = billingDetails.customer_id;
        console.log('✅ Using customer_id from billingDetails.customer_id:', customerIdSource);
      } else if (customer_id) {
        customerIdSource = customer_id;
        console.log('✅ Using customer_id from top-level customer_id:', customerIdSource);
      } else {
        throw new Error('Customer billing details are required for invoice creation (billingDetails.customer_id or customer_id)')
      }

      const customerId = parseInt(customerIdSource.toString());
      if (isNaN(customerId) || customerId <= 0) {
        throw new Error('Invalid customer ID provided')
      }

      console.log('🎯 FINAL CUSTOMER ID FOR CREATION:', customerId);

      // ===== CREATE BILL_TO RECORD FOR "OTHER" CUSTOMERS =====
      // Save customer details to bill_to table for inline editing (similar to purchase API)
      const billToOperations = [];

      // For "Other" customers (customer_id = 0), create bill_to record with manual details
      if (customerId === 0) {
        billToOperations.push(
          tx.bill_to.create({
            data: {
              invoice_no: invoice_no,
              vendor_name: req.body.customer_name,
              contact_no: req.body.contact_number,
              email: req.body.email_id || '',
              address: req.body.address || '',
              address2: req.body.address_2 || '',
              city: req.body.city || '',
              state: req.body.state || '',
              state_code: req.body.state_code || null,
              gstin: req.body.gst_number || '',
              pin_code: req.body.pin_code || ''
            }
          })
        );
      }

      // Create incexp, billing, shipping, and transport details in parallel
      const parallelOperations = [
        // Record income transaction in incexp table (MANDATORY - invoice creation fails if this fails)
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

        // Customer ID reference creation (ALWAYS REQUIRED)
        tx.bill_tosales.create({
          data: {
            invoice_no: invoice.id,                       // BillToSales.invoice_no (FK to invoice)
            customer_id: customerId                       // BillToSales.customer_id (FK to customer_details)
          }
        }),

        // Shipping relationship creation - links invoice to customer with shipping flag (ALWAYS REQUIRED)
        tx.shipto.create({
          data: {
            invoice_no: invoice.id,                        // shipto.invoice_no (FK to invoice)
            customer_id: customerId,                       // shipto.customer_id (FK to customer_details)
            shipping: !!shippingDetails                    // shipping flag: true if shipping to shipping address, false for billing
          }
        }),

        // Transport details creation (OPTIONAL)
        transportDetails ? tx.transport_details.create({
          data: {
            invoice_id: invoice.id,                       // TransportDetails.invoice_id (FK to invoice)
            trans_mode: transportDetails.trans_mode || '', // TransportDetails.trans_mode
            vehicle_no: transportDetails.vehicle_no || ''  // TransportDetails.vehicle_no
            // supply_date and place_of_supply are optional and not provided in current payload
          }
        }) : Promise.resolve(null),

        // Bill_to record for "Other" customers
        ...billToOperations
      ];

      // Execute all parallel operations
      await Promise.all(parallelOperations);

      // ===== INVOICE ITEMS CREATION =====
      // Maps to: InvoiceItems table (multiple records) - BATCH INSERT OPTIMIZATION
      if (invoiceItems && invoiceItems.length > 0) {
        // Prepare batch data for invoice items
        const invoiceItemData = invoiceItems.map(item => ({
          product_id: item.product_id,
          invoice_no: invoice.id,                     // InvoiceItems.invoice_no (FK to invoice)
          name_of_product: item.name_of_product, // InvoiceItems.name_of_product (product name/ID)
          qty: item.qty,                              // InvoiceItems.qty
          rate: item.rate,                            // InvoiceItems.rate
          subtotal: item.subtotal,                    // InvoiceItems.subtotal
          gst_percentage: item.gst_percentage,        // InvoiceItems.gst_percentage (new field)
          cgst: item.cgst,                            // InvoiceItems.cgst (new field)
          sgst: item.sgst,                            // InvoiceItems.sgst (new field)
          igst: item.igst,                            // InvoiceItems.igst (new field)
          tax: item.tax,                              // InvoiceItems.tax (new field)
          discount: item.discount || 0,               // InvoiceItems.discount (item-level discount amount)
          discountrate: item.discountrate || 0,       // InvoiceItems.discountrate (item-level discount percentage)
          hsn: item.hsn,                              // InvoiceItems.hsn
          part: item.part,                            // InvoiceItems.part
          category_id: item.category_id,              // InvoiceItems.category_id
          subcategory_id: item.subcategory_id,        // InvoiceItems.subcategory_id (new field)
          model_id: parseInt(item.model_id),          // InvoiceItems.model_id
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
    }, { timeout: 15000 })

    console.log('✅ INVOICE CREATED SUCCESSFULLY:', { id: result.id, invoice_no: result.invoice_no, total: result.total });


    res.status(201).json({
      status: "success",
      message: "Invoice created successfully"
    })
  } catch (error) {
    console.error('Invoice creation error:', error)
    res.status(500).json({
      status: "failure",
      message: 'Failed to create invoice'
    })
  }
}


export default withObservability(handler)
