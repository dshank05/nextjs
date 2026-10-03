import { prisma } from './db';

/**
 * GST summary for a period - what GSTR-1 and GSTR-3B are filed from.
 *
 *  Output tax   sales (Invoice C carries no GST: shown as non-GST supplies)
 *  - credit notes   sale returns dated in the period
 *  Input tax    purchases
 *  - debit notes    purchase returns dated in the period
 *  = net per head (CGST / SGST / IGST); positive is payable, negative carries
 *    forward as credit.
 *
 * Head totals are the bills' own rounded totals (F-34), as printed. The rate
 * and HSN tables add up the lines (paise kept), so they can differ from the
 * heads by the rounding, which is shown. B2B is a sale whose bill carries the
 * buyer's GSTIN (the bill's billing snapshot), the rest B2C.
 *
 * Sale return lines store one tax amount; it is split as the original line
 * was (IGST if the line had IGST, else half CGST and half SGST).
 */
const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const q = (sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe(sql, ...p) as Promise<any[]>;

const heads = (r: any) => ({ taxable: r2(n(r.taxable)), cgst: r2(n(r.cgst)), sgst: r2(n(r.sgst)), igst: r2(n(r.igst)), tax: r2(n(r.cgst) + n(r.sgst) + n(r.igst)), count: n(r.cnt) });

export async function gstReport(start: number, end: number) {
  const p = [start, end];
  const [
    sales, b2b, salesByRate, hsn, nonGst,
    credit, purchases, purchasesByRate, debit
  ] = await Promise.all([
    q(`SELECT COUNT(*) AS cnt, SUM(total_taxable_value) AS taxable, SUM(COALESCE(total_cgst, 0)) AS cgst,
              SUM(COALESCE(total_sgst, 0)) AS sgst, SUM(COALESCE(total_igst, 0)) AS igst, SUM(total) AS total
       FROM invoice WHERE invoice_date BETWEEN ? AND ?`, ...p),
    q(`SELECT CASE WHEN COALESCE(b.billing_gstin, '') <> '' THEN 'B2B' ELSE 'B2C' END AS kind,
              COUNT(*) AS cnt, SUM(h.total_taxable_value) AS taxable, SUM(COALESCE(h.total_cgst, 0)) AS cgst,
              SUM(COALESCE(h.total_sgst, 0)) AS sgst, SUM(COALESCE(h.total_igst, 0)) AS igst
       FROM invoice h LEFT JOIN bill_tosales b ON b.invoice_no = h.id
       WHERE h.invoice_date BETWEEN ? AND ? GROUP BY kind`, ...p),
    q(`SELECT COALESCE(i.gst_percentage, 0) AS rate, COUNT(*) AS cnt, SUM(i.subtotal) AS taxable,
              SUM(COALESCE(i.cgst, 0)) AS cgst, SUM(COALESCE(i.sgst, 0)) AS sgst, SUM(COALESCE(i.igst, 0)) AS igst
       FROM invoice_items i JOIN invoice h ON h.id = i.invoice_no
       WHERE h.invoice_date BETWEEN ? AND ? GROUP BY rate ORDER BY rate`, ...p),
    q(`SELECT COALESCE(NULLIF(i.hsn, ''), '-') AS hsn, COALESCE(i.gst_percentage, 0) AS rate, SUM(i.qty) AS qty, COUNT(*) AS cnt,
              SUM(i.subtotal) AS taxable, SUM(COALESCE(i.cgst, 0)) AS cgst, SUM(COALESCE(i.sgst, 0)) AS sgst, SUM(COALESCE(i.igst, 0)) AS igst
       FROM invoice_items i JOIN invoice h ON h.id = i.invoice_no
       WHERE h.invoice_date BETWEEN ? AND ? GROUP BY hsn, rate ORDER BY hsn, rate`, ...p),
    q(`SELECT COUNT(*) AS cnt, SUM(total) AS total FROM invoicex WHERE invoice_date BETWEEN ? AND ?`, ...p),
    q(`SELECT COUNT(DISTINCT r.id) AS cnt, SUM(x.return_qty * x.unit_price) AS taxable,
              SUM(CASE WHEN COALESCE(ii.igst, 0) > 0 THEN 0 ELSE COALESCE(x.tax_amount, 0) / 2 END) AS cgst,
              SUM(CASE WHEN COALESCE(ii.igst, 0) > 0 THEN 0 ELSE COALESCE(x.tax_amount, 0) / 2 END) AS sgst,
              SUM(CASE WHEN COALESCE(ii.igst, 0) > 0 THEN COALESCE(x.tax_amount, 0) ELSE 0 END) AS igst
       FROM sale_returns r JOIN sale_return_items x ON x.sale_return_id = r.id
       LEFT JOIN invoice_items ii ON ii.id = x.invoice_item_id
       WHERE r.return_date BETWEEN ? AND ?`, ...p),
    q(`SELECT COUNT(*) AS cnt, SUM(total_taxable_value) AS taxable, SUM(COALESCE(total_cgst, 0)) AS cgst,
              SUM(COALESCE(total_sgst, 0)) AS sgst, SUM(COALESCE(total_igst, 0)) AS igst, SUM(total) AS total
       FROM purchase WHERE invoice_date BETWEEN ? AND ?`, ...p),
    q(`SELECT COALESCE(i.gst_percentage, 0) AS rate, COUNT(*) AS cnt, SUM(i.subtotal) AS taxable,
              SUM(COALESCE(i.cgst, 0)) AS cgst, SUM(COALESCE(i.sgst, 0)) AS sgst, SUM(COALESCE(i.igst, 0)) AS igst
       FROM purchase_items i JOIN purchase h ON h.id = i.purchase_id
       WHERE h.invoice_date BETWEEN ? AND ? GROUP BY rate ORDER BY rate`, ...p),
    q(`SELECT COUNT(DISTINCT r.id) AS cnt, SUM(x.return_qty * x.unit_price) AS taxable,
              SUM(COALESCE(x.cgst, 0)) AS cgst, SUM(COALESCE(x.sgst, 0)) AS sgst, SUM(COALESCE(x.igst, 0)) AS igst
       FROM purchase_returns r JOIN purchase_return_items x ON x.purchase_return_id = r.id
       WHERE r.return_date BETWEEN ? AND ?`, ...p)
  ]);

  const output = heads(sales[0] || {});
  const creditNotes = heads(credit[0] || {});
  const input = heads(purchases[0] || {});
  const debitNotes = heads(debit[0] || {});
  const net = {
    cgst: r2(output.cgst - creditNotes.cgst - (input.cgst - debitNotes.cgst)),
    sgst: r2(output.sgst - creditNotes.sgst - (input.sgst - debitNotes.sgst)),
    igst: r2(output.igst - creditNotes.igst - (input.igst - debitNotes.igst))
  };
  const rateRows = (rows: any[]) => rows.map(r => ({ rate: n(r.rate), ...heads(r) }));
  const salesRates = rateRows(salesByRate);
  const lineTax = r2(salesRates.reduce((s, r) => s + r.tax, 0));
  const b2bRow = b2b.find(r => r.kind === 'B2B') || {};
  const b2cRow = b2b.find(r => r.kind === 'B2C') || {};

  return {
    success: true,
    output: { ...output, total: r2(n(sales[0]?.total)), b2b: heads(b2bRow), b2c: heads(b2cRow), byRate: salesRates, roundingDifference: r2(output.tax - lineTax) },
    creditNotes,
    input: { ...input, total: r2(n(purchases[0]?.total)), byRate: rateRows(purchasesByRate) },
    debitNotes,
    net: { ...net, total: r2(net.cgst + net.sgst + net.igst) },
    hsn: hsn.map(r => ({ hsn: String(r.hsn), rate: n(r.rate), qty: n(r.qty), ...heads(r) })),
    nonGst: { count: n(nonGst[0]?.cnt), total: r2(n(nonGst[0]?.total)) }
  };
}
