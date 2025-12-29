import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { getNextInvoiceNumber } from '../../../lib/invoice-counter'
import { withObservability } from '../../../lib/withObservability'
import { calculatePaymentStatus } from '../../../lib/payment-allocation-service'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    case 'PUT':
      return handlePut(req, res)
    default:
      return res.status(405).json({ message: 'Method not allowed' })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    // ===== INVOICE NUMBERING =====
    // Get next invoice number based on current financial year
    const { nextInvoiceNo, currentFy } = await getNextInvoiceNumber('invoice');

    const {
      // ===== MAIN SALE TABLE FIELDS (ALL STORED) =====
      // invoice_number is now auto-generated based on FY
      bill_reference,
      staff_id,
      mechanic_id,
      commission,
      date,

      // ===== CUSTOMER RELATIONSHIP (ONLY FK STORED) =====
      customer_id,

      // ===== TRANSPORT FIELDS =====
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

    console.log('📝 API Received POST data for sale:', req.body);

    // ===== VALIDATION =====
    // Allow customer_id to be 0 (Other)
    if (customer_id === undefined || customer_id === null || !items || items.length === 0) {
      return res.status(400).json({
        message: 'Missing required fields: customer_id, or items'
      })
    }

    // ===== VALIDATE CUSTOMER EXISTS =====
    let existingCustomer = null;
    if (parseInt(customer_id) !== 0) {
      existingCustomer = await prisma.customer_details.findUnique({
        where: { id: parseInt(customer_id) }
      })

      if (!existingCustomer) {
        return res.status(400).json({
          message: 'Invalid customer selected - customer does not exist'
        })
      }
    }

    // Validate payment_status and payment_mode (Phase 2: Payment Allocation)
    const validPaymentStatuses = [0, 1, 2]; // 0=Unpaid, 1=Partial, 2=Paid
    const validPaymentModes = [0, 1];

    const parsedPaymentStatus = payment_status !== undefined && payment_status !== null
      ? parseInt(payment_status.toString())
      : 0;

    const parsedPaymentMode = payment_mode !== undefined && payment_mode !== null
      ? parseInt(payment_mode.toString())
      : 1;

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

    console.log('✅ Payment validation passed');
    console.log('📋 Auto-generated invoice number:', nextInvoiceNo, 'for FY:', currentFy);

    // Convert date to Unix timestamp
    const invoiceDate = new Date(date).getTime() / 1000

    // Calculate totals
    const itemsTotal = items.reduce((sum, item) => sum + (item.qty * item.rate), 0)
    const calculatedGrandTotal = itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0)

    // ===== CRITICAL FIX: Use database transaction for atomic operations =====
    // This ensures sale creation, item creation, stock updates, and related records all succeed or all fail together
    // Increased timeout to 30 seconds to handle large sales with many items
    const sale = await prisma.$transaction(async (tx) => {
      // Create sale record within transaction
      const saleData: any = {
        invoice_no: nextInvoiceNo,
        bill_reference: bill_reference || '',
        commission: commission || 0,
        items_total: itemsTotal,
        freight: transport_cost || 0,
        total_taxable_value: itemsTotal,
        total_cgst: total_cgst || 0,
        total_sgst: total_sgst || 0,
        total_igst: total_igst || 0,
        total_tax: total_tax || 0,
        total: calculatedGrandTotal,
        notes: notes || '',
        descriptions: descriptions || '',
        packing_forwarding_qty: packing_forwarding_qty || 0,
        packing_forwarding_rate: packing_forwarding_rate || 0,
        packing_forwarding_total: packing_forwarding_total || 0,
        invoice_date: Math.floor(invoiceDate),
        payment_status: parsedPaymentStatus,
        payment_mode: parsedPaymentMode,
        fy: currentFy
      };

      // Add staff and mechanic relations if provided
      if (staff_id) {
        saleData.staff = { connect: { id: parseInt(staff_id) } };
      }
      if (mechanic_id) {
        saleData.mechanic = { connect: { id: parseInt(mechanic_id) } };
      }

      const sale = await tx.invoice.create({
        data: saleData
      })

      // ===== PERFORMANCE FIX: Batch load all products at once =====
      // Instead of N separate product.findUnique queries, do 1 batch query
      const productIds = items.map(item => parseInt(item.product_id));
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          product_name: true,
          hsn: true,
          product_category_id: true,
          product_subcategory_id: true,
          company_id: true,
          stock: true
        }
      });

      // Create product lookup map for O(1) access
      const productMap = new Map(products.map(product => [product.id, product]));

      // Validate all products exist and check stock
      for (const item of items) {
        const productId = parseInt(item.product_id);
        const product = productMap.get(productId);

        if (!product) {
          throw new Error(`Product with ID ${productId} not found`);
        }

        // Check stock availability
        if (product.stock < item.qty) {
          throw new Error(`Insufficient stock for product "${product.product_name}": available ${product.stock}, requested ${item.qty}`);
        }
      }

      // Create sale items and update stock within the same transaction
      for (const item of items) {
        const productId = parseInt(item.product_id);
        const product = productMap.get(productId)!;

        const modelId = item.model_id ? parseInt(item.model_id) : null;

        await tx.invoiceitems.create({
          data: {
            invoice_no: sale.id,
            product_id: productId,
            name_of_product: item.product_name || product.product_name || '',
            category_id: product.product_category_id,
            subcategory_id: product.product_subcategory_id,
            model_id: modelId,
            company_id: product.company_id,
            hsn: product.hsn,
            part: item.part || '',
            qty: item.qty,
            rate: item.rate,
            subtotal: item.qty * item.rate,
            gst_percentage: item.gst_percentage || 0,
            cgst: item.cgst || 0,
            sgst: item.sgst || 0,
            igst: item.igst || 0,
            tax: item.tax || 0,
            fy: currentFy,
            invoice_date: invoiceDate
          }
        })

        // Validate and convert quantity to number to prevent null/undefined/0 issues
        const validatedQty = Number(item.qty) || 0;

        // Decrease product stock within transaction
        await tx.product.update({
          where: { id: productId },
          data: {
            stock: {
              decrement: validatedQty
            }
          }
        })
      }

      // Create customer relationship within transaction
      await tx.bill_tosales.create({
        data: {
          invoice_no: sale.id,
          billing_name: req.body.customer_name || existingCustomer?.billing_name || 'Other',
          contact_no: req.body.contact_number || existingCustomer?.contact_no || '',
          email: req.body.email_id || existingCustomer?.email || '',
          billing_address: req.body.address || existingCustomer?.billing_address || '',
          billing_address2: existingCustomer?.billing_address_2 || '',
          billing_city: req.body.city || existingCustomer?.billing_city || '',
          billing_state: req.body.state || existingCustomer?.billing_state || '',
          billing_state_code: req.body.state_code || existingCustomer?.billing_state_code || null,
          billing_gstin: req.body.gst_number || existingCustomer?.billing_gstin || ''
        }
      })

      // Create shipping details within transaction
      await tx.shipto.create({
        data: {
          invoice_no: sale.id,
          shipping_name: req.body.customer_name || existingCustomer?.shipping_name || existingCustomer?.billing_name || 'Other',
          shipping_address: req.body.address || existingCustomer?.shipping_address || existingCustomer?.billing_address || '',
          shipping_address2: existingCustomer?.shipping_address_2 || existingCustomer?.billing_address_2 || '',
          shipping_city: req.body.city || existingCustomer?.shipping_city || existingCustomer?.billing_city || '',
          shipping_state: req.body.state || existingCustomer?.shipping_state || existingCustomer?.billing_state || '',
          shipping_state_code: existingCustomer?.shipping_state_code || existingCustomer?.billing_state_code || null,
          shipping_gstin: req.body.gst_number || existingCustomer?.shipping_gstin || existingCustomer?.billing_gstin || '',
          shipping: true
        }
      })

      return sale;
    }, {
      timeout: 30000 // 30 second timeout for large sales
    });

    // Create customer ledger entry for sale (outside transaction)
    try {
      const { recordSaleTransaction, recordReceiptTransaction } = await import('../../../lib/customer-ledger-service')
      
      await recordSaleTransaction(
        parseInt(customer_id),
        sale.id,
        sale.invoice_no.toString(),
        calculatedGrandTotal,
        Math.floor(invoiceDate),
        currentFy,
        notes || `Sale invoice ${sale.invoice_no}`
      )

      // If paid immediately, create receipt entry
      if (parsedPaymentStatus === 1) {
        await recordReceiptTransaction(
          parseInt(customer_id),
          sale.id,
          `PAY-${String(sale.id).padStart(3, '0')}`,
          calculatedGrandTotal,
          Math.floor(invoiceDate),
          parsedPaymentMode,
          currentFy,
          `Payment received for sale ${sale.invoice_no}`
        )
      }
    } catch (ledgerError) {
      console.error('Failed to create customer ledger entry:', ledgerError)
      // Don't fail the sale if ledger entry fails
    }

    res.status(201).json({
      message: 'Sale created successfully',
      sale: {
        id: sale.id,
        invoice_no: sale.invoice_no,
        total: sale.total,
        customer_name: existingCustomer?.billing_name || req.body.customer_name || 'Other'
      }
    })

  } catch (error) {
    console.error('Sale creation error:', error)
    res.status(500).json({
      message: 'Failed to create sale',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
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

      // ===== TRANSPORT FIELDS =====
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

    // ===== VALIDATION =====
    if (!invoice_number || customer_id === undefined || customer_id === null) {
      return res.status(400).json({
        message: 'Missing required fields: invoice_number or customer_id'
      })
    }

    // ===== VALIDATE CUSTOMER EXISTS =====
    let existingCustomer = null;
    if (parseInt(customer_id) !== 0) {
      existingCustomer = await prisma.customer_details.findUnique({
        where: { id: parseInt(customer_id) }
      })

      if (!existingCustomer) {
        return res.status(400).json({
          message: 'Invalid customer selected - customer does not exist'
        })
      }
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

    // ===== VALIDATE PAYMENT FIELDS =====
    const validPaymentStatuses = [0, 1, 2]; // 0=Unpaid, 1=Partial, 2=Paid
    const validPaymentModes = [0, 1];

    const parsedPaymentStatus = payment_status !== undefined && payment_status !== null
      ? parseInt(payment_status.toString())
      : 0;

    const parsedPaymentMode = payment_mode !== undefined && payment_mode !== null
      ? parseInt(payment_mode.toString())
      : 1;

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

    // Get old sale data before update for comparison
    const oldSale = await prisma.invoice.findUnique({
      where: { id: saleId },
      select: { total: true, payment_status: true }
    })

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

    const calculatedGrandTotal = itemsTotal + (packing_forwarding_total || 0) + (transport_cost || 0) + (total_tax || 0)

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update sale record
      const saleUpdateData: any = {
        bill_reference: bill_reference || '',
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
        invoice_date: Math.floor(invoiceDate),
        payment_status: parsedPaymentStatus,
        payment_mode: parsedPaymentMode,
        fy: financialYear
      };

      // Handle staff and mechanic relations
      if (staff_id) {
        saleUpdateData.staff = { connect: { id: parseInt(staff_id) } };
      } else {
        saleUpdateData.staff = { disconnect: true };
      }

      if (mechanic_id) {
        saleUpdateData.mechanic = { connect: { id: parseInt(mechanic_id) } };
      } else {
        saleUpdateData.mechanic = { disconnect: true };
      }

      const sale = await tx.invoice.update({
        where: { id: saleId },
        data: saleUpdateData
      })

      // Handle item-level updates if items provided
      if (items && items.length > 0) {
        // Get existing sale items for comparison
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

            await tx.invoiceitems.create({
              data: {
                invoice_no: sale.id,
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

            // Validate and convert quantity to number to prevent null/undefined/0 issues
            const validatedNewQty = Number(newData.qty) || 0;

            // Decrease stock for new sales
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

            if (Math.abs(qtyDifference) > 0.001) { // Allow for small floating point differences
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
                    increment: -qtyDifference // Negative because sales decrease stock
                  }
                }
              })
            }
          }
        }
      }

      // Update customer relationship
      await tx.bill_tosales.upsert({
        where: { invoice_no: sale.id },
        update: {
          billing_name: req.body.customer_name || existingCustomer?.billing_name || 'Other',
          contact_no: req.body.contact_number || existingCustomer?.contact_no || '',
          email: req.body.email_id || existingCustomer?.email || '',
          billing_address: req.body.address || existingCustomer?.billing_address || '',
          billing_address2: existingCustomer?.billing_address_2 || '',
          billing_city: req.body.city || existingCustomer?.billing_city || '',
          billing_state: req.body.state || existingCustomer?.billing_state || '',
          billing_state_code: req.body.state_code || existingCustomer?.billing_state_code || null,
          billing_gstin: req.body.gst_number || existingCustomer?.billing_gstin || ''
        },
        create: {
          invoice_no: sale.id,
          billing_name: req.body.customer_name || existingCustomer?.billing_name || 'Other',
          contact_no: req.body.contact_number || existingCustomer?.contact_no || '',
          email: req.body.email_id || existingCustomer?.email || '',
          billing_address: req.body.address || existingCustomer?.billing_address || '',
          billing_address2: existingCustomer?.billing_address_2 || '',
          billing_city: req.body.city || existingCustomer?.billing_city || '',
          billing_state: req.body.state || existingCustomer?.billing_state || '',
          billing_state_code: req.body.state_code || existingCustomer?.billing_state_code || null,
          billing_gstin: req.body.gst_number || existingCustomer?.billing_gstin || ''
        }
      })

      // Update shipping details
      await tx.shipto.upsert({
        where: { invoice_no: sale.id },
        update: {
          shipping_name: req.body.customer_name || existingCustomer?.shipping_name || existingCustomer?.billing_name || 'Other',
          shipping_address: req.body.address || existingCustomer?.shipping_address || existingCustomer?.billing_address || '',
          shipping_address2: existingCustomer?.shipping_address_2 || existingCustomer?.billing_address_2 || '',
          shipping_city: req.body.city || existingCustomer?.shipping_city || existingCustomer?.billing_city || '',
          shipping_state: req.body.state || existingCustomer?.shipping_state || existingCustomer?.billing_state || '',
          shipping_state_code: existingCustomer?.shipping_state_code || existingCustomer?.billing_state_code || null,
          shipping_gstin: req.body.gst_number || existingCustomer?.shipping_gstin || existingCustomer?.billing_gstin || '',
          shipping: true
        },
        create: {
          invoice_no: sale.id,
          shipping_name: req.body.customer_name || existingCustomer?.shipping_name || existingCustomer?.billing_name || 'Other',
          shipping_address: req.body.address || existingCustomer?.shipping_address || existingCustomer?.billing_address || '',
          shipping_address2: existingCustomer?.shipping_address_2 || existingCustomer?.billing_address_2 || '',
          shipping_city: req.body.city || existingCustomer?.shipping_city || existingCustomer?.billing_city || '',
          shipping_state: req.body.state || existingCustomer?.shipping_state || existingCustomer?.billing_state || '',
          shipping_state_code: existingCustomer?.shipping_state_code || existingCustomer?.billing_state_code || null,
          shipping_gstin: req.body.gst_number || existingCustomer?.shipping_gstin || existingCustomer?.billing_gstin || '',
          shipping: true
        }
      })

      return sale
    })

    // Create ledger adjustment entries if amount changed (outside transaction)
    if (oldSale && oldSale.total !== calculatedGrandTotal) {
      try {
        const { recordSaleAdjustmentTransaction, recordReceiptAdjustmentTransaction } = await import('../../../lib/customer-ledger-service')
        
        const diff = calculatedGrandTotal - Number(oldSale.total)
        
        // Create sale adjustment entry
        await recordSaleAdjustmentTransaction(
          parseInt(customer_id),
          result.id,
          result.invoice_no.toString(),
          diff,
          Math.floor(invoiceDate),
          financialYear,
          `Sale amount adjusted from ₹${oldSale.total} to ₹${calculatedGrandTotal}`
        )
        
        // If sale was paid, create receipt adjustment
        if (parsedPaymentStatus === 1) {
          await recordReceiptAdjustmentTransaction(
            parseInt(customer_id),
            result.id,
            result.id,
            `ADJ-${String(result.id).padStart(3, '0')}`,
            diff,
            Math.floor(invoiceDate),
            financialYear,
            `Receipt adjusted for sale amount change`
          )
          
          // Update payment allocations
          await prisma.customer_payment_allocations.updateMany({
            where: { invoice_id: result.id },
            data: { allocated_amount: calculatedGrandTotal }
          })
        }
      } catch (ledgerError) {
        console.error('Failed to create ledger adjustment entries:', ledgerError)
        // Don't fail the update if ledger entry fails
      }
    }

    res.status(200).json({
      message: 'Sale updated successfully',
      sale: {
        id: result.id,
        invoice_no: result.invoice_no,
        total: result.total,
        customer_name: existingCustomer?.billing_name || req.body.customer_name || 'Other'
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

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      page = '1',
      limit = '50',
      search = '',
      startDate = '',
      endDate = '',
      fy = '',
      status = '',
      vendor = '',
      uid = '', // Filter by invoice number
      billRef = '', // NEW: Filter by bill reference
      items = '', // NEW: Filter by item count
      taxAmount = '', // NEW: Filter by tax amount
      pf = '', // NEW: Filter by packing/forwarding amount
      paymentMode = '', // NEW: Filter by payment mode
      sortBy = 'invoice_date', // Sort field (default: invoice_date)
      sortOrder = 'desc' // Sort order (default: desc)
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    // Handle UID filtering - filter by invoice_no for "Invoice No" filter
    if (uid && uid !== '') {
      where.invoice_no = parseInt(uid as string)
    }

    // NEW: Filter by bill reference
    if (billRef && billRef !== '') {
      where.bill_reference = { contains: billRef as string }
    }

    if (search) {
      const searchStr = Array.isArray(search) ? search[0] : search;
      const searchNum = parseInt(searchStr);
      where.OR = [
        !isNaN(searchNum) ? { invoice_no: searchNum } : undefined,
        { notes: { contains: searchStr } },
      ].filter(Boolean) // Remove undefined values
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

    if (status && status !== '') {
      if (status === '1' || status === '0') {
        where.payment_status = parseInt(status)
      } else if (status === 'unknown') {
        // For unknown status, show statuses that are not 0, 1, or 2 (2 is cancelled for sales)
        where.payment_status = { notIn: [0, 1, 2] }
      }
    }

    // NEW: Filter by payment mode
    if (paymentMode && paymentMode !== '') {
      where.payment_mode = parseInt(paymentMode as string)
    }

    // NEW: Filter by tax amount
    if (taxAmount && taxAmount !== '') {
      where.total_tax = { gte: parseFloat(taxAmount as string) }
    }

    // NEW: Filter by packing/forwarding amount
    if (pf && pf !== '') {
      where.packing_forwarding_total = { gte: parseFloat(pf as string) }
    }

    // NEW: Filter by item count - will be handled after fetching data since it's not stored on invoice table
    const itemsFilter = items && items !== '' ? parseInt(items as string) : null

    // Validate and set sort parameters - COMPLETE LIST for SaleTable compatibility
    const validSortFields = [
      'id', 'invoice_no', 'customer_name', 'total', 'invoice_date',
      'payment_status', 'fy', 'bill_reference', 'item_count',
      'total_tax', 'packing_forwarding_total', 'payment_mode'
    ]
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'invoice_date'
    const sortDirection = (sortOrder as string) === 'desc' ? 'desc' : 'asc'

    // For customer_name sorting, we need to fetch all data first and sort in JavaScript
    // For other fields, we can sort at database level
    const needsPostSorting = sortField === 'customer_name'

    let salesInvoices: any[]
    let total: number

    if (needsPostSorting) {
      // Get all sales invoices without sorting (we'll sort after fetching customer names)
      const result = await Promise.all([
        prisma.invoice.findMany({
          where,
        select: {
            id: true,
            invoice_no: true,
            select_customer: true,
            items_total: true,
            freight: true,
            total_taxable_value: true,
            taxrate: true,
            total_cgst: true,
            total_sgst: true,
            total_igst: true,
            total_tax: true,
            total: true,
            notes: true,
            invoice_date: true,
            payment_status: true,
            payment_mode: true,
            fy: true,
            bill_reference: true,
            return_status: true,
            packing_forwarding_total: true
          }
        }),
        prisma.invoice.count({ where })
      ])
      salesInvoices = result[0]
      total = result[1]
    } else {
      // Get sales invoices with database-level sorting
      const result = await Promise.all([
        prisma.invoice.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { [sortField]: sortDirection },
          select: {
            id: true,
            invoice_no: true,
            select_customer: true,
            items_total: true,
            freight: true,
            total_taxable_value: true,
            taxrate: true,
            total_cgst: true,
            total_sgst: true,
            total_igst: true,
            total_tax: true,
            total: true,
            notes: true,
            invoice_date: true,
            payment_status: true,
            payment_mode: true,
            fy: true,
            bill_reference: true,
            return_status: true,
            packing_forwarding_total: true
          }
        }),
        prisma.invoice.count({ where })
      ])
      salesInvoices = result[0]
      total = result[1]
    }

    // Get customer names, bill_to data, item counts, and payment allocations in batch queries
    const invoiceIds = salesInvoices.map((inv: { id: any }) => inv.id)
    // Get bill_to data for "Other" customers (select_customer = 0)
    const otherCustomerInvoices = salesInvoices.filter((inv: any) => inv.select_customer === 0).map((inv: any) => inv.id)

    const [customerData, itemCounts, billToData, paymentAllocations] = await Promise.all([
      // Get customer IDs from invoices first
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, select_customer: true }
      }),

      // Get all item counts in one query
      prisma.invoiceitems.groupBy({
        by: ['invoice_no'],
        where: { invoice_no: { in: invoiceIds } },
        _count: { id: true }
      }),

      // Get bill_to data for "Other" customers
      otherCustomerInvoices.length > 0 ? prisma.bill_tosales.findMany({
        where: { invoice_no: { in: otherCustomerInvoices } },
        select: { invoice_no: true, billing_name: true, contact_no: true, email: true, billing_address: true, billing_address2: true, billing_city: true, billing_state: true, billing_gstin: true }
      }) : Promise.resolve([]),

      // Get payment allocations for all invoices
      invoiceIds.length > 0 ? prisma.customer_payment_allocations.groupBy({
        by: ['invoice_id'],
        where: { invoice_id: { in: invoiceIds } },
        _sum: { allocated_amount: true }
      }) : Promise.resolve([])
    ])

    // Get customer details separately
    const customerIds = customerData
      .map(inv => inv.select_customer)
      .filter(id => id !== null && id !== 0)

    const customerDetails = customerIds.length > 0 ? await prisma.customer_details.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, billing_name: true, billing_gstin: true }
    }) : []

    // Create lookup maps for fast access
    const customerMap = new Map()
    const gstinMap = new Map()
    const billToMap = new Map(billToData.map(billTo => [billTo.invoice_no, billTo]))

    // Create customer lookup map
    const customerLookupMap = new Map(customerDetails.map(cust => [cust.id, cust]))

    customerData.forEach(invoice => {
      const customer = customerLookupMap.get(invoice.select_customer)
      if (customer) {
        customerMap.set(invoice.id, customer.billing_name)
        gstinMap.set(invoice.id, customer.billing_gstin)
      }
    })

    const itemCountMap = new Map(itemCounts.map((item: any) => [item.invoice_no, item._count.id]))
    const paymentMap = new Map(paymentAllocations.map((payment: any) => [payment.invoice_id, Number(payment._sum.allocated_amount || 0)]))

    // Enhanced sales invoices using maps
    let enhancedSales = salesInvoices.map((invoice: any) => {
      // Calculate outstanding amount
      const totalPaid = paymentMap.get(invoice.id) || 0
      const outstandingAmount = Number(invoice.total) - totalPaid

      // Handle integer timestamp format for sales
      let formattedDate = 'Invalid Date'
      try {
        if (invoice.invoice_date) {
          // Sales dates are stored as integer timestamps
          const dateObj = new Date(invoice.invoice_date * 1000)
          if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toLocaleDateString('en-IN')
          }
        }
      } catch (error) {
        console.warn('Invalid date format for sale:', invoice.invoice_date)
      }

      return {
        id: invoice.id,
        invoice_no: invoice.invoice_no,
        // OPTIMIZATION: Commented out unused customer ID field
        // select_customer: invoice.select_customer,
        customer_name: customerMap.get(invoice.id) || billToMap.get(invoice.id)?.billing_name || 'Other',
        // OPTIMIZATION: Removed customer_gstin as it's always empty
        // OPTIMIZATION: Commented out fields only used in removed expanded details
        // items_total: invoice.items_total || 0,
        // freight: invoice.freight || 0,
        // total_taxable_value: invoice.total_taxable_value,
        // taxrate: invoice.taxrate || 0,
        // total_cgst: invoice.total_cgst || 0,
        // total_sgst: invoice.total_sgst || 0,
        // total_igst: invoice.total_igst || 0,
        total_tax: invoice.total_tax || 0,
        // notes: invoice.notes || '',
        // transport: '', // Not fetched in sales API
        // items: [], // Never populated in GET response
        total: invoice.total,
        bill_reference: invoice.bill_reference || '',
        invoice_date: invoice.invoice_date,
        payment_status: invoice.payment_status || 0,
        payment_mode: invoice.payment_mode || 0,
        return_status: invoice.return_status || 0,
        fy: invoice.fy,
        type: invoice.type || 'sale',
        item_count: itemCountMap.get(invoice.id) || 0,
        packing_forwarding_total: invoice.packing_forwarding_total || 0,
        // Payment allocation summary (NEW)
        total_paid: totalPaid,
        outstanding_amount: outstandingAmount,
        // OPTIMIZATION: Commented out unused formatted fields - frontend handles formatting
        // formattedDate,
        // formattedTotal: invoice.total.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })
      }
    })

    // Apply item count filtering if specified
    if (itemsFilter !== null && !isNaN(itemsFilter)) {
      enhancedSales = enhancedSales.filter(sale => (sale.item_count || 0) >= itemsFilter!)
    }

    // Apply post-sorting for customer_name if needed
    if (needsPostSorting) {
      enhancedSales.sort((a, b) => {
        const aValue = (a.customer_name || '').toString().toLowerCase()
        const bValue = (b.customer_name || '').toString().toLowerCase()

        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
        return 0
      })

      // Apply pagination after sorting
      enhancedSales = enhancedSales.slice(skip, skip + limitNum)
    }

    const totalPages = Math.ceil(total / limitNum)

    res.status(200).json({
      sales: enhancedSales,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasMore: pageNum < totalPages,
      },
    })
  } catch (error) {
    console.error('Sales fetch error:', error)
    res.status(500).json({
      message: 'Failed to fetch sales data',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

export default withObservability(handler)
