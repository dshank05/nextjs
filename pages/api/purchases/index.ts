import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'
import { withObservability } from '../../../lib/withObservability'
import { listPurchases, parsePurchaseListQuery } from '../../../lib/purchase-query'
import { listResponse } from '../../../lib/api/list-query'
import { fail } from '../../../lib/api/respond'
import { getNextInvoiceNumber } from '../../../lib/invoice-counter'
import { ledgerService } from '../../../lib/ledger-service'
import { balanceHandler } from '../../../lib/balance-handler'
import { getLocalDateString, convertDateToTimestamp } from '../../../lib/date-utils'
import { validatePurchase, computePurchaseTotals, getBusinessGstin, num } from '../../../lib/purchase'
import { parseStateCode } from '../../../lib/purchase-edit'
import { allocateFromAdvance } from '../../../lib/advance-allocation'

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

/** The list - see lib/purchase-query.ts. `purchases` is the key existing callers read. */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { purchases, pagination } = await listPurchases(parsePurchaseListQuery(req))
    return res.status(200).json(listResponse(purchases, pagination, 'purchases'))
  } catch (error) {
    return fail(res, error, 'fetch purchases')
  }
}

/**
 * `attempt` exists for the invoice-number race (F-13 / P4-05).
 *
 * UNIQUE(fy, invoice_no) makes a duplicate impossible to write, which is the
 * part that actually matters - getNextInvoiceNumber reads MAX+1 inside a
 * transaction that only READS, so it holds no lock and two concurrent creates
 * can read the same maximum. The index turns that from silent duplication into
 * a constraint error.
 *
 * But an auto-numbered create losing that race should take the next number, not
 * fail in front of the user. So a P2002 on an auto-generated number re-reads the
 * counter and tries again. A number the USER chose is not retried: there the
 * collision is a real answer and they need to see it.
 */
const MAX_INVOICE_ATTEMPTS = 3;

