# Ledger, report and whole-backend checks

Status: **done** (2026-10-03) — see section 6. Owner asked to run the tests across the whole backend and to make
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
| Return, refunded | DEBIT_NOTE, ref `purchase_return`, credit = refund | CREDIT_NOTE credit; created as refunded also a REFUND debit, marked refunded later the note only |
| Return, pending | nothing | nothing |
| Edit | amounts updated in place or `_ADJUSTMENT` rows; a status change back adds `_REVERSAL` rows | same |
| Delete | the document's rows are removed | same |

## 3. New assertions (A12–A14)

- **A12 documents → ledger.** Each bill's rows (PURCHASE* / SALE*) net to its total. Per party,
  payment rows net to the party's payments, refund rows to its refunds, note rows to its refunded
  returns; a customer return's own REFUND rows, when it has any, equal its refund. So the closing
  balance is what the documents say.
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

## 6. Outcome

**Owner decision (2026-10-03).** A refunded return is a **direct adjustment** to the party's
account and the behaviour stays as it is: a purchase return posts its debit note only; a sale /
Invoice C return marked refunded after it was created posts its credit note only (created as
refunded it also writes a REFUND row for the same amount). The cash book keeps listing completed
returns as money moved (the earlier decision in `lib/cash-book.ts`). A12 encodes this.

**Bugs the flow suite found, fixed**

| | What | Where | Commit |
|---|---|---|---|
| 1 | Editing a vendor payment or refund amount left the stored running balance of that row and every later row off by the change; the vendor's next entry was built on it (the L-36 mistake, still in two routes) | `pages/api/vendor-payments/[id].ts`, `vendor-refunds/[id].ts` | 85645ab |
| 2 | Marking a sale or purchase paid by an edit moved total_paid / total_allocated with no balance-log row, so the balance-log reports disagreed with the party | `lib/customer-transaction-handler.ts`, `lib/transaction-handler.ts` | 7c99a9d |
| 3 | A4 (assertion) had no freight in the purchase total, out of date since Q1 | `scripts/audit-assert.js` | d6cda0c |

Each fix was checked both ways: with the old code back the flow fails at that step, with the fix
it passes.

**Checks**

- Flow suite (harness `delcheck/flowcheck.js`): 41 steps over 8 days — purchases (unpaid, paid,
  "Other" vendor, from advance, freight), sales (unpaid, paid, walk-in), Invoice C, payments
  (bill specific, mixed, on account), refunds, returns pending and refunded, dead stock; edits of
  bills, payments, refunds, returns, paid ↔ unpaid on a sale and a purchase; deletes including a
  refused one. After every step A1–A14 pass and 16 reports agree with the ledger and the
  documents: customer / vendor outstanding, ledger accounts, balance logs, sales, Invoice C,
  purchase, GST, credit / debit notes, returns register, cash book, profit, stock. At the end the
  balances, stock, cash book and bill counts match figures worked out by hand, and eleven
  deliberate corruptions are each caught by the assertion meant for them. 120 checks.
- All 21 other server suites, page tests 3–10 and 12–14, `tsc`, `next build`: pass.
- A1–A6 now also run in the harness (they use `$queryRaw` and MySQL's `<=>`; the SQL mirror
  builds every table from `schema.prisma`).

**To run on the real database** (read-only): `node scripts/audit-assert.js`. Expect A13 to list
any hand-written ledger rows and A14 to report counters that moved without a log row before
today's fix (bug 2); A2 can show rows left off by bug 1. Those are past data, not new faults.

**Not covered / noticed, unchanged**

- The cash book lists money through payments, refunds and returns; a walk-in sale paid in cash
  has no payment record, so it is not in the cash book (it is in the sales report).
- Routes no screen calls: `/api/transactions`, `/api/customer-adjustments` (its POST reads `.id`
  from a ledger call that returns nothing, so it cannot succeed), `/api/sales/analytics`,
  `/api/products/optimized`. Products (11 routes) are the next phase.
