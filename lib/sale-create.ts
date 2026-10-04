import { prisma } from './db';
import { getNextInvoiceNumber } from './invoice-counter';
import { convertDateToTimestamp, getLocalDateString } from './date-utils';
import { customerLedgerService } from './customer-ledger-service';
import { customerBalanceHandler } from './customer-balance-handler';
import { allocateFromAdvance, availableAdvance } from './advance-allocation';
import { getBusinessGstin, PAYMENT_STATUS } from './purchase';
import {
  SaleKind, SaleError, saleTables, validateSale, computeSaleTotals, assertStock,
  intOrNull, requestedCustomer, requestedFreight, requestedItems, billStateCode, requestedDate
} from './sale';

/**
 * Creating a sale or salex (POST /api/sales, POST /api/salex).
 *
 * Fixes, by docs/SALE_AUDIT.md id:
 *  - every amount is computed here from qty, rate, discount and GST % (SA-06,
 *    SA-07, SA-09); the payload's totals and per-line tax are ignored;
 *  - `fy` is always the current FY from Settings (SA-04);
 *  - stock is checked per product across all lines (SA-14);
 *  - Partial cannot be asserted on create (SA-15);
 *  - UNIQUE(fy, invoice_no) plus a retry on a lost race (SA-16, as purchase);
 *  - a registered customer must exist and the "Other" walk-in must be named
 *    (SA-22); line names and categories come from the product, not the body;
 *  - the billing snapshot takes the bill's own address line 2 (SA-31);
 *  - P&F is stored the same way by both kinds (SA-31).
 */

const MAX_INVOICE_ATTEMPTS = 3;
const text = (v: any) => (v === undefined || v === null ? undefined : String(v));

