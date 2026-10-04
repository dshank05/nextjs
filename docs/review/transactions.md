# Review C — Money: payments, refunds, party transactions, ledgers

Reviewer C, 2026-10-03, following `docs/REVIEW_PLAN.md`. No app code changed. Added: two backend
suites (`tests/backend/suites/review-c-roundtrip.test.js`, `review-c-findings.test.js`), 32 captured
fixtures (`tests/backend/fixtures/transactions/*.json`), one page-harness script
(`harness/review-c-capture.jsx`), this report, and **one fix to the test support file
`tests/backend/support/memtx.js`** in this copy (H-01 below — the merge must take it, or the vendor
two-bill tests report false A3 failures).

## 0. Summary

- **Actions traced:** 14 user actions (create / edit / delete payment and refund for each party,
  each payment type, allocation changes, Auto Allocate, open bills, list filters / sort / paging /
  totals / export, view, ledger note edit, refusals shown on the form, the bill's "Record Payment"
  modal as a second caller), plus the unused routes.
- **Screens rendered and payloads captured:** customer and vendor transaction form (create, edit
  cached and fetched, party change), view, list (filters, delete), both ledger screens (note edit),
  `/transactions`. 51 harness checks pass; 32 fixtures written.
- **Round trips (from the fixtures):** customer payment Bill Specific, Mixed, On Account; customer
  refund; vendor payment Bill Specific (create / read / unchanged / delete), Mixed + On Account
  (incl. amount / date edit); vendor refund — each step followed by A1–A14 and the 16 report checks
  and by the places the write must show up. All pass.
- **Findings:** 10 wrong-today behaviours (C-01 … C-10, 2 high), 4 gaps in A1–A14 (G-01 … G-04),
  one dead route confirmed (C-12), one owner question (Q-01), one test-harness fault fixed (H-01),
  minor notes N-1 … N-6.

| Id | Sev. | One line |
|---|---|---|
| C-01 | **High** | Vendor Bill Specific payment over 2+ bills: an amount edit writes the NEW TOTAL onto every per-bill ledger row — the ledger, outstanding and the vendor ledger screen show the payment 2× (₹2,400 for ₹1,200). |
| C-02 | **High** | An on-account refund is counted as *advance* (sign error): the next bill created as Paid draws on money already given back — no new payment is recorded, the cash book misses it, the bill shows Paid while the ledger says the party owes the full bill; a "carried advance" payment row is invented. Sale, Invoice C and purchase. |
| C-03 | Medium | Editing a payment's allocations never moves its ledger rows: a vendor Bill Specific row keeps naming (and "paying") the old bill; a customer payment made with a paid bill keeps its row tagged with that bill. Deleting the old bill then deletes the payment's ledger row (A12 fails). |
| C-04 | Medium | A mode edit (cash ↔ bank) never reaches the ledger rows (payments and refunds, both parties); the ledger report's `paymentMode` and the vendor ledger screen's "Cash / Bank" column stay wrong. |
| C-05 | Low–Med | Notes: a payment / refund notes edit never reaches the ledger; any amount edit overwrites the ledger note — including one typed on the ledger screen — with "Payment #N updated to ₹…". |
| C-06 | Low–Med | Auto Allocate float residue: the screen sends `1.1e-13` to one more bill; the server stores a ₹0 allocation on it (vendor: also a ₹0 PAYMENT ledger row); the view shows "4 bill(s)" with a ₹0.00 line. |
| C-07 | Low–Med | Edit form leaves the party picker live; the PUT ignores `customer_id` / `vendor_id` and answers 200 — the user's change is silently dropped (or refused as FOREIGN_BILL if bills were picked). |
| C-08 | Low (API) | Vendor refund create accepts a ₹0 allocation to a return: writes a ₹0 allocation and ₹0 ledger row and resets a *completed* return to pending (A9 / A12 fail). The customer twin refuses it. |
| C-09 | Low | Save unchanged is not a no-op: notes `''` come back as `null` (payments, both parties). |
| C-10 | Low | `GET /api/customer-payments` and `/api/customer-refunds`: the `customer` filter is computed and thrown away; `status` ignored. No screen calls these lists. |
| C-11 | Low | `/transactions` renders hard-coded demo bills ("ABC Electronics"…), no API; not in the menu. |
| C-12 | Info | `POST /api/customer-adjustments` cannot succeed (reads `.id` of a void ledger write → 500, rolled back). No screen calls it or `/api/transactions`. |
| G-01…G-04 | — | A1–A14 do not check per-payment ledger rows, ledger mode/date vs the document, `total_allocated` vs allocations, or customer refund allocations. |
| Q-01 | Question | Mixed asked and fully allocated is stored MIXED, not BILL_SPECIFIC as the owner rule reads. |
| H-01 | Harness | `memtx.findUnique` (with select / include) swapped `store[table]` while awaiting: parallel callers (vendor status recalculation, `Promise.all`) saw a one-row table and wrote status 0. Fixed in this copy; full suite still 291 / 3 skipped. |

