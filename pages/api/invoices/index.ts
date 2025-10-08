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
      prisma.invoice_itemsx.groupBy({
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
      fy,                                // ✓ Invoice.fy

      // ===== RELATIONAL DATA (CURRENTLY STORED IN DATABASE) =====
      invoiceItems,                      // ✓ InvoiceItems table (multiple records)
      billingDetails,                    // ✓ BillToSales table (single record)
      shippingDetails,                   // ✓ ShipTo table (single record)
      transportDetails,                  // ✓ TransportDetails table (single record)

      // ===== FIELDS COLLECTED BUT NOT YET SAVED IN DATABASE =====
      // These fields are collected in UI but current schema doesn't have space for them:
      bill_reference,                    // ❌ NOT SAVED - Future: Invoice.bill_reference
      staff_details,                     // ❌ NOT SAVED - Future: Invoice.staff_details
      staff_id,                          // ❌ NOT SAVED - Future: Invoice.staff_id (relation)
      mechanic_id,                       // ❌ NOT SAVED - Future: Invoice.mechanic_id (relation)
      commission,                        // ❌ NOT SAVED - Future: Invoice.commission
      discount,                          // ❌ NOT SAVED - Future: Invoice.discount (invoice-level)
      tax,                               // ❌ NOT SAVED - Future: Invoice.tax_description
      descriptions,                      // ❌ NOT SAVED - Future: Invoice.descriptions
      packing_forwarding_qty,            // ❌ NOT SAVED - Future: Invoice.packing_forwarding_qty
      packing_forwarding_rate,           // ❌ NOT SAVED - Future: Invoice.packing_forwarding_rate
      packing_forwarding_total,          // ❌ NOT SAVED - Future: Invoice.packing_forwarding_total
      tax_rate,                          // ❌ NOT SAVED - Future: Invoice.tax_rate_percentage
      basic_value,                       // ❌ NOT SAVED - Future: Invoice.basic_value

      // ===== PAYMENT FIELDS (UI vs DB NAMING ISSUES) =====
      payment_status,                    // ❌ NOT SAVED - UI sends payment_status, DB has status field (1=Paid)
      payment_mode,                      // ✓ Invoice.payment_mode

      // ===== CALCULATED FIELDS (REDUNDANT, NOT SAVED) =====
      total_discount,                    // ❌ NOT SAVED - Calculated field, will compute from items
      subtotal,                          // ❌ NOT SAVED - Redundant, same as items_total
      grand_total                        // ❌ NOT SAVED - Redundant, same as total
    } = req.body

    // Validate required fields
    if (!invoice_no || !total_taxable_value || !total || !invoice_date) {
      return res.status(400).json({ message: 'Required fields missing' })
    }

    console.log('� INVOICE API RECEIVED PAYLOAD:');
    console.log('✅ FIELDS BEING STORED IN DATABASE:', {
      invoice_no, invoice_date, select_customer, items_total, freight,
      total_taxable_value, total_cgst, total_sgst, total_igst, total_tax, total, notes, fy,
      has_billing_details: !!billingDetails, has_shipping_details: !!shippingDetails, has_transport_details: !!transportDetails, has_invoice_items: !!invoiceItems
    });
    console.log('❌ FIELDS COLLECTED BUT NOT CURRENTLY SAVED:', {
      bill_reference, staff_details, staff_id, mechanic_id, commission, discount, tax,
      descriptions, packing_forwarding_qty, packing_forwarding_rate, packing_forwarding_total,
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
    // Start transaction
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
          fy,                                            // Invoice.fy
          status: 1,                                     // Invoice.status (default: Paid)
          payment_mode: 1,                               // Invoice.payment_mode (default: Cash)
          updated_at: new Date().toISOString()           // Invoice.updated_at
        }
      })

      // ===== BILLING DETAILS CREATION =====
      // Maps to: BillToSales table
      if (billingDetails) {
        await tx.billtosales.create({
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
        })
      }

      // ===== SHIPPING DETAILS CREATION =====
      // Maps to: ShipTo table
      if (shippingDetails) {
        await tx.shipto.create({
          data: {
            invoice_no: invoice.id,                       // ShipTo.invoice_no (FK to invoice)
            user_name: shippingDetails.user_name,          // ShipTo.user_name
            address: shippingDetails.address,              // ShipTo.address
            state: shippingDetails.state,                  // ShipTo.state
            state_code: shippingDetails.state_code,        // ShipTo.state_code
            gstin: shippingDetails.gstin                   // ShipTo.gstin
          }
        })
      }

      // ===== TRANSPORT DETAILS CREATION =====
      // Maps to: TransportDetails table
      if (transportDetails) {
        await tx.transportdetails.create({
          data: {
            invoice_id: invoice.id,                       // TransportDetails.invoice_id (FK to invoice)
            trans_mode: transportDetails.trans_mode,      // TransportDetails.trans_mode
            vehicle_no: transportDetails.vehicle_no,       // TransportDetails.vehicle_no
            supply_date: transportDetails.supply_date,    // TransportDetails.supply_date
            place_of_supply: transportDetails.place_of_supply // TransportDetails.place_of_supply
          }
        })
      }

      // ===== INVOICE ITEMS CREATION =====
      // Maps to: InvoiceItems table (multiple records)
      if (invoiceItems && invoiceItems.length > 0) {
        for (const item of invoiceItems) {
          // Create invoice item record
          await tx.invoiceitems.create({
            data: {
              invoice_no: invoice.id,                     // InvoiceItems.invoice_no (FK to invoice)
              name_of_product: parseInt(item.name_of_product), // InvoiceItems.name_of_product (product name/ID)
              qty: item.qty,                              // InvoiceItems.qty
              rate: item.rate,                            // InvoiceItems.rate
              subtotal: item.subtotal,                    // InvoiceItems.subtotal
              hsn: item.hsn,                              // InvoiceItems.hsn
              part: item.part,                            // InvoiceItems.part
              category_id: item.category_id,              // InvoiceItems.category_id
              model_id: item.model_id,                    // InvoiceItems.model_id
              company_id: item.company_id,                // InvoiceItems.company_id
              invoice_date: invoice.invoice_date,         // copied from invoice
              fy: invoice.fy                             // copied from invoice
            }
          })

          // ===== STOCK MANAGEMENT =====
          // Update product stock (decrease for sales)
          await tx.product.update({
            where: { id: parseInt(item.name_of_product) },
            data: {
              stock: {
                decrement: item.qty                      // Product.stock -= item.qty
              }
            }
          })
        }
      }

      return invoice
    })

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