async function handlePost(req: NextApiRequest, res: NextApiResponse, attempt: number = 1) {
  const startTime = Date.now();

  try {
    const { nextInvoiceNo, currentFy } = await getNextInvoiceNumber('purchase');

    const {
      invoice_number,
      bill_reference,
      bill_reference_date,
      staff_id,
      date,
      vendor_id,
      items,
      descriptions,
      packing_forwarding_qty,
      packing_forwarding_rate,
      packing_forwarding_total,
      total_cgst,
      total_sgst,
      total_igst,
      notes,
      total_tax,
      payment_status,
      payment_mode
    } = req.body

    // ===== STEP 1: DETERMINE INVOICE NUMBER TO USE =====
    // Use UI-provided invoice_number if present, otherwise use auto-generated
    const invoiceNumberToUse = invoice_number ? parseInt(invoice_number) : nextInvoiceNo;

    // ===== DUPLICATE INVOICE NUMBER VALIDATION =====
    //
    // Scoped to the financial year, because the COUNTER is scoped to the
    // financial year. getNextInvoiceNumber('purchase') returns
    // MAX(invoice_no) + 1 WHERE fy = currentFy, so a new FY restarts near 1 -
    // but this check used to look at invoice_no across ALL years, find last
    // year's row, and refuse.
    //
    // That is not a rare race. It is every 1 April: the counter restarts, and
    // every number up to the previous year's maximum is blocked, so
    // auto-numbered purchase creation stops working until someone manually
    // types a number above the all-time maximum. Reproduced: a FY 3 purchase
    // numbered 501 made the FY 4 counter's 501 fail with
    // "Invoice number 501 already exists" (P4-02, lead L-1).
    //
    // An invoice number is only ever unique WITHIN a financial year - that is
    // what the counter means by it, what the documents mean by it, and what
    // the UNIQUE(fy, invoice_no) index enforces.
    const existingPurchase = await prisma.purchase.findFirst({
      where: {
        invoice_no: invoiceNumberToUse,
        fy: currentFy
      }
    });

    if (existingPurchase) {
      return res.status(400).json({
        message: `Invoice number ${invoiceNumberToUse} already exists in this financial year`,
        error_code: 'DUPLICATE_INVOICE_NO'
      });
    }

    // ===== STEP 2: VALIDATION =====
    //
    // One validator, shared with the update path, so the two cannot drift
    // apart again. They already had: create accepted payment_status 0 or 1
    // while update accepted 0, 1 or 2 (L-5).
    const failure = await validatePurchase(req.body, { partial: false });
    if (failure) {
      return res.status(failure.status).json({ message: failure.message });
    }

    if (parseInt(vendor_id) === 0) {
      if (!req.body.contact_number || req.body.contact_number.trim() === '') {
        return res.status(400).json({
          message: 'Phone number is required for "Other" vendor selection'
        })
      }
    }

    const existingVendor = await prisma.vendor_details.findUnique({
      where: { id: parseInt(vendor_id) }
    })

    // ===== STEP 3: DATA PREPARATION ===== 
    // ✅ TIMEZONE SAFE: Use convertDateToTimestamp for consistent midnight local time
    // ✅ VALIDATION: Fallback to current date if not provided
    const invoiceDate = date
      ? convertDateToTimestamp(date)
      : Math.floor(Date.now() / 1000);
    // ===== Money: computed here, never taken from the payload =====
    //
    // Every total, and the whole CGST/SGST/IGST split, is derived from the
    // lines and the two state codes. The client's own total_cgst, total_sgst,
    // total_igst and total_tax are now ignored entirely (P4-12, F-04, and the
    // statutory requirement in AUDIT_PLAN 4a).
    //
    // This also removes the NaN route that made P4-04 a 500: `num()` coerces
    // every term, so a missing field is 0.
    //
    // The vendor is the SUPPLIER on a purchase and we are the recipient, so the
    // comparison is the vendor's state against ours - ours coming from
    // business_details.gstin, which is the only place it exists (F-30).
    const businessGstin = await getBusinessGstin();
    // The bill's own state - the one written to bill_to below - with the
    // vendor master as the fallback. Same rule as edit (PU-18).
    const billStateCode = req.body.state_code !== undefined && req.body.state_code !== null && req.body.state_code !== ''
      ? parseStateCode(req.body.state_code)
      : (existingVendor?.state_code ?? null);
    const totals = computePurchaseTotals({
      items,
      packingQty: packing_forwarding_qty,
      packingRate: packing_forwarding_rate,
      packingTotal: packing_forwarding_total,
      vendorStateCode: billStateCode,
      businessGstin,
      hasVendorState: billStateCode != null
    });

    // A supply type we cannot resolve is a configuration error, not something
    // to guess at. Charging CGST+SGST on what might be an inter-state purchase
    // understates IGST, which is a real tax error - so say so instead.
    if (totals.supplyType === null) {
      return res.status(400).json({
        message:
          'Cannot determine the tax type for this purchase. Check that the vendor has a valid state ' +
          'and that the business GSTIN in Settings is correct.',
        error_code: 'SUPPLY_TYPE_UNRESOLVED'
      })
    }

    const itemsTotal = totals.itemsTotal;
    const calculatedGrandTotal = totals.grandTotal;
    // Note: Freight (transport_cost) is stored separately but NOT included in total

    if (!Number.isFinite(calculatedGrandTotal)) {
      return res.status(400).json({
        message: 'Could not compute a valid total from the supplied amounts'
      })
    }

    // ===== STEP 4: OPTIMIZED DATABASE TRANSACTION =====
    const purchase = await prisma.$transaction(async (tx) => {
      // ===== DB OPERATION 1: Create purchase record =====
      // ✅ FIX: Build data object based on vendor_id to avoid mixing relation and unchecked syntax
      const purchaseData: any = {
        invoice_no: invoiceNumberToUse,
        bill_reference: bill_reference,
        bill_reference_date: bill_reference_date ? new Date(bill_reference_date).toISOString() : null,
        items_total: itemsTotal,
        freight: num(req.body.transport_cost),
        total_taxable_value: itemsTotal,
        total_cgst: totals.totalCgst,
        total_sgst: totals.totalSgst,
        total_igst: totals.totalIgst,
        total_tax: totals.totalTax,
        total: calculatedGrandTotal,
        notes: notes || '',
        descriptions: descriptions,
        packing_forwarding_qty: num(packing_forwarding_qty),
        packing_forwarding_rate: num(packing_forwarding_rate),
        // Derived from qty x rate, the way the update path always did it. Create
        // used to store whatever total the client sent, so the same input gave
        // different answers on the two paths (L-20).
        packing_forwarding_total: totals.packingTotal,
        invoice_date: Math.floor(invoiceDate),
        updated_at: getLocalDateString(),
        payment_status: payment_status || 0,
        payment_mode: payment_mode,
        fy: currentFy,
        transport: req.body.transport_name || '',
        transport_name: req.body.transport_name,
        vehicle_number: req.body.vehicle_number,
        return_status: 0
      };

      // Add staff relation if provided
      if (staff_id) {
        purchaseData.staff = { connect: { id: parseInt(staff_id) } };
      }

      // Handle vendor: use relation for real vendors, direct field for "Other" (vendor_id = 0)
      if (parseInt(vendor_id) === 0) {
        purchaseData.vendor_id = 0;
      } else {
        purchaseData.vendor = { connect: { id: parseInt(vendor_id) } };
      }

      const purchase = await tx.purchase.create({
        data: purchaseData
      });

      // ===== DB OPERATION 2: Create bill_to record =====
      //
      // invoiceNumberToUse, the same number the purchase and its items carry.
      //
      // This used `nextInvoiceNo` - always the auto-generated number, even when
      // the user supplied their own. Supplying `invoice_number: 500` wrote the
      // purchase and its items at 500 and the billing snapshot at 1, leaving it
      // attached to a number no purchase had. And because bill_to.invoice_no is
      // UNIQUE, the next purchase legitimately numbered 1 then collided with it
      // (P4-03, lead L-2).
      await tx.bill_to.create({
        data: {
          purchase_id: purchase.id,
          invoice_no: invoiceNumberToUse,
          fy: currentFy,
          vendor_name: req.body.vendor_name ?? existingVendor?.vendor_name ?? '',
          contact_no: req.body.contact_number ?? existingVendor?.contact_no ?? '',
          email: req.body.email_id ?? existingVendor?.email ?? '',
          address: req.body.address ?? existingVendor?.address ?? '',
          address2: req.body.address_2 ?? existingVendor?.address_2 ?? '',
          city: req.body.city ?? existingVendor?.city ?? '',
          state: req.body.state ?? existingVendor?.state ?? '',
          state_code: billStateCode,
          gstin: req.body.gst_number ?? existingVendor?.tax_id ?? '',
          pin_code: req.body.pin_code ?? existingVendor?.pin_code ?? ''
        }
      });

      // ===== DB OPERATION 3: Batch load all products =====
      const productIds = items.map(item => parseInt(item.product_id));
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          product_name: true,
          product_category_id: true,
          product_subcategory_id: true,
          company_id: true,
          hsn: true
        }
      });

      // Create product lookup map for O(1) access
      const productMap = new Map(products.map(product => [product.id, product]));

      // ===== DB OPERATION 4: Validate products exist =====
      for (const item of items) {
        const productId = parseInt(item.product_id);
        if (!productMap.has(productId)) {
          throw new Error(`Product with ID ${productId} not found`);
        }
      }

      // ===== OPTIMIZED DB OPERATION 5: Bulk insert purchase items =====
      const bulkInsertData = items.map((item, lineIndex) => {
        const productId = parseInt(item.product_id);
        const product = productMap.get(productId)!;
        // The server's figures for this line, positionally matched to `items`.
        const lineTotals = totals.lines[lineIndex];

        const modelId = item.model_id ? parseInt(item.model_id) : null;
        const companyId = item.company_id ? parseInt(item.company_id) : null;

        return {
          invoice_no: purchase.invoice_no,
          product_id: productId,
          name_of_product: product.product_name,
          category_id: product.product_category_id || 0,
          subcategory_id: product.product_subcategory_id || 0,
          model_id: modelId,
          company_id: companyId,
          car_model: item.car_model || '',
          vendor_id: parseInt(vendor_id),
          part: item.part || '',
          qty: lineTotals.qty,
          rate: lineTotals.rate,
          // subtotal is qty x rate computed here, not the client's `total`.
          subtotal: lineTotals.taxable,
          gst_percentage: lineTotals.gst_percentage,
          cgst: lineTotals.cgst,
          sgst: lineTotals.sgst,
          igst: lineTotals.igst,
          tax: lineTotals.tax,
          fy: currentFy,
          invoice_date: invoiceDate
        };
      });

      // Use Prisma's createMany for bulk insert
      await tx.purchaseitems.createMany({
        data: bulkInsertData.map(item => ({
          ...item,
          purchase_id: purchase.id,
          invoice_no: invoiceNumberToUse
        }))
      });

      // ===== OPTIMIZED: Parallel stock updates and ledger creation =====
      // ===== Advance breakdown, computed ONCE (L-9 / P4-18) =====
      //
      // This used to be worked out twice inside this one function - here for the
      // ledger note, and again in the payment block below - each with its own
      // vendor_details read. Two copies of one rule are free to drift, and if
      // they ever did, the note attached to the ledger entry would describe a
      // different split from the payment rows actually written.
      let advanceUsed = 0;
      let newPayment = 0;
      let purchaseNotes: string | undefined;
      // Hoisted with the breakdown: the balance handler below needs the same
      // vendor row, and re-reading it was half of what P4-18 removed.
      let vendor: {
        total_paid: any;
        total_allocated: any;
        total_refunded: any;
        total_refund_allocated: any;
      } | null = null;

      if (payment_status === 1) {
        vendor = await tx.vendor_details.findUnique({
          where: { id: parseInt(vendor_id) },
          select: {
            total_paid: true,
            total_allocated: true,
            total_refunded: true,
            total_refund_allocated: true
          }
        });

        // Unallocated payments AND unallocated refunds both count as advance.
        const advanceBalance = vendor
          ? (Number(vendor.total_paid) - Number(vendor.total_allocated)) +
          (Number(vendor.total_refunded) - Number(vendor.total_refund_allocated))
          : 0;

        // Allocated from the vendor's existing payments, oldest first - no new
        // payment row for money paid earlier (SA-28). What the rows cannot
        // cover is new money.
        advanceUsed = await allocateFromAdvance(
          tx, 'vendor', parseInt(vendor_id), { purchase_id: purchase.id },
          Math.min(Math.max(0, advanceBalance), calculatedGrandTotal), Math.floor(invoiceDate),
          { mode: payment_mode, fy: currentFy }
        );
        newPayment = Math.round((calculatedGrandTotal - advanceUsed) * 100) / 100;

        if (advanceUsed >= calculatedGrandTotal) {
          purchaseNotes = `Paid using ₹${advanceUsed.toFixed(2)} from advance balance`;
        } else if (advanceUsed > 0) {
          purchaseNotes = `Paid: ₹${advanceUsed.toFixed(2)} from advance + ₹${newPayment.toFixed(2)} new payment`;
        }
      }

      // ===== Stock and rate, aggregated per product =====
      //
      // Three problems lived in the statement this replaces.
      //
      // F-12: it built `stock = CASE id WHEN 5 THEN stock+2 WHEN 5 THEN stock+3
      // END`. SQL CASE takes the FIRST matching WHEN, so putting the same
      // product on two lines silently discarded every line after the first. The
      // rate CASE had the identical flaw, so latest_purchase_rate took the
      // first line's rate rather than the last.
      //
      // L-4: `last_purchase_date` and `latest_purchase_rate` were written
      // unconditionally, so entering a forgotten older bill rewrote the
      // product's current rate with a stale one.
      //
      // G-01: it was hand-built SQL with ids and quantities interpolated into
      // the string. F-12 exists BECAUSE it was hand-built - a CASE with a
      // duplicate WHEN is not a mistake Prisma would let you make. Rewriting it
      // through the query builder fixes the class, not just this instance.
      const perProduct = new Map<number, { qty: number; rate: number }>();
      // From the server's line figures, so stock moves by exactly the qty stored
      // on the line (whole units, PU-33).
      for (const line of totals.lines) {
        const productId = line.product_id;
        if (isNaN(productId)) continue;
        const existing = perProduct.get(productId);
        if (existing) {
          // Same product on another line: quantities ADD, and the later line's
          // rate is the one that stands as "latest".
          existing.qty += line.qty;
          existing.rate = line.rate;
        } else {
          perProduct.set(productId, { qty: line.qty, rate: line.rate });
        }
      }

      // Array.from because this project's tsconfig target predates direct Map
      // iteration.
      for (const [productId, agg] of Array.from(perProduct.entries())) {
        await tx.product.update({
          where: { id: productId },
          data: { stock: { increment: agg.qty } }
        });

        // Only advance the "latest purchase" fields when this document really is
        // the latest. `lte` rather than `lt` so a correction entered on the same
        // day still takes effect (L-4).
        await tx.product.updateMany({
          where: {
            id: productId,
            OR: [
              { last_purchase_date: null },
              { last_purchase_date: { lte: Math.floor(invoiceDate) } }
            ]
          },
          data: {
            latest_purchase_rate: agg.rate,
            last_purchase_date: Math.floor(invoiceDate)
          }
        });
      }

      // Serialised, not Promise.all.
      //
      // The stock update and this ledger write used to run concurrently through
      // Promise.all over the SAME interactive transaction client. Prisma's
      // interactive transactions are a single session; issuing queries on one
      // concurrently is not supported and interleaves unpredictably (F-21).
      await ledgerService.createPurchaseEntry({
        id: purchase.id,
        vendor_id: parseInt(vendor_id),
        invoice_no: purchase.invoice_no,
        invoice_date: Math.floor(invoiceDate),
        total: calculatedGrandTotal,
        fy: currentFy,
        notes: purchaseNotes
      }, tx);



      // ===== PAYMENT OPERATIONS (if paid) =====
      if (payment_status === 1) {
        // advanceUsed and newPayment were computed once above (P4-18); the
        // second vendor_details read and the duplicate arithmetic that used to
        // sit here are gone.

        // The advance portion was allocated from the vendor's existing payments
        // above; only the new money gets a payment row (SA-28).

        // ✅ CREATE PAYMENT/ALLOCATION RECORDS FOR NEW PAYMENT PORTION (CREATE FIRST!)
        let newPaymentId: number | undefined;
        if (newPayment > 0) {
          console.log(`[PURCHASE CREATE] Creating new payment: ₹${newPayment.toFixed(2)}`);
          const payment = await tx.vendor_payments.create({
            data: {
              vendor_id: parseInt(vendor_id),
              payment_date: Math.floor(invoiceDate),
              payment_amount: newPayment,
              payment_mode: payment_mode,
              payment_type: 'BILL_SPECIFIC',
              notes: advanceUsed > 0
                ? `New payment for purchase ${purchase.invoice_no}: ₹${newPayment.toFixed(2)}`
                : `Payment for purchase ${purchase.invoice_no}`,
              fy: currentFy
            }
          });

          newPaymentId = payment.id;

          await tx.payment_allocations.create({
            data: {
              payment_id: payment.id,
              purchase_id: purchase.id,
              allocated_amount: newPayment,
              allocation_date: Math.floor(invoiceDate),
              notes: 'Allocated during purchase creation'
            }
          });
        }

        // ✅ NOW CREATE PAYMENT LEDGER ENTRY - Only if new payment needed, WITH transaction_id
        if (newPayment > 0 && newPaymentId) {
          await ledgerService.createEntry({
            vendor_id: parseInt(vendor_id),
            transaction_date: Math.floor(invoiceDate),
            transaction_type: 'PAYMENT',
            reference_type: 'purchase',
            reference_id: purchase.id,
            reference_no: purchase.invoice_no.toString(),
            debit: 0,
            credit: newPayment,  // ✅ Only new payment, not full amount
            payment_mode: payment_mode,
            payment_status: 1,
            payment_date: Math.floor(invoiceDate),
            notes: `Payment ₹${newPayment} for bill INV-${purchase.invoice_no} via Payment #${newPaymentId}`,
            fy: currentFy,
            transaction_id: newPaymentId  // ✅ NEW: Set transaction_id for deletion tracking
          }, tx);
        } else if (newPayment === 0) {
          console.log(`[PURCHASE CREATE] No new payment needed - fully covered by ₹${advanceUsed.toFixed(2)} advance balance`);
        }

        // ✅ UPDATE VENDOR BALANCE
        // Use balance handler for smart allocation (handles vendor_id = 0)
        const balanceOp = balanceHandler.getCreateBalanceOps({
          vendorId: parseInt(vendor_id),
          total: calculatedGrandTotal,
          currentBalance: vendor ? {
            total_paid: Number(vendor.total_paid),
            total_allocated: Number(vendor.total_allocated),
            total_refunded: Number(vendor.total_refunded),
            total_refund_allocated: Number(vendor.total_refund_allocated)
          } : undefined,
          type: 'PURCHASE'
        });

        if (balanceOp) {
          await balanceHandler.incrementBalanceInTransaction(
            tx,
            balanceOp.vendorId,
            balanceOp.update,
            {
              type: 'purchase_create',
              id: purchase.id,
              reference_no: `INV-${purchase.invoice_no}`,
              notes: advanceUsed > 0
                ? `Purchase: ₹${advanceUsed.toFixed(2)} from advance + ₹${newPayment.toFixed(2)} new payment`
                : `Purchase: ₹${calculatedGrandTotal.toFixed(2)} paid`
            }
          );
        }
      }

      return purchase;
    }, { timeout: 45000 });

    // No operations outside transaction - everything is atomic!

    const totalTime = Date.now() - startTime;

    res.status(201).json({
      message: 'Purchase created successfully',
      purchase: {
        id: purchase.id,
        invoice_no: purchase.invoice_no,
        total: purchase.total,
        vendor_name: existingVendor?.vendor_name || req.body.vendor_name || 'Other'
      }
    })

  } catch (error: any) {
    // Translated at the boundary, and logged in full rather than returned.
    //
    // This returned `error.message`, which for a Prisma failure is not a
    // sentence - it is the whole invocation. The L-3 reproduction came back
    // with every field and value in the create call, the vendor connect
    // clause, the financial year and the internal timestamps (P4-20, L-11).
    const totalTime = Date.now() - startTime;
    console.error(`Purchase creation failed after ${totalTime}ms:`, error);

    // Auto-numbered and we lost the race: re-read the counter and try again.
    const clientChoseNumber = req.body?.invoice_number !== undefined
      && req.body?.invoice_number !== null
      && req.body?.invoice_number !== '';
    if (error?.code === 'P2002' && !clientChoseNumber && attempt < MAX_INVOICE_ATTEMPTS) {
      console.warn(`Invoice number collision on attempt ${attempt}; retrying with a fresh number`);
      return handlePost(req, res, attempt + 1);
    }

    if (error?.code === 'P2002') {
      // Deliberately does not name the invoice number. The first version of
      // this handler said "already in use in this financial year", which was
      // wrong: the constraint that actually fired was bill_to's, colliding
      // across financial years, and the message sent someone looking in the
      // wrong place (L-19).
      return res.status(409).json({
        message: 'That purchase conflicts with an existing record. Check the invoice number for this financial year.',
        error_code: 'DUPLICATE_RECORD'
      })
    }
    if (error?.code === 'P2003') {
      return res.status(400).json({
        message: 'A selected vendor, staff member or product does not exist'
      })
    }
    res.status(500).json({ message: 'Failed to create purchase' })
  }
}





export default withObservability(handler)
