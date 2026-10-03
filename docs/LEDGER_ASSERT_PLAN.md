# Ledger, report and whole-backend checks

Status: **plan** (2026-10-03). Owner asked to run the tests across the whole backend and to make
the assert test prove that every write updates the ledger tables and the reports properly.
Database: nothing to run, no data changes. `scripts/audit-assert.js` stays read-only.

## 1. Where things stand

- All 21 server suites and the 11 page tests (3–10, 12–14) pass.
- 86 of the 108 API routes are exercised by a suite. Not covered:
  - products (11 routes) — next phase;
  - not called by any screen: `/api/transactions` (PUT / DELETE on income and expense),
    `/api/customer-adjustments` (+ `[id]`, writes customer ledger rows by hand),
    `/api/sales/analytics`, `/api/products/optimized`;
  - small: the three `last-invoice` routes, `PATCH /api/vendor-ledger/[id]`,
    `GET /api/warehouses/[id]`, the login route.
- `audit-assert.js` (A1–A11) checks running balances, payment / return status, allocations,
  stock and orphans. It does **not** check that a bill, payment, refund or return has its ledger
  rows for the right amount — a sale with no SALE row, or a purchase posted at the wrong total,
  passes. In the harness only A7–A11 run; A1–A6 use `$queryRaw` and MySQL's `<=>`, which the
  in-memory store could not run.

## 2. How each write posts (read from the code; per-party conventions kept)

| Document | Vendor ledger | Customer ledger |
|---|---|---|
| Bill | PURCHASE, ref `purchase`/id, debit = total (vendor 0 "Other" posts too) | SALE, ref `sale` or `salex`/id, debit = total; customer 0 posts nothing |
| Paid on the bill | PAYMENT, ref the bill, credit, `transaction_id` = payment | PAYMENT_RECEIVED, ref the bill, credit, `transaction_id` = payment |
| Payment | PAYMENT, credit; one row per bill (bill specific) or one row ref `payment` (on account / mixed) | PAYMENT_RECEIVED, ref `payment`, credit = amount |
| Refund | REFUND_RECEIVED, debit; per return, plus ref `payment` for the unallocated part | REFUND_PAID, ref `refund`, debit = amount |
| Return, refunded | DEBIT_NOTE, ref `purchase_return`, credit = refund | CREDIT_NOTE credit + REFUND debit, ref `sale_return` / `salex_return` |
| Return, pending | nothing | nothing |
| Edit | amounts updated in place or `_ADJUSTMENT` rows; a status change back adds `_REVERSAL` rows | same |
| Delete | the document's rows are removed | same |

## 3. New assertions (A12–A14)

- **A12 documents → ledger.** Each bill's rows (PURCHASE* / SALE*) net to its total. Per party,
  payment rows net to the party's payments, refund rows to its refunds, refunded-return refund
  rows to its refunded returns. So the closing balance is what the documents say.
- **A13 ledger → documents.** Every row's document exists and belongs to the same party; every
  row's type is one the app writes.
- **A14 balance logs.** For each party and column, each log row's new value = old + change, the
  rows chain, and the last one equals the column in `customer_details` / `vendor_details`
  (parties with no logs — older data — are skipped).

`audit-assert.js` becomes importable (`run(ids)` returns the results) with the command line
unchanged. The harness runs **A1–A14** over the in-memory store (`$queryRaw` and `<=>` handled
there), and a broken-data copy must fail each new assertion.

## 4. Flow suite

One business story through the real API routes over the in-memory store: purchases (paid,
unpaid, Other vendor, freight), sales and Invoice C (paid, unpaid, walk-in), payments and refunds
of every type, returns pending and refunded, edits of bills / payments / returns, deletes, dead
stock. After **every** step: A1–A14 must pass, and the reports must agree with the ledger:

- customer / vendor outstanding = ledger sums; ledger accounting reports' closing = ledger;
- sales / purchase / Invoice C reports = the bills; GST report = the bills' tax;
- credit / debit note registers = refunded returns; cash book = money in and out;
- balance-log reports = the balance logs.

At the end, every figure is checked against totals worked out by hand for the story.

## 5. Order

P1 this plan → P2 A12–A14 + harness changes (commit) → P3 flow suite; any bug it finds is
fixed in its own commit with a named reason → P4 all suites, page tests, tsc, `next build`.