## 1. Actions and field-by-field trace

Screens: `pages/customer-transactions/{index,create,view/[id]}`, `pages/vendor-transactions/{index,view/[id]}`,
`pages/entry/vendor-transaction` → `components/transactions/PartyTransaction{List,Form,View}.tsx`,
`TransactionTotals`, `PendingReturnsHint` → `hooks/usePartyTransactions.ts`. Ledger screens
`pages/reports/{customer,vendor}-ledger` → `components/reports/PartyLedgerReport.tsx` (+ client merge
`lib/ledger-merge-utils.ts`). Bill pages use `components/PaymentHistory*.tsx` and
`components/bills/BillPaymentModal.tsx`.

Captured payloads (exact, from the rendered screens; ids from the harness seed):

```
POST /api/customer-payments {"customer_id":"1","notes":"cash receipt","allocations":[{"invoice_id":1000,"allocated_amount":1000,"notes":"Payment for Invoice 1"},{"invoice_id":1001,"allocated_amount":300,"notes":"Payment for Invoice 2"}],"payment_amount":1300,"payment_mode":0,"payment_date":1791138600,"payment_type":"BILL_SPECIFIC"}
POST /api/customer-payments {"customer_id":"1","notes":"","allocations":[{"invoicex_id":1000,"allocated_amount":200,"notes":"Payment for Invoice C 1"}],"payment_amount":500,"payment_mode":1,"payment_date":1791138600,"payment_type":"MIXED"}
PUT  /api/customer-payments/1003  (same shape as POST; party id included and ignored)
POST /api/customer-refunds {"customer_id":"1","notes":"refund cash","allocations":[],"refund_amount":100,"refund_mode":0,"refund_date":1791138600,"refund_type":"DIRECT"}
POST /api/vendor-payments  {"vendor_id":"1", ... same keys, allocations [{"purchase_id":…}]}
POST /api/vendor-refunds   {"vendor_id":"1", ... same keys as the customer refund}
DELETE /api/customer-payments/1004   (no body)
GET  /api/customer-transactions?page=1&limit=50&sortBy=date&sortOrder=asc&type=all&customer_id=1&dateFrom=2026-10-01T00:00:00&dateTo=2026-10-31T23:59:59[&payment_mode=0][&payment_type=…]
PATCH /api/customer-ledger/1012 {"notes":"checked with bank statement"}
POST /api/customer-payments (Auto Allocate, party 2) … {"invoice_id":1005,"allocated_amount":1.1368683772161603e-13,…}   ← C-06
```

Unit notes that hold: amounts are rupees (numbers, not paise); dates are seconds at IST midnight
(the form converts `YYYY-MM-DD` in the browser; the bill modal sends `YYYY-MM-DD` and the server
converts — both land on the same second); party ids travel as strings (`"1"`) and are `parseInt`ed;
mode 0 is cash and stays 0 on every route (R-03).

### 1.1 Create payment (customer receipt / vendor payment) — Bill Specific, Mixed, On Account

