# Rewrite plan — transactions, returns, unvisited sections

Status: **plan, awaiting go-ahead** (2026-10-03). Same method as the sale / purchase rewrite:
one shared implementation for the customer and vendor twins, thin page and route files,
behaviour unchanged unless a bug is named, every existing test suite passing after each
step, one commit per step with line counts before and after.

## Ground rules

- **No data changes.** Ledger conventions differ by party and stay as stored
  (customer: one `PAYMENT_RECEIVED` row per payment; vendor: one `PAYMENT` row per bill
  for bill-specific payments). The shared code takes these as per-party config.
- **URLs stay.** `/customer-transactions/...`, `/vendor-transactions/...`,
  `/entry/vendor-transaction`, `/entry/salereturn...`, `/entry/purchasereturn-vendor...`
  keep working; they become one-line pages over shared components.
- **API contracts stay** (request and response fields), so nothing else breaks.
- Owner decisions already made hold: refunds on these screens are on account; a return is
  refunded by marking it complete.
- Each step: type-check, `next build`, all server suites (out … out-tx, rpt, stock), page
  suites (test3–test7) and a new page suite for the step.

## Size today

| Area | Files | Lines |
|---|---|---|
| Transaction screens | customer list / view / create, vendor list / view / entry form | 610 + 334 + 1,087 + 611 + 279 + 926 = **3,847** |
| Transaction hooks | `useCustomers.ts` (transaction part), `useVendorTransactions.ts` | ~300 + 360 |
| Payment / refund routes | customer-payments, customer-refunds, vendor-payments, vendor-refunds (index + [id]) | **3,641** |
| Party handlers | `customer-transaction-handler.ts`, `transaction-handler.ts` | 1,542 + 1,677 = **3,219** |
| Return screens | sale return list / view / create, purchase return list / view / create | 535 + 302 + 1,194 + 139 + 479 + 947 = **3,596** |
| Return routes | sale-returns (4 files, already thin), purchase-returns (5 files) | 704 + 1,995 |

## Step T — Customer / Vendor transactions

**T1. Hooks.** `hooks/usePartyTransactions.ts`: list, detail, create, update, delete,
open bills, for `party: 'customer' | 'vendor'`. Replaces the transaction half of
`useCustomers.ts` and all of `useVendorTransactions.ts`. One error reader, one invalidation
list per party.

**T2. List.** `components/transactions/PartyTransactionList.tsx` (filters, totals, table,
pagination, delete). The two list pages are diffs of each other on names only.

**T3. View.** `components/transactions/PartyTransactionView.tsx` (summary, allocations with
links, edit button). Customer and vendor view pages become one-liners.

**T4. Form.** `components/transactions/PartyTransactionForm.tsx` (create and edit):
party picker, direction (income / expense), payment type, date / mode / amount / notes,
bill allocation table (customer: sale + Invoice C; vendor: purchases), auto-allocate,
validation, confirm. Refund side shows `PendingReturnsHint` (on account only).
Config per party: label, which direction is a payment, endpoints, bill source, routes.
Replaces `customer-transactions/create.tsx` and `entry/vendor-transaction.tsx`.

**T5. Routes.** `lib/party-payments.ts` and `lib/party-refunds.ts`: create / read /
update / delete for both parties on top of `lib/payment-allocations.ts` (already shared).
The eight route files become route factories like `lib/api/sale-routes.ts`. Ledger
posting stays per party (config).

**T6. Handlers.** The two handlers are method-for-method twins (handleXEdit,
handleReturnEdit, handlePaymentEdit, handleRefundEdit, execute*, handleXDelete,
executeDelete*, executeLedgerReversal, executeBalanceUpdate). Merge into
`lib/party-handler.ts` with a party config (tables, ledger types, balance handler), keeping
the two exported objects as thin instances so sale / purchase callers do not change.
Riskiest step — done last, and only with every sale, purchase, return and payment suite
green. If a difference between the twins turns out to be a real business rule, it becomes
config, not deleted.

Expected: ~3,850 screen lines → ~1,500; ~3,640 route lines → ~1,200; handlers ~3,200 →
~1,800.

## Step R — Sale / Purchase returns

**R1. Hooks.** One returns hook module for both kinds (list, detail with `type`, create,
update, delete, bills with items for a party). Sale side currently uses raw `fetch` in the
page; purchase side uses hooks.

**R2. List.** `components/returns/ReturnList.tsx` for sale / Invoice C and purchase lists.

**R3. View.** `components/returns/ReturnView.tsx` (header, party, lines with reason, tax,
totals, edit / delete). Purchase view's print header stays.

**R4. Form.** `components/returns/ReturnForm.tsx`: party picker, bills with their lines
(available qty, net price ceiling, GST), quantity / price / reason per line, date, notes,
status / mode, P&F (purchase), confirm. Config per kind: bill source, item ids
(sale lines carry `invoice_type`), endpoints, labels.

**R5. Purchase return routes** onto `lib/purchase-return.ts` (already holds pricing and
status), mirroring `lib/sale-return.ts`: create, read, update, delete in the lib, thin route
files. `vendor-items` / `customer-items` (bills with lines for a party) into one shared
query with per-kind config.

Expected: ~3,600 screen lines → ~1,400; purchase-return routes ~2,000 → ~800.

## Step U — Sections never visited

| Section | What happens |
|---|---|
| Settings: business details, bank details, financial year, GST tax rate, mechanics, staff, states, users, warehouse, warehouse racks (the 6 left from Phase 2 + re-check) | Audit each page and its API with the page-test approach (render against the real handler); fix what fails |
| Dashboard (`pages/index.tsx`) | Check its figures against the reports (same source of truth as F-47) |
| Customer / Vendor details (`entry/customerdetails`, `entry/vendordetails`, `customers/*`, `vendors/*`) | Audit, page tests |
| Dead stock | Audit; its stock movement is now read by Opening / Closing Stock, so check edit / delete |
| `/transactions` (old Transaction Management) | Shows hard-coded sample data and is not linked. **Owner decision:** remove it, or replace it with an income / expense list later |

## Order and checkpoints

1. T1–T4 (screens) → commit, page suite `test8` (transactions: list, view, create, edit, both parties).
2. T5 (routes) → commit; server suites pay / tx / adv / advv unchanged.
3. R1–R4 (return screens) → commit, page suite `test9`.
4. R5 (purchase return routes) → commit; ret / vret suites unchanged.
5. T6 (handler merge) → commit; every suite.
6. U (unvisited sections) → commit per section group.
7. `docs/REWRITE_PLAN.md` updated with actual line counts; journey and audit docs updated.

## Risks

- **Handler merge (T6)** touches sale and purchase edit / delete. Mitigation: last, behind
  all suites; differences found become config.
- **Form rewrites** carry the most UI logic (edit-mode loading, allocation caps). Each gets
  a page test that drives create and edit end to end before the old file is deleted.
- **Not testable here:** the real MySQL server and the look of the pages. The owner's own
  click-through after each step is the final check.
