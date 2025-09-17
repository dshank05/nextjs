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
      invoiceItems,
      billingDetails,
      shippingDetails,
      transportDetails
    } = req.body

    // Validate required fields
    if (!invoice_no || !total_taxable_value || !total || !invoice_date) {
      return res.status(400).json({ message: 'Required fields missing' })
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Create invoice
      const invoice = await tx.invoice.create({
        data: {
          invoice_no,
          invoice_date: Math.floor(new Date(invoice_date).getTime() / 1000),
          select_customer,
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
          status: 1,
          payment_mode: 1,
          updated_at: new Date().toISOString()
        }
      })

      // Create billing details
      if (billingDetails) {
        await tx.billtosales.create({
          data: {
            invoice_no: invoice.id,
            ...billingDetails
          }
        })
      }

      // Create shipping details
      if (shippingDetails) {
        await tx.shipto.create({
          data: {
            invoice_no: invoice.id,
            ...shippingDetails
          }
        })
      }

      // Create transport details
      if (transportDetails) {
        await tx.transportdetails.create({
          data: {
            invoice_id: invoice.id,
            ...transportDetails
          }
        })
      }

      // Create invoice items and update stock
      if (invoiceItems && invoiceItems.length > 0) {
        for (const item of invoiceItems) {
          // Create invoice item
          await tx.invoiceitems.create({
            data: {
              invoice_no: invoice.id,
              name_of_product: parseInt(item.name_of_product),
              qty: item.qty,
              rate: item.rate,
              subtotal: item.subtotal,
              hsn: item.hsn,
              part: item.part,
              category_id: item.category_id,
              model_id: item.model_id,
              company_id: item.company_id,
              invoice_date: invoice.invoice_date,
              fy: invoice.fy
            }
          })

          // Update product stock (decrease for sales)
          await tx.product.update({
            where: { id: parseInt(item.name_of_product) },
            data: {
              stock: {
                decrement: item.qty
              }
            }
          })
        }
      }

      return invoice
    })

    res.status(201).json(result)
  } catch (error) {
    console.error('Invoice creation error:', error)
    res.status(500).json({ 
      message: 'Failed to create invoice',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
