// Moved from the test harness (2026-10-03); see tests/backend/README.md.
import { makeTx } from '../support/memtx.js';
import { transactionHandler } from '../../../lib/transaction-handler';
import { customerTransactionHandler } from '../../../lib/customer-transaction-handler';
let fail = 0; const FAILED = []; const ok = (n, c, i) => { if (!c) { fail++; FAILED.push(`${n}  ${JSON.stringify(i)?.slice(0, 500)}`); } };
test('transaction handlers: purchase / sale edit status cases', async () => {
  // ---- purchase #12 exists in fy 3 (id 1) and fy 4 (id 2); delete id 2
  let log = [], S = {
    product: [{ id: 1, stock: 100 }, { id: 2, stock: 100 }],
    purchase: [{ id: 1, invoice_no: 12, fy: 3 }, { id: 2, invoice_no: 12, fy: 4 }],
    purchaseitems: [{ id: 11, purchase_id: 1, invoice_no: 12, fy: 3, product_id: 1, qty: 5 }, { id: 21, purchase_id: 2, invoice_no: 12, fy: 4, product_id: 2, qty: 3 }],
    bill_to: [{ id: 1, purchase_id: 1, invoice_no: 12, fy: 3 }, { id: 2, purchase_id: 2, invoice_no: 12, fy: 4 }],
  };
  let ops = await transactionHandler.handlePurchaseDelete({ purchaseId: 2, vendorId: 1, invoiceNo: 12, fy: 4, paymentStatus: 0, returnStatus: 0 });
  await transactionHandler.executeDeleteInTransaction(makeTx(S, log), ops);
  ok('purchase: other year lines kept', S.purchaseitems.length === 1 && S.purchaseitems[0].fy === 3, S.purchaseitems);
  ok('purchase: other year bill_to kept', S.bill_to.length === 1 && S.bill_to[0].fy === 3, S.bill_to);
  ok('purchase: header deleted', S.purchase.map(p => p.id).join() === '1', S.purchase);
  ok('purchase: only its own stock moved', S.product[0].stock === 100 && S.product[1].stock === 97, S.product);
  let threw = false; try { await transactionHandler.handlePurchaseDelete({ purchaseId: 0, vendorId: 1, invoiceNo: 12, fy: 3, paymentStatus: 0, returnStatus: 0 }).then(o => transactionHandler.executeDeleteInTransaction(makeTx(S, []), o)); } catch (e) { threw = /purchase id/.test(e.message); }
  ok('purchase: refuses without the purchase id', threw);

  // ---- sale: id 5 printed #99, id 99 printed #5. Lines store header id.
  log = []; S = {
    product: [{ id: 1, stock: 10 }, { id: 2, stock: 10 }],
    invoice: [{ id: 5, invoice_no: 99 }, { id: 99, invoice_no: 5 }],
    invoiceitems: [{ id: 50, invoice_no: 5, product_id: 1, qty: 2 }, { id: 990, invoice_no: 99, product_id: 2, qty: 4 }],
    bill_tosales: [{ id: 1, invoice_no: 5 }, { id: 2, invoice_no: 99 }], shipto: [{ id: 1, invoice_no: 5 }, { id: 2, invoice_no: 99 }],
    transport_details: [{ id: 1, invoice_id: 5 }, { id: 2, invoice_id: 99 }],
  };
  ops = await customerTransactionHandler.handleSaleDelete({ type: 'sale', invoiceId: 5, customerId: 1, invoiceNo: 99, paymentStatus: 0, returnStatus: 0 });
  await customerTransactionHandler.executeDeleteInTransaction(makeTx(S, log), ops);
  ok('sale: own lines deleted, other sale untouched', S.invoiceitems.map(i => i.id).join() === '990', S.invoiceitems);
  ok('sale: own stock restored only', S.product[0].stock === 12 && S.product[1].stock === 10, S.product);
  ok('sale: header 5 deleted, 99 kept', S.invoice.map(i => i.id).join() === '99', S.invoice);
  ok('sale: snapshots of 5 deleted only', S.bill_tosales.length === 1 && S.shipto.length === 1 && S.transport_details.length === 1 && S.bill_tosales[0].invoice_no === 99, [S.bill_tosales, S.shipto, S.transport_details]);

  // ---- salex: id 7 printed #3
  log = []; S = {
    product: [{ id: 1, stock: 10 }],
    invoicex: [{ id: 7, invoice_no: 3 }, { id: 3, invoice_no: 7 }],
    invoice_itemsx: [{ id: 70, invoice_no: 7, product_id: 1, qty: 1 }, { id: 30, invoice_no: 3, product_id: 1, qty: 5 }],
    bill_tosalesx: [{ id: 1, invoice_no: 7 }], shiptox: [{ id: 1, invoice_no: 7 }], transport_detailsx: [{ id: 1, invoice_id: 7 }], incexpx: [{ id: 1, invoice_id: 7 }],
  };
  ops = await customerTransactionHandler.handleSaleDelete({ type: 'salex', invoiceId: 7, customerId: 1, invoiceNo: 3, paymentStatus: 0, returnStatus: 0 });
  let err = null; try { await customerTransactionHandler.executeDeleteInTransaction(makeTx(S, log), ops); } catch (e) { err = e.message; }
  ok('salex: delete runs', err === null, err);
  ok('salex: own lines deleted only', S.invoice_itemsx.map(i => i.id).join() === '30', S.invoice_itemsx);
  ok('salex: stock restored by own qty', S.product[0].stock === 11, S.product);
  ok('salex: header + snapshots deleted', S.invoicex.map(i => i.id).join() === '3' && !S.bill_tosalesx.length && !S.shiptox.length && !S.transport_detailsx.length && !S.incexpx.length, S);

  // ---- salex return delete (handler path)
  log = []; S = {
    product: [{ id: 1, stock: 10 }],
    invoice_itemsx: [{ id: 70, invoice_no: 7, product_id: 1, qty: 3 }],
    salex_returns: [{ id: 4, invoicex_id: 7 }], salex_return_items: [{ id: 1, salex_return_id: 4, invoice_itemx_id: 70, return_qty: 2 }],
  };
  ops = await customerTransactionHandler.handleReturnDelete({ type: 'salex', returnId: 4, customerId: 1, paymentStatus: 0 });
  err = null; try { await customerTransactionHandler.executeDeleteInTransaction(makeTx(S, log), ops); } catch (e) { err = e.message; }
  ok('salex return delete runs', err === null, err);
  ok('salex return: stock back out by 2, rows gone', S.product[0].stock === 8 && !S.salex_returns.length && !S.salex_return_items.length, S);

  // ---- sale return delete still works
  log = []; S = {
    product: [{ id: 1, stock: 10 }], invoiceitems: [{ id: 50, invoice_no: 5, product_id: 1, qty: 3 }],
    sale_returns: [{ id: 4, invoice_id: 5 }], sale_return_items: [{ id: 1, sale_return_id: 4, invoice_item_id: 50, return_qty: 1 }],
  };
  ops = await customerTransactionHandler.handleReturnDelete({ type: 'sale', returnId: 4, customerId: 1, paymentStatus: 0 });
  await customerTransactionHandler.executeDeleteInTransaction(makeTx(S, log), ops);
  ok('sale return: stock 9, rows gone', S.product[0].stock === 9 && !S.sale_returns.length && !S.sale_return_items.length, S);
  expect(FAILED).toEqual([]);
}, 170000);
