import { round2, roundRupee } from './line-math';
import { SaleError, intOrNull } from './sale';

/**
 * Purchase (vendor) return pricing and validation, the twin of
 * lib/sale-return.ts so the two sides refuse and price the same way.
 *
 *  - A line cannot be returned beyond what is left of it (other returns
 *    counted, the return being edited excluded), and must be on one of THIS
 *    vendor's bills. Neither was checked: only current stock was.
 *  - The price is the purchase rate unless the form lowers it; never above.
 *  - Tax is the line's own GST % (the form's tax_rate was trusted), split the
 *    way the bill was (IGST if the bill line carried IGST). Edit split on an
 *    `item.vendor_state_code` the form never sends, so every edit became IGST.
 *  - Totals round per F-34: each tax head and the refund to the rupee.
 *
 * Purchase lines carry no discount column, so the rate is already net.
 */
export interface PricedPurchaseLine {
  purchase_item_id: number;
  product_id: number | null;
  purchase_id: number;
  return_qty: number;
  return_reason_id: number;
  unit_price: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  notes: string;
}

export async function pricePurchaseReturnLines(
  tx: any,
  vendorId: number,
  items: any[],
  opts: { excludeReturnId?: number } = {}
) {
  if (!Array.isArray(items) || items.length === 0) throw new SaleError(400, 'Select at least one item to return', 'VALIDATION');
  const wanted = items.map((i: any) => ({
    id: intOrNull(i.purchase_item_id ?? i.id),
    qty: Math.round(Number(i.return_qty)),
    reason: intOrNull(i.return_reason_id) ?? 1,
    price: i.unit_price,
    notes: i.notes || ''
  }));
  if (wanted.some(w => w.id === null)) throw new SaleError(400, 'Every return line needs its bill line', 'VALIDATION');
  const ids = wanted.map(w => w.id as number);
  if (new Set(ids).size !== ids.length) throw new SaleError(400, 'The same line was sent twice', 'DUPLICATE_LINE');

  const lines = await tx.purchaseitems.findMany({
    where: { id: { in: ids } },
    select: { id: true, purchase_id: true, product_id: true, qty: true, rate: true, gst_percentage: true, igst: true, name_of_product: true }
  });
  const byId = new Map<number, any>(lines.map((l: any) => [l.id, l]));
  const billIds = Array.from(new Set(lines.map((l: any) => l.purchase_id)));
  const bills = billIds.length ? await tx.purchase.findMany({ where: { id: { in: billIds } }, select: { id: true, vendor_id: true } }) : [];
  const vendorOf = new Map<number, number | null>(bills.map((b: any) => [b.id, b.vendor_id]));
  const prior = await tx.purchase_return_items.findMany({
    where: { purchase_item_id: { in: ids } },
    select: { purchase_item_id: true, purchase_return_id: true, return_qty: true }
  });
  const returned = new Map<number, number>();
  for (const r of prior) {
    if (opts.excludeReturnId !== undefined && r.purchase_return_id === opts.excludeReturnId) continue;
    returned.set(r.purchase_item_id, (returned.get(r.purchase_item_id) || 0) + (Number(r.return_qty) || 0));
  }

  const priced: PricedPurchaseLine[] = wanted.map(w => {
    const line = byId.get(w.id as number);
    if (!line) throw new SaleError(400, 'A return line does not belong to any purchase bill', 'UNKNOWN_LINE');
    if ((vendorOf.get(line.purchase_id) ?? null) !== vendorId) {
      throw new SaleError(400, `"${line.name_of_product}" is not on a bill from this vendor`, 'FOREIGN_BILL');
    }
    if (!Number.isFinite(w.qty) || w.qty < 1) throw new SaleError(400, `Return at least 1 of "${line.name_of_product}"`, 'VALIDATION');
    const left = (Number(line.qty) || 0) - (returned.get(line.id) || 0);
    if (w.qty > left) {
      throw new SaleError(400, `Only ${left} of "${line.name_of_product}" can still be returned`, 'OVER_RETURN',
        { product_name: line.name_of_product, available_qty: left, requested_qty: w.qty });
    }
    const rate = round2(Number(line.rate) || 0);
    let unit = rate;
    if (w.price !== undefined && w.price !== null && w.price !== '') {
      const asked = Number(w.price);
      if (!Number.isFinite(asked) || asked < 0) throw new SaleError(400, 'A return price must be a number', 'VALIDATION');
      if (asked > rate + 0.005) throw new SaleError(400, `The return price of "${line.name_of_product}" cannot be more than it was bought for (₹${rate})`, 'PRICE_ABOVE_PURCHASE');
      unit = round2(asked);
    }
    const subtotal = round2(w.qty * unit);
    const tax = round2((subtotal * (Number(line.gst_percentage) || 0)) / 100);
    const inter = (Number(line.igst) || 0) > 0;
    return {
      purchase_item_id: line.id,
      product_id: line.product_id ?? null,
      purchase_id: line.purchase_id,
      return_qty: w.qty,
      return_reason_id: w.reason,
      unit_price: unit,
      tax_amount: tax,
      cgst: inter ? 0 : round2(tax / 2),
      sgst: inter ? 0 : round2(tax / 2),
      igst: inter ? tax : 0,
      notes: w.notes
    };
  });

  const sum = (f: keyof PricedPurchaseLine) => priced.reduce((s, l) => s + (l[f] as number), 0);
  const totalAmount = round2(priced.reduce((s, l) => s + round2(l.return_qty * l.unit_price), 0));
  const totalTax = roundRupee(sum('cgst')) + roundRupee(sum('sgst')) + roundRupee(sum('igst'));
  return {
    lines: priced,
    totalAmount,
    totalTax,
    purchaseIds: Array.from(new Set(priced.map(l => l.purchase_id))),
    refund: (pf: number) => roundRupee(totalAmount + totalTax + round2(pf || 0))
  };
}

/** The row each priced line is stored as. */
export const purchaseReturnItemRow = (returnId: number, l: PricedPurchaseLine) => ({
  purchase_return_id: returnId,
  purchase_item_id: l.purchase_item_id,
  return_qty: l.return_qty,
  return_reason_id: l.return_reason_id,
  unit_price: l.unit_price,
  tax_amount: l.tax_amount,
  cgst: l.cgst,
  sgst: l.sgst,
  igst: l.igst,
  notes: l.notes
});

/** Recompute return_status (0 none, 1 partial, 2 full) for each bill, by id. */
export async function recalcPurchaseReturnStatus(tx: any, purchaseIds: number[]) {
  for (const pid of Array.from(new Set(purchaseIds.filter(Boolean)))) {
    const lines = await tx.purchaseitems.findMany({ where: { purchase_id: pid }, select: { id: true, qty: true } });
    const rows = lines.length
      ? await tx.purchase_return_items.findMany({ where: { purchase_item_id: { in: lines.map((l: any) => l.id) } }, select: { purchase_item_id: true, return_qty: true } })
      : [];
    const back = new Map<number, number>();
    rows.forEach((r: any) => back.set(r.purchase_item_id, (back.get(r.purchase_item_id) || 0) + (Number(r.return_qty) || 0)));
    const any = rows.length > 0;
    const full = lines.length > 0 && lines.every((l: any) => (back.get(l.id) || 0) >= (Number(l.qty) || 0));
    await tx.purchase.update({ where: { id: pid }, data: { return_status: !any ? 0 : full ? 2 : 1 } });
  }
}