export async function createSale(kind: SaleKind, rawBody: any, attempt = 1): Promise<{ id: number; invoice_no: number; total: number; customer_name: string }> {
  const body: any = { ...(rawBody || {}) };
  const t = saleTables(kind);

  const failure = await validateSale(kind, body, { partial: false });
  if (failure) throw failure;

  const customerId = requestedCustomer(body) as number;
  const customer = customerId !== 0
    ? await prisma.customer_details.findUnique({ where: { id: customerId } })
    : null;

  const items = requestedItems(body) as any[];
  const invoiceDate = requestedDate(body, convertDateToTimestamp) ?? Math.floor(Date.now() / 1000);
  const stateCode = billStateCode(body, customer?.billing_state_code);
  const businessGstin = await getBusinessGstin();
  const { bill, supplyType, packing } = computeSaleTotals({
    kind,
    items,
    packingQty: body.packing_forwarding_qty,
    packingRate: body.packing_forwarding_rate,
    packingTotal: body.packing_forwarding_total,
    freight: requestedFreight(body),
    stateCode,
    businessGstin
  });
  if (supplyType === null) {
    throw new SaleError(400,
      'Cannot determine the tax type for this bill. Check the state on the bill and the business GSTIN in Settings.',
      'SUPPLY_TYPE_UNRESOLVED');
  }
  if (!Number.isFinite(bill.grandTotal)) throw new SaleError(400, 'Could not compute a valid total', 'VALIDATION');

  const paymentStatus = intOrNull(body.payment_status) ?? PAYMENT_STATUS.UNPAID;
  const paymentMode = intOrNull(body.payment_mode);
  const { nextInvoiceNo, currentFy } = await getNextInvoiceNumber(t.counter);

  try {
    const header = await prisma.$transaction(async (tx: any) => {
      // ---- Products, and stock per product (SA-14)
      const productIds = Array.from(new Set(items.map(i => intOrNull(i.product_id) as number)));
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, product_name: true, hsn: true, product_category_id: true, product_subcategory_id: true, company_id: true }
      });
      const productById = new Map<number, any>(products.map((p: any) => [p.id, p]));
      const need = new Map<number, number>();
      bill.lines.forEach((l, i) => {
        const pid = intOrNull(items[i].product_id) as number;
        need.set(pid, (need.get(pid) || 0) + l.qty);
      });
      await assertStock(tx, need);

      // ---- Header
      const headerData: any = {
        invoice_no: nextInvoiceNo,
        select_customer: customerId,
        bill_reference: body.bill_reference || '',
        commission: Number(body.commission) || 0,
        items_total: bill.itemsTotal,
        discount: bill.discountTotal,
        freight: bill.freight,
        total_taxable_value: bill.itemsTotal,
        taxrate: 0,
        total_cgst: bill.totalCgst,
        total_sgst: bill.totalSgst,
        total_igst: bill.totalIgst,
        total_tax: bill.totalTax,
        total: bill.grandTotal,
        notes: body.notes || '',
        descriptions: body.descriptions || '',
        packing_forwarding_qty: packing.qty,
        packing_forwarding_rate: packing.rate,
        packing_forwarding_total: packing.total,
        invoice_date: invoiceDate,
        payment_status: paymentStatus,
        payment_mode: paymentMode,
        fy: currentFy,
        updated_at: getLocalDateString(),
        return_status: 0
      };
      const staffId = intOrNull(body.staff_id);
      const mechanicId = intOrNull(body.mechanic_id);
      if (staffId) headerData.staff = { connect: { id: staffId } };
      if (mechanicId) headerData.mechanic = { connect: { id: mechanicId } };
      if (body.staff_details) headerData.staff_details = String(body.staff_details);
      const created = await tx[t.header].create({ data: headerData });

      // ---- Lines: the server's figures, the product's names
      await tx[t.items].createMany({
        data: bill.lines.map((l, i) => {
          const item = items[i];
          const pid = intOrNull(item.product_id) as number;
          const product = productById.get(pid);
          return {
            invoice_no: created.id,
            product_id: pid,
            name_of_product: product.product_name,
            category_id: product.product_category_id ?? null,
            subcategory_id: product.product_subcategory_id ?? null,
            company_id: intOrNull(item.company_id) ?? product.company_id ?? null,
            model_id: intOrNull(item.model_id),
            hsn: product.hsn || '',
            part: item.part || item.part_number || '',
            qty: l.qty,
            rate: l.rate,
            subtotal: l.taxable,
            discount: l.discount,
            discountrate: l.discountrate,
            gst_percentage: l.gst_percentage,
            cgst: l.cgst,
            sgst: l.sgst,
            igst: l.igst,
            tax: l.tax,
            fy: currentFy,
            invoice_date: invoiceDate
          };
        })
      });
      for (const [pid, qty] of Array.from(need.entries())) {
        await tx.product.update({ where: { id: pid }, data: { stock: { decrement: qty } } });
      }

      // ---- Snapshots: the bill's own details, the master as the fallback
      const name = text(body.customer_name) ?? customer?.billing_name ?? 'Other';
      const billing = {
        billing_name: name,
        contact_no: text(body.contact_number) ?? customer?.contact_no ?? '',
        email: text(body.email_id) ?? customer?.email ?? '',
        billing_address: text(body.address) ?? customer?.billing_address ?? '',
        billing_address2: text(body.address_2) ?? customer?.billing_address_2 ?? '',
        billing_city: text(body.city) ?? customer?.billing_city ?? '',
        billing_state: text(body.state) ?? customer?.billing_state ?? '',
        billing_state_code: stateCode,
        billing_gstin: text(body.gst_number) ?? customer?.billing_gstin ?? ''
      };
      await tx[t.billTo].create({ data: { invoice_no: created.id, ...billing } });
      await tx[t.shipTo].create({ data: { invoice_no: created.id, ...shippingFrom(body, billing) } });
      const transport = transportFrom(body);
      if (transport) await tx[t.transport].create({ data: { invoice_id: created.id, ...transport } });

      // ---- Ledger and payment: registered customers only ("Other" has no account)
      if (customerId !== 0) {
        await customerLedgerService.createEntry({
          customer_id: customerId,
          transaction_date: invoiceDate,
          transaction_type: 'SALE',
          reference_type: kind,
          reference_id: created.id,
          reference_no: String(created.invoice_no),
          debit: bill.grandTotal,
          credit: 0,
          payment_mode: null,
          payment_status: paymentStatus,
          payment_date: null,
          notes: `${t.label} INV-${created.invoice_no}`,
          fy: currentFy,
          transaction_id: null
        } as any, tx);

        if (paymentStatus === PAYMENT_STATUS.PAID) {
          await recordPaymentOnCreate(tx, {
            kind, customerId, docId: created.id, invoiceNo: created.invoice_no,
            total: bill.grandTotal, date: invoiceDate, mode: paymentMode ?? 0, fy: currentFy
          });
        }
      }
      return created;
    }, { timeout: 45000 });

    return {
      id: header.id,
      invoice_no: header.invoice_no,
      total: header.total,
      customer_name: customer?.billing_name || body.customer_name || 'Other'
    };
  } catch (error: any) {
    // Auto-numbered and lost the race for the number: take the next one (SA-16).
    if (error?.code === 'P2002' && attempt < MAX_INVOICE_ATTEMPTS) {
      return createSale(kind, rawBody, attempt + 1);
    }
    throw error;
  }
}