| Screen field | Payload key (POST `/api/customer-payments` · `/api/vendor-payments`) | Server reads | Validated / computed | Table.column written | Response | Screen reads back | Cache | Shown elsewhere |
|---|---|---|---|---|---|---|---|---|
| Customer / Vendor (SearchableSelect) | `customer_id` / `vendor_id` (string) | parseInt | customer: must exist (400); vendor: no existence check (an unknown vendor reaches the FK → 500; screen can't send one) | `*_payments.customer_id/vendor_id`, ledger, counters, logs | — | — | all queries invalidated | list, ledger, outstanding, party view |
| Operation type radio | route choice (payments vs refunds) | — | — | — | — | — | — | — |
| Payment type radio | `payment_type` | `requestedType` | **derived** (`lib/payment-allocations.ts:49`): none → DIRECT, part → MIXED, full → BILL_SPECIFIC unless MIXED/DIRECT asked (Q-01) | `payment_type` | `data.payment.payment_type` (cust) / full row (vend) | view badge | ✓ | list "Payment Type", A10 |
| Date | `payment_date` (number) | `convertDateToTimestamp` | — | `payment_date`, `*_allocations.allocation_date`, ledger `transaction_date` + `payment_date` | — | view date | ✓ | cash book date, ledger date, list date filter |
| Amount | `payment_amount` | `r2`, > 0 (400) | sum of allocations ≤ amount (OVER_ALLOCATED) | `payment_amount`; ledger credit; `total_paid` (+ log) | ✓ | view Total | ✓ | outstanding, cash book in/out, list totals |
| Payment Mode | `payment_mode` 0/1 | customer `parseInt` (fallback 1); vendor stored as sent | 0 kept as cash | `payment_mode`; ledger `payment_mode` | ✓ | view Cash/Bank | ✓ | cash book cash/bank split; vendor ledger screen "Cash/Bank" (from the ledger row) |
| Notes | `notes` (`''` when blank) | customer `notes \|\| ''`; vendor as sent | — | `notes`; ledger `notes` (customer: `notes \|\| 'Customer payment receipt'`; vendor: notes or generated text) | ✓ | view Notes | ✓ | ledger "Notes" column, cash book notes |
| Allocate column per open bill / Auto Allocate | `allocations[{invoice_id \| invoicex_id \| purchase_id, allocated_amount, notes}]` | `checkPaymentAllocations` | kind by field (sale / Invoice C ids overlap), id > 0, no duplicates (DUPLICATE_BILL), bill exists (UNKNOWN_BILL), same party (FOREIGN_BILL), ≤ bill total − other payments (OVER_BILL); amounts `r2`; **an amount that rounds to 0 is kept** (C-06) | `*_payment_allocations` (allocation_date = payment date); bill `payment_status` (customer `recalculateSaleStatus`; vendor computed inline, `vendor-payments/index.ts:125-149`); `total_allocated` (+ log) | `allocations_count` / `allocations` | view allocation table with live bill status | ✓ | bill payment history (`lib/sale-read.ts:256`, `purchase-read.ts:248`), open-bills list (`remaining_amount`), A3 / A8 |
| (computed) ledger | — | — | customer: one PAYMENT_RECEIVED row ref `payment`, credit = amount. Vendor: BILL_SPECIFIC → one PAYMENT row per bill ref `purchase` with the bill's share and status; MIXED / DIRECT → one row ref `payment`, credit = amount | `customer_ledger` / `vendor_ledger` (written one after another) | — | — | — | ledger report / screens, outstanding (ledger sum), party view |
| (computed) fy | — | — | Settings `currentfy` | `fy` | — | view FY | — | — |

Response used: `data.payment.id` → `router.push(view)`. Refusals come back as `{status:'failure', message, error_code}` and the form shows the message (harness: OVER_BILL on a Mixed over-allocation is shown, both parties).

**Breaks:** C-06 (residue allocation kept), Q-01 (type derivation exception). Twin difference: vendor stores `notes`/`payment_mode` raw and does not check the vendor exists (N-1).

### 1.2 Edit payment (view → Edit → form → Update)

| Screen field | Payload (PUT `/api/…-payments/:id`, same body as create) | Server reads | Validated / computed | Written | Shown elsewhere / break |
|---|---|---|---|---|---|
| Form load | — | GET `/api/…-payments/:id` (or the view's sessionStorage copy, removed on load) | `normalizeDetail` → amount, date, mode, type, notes, allocations (key = kind-id) | — | read fidelity checked in RT-CP / RT-VP: equals what the screen read |
| Party picker (live on edit) | `customer_id` / `vendor_id` | **ignored** | payment stays with the old party | — | **C-07** |
| Amount | `payment_amount` | ✓ | `checkPaymentAllocations(..., excludePaymentId)` | payment; ledger credit via `handle*PaymentEdit`; counters by the difference (+ logs) | **C-01** (vendor, 2+ bills: every row gets the new total); ledger notes overwritten (**C-05**) |
| Allocations | `allocations` | ✓ | own share counted back | allocations deleted and recreated; statuses of every old and new bill recalculated | ledger rows are **not** moved between bills or reshaped on a type change (**C-03**) |
| Date | `payment_date` | ✓ | — | payment; `updateMany` of the ledger rows by `transaction_id` (date + payment_date) | vendor: F-02 (stored balance in entry order) — known |
| Mode | `payment_mode` | ✓ | — | payment only | ledger rows keep the old mode (**C-04**) |
| Notes | `notes` | ✓ | `notes \|\| null` | payment only | `''` → `null` (**C-09**); ledger row keeps old note (**C-05**) |
| Type | `payment_type` | `?? existing type` | derived again | payment | vendor ledger shape not rebuilt (**C-03**) |

Response `{success, data}`; the form pushes to the view; `invalidateQueries()` refreshes everything on screen.

### 1.3 Delete payment / refund (list → trash → confirm)

`DELETE /api/…/:id` → handler `handlePaymentDelete` / `handleRefundDelete` → allocations removed,
statuses of the bills / returns recalculated, the record deleted, ledger rows found by
`transaction_id` (customer refunds also by `reference_type 'refund'`) deleted and running balance
rebuilt from the start, counters reversed with the allocated amount actually held (logged).
Response `{success, message}`; list invalidates. Round trips prove every table returns to its
pre-create state (balance logs keep the history). **Break:** after C-03, a payment's row tagged
with a bill is deleted by that bill's delete, not by the payment's.

### 1.4 Refund (customer "payment to customer" / vendor "refund received") — on account only

| Screen field | Payload | Server | Written | Notes |
|---|---|---|---|---|
| Amount | `refund_amount` | create: > 0; edit: `r2`, > 0 | `refund_amount`; ledger debit (customer REFUND_PAID ref `refund`; vendor REFUND_RECEIVED ref `payment`); `total_refunded` (+ log) | edit moves `total_refunded` by the change ✓ |
| Date / Mode / Notes | `refund_date` / `refund_mode` / `notes` | converted / `parseInt` / as sent | refund row; ledger date synced on edit | mode and notes not synced (**C-04 / C-05**); `''`→`null` |
| Type | `refund_type` (`DIRECT`) | forced DIRECT (customer: DIRECT when no allocations) | `refund_type` | — |
| Allocations | `[]` (new); legacy rows on edit | any amount > 0 on create → REFUND_VIA_RETURN; edit may keep / reduce, not add | allocations replaced; return status recalculated from allocations | vendor create accepts ₹0 rows (**C-08**) |
| On-account panel | — | `PendingReturnsHint` lists returns waiting, linking to the return | — | owner rule: complete the return instead |

### 1.5 Auto Allocate, Clear All, open bills

Open bills: `GET /api/sales?customer=…&limit=1000&sortOrder=asc` + `/api/salex…` (or `/api/purchases?vendor=…`),
kept where `remaining_amount > 0` (`total − Σ allocations`), oldest first; on edit the payment's own
share is added back to each of its bills. Auto Allocate walks the rows (own bills first) taking
`min(left, outstanding)` with plain float subtraction — the residue `1.1e-13` becomes a fourth
allocation (C-06; the bills' remaining amounts were 399.9 / 399.8 / 399.7 after part payments of
600.1 / 600.2 / 600.3). Client checks: Bill Specific needs Σ = amount (±0.01) and no row over its
outstanding; Mixed needs 0 < Σ ≤ amount but does **not** check a row against its outstanding — the
server refuses (OVER_BILL) and the form shows the message (harness).

### 1.6 List, view, export

List query (captured above) → `lib/party-transactions.ts`: payments and refunds of the party,
date range (either end alone works), mode applied as `payment_mode` / `refund_mode`, `payment_type`
applied to both, sort by id / date / amount / type / name, paging after merging, totals over the
whole filtered set. RT-LIST covers the captured query, mode Cash, page 2 of limit 1, payment type,
direction, an empty range. View reads the detail (contact / email, allocations with live status),
Edit caches it. **Notes:** export takes only the rows of the current page (N-2); carried-advance
rows from C-02 are listed as income (cash book leaves them out).

### 1.7 Ledger note edit

`PATCH /api/{customer,vendor}-ledger/:id {notes}` → `lib/api/ledger-note-route.ts` → `notes` trimmed;
optimistic UI, reverted on error. Only the note changes (RT-NOTE); missing notes → 400. On the
vendor screen several rows of one payment are merged into one line (`ledger-merge-utils.ts:84`);
the PATCH goes to the base row. A later amount edit of the payment overwrites the note (C-05).

### 1.8 Other callers and unused routes

- `components/bills/BillPaymentModal.tsx` (bill view "Record Payment", sections A/B) posts one
  allocation to the same routes with `payment_date` as `YYYY-MM-DD`; same server path as 1.1.
- Not called by any screen: `GET` lists of `/api/customer-payments`, `/customer-refunds` (C-10),
  `/vendor-payments`, `/vendor-refunds`; `/api/transactions` (income / expense GET / PUT / DELETE on
  `incexp`, no ledger); `/api/customer-adjustments` (+`[id]`) — POST always 500 (C-12).
- `pages/transactions/index.tsx` renders `mockTransactions` (lines 82, 216) — C-11.

### 1.9 Shown elsewhere (asserted after each round-trip step)

Bill statuses (sale / Invoice C / purchase), the party's ledger row(s) (amount, date, tag), customer
/ vendor outstanding (report), party view (`/api/customers/[id]` outstanding = ledger sum), balance
logs (rows and source types), cash book (row, direction, Cash / Bank, date), the transactions list
(row, mode, type, bill numbers, totals), the bill's payment history (mode text, allocated amount),
and the vendor ledger report rows — plus A1–A14 and all 16 reports.

## 2. Coverage matrix (action × outcome → test)

Before = suites present at the start (`paycheck`, `txcheck`, `scenbills` batch 3, `scenreturns` batch 6, `flow`, `advcheck`, `advvendor`). After = this review (`RT-*` round trips, `R-*` refusals, `C-*` / `G-*` findings, all in `review-c-*.test.js`; `H:` = harness check in `review-c-capture.jsx`).

| Action | Outcome | Before | After |
|---|---|---|---|
| Customer payment create | Bill Specific, 1 bill / several bills | scenbills S3.1, S3.4–3.5; paycheck | RT-CP (screen body, Auto Allocate, 2 bills, cash), H |
| | Mixed / On Account | paycheck (Mixed); flow | RT-CP2 (screen bodies), H |
| | Invoice C allocation lands on Invoice C | paycheck, test8 | RT-CP2 |
| | refusals OVER_ALLOCATED / OVER_BILL / FOREIGN_BILL | scenbills S3.9–3.11 | R-01 (amount 0), H (OVER_BILL shown on the form) |
| | float residue from Auto Allocate | — | **C-06**, H |
| Vendor payment create | Bill Specific 1 / several bills (row per bill) | scenbills P3.1, P3.4–3.5; paycheck | RT-VP (screen body), H |
| | Mixed / On Account (one row tagged payment) | flow; paycheck | RT-VP2, H |
| | refusals | scenbills P3.9–3.11; paycheck | R-01, H |
| Payment edit | save unchanged = no change | — | RT-CP, RT-VP (pass); RT-CP2 / **C-09** (`''`→null) |
| | amount (customer) | flow (500→450) | RT-CP (1300→1200, allocations, date, mode, notes) |
| | amount (vendor, one row) | flow (DIRECT 300→250) | RT-VP2 (Mixed 500→600 + date) |
| | amount (vendor Bill Specific, 2 bills) | — | **C-01** |
| | allocations moved / type changed | paycheck (customer kinds) | **C-03** (both parties) |
| | mode / notes reach the ledger | — | **C-04**, **C-05** |
| | party changed on the form | — | **C-07**, H |
| | refusals OVER_BILL (own share excluded) / FOREIGN_BILL / OVER_ALLOCATED / DUPLICATE_BILL / UNKNOWN_BILL / 0 / missing id | paycheck (OVER_BILL, OVER_ALLOCATED) | R-01, R-02 |
| Payment delete | rolled back fully | scenbills S/P3.15; txcheck | RT-CP, RT-CP2, RT-VP, RT-VP2 (all tables as before), H |
| | missing id 404 | — | R-02 |
| Refund create (both) | on account, cash / bank, notes | scenreturns 6.6; txcheck | RT-CR, RT-VR (screen bodies), H |
| | to a return refused (REFUND_VIA_RETURN) | scenreturns 5.5; txcheck | R-02 (on edit) |
| | ₹0 allocation (vendor) | — | **C-08** |
| | amount 0 | scenreturns 6.9 | R-02 (edit) |
| Refund edit | amount | scenreturns 6.14; flow | RT-CR, RT-VR (amount, date, mode, notes) |
| | unchanged | — | RT-CR, RT-VR |
| | legacy return-specific: keep / reduce, not raise | test8 (keep) | R-04 |
| Refund delete | rolled back | scenreturns 6.14; paycheck | RT-CR, RT-VR |
| Cash kept as cash | 4 creates, cash book split | paycheck; scenbills 3.6 | R-03 |
| Refund then paid bill | advance not double counted | — | **C-02** (sale, Invoice C, purchase) |
| List | mode filter with all types; totals over pages; date start only | txcheck | RT-LIST (captured query, mode Cash, page 2, type, direction, empty range), H |
| View / edit form read | detail as the form reads it | test8 | RT-CP, RT-VP, RT-CR, RT-VR (normalizeDetail vs captured form detail) |
| Ledger note edit | only the note changes; 400 without notes | — | RT-NOTE, H |
| Unused routes | customer list filter; adjustments POST | — | **C-10**, C-12 |
| `/transactions` page | real data | — | H (C-11) |
| A1–A14 coverage of these tables | per-payment rows, ledger mode/date, total_allocated, customer refund allocations | — | **G-01 … G-04** |

## 3. Findings (ranked)

### C-01 (High) Vendor Bill Specific payment over two bills: amount edit doubles the ledger

- **Where:** `lib/transaction-handler.ts:253-265` builds one update `where { transaction_id, transaction_type: 'PAYMENT' }` with `credit: newAmount`; `pages/api/vendor-payments/[id].ts:301-353` runs it as `updateMany`. A Bill Specific payment has one PAYMENT row per bill (`vendor-payments/index.ts:222-245`), so **each** row is set to the full new amount.
- **Evidence:** screen fixtures `vp-create-bill` (1300 on P1 1000 + P2 300) then `vp-edit-changed` (1200: 1000 + 200). Rows become 1200 + 1200; A12 "payments ₹1200 but the ledger rows net ₹2400"; Bosch shows ₹900 advance instead of owing ₹300. The vendor ledger **screen** shows the merged line as "Payment … ₹2,400.00" (harness `vendor-ledger-note.json` `screen_rows`). Test `C-01` (test.failing).
- **Expected:** rows per bill with each bill's new share (owner rule), or delete the payment's rows and re-post them from the new allocations.
- **Fix:** in the vendor PUT, delete the payment's ledger rows (by `transaction_id`, type PAYMENT) and re-post exactly as create does for the derived type (per bill for BILL_SPECIFIC, one `payment` row otherwise), one after another, then rebuild the running balance from the start. This also fixes C-03, C-04 and C-05 for vendor payments. Risk: low — same code as create; the delete path already removes by `transaction_id`.

### C-02 (High) An on-account refund is counted as advance by the next bill created / marked Paid

- **Where:** `lib/sale-create.ts:255-258` and `lib/purchase-create.ts:192-195` compute
  `advance = (total_paid − total_allocated) + (total_refunded − total_refund_allocated)`; the same
  `+` is in the edit paths `lib/customer-transaction-handler.ts:643-646` and `lib/transaction-handler.ts:686-689`.
  The party's advance is `account_balance = paid − allocated − refunded + refund_allocated`
  (A2 / A7 and both balance handlers say so): money refunded on account **reduces** the advance.
  `allocateFromAdvance` then finds too little in the payment rows and invents a MIXED "Advance
  carried in the balance with no payment row" row (`lib/advance-allocation.ts:75-91`).
- **Evidence:** advance 1000 on account, refunded 1000 on account (both screens' refund action),
  then a 1500 bill created as Paid in cash: the bill is Paid by 1000 of the old (refunded) advance +
  a 500 carried row; **no** new payment, the cash book misses 1500, the party ledger shows 1500 owed
  against a "Paid" bill; A12 fails (payments ≠ ledger; customer `total_paid` ≠ payments) and the cash
  book report disagrees. Tests `C-02 sale / salex / purchase`. The carried row is also listed as
  income in the transactions list and can be edited / deleted there, moving `total_paid` by money
  that was never added to it.
- **Expected:** advance = `account_balance` (here 0) → the 1500 is new money with its payment and ledger row.
- **Fix:** subtract the unallocated refunds in the four places (or read `account_balance`). Sections A / B own the files; the trigger is this section's refund action. Risk: medium — changes how much advance a Paid bill draws; covered by scenbills and these tests.

### C-03 (Medium) Allocation edits do not move a payment's ledger rows; deleting the old bill then deletes them

- **Where:** payment PUTs replace allocations and statuses (`customer-payments/[id].ts:249-271`, `vendor-payments/[id].ts:275-299`) but only touch the ledger on an amount or date change. Vendor Bill Specific rows carry `reference_type 'purchase'`, `reference_id` = bill, the bill's share and its `payment_status`; a customer payment made with a paid bill carries `reference_type 'sale'|'salex'` (`lib/sale-create.ts:290-305`). Bill delete removes every row tagged with the bill (`customer-transaction-handler.ts:1412-1417`, `transaction-handler.ts:1526-1531`).
- **Evidence:** vendor: payment 1000 on bill a moved (screen-shaped PUT) to bill b → the row still names bill a, status "paid"; deleting bill a (now unpaid) deletes the row → A12 "payments ₹1000, ledger ₹0". Customer: a sale created Paid, its payment moved to another sale, the first sale deleted → the payment's PAYMENT_RECEIVED row is gone. A Bill Specific → Mixed / On Account change also keeps per-bill rows (owner rule: one row tagged `payment`). Tests `C-03 vendor`, `C-03 customer twin`; G-01 shows A1–A14 pass in between.
- **Fix:** vendor as C-01 (re-post from the allocations). Customer: on any allocation change, re-tag the row as `reference_type 'payment', reference_id = payment id` (the payments-screen shape). Risk: low.

### C-04 (Medium) Mode edits never reach the ledger rows

- **Where:** the PUTs sync date only (`customer-payments/[id].ts:236-247`, `customer-refunds/[id].ts:284-297`, `vendor-payments/[id].ts:262-274`, `vendor-refunds/[id].ts:248-260`).
- **Evidence:** screen edit cash → bank: payment / refund rows say cash; `customer-ledger-accounting` / `vendor-ledger-accounting` return `paymentMode 0`; the vendor ledger screen prints its "Particulars" from that mode (`ledger-merge-utils.ts:117-129`) — harness shows "Cash" on the edited payment. Cash book is right (reads the documents). Tests `C-04 customer`, `C-04 vendor`; G-02.
- **Fix:** add `payment_mode` to the same `updateMany` as the date (four routes). Risk: none.

### C-05 (Low–Medium) Notes

- **Where:** same PUTs (notes not synced); handlers overwrite on amount change (`customer-transaction-handler.ts:262`, `:337`; `transaction-handler.ts:263`, `:334`).
- **Evidence:** a note typed on the ledger screen ("checked with bank statement") is replaced by "Payment #1003 updated to ₹1200.00 (Bill specific)"; a vendor notes-only edit leaves "Direct advance payment ₹250". Test `C-05`.
- **Fix:** sync `notes` like the date when the user changed them; do not write generated text over an existing note. Risk: low. (Owner: decide whether the ledger note is the payment's note or a separate ledger remark; today it is both.)

### C-06 (Low–Medium) Auto Allocate float residue → ₹0 allocation

- **Where:** client `PartyTransactionForm.tsx:150-158` (`left -= take` in floats); server `lib/payment-allocations.ts:69-89` skips only an exact `0`, then stores `r2(value)` = 0.
- **Evidence:** fixtures `cp-auto-paise`, `vp-auto-paise` (amount 1199.40 over 399.9 / 399.8 / 399.7 / 500) send `1.1368683772161603e-13` to the fourth bill; stored as a ₹0 allocation (vendor also a ₹0 PAYMENT row with status 0 on that bill); the view says "4 bill(s)" with a ₹0.00 line (harness). Tests `C-06 customer / vendor`.
- **Fix:** server: `if (r2(value) === 0) continue`; client: round `take` and `left` to paise. Risk: none.

### C-07 (Low–Medium) Party can be changed on edit and is silently ignored

- **Where:** `PartyTransactionForm.tsx:281-287` (picker not disabled when `isEdit`), payload `:207`; PUTs never read the party.
- **Evidence:** fixtures `cp-edit-party` / `vp-edit-party` send party 2; 200, payment still party 1. With bills picked the other party's bills appear and the save is refused FOREIGN_BILL. Tests `C-07 customer / vendor`.
- **Fix:** lock the picker on edit (as the return screens do); optionally refuse a mismatching party in the PUT. Risk: none.

### C-08 (Low, API only) Vendor refund create with a ₹0 allocation

- **Where:** `vendor-refunds/index.ts:75` refuses only amounts > 0; `:84-90` validator; `:122-199` writes the rows and sets the return status from allocations alone (`:153-176`).
- **Evidence:** a completed purchase return (status 1, debit note) + refund with `{return_id, allocated_amount: 0}` → 201; return back to 0 (pending) while its debit note stays; A9 and A12 fail. Customer twin answers 400. Test `C-08`. The screen never sends allocations for a new refund.
- **Fix:** refuse any allocation on create (as the edit route does for new ones). Risk: none.

### C-09 (Low) Save unchanged is not a no-op

`notes || ''` on customer create (`customer-payments/index.ts:278`, `customer-refunds/index.ts:413`), raw on vendor create (`:90`, `:117`), `notes || null` on every PUT (`:231`, `:280`, `:256`, `:244`). Test `C-09`; RT-CP2 allows exactly this difference. Fix: store `notes || null` (or `''`) consistently.

### C-10 (Low) Customer payment / refund GET list filters

`customer-payments/index.ts:189-202`, `customer-refunds/index.ts:186-199`: `enhanced*.filter(...)` result discarded; `status` read and unused. Unused by the screens (they use `/api/customer-transactions`). Test `C-10`. Fix: assign the filter (or delete the unused list).

### C-11 (Low) `/transactions` shows demo data

`pages/transactions/index.tsx:82-206` `mockTransactions`, filtered client-side (`:216`); the page fetches nothing. Not linked from the menu. Harness check. Fix: remove the page (or wire it to a real list).

### C-12 (Info) `POST /api/customer-adjustments` cannot succeed

`customer-adjustments/index.ts:337-361`: `customerLedgerService.createEntry` returns `void` (`customer-ledger-service.ts:40`), so `ledgerEntry.id` throws → 500 and MySQL rolls back. Test `C-12` (passes: documents it). No screen calls it or `/api/transactions` (whose PUT / DELETE edit `incexp` with no ledger). Suggest deleting both.

### G-01 … G-04 Gaps in A1–A14 for these tables (test.failing: the state is wrong, A1–A14 pass)

- **G-01** per-payment ledger rows: no check that a vendor BILL_SPECIFIC payment has one row per allocated bill for that bill's share, a MIXED / DIRECT payment one row tagged `payment` for its amount, a customer payment one PAYMENT_RECEIVED row for its amount. (A12 only sums per party — it caught C-01 but not C-03 until the bill was deleted, nor C-06's ₹0 row.)
- **G-02** ledger row vs document: `transaction_date` / `payment_mode` of a payment's / refund's rows equal the document's.
- **G-03** `total_allocated` = Σ allocations of the party's payments (and `total_refund_allocated` ≥ Σ refund allocations); A14 only checks the log chain, so a logged wrong increment passes.
- **G-04** A10's cross-party and orphan lists cover customer payments, vendor payments and vendor refunds but not `customer_refund_allocations` (refund exists, return exists and belongs to the refund's customer); A10's type check ignores RETURN_SPECIFIC.

### Q-01 (owner question) Payment type when Mixed is asked and fully allocated

`derivePaymentType` (`payment-allocations.ts:49-53`) keeps MIXED when the form asked Mixed (or On Account) and everything is allocated, so a used-up advance stays an advance (bill delete then does not delete the money). The recorded rule reads "allocated in full → BILL_SPECIFIC". On the vendor side the type decides the ledger shape (one `payment` row vs per bill). Test `Q-01` documents today's behaviour; please confirm the exception.

### H-01 (test harness) `memtx.findUnique` was not safe for parallel callers — fixed in this copy

`tests/backend/support/memtx.js` `findUnique` with `select`/`include` replaced `store[table]` by a
one-row array while it awaited `findMany`; a second `findUnique` running at the same time (the vendor
routes recalculate purchase / return statuses with `Promise.all`) saw that one-row table, found
nothing and the route wrote status 0. It showed as a false A3 failure on the vendor two-bill edit.
Now it filters with the same `where` (one line). Full backend suite before and after: 291 pass, 3
skipped. The harness copy (`harness/delcheck/memtx.js`) has the old code but no copy-on-read either;
not changed.

### Minor notes (no test)

- **N-1** Vendor create twin gaps: vendor existence not checked (FK → 500), `payment_mode` / `notes` stored as sent (a string mode from another caller would reach Prisma as a string). The screen sends numbers.
- **N-2** List export (`PartyTransactionList.tsx:105-123`) exports the current page only, while the totals cover all pages.
- **N-3** A refund edit recalculates a legacy return's status from its old refund allocations alone (`customer-refunds/[id].ts:318-335`, `vendor-refunds/[id].ts:276-284`), which can override a return completed under the new rule. Only legacy data (new refunds cannot be allocated); consistent with the purchase-return edit's own legacy rule.
- **N-4** The vendor create computes purchase statuses inline (`vendor-payments/index.ts:125-149`) instead of `calculatePurchasePaymentStatus` (same result with Decimal sums; one rule in one place would be safer).
- **N-5** `normalizeDetail` shows a `null` mode as Cash (`usePartyTransactions.ts:157`); only old rows can have one.
- **N-6** Rule question: `cash-book.ts:27/38` excludes payments by their *notes* text ("Advance carried…"); a user editing that note on such a row would bring it into the cash book. Goes away with C-02.

## 4. Tests and fixtures added, results

Run: `cd build && TZ=Asia/Kolkata npx jest -c jest.backend.config.js --runInBand tests/backend/suites/review-c-roundtrip.test.js tests/backend/suites/review-c-findings.test.js`

| File | Tests | Result |
|---|---|---|
| `tests/backend/suites/review-c-roundtrip.test.js` | 8: RT-CP, RT-CP2, RT-CR, RT-VP, RT-VP2, RT-VR, RT-LIST, RT-NOTE | 8 pass |
| `tests/backend/suites/review-c-findings.test.js` | 26: C-01, C-02 ×3, C-03 ×2, C-04 ×2, C-05, C-06 ×2, C-07 ×2, C-08, C-09, C-10 (16 test.failing); G-01…G-04 (4 test.failing); C-12, Q-01 (2 pass, documenting); R-01…R-04 (4 pass) | 26 green: 20 failing-by-design, 6 pass |
| `tests/backend/fixtures/transactions/*.json` | 32 captured requests (+ `index.json` with the seed and bill map): `{cp,vp}-create-{bill,mixed,direct}`, `{cp,vp}-edit-{unchanged,changed,party}`, `{cr,vr}-create`, `{cr,vr}-edit-{unchanged,changed}`, `{cp,vp,cr,vr}-delete`, `{cp,vp}-auto-paise`, `{cp,vp}-refused-over-bill`, `{customer,vendor}-list-query[-cash]`, `{customer,vendor}-ledger-note`. Each holds method, URL, body, the server's answer, the screen steps; edit fixtures also the GET the form read and the normalized detail it held. | — |
| `harness/review-c-capture.jsx` | 51 checks: renders both forms, views, lists, ledger screens and `/transactions`, fills them, captures and writes the fixtures | 51 PASS |
| `tests/backend/support/memtx.js` | H-01 fix (one line) | full suite unchanged |

Each finding was checked both ways: run as a plain `test`, it fails on exactly the assertion named
in its title (messages quoted in section 3); registered as `test.failing`, the suite is green.
Every round-trip step and every `R-` / `C-` test ends with A1–A14 and the 16 report checks
(`A2` known on vendor steps: F-02, stored balance in entry order).

Whole backend suite with these files (`npx jest -c jest.backend.config.js --runInBand`): **27 suites, 328 tests — 325 green (incl. the 20 failing-by-design), 3 skipped** (before: 25 suites, 294 tests, 291 pass, 3 skipped — unchanged by the memtx fix).

Run the harness: `cd harness && HOME=/home/claude/review/C ENTRY=review-c-capture.jsx OUT=review-c-capture.out.js node build-e2e.mjs && HOME=/home/claude/review/C TZ=Asia/Kolkata node review-c-capture.out.js` (rewrites the fixtures; deterministic ids).