/** Ship-to: the form's own shipping block when it sent one, else the billing details. */
export function shippingFrom(body: any, billing: any) {
  const s = body?.useShippingAddress && body?.shippingDetails ? body.shippingDetails : null;
  return {
    shipping_name: (s && (s.user_name ?? s.shipping_name)) ?? billing.billing_name,
    shipping_address: (s && (s.address ?? s.shipping_address)) ?? billing.billing_address,
    shipping_address2: (s && (s.address_2 ?? s.shipping_address2)) ?? billing.billing_address2,
    shipping_city: (s && (s.city ?? s.shipping_city)) ?? billing.billing_city,
    shipping_state: (s && (s.state ?? s.shipping_state)) ?? billing.billing_state,
    shipping_state_code: (s && intOrNull(s.state_code ?? s.shipping_state_code)) ?? billing.billing_state_code,
    shipping_gstin: (s && (s.gstin ?? s.shipping_gstin)) ?? billing.billing_gstin,
    shipping: true
  };
}

/** Transport, from the nested block (both forms) or the flat fields. */
export function transportFrom(body: any): { trans_mode: string | null; vehicle_no: string | null; supply_date: string | null } | null {
  const d = body?.transportDetails || {};
  const mode = d.trans_mode ?? body?.transport_name;
  const vehicle = d.vehicle_no ?? body?.vehicle_number;
  const supply = d.supply_date ?? null;
  if (mode === undefined && vehicle === undefined && !supply) return null;
  return { trans_mode: mode || null, vehicle_no: vehicle || null, supply_date: supply || null };
}

/**
 * A bill created as Paid: use the customer's advance first, then record new
 * money for the rest. The same split, rows and counters as before (and as the
 * purchase twin); only gathered in one place for both kinds.
 */
async function recordPaymentOnCreate(tx: any, p: {
  kind: SaleKind; customerId: number; docId: number; invoiceNo: number; total: number; date: number; mode: number; fy: number;
}) {
  const t = saleTables(p.kind);
  const customer = await tx.customer_details.findUnique({
    where: { id: p.customerId },
    select: { total_paid: true, total_allocated: true, total_refunded: true, total_refund_allocated: true }
  });
  const advance = availableAdvance(customer);
  // The advance is allocated from the customer's existing payments - no new
  // row for money paid earlier (SA-28). What the rows cannot cover is new money.
  const advanceUsed = await allocateFromAdvance(
    tx, 'customer', p.customerId, { [t.allocFk]: p.docId }, Math.min(Math.max(0, advance), p.total), p.date,
    { mode: p.mode, fy: p.fy }
  );
  const newPayment = Math.round((p.total - advanceUsed) * 100) / 100;

  const allocate = async (amount: number, notes: string, paymentNotes: string) => {
    const payment = await tx.customer_payments.create({
      data: {
        customer_id: p.customerId,
        payment_date: p.date,
        payment_amount: amount,
        payment_mode: p.mode,
        payment_type: 'BILL_SPECIFIC',
        notes: paymentNotes,
        fy: p.fy
      }
    });
    await tx.customer_payment_allocations.create({
      data: { payment_id: payment.id, [t.allocFk]: p.docId, allocated_amount: amount, allocation_date: p.date, notes }
    });
    return payment.id as number;
  };

  if (newPayment > 0) {
    const paymentId = await allocate(
      newPayment,
      `Allocated during ${p.kind} creation`,
      advanceUsed > 0 ? `New payment for ${p.kind} ${p.invoiceNo}: ₹${newPayment.toFixed(2)}` : `Payment for ${p.kind} ${p.invoiceNo}`
    );
    await customerLedgerService.createEntry({
      customer_id: p.customerId,
      transaction_date: p.date,
      transaction_type: 'PAYMENT_RECEIVED',
      reference_type: p.kind,
      reference_id: p.docId,
      reference_no: String(p.invoiceNo),
      debit: 0,
      credit: newPayment,
      payment_mode: p.mode,
      payment_status: 1,
      payment_date: p.date,
      notes: `Payment ₹${newPayment} for ${p.kind} INV-${p.invoiceNo} via Payment #${paymentId}`,
      fy: p.fy,
      transaction_id: paymentId
    } as any, tx);
  }

  await customerBalanceHandler.incrementBalanceInTransaction(
    tx,
    p.customerId,
    { total_paid: newPayment, total_allocated: p.total },
    {
      type: (p.kind === 'sale' ? 'sale_create' : 'salex_create') as any,
      id: p.docId,
      reference_no: String(p.invoiceNo),
      notes: advanceUsed > 0
        ? `${t.label} ${p.invoiceNo}: ₹${advanceUsed.toFixed(2)} from advance + ₹${newPayment.toFixed(2)} new payment`
        : `${t.label} ${p.invoiceNo} created`
    }
  );
}
