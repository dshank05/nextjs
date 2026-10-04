# Review A — Purchases

Reviewer A, 2026-10-03/04, method `docs/REVIEW_PLAN.md`. No app code changed. Added only:
`tests/backend/suites/review-a-purchases.test.js`, `tests/backend/suites/review-a-findings.test.js`,
`tests/backend/fixtures/purchases/*.json`, `harness/review-a-build.mjs`, `harness/review-a-capture.jsx`
and this report. No support file was changed (two in-memory-store limits are worked around inside the
tests — §4.3).

Scope read in full: `pages/purchases/*`, `components/bills/{BillForm,BillLines,BillList,BillView,BillPaymentModal}`,
`hooks/useBills.ts`, `pages/api/purchases/{index,[id],last-invoice}`, `lib/api/purchase-routes.ts`,
`lib/purchase{,-create,-edit,-delete,-read,-query}.ts`, `lib/transaction-handler.ts` (purchase paths),
`ledger-handler.ts`, `ledger-service.ts`, `balance-handler.ts`, `advance-allocation.ts`,
`payment-allocation-service.ts` (purchase status), `invoice-counter.ts`, `line-math.ts`; and, where a purchase
reaches them, `pages/api/vendor-payments/index.ts` (Mark as Paid), `lib/bill-report.ts`, `gst-report.ts`,
`cash-book.ts`, `pages/api/dashboard`, `lib/export-layouts/purchase-view-layout.ts`, `scripts/audit-assert.js`.

**Headline.** The screens and the routes agree field for field: every field the form shows is sent under the
name the server reads, comes back under the name the form loads, and a save of the untouched form changes
nothing (one cosmetic exception, A-06). The breaks are in the money paths behind the bill: a vendor refund is
spent as if it were an advance (A-04, money is invented), a lowered bill's surplus payment loses its ledger
row when the bill is later deleted or unmarked (A-01), "Other" paid on create skips its counters (A-02), and a
paid bill at rate 0 stays "Paid" with a phantom payment once it is priced (A-03).

---

## 1. User actions and the field-by-field trace

### 1.1 Actions

| # | Screen action | Request (captured from the real screen) | Fixture |
|---|---|---|---|
| 1 | Open "Add Purchase" | `GET /api/purchases/last-invoice` (number shown, read-only), vendors / staff / states / business / product lists | — |
| 2 | Create (Unpaid / Paid, Cash / Bank; registered vendor or "Other") | `POST /api/purchases` | `create-paid.json`, `create-unpaid.json`, `create-other-unpaid.json` |
| 3 | Open Edit (`/purchases/create?edit=id`) | `GET /api/purchases/[id]` → `normalizeBill` → form state | `detail-after-create.json` |
| 4 | Update (any field; status Paid / Unpaid picked; partial shown, not offered) | `PUT /api/purchases/[id]` (no `vendor_id`; `payment_status` only when picked) | `edit-notes.json`, `edit-qty.json`, `edit-unmark.json`, `edit-mark-paid.json` |
| 5 | View (`/purchases/view/[id]`) incl. payment history, returns, export Excel / PDF | `GET /api/purchases/[id]` | — |
| 6 | Mark as Paid (view; registered vendor only) | `POST /api/vendor-payments` (BillPaymentModal) | `mark-paid-part.json` |
| 7 | Create Return (view link) | → section D | — |
| 8 | Delete (list, confirm) | `DELETE /api/purchases/[id]` | `delete.json` |
| 9 | List: open, filter (invoice no, bill ref, vendor incl. Other, items, total, tax, date range, mode, status, P/F), sort, page, export | `GET /api/purchases?…` | `list-default-query.json`, `list-filter-query.json` |
| 10 | Refusals the screen shows (snackbar = server `message`) | 400 / 404 bodies | tests X1, X2 |

`capture-log.json` is the whole captured sequence (methods, paths, query strings, bodies, statuses) including
the refetches each save triggers.

### 1.2 Trace — create / edit form (`POST /api/purchases`, `PUT /api/purchases/[id]`)

Server columns in **bold** are derived by the server; the browser never sends a total. "Read back" is
`lib/purchase-read.ts` → `hooks/useBills.ts normalizeBill` → `BillForm` populate effect. Every save calls
`qc.invalidateQueries()` (all queries) and broadcasts to other tabs (captured: each PUT/POST is followed by a
refetch of the detail / list).

| Screen field | Payload key | Server reads / validates / computes | Table.column written | Response / GET field | Form reads back | Shown elsewhere | Break |
|---|---|---|---|---|---|---|---|
| INVOICE NUMBER (read-only) | not sent | `getNextInvoiceNumber('purchase')` per FY, duplicate check per FY; a sent `invoice_number` is still honoured | purchase.invoice_no, bill_to.invoice_no, purchase_items.invoice_no | POST `purchase.invoice_no`; GET `invoice_number` (string) | `n(invoice_number)` | list, ledger `reference_no`, reports, dashboard last purchase | Q: A-14 |
| BILL REFERENCE | `bill_reference` | as sent | purchase.bill_reference (`''` on create, `null` when an edit sends `''`) | `bill_reference` (`''` for null) | header.bill_reference | list column + `billReference` filter (LIKE) | A-06 |
| BILL REFERENCE DATE | `bill_reference_date` `YYYY-MM-DD` / `''` | `new Date(d).toISOString()` (UTC midnight) | purchase.bill_reference_date (DATETIME) | `YYYY-MM-DD` (UTC slice) | same | list (second line under the ref) | — |
| STAFF MEMBER | `staff_id` int / null | must exist | purchase.staff_id (connect / disconnect) | `staff_id`, `staff` | header.staff_id | view "Staff" | — |
| DATE | `date` `YYYY-MM-DD` | `convertDateToTimestamp` (server-TZ midnight; junk not validated) | purchase.invoice_date, purchase_items.invoice_date, ledger PURCHASE `transaction_date` (edit moves it), product.last_purchase_date; paid on create: payment_date / allocation_date / PAYMENT row date | `date` (unix) | `toDateInput` (browser day) | list, every report by day, cash book, dashboard day | A-10 (payment date on edit-to-paid) |
| VENDOR | `vendor_id` (create only) | exists; 0 = "Other" (needs `contact_number`); edit refuses a change | purchase.vendor_id, purchase_items.vendor_id, ledger, payments | `vendor_id` | party.id (select disabled on edit) | list vendor (master name; "Other" → bill_to name), outstanding, ledger account | A-02, A-11 |
| CONTACT / EMAIL / GST / LINE 1 / LINE 2 / CITY / STATE (read-only unless "Other") / pin (hidden) | `contact_number`, `email_id`, `gst_number`, `address`, `address_2`, `city`, `state`, `state_code`, `pin_code`, `vendor_name` | `state_code` (else master's) + business GSTIN → INTRA / INTER (null → refused) | bill_to.contact_no / email / gstin / address / address2 / city / state / state_code / pin_code / vendor_name | `bill_to.*` and `vendor` block = the snapshot | party (snapshot first) | view vendor block, GST split, list name for "Other" | — |
| MANUAL VENDOR NAME ("Other") | `vendor_name` | not required by the server (form requires it) | bill_to.vendor_name; vendor-0 ledger rows' notes | `vendor.vendor_name` | party.name | list, ledger account notes | — |
| TRANSPORT NAME | `transport_name` | — | purchase.transport + purchase.transport_name | `transport_name` | header | view | A-06 |
| BOX QUANTITY | `vehicle_number` | — | purchase.vehicle_number | `vehicle_number` | header | view "Box Quantity" | A-06 |
| FREIGHT | `transport_cost` | ≥ 0; in the total (owner F-34) | purchase.freight, **purchase.total** | `transport_cost`, `freight` | header.freight | totals everywhere | — |
| Enable Tax (checkbox, off by default on purchase) | not sent; zeroes each line's `gst_percentage` | — | — | — | on when any line has GST or total_tax > 0 | — | — |
| Line: product | `items[].product_id` | must exist | purchase_items.product_id, name_of_product, category_id, subcategory_id; **hsn not written on create** | `items[].product_name`, `display_name`, `hsn` | line | stock, purchase report top products | A-08 |
| Line: car model / company / part | `items[].model_id`, `car_model`, `company_id`, `part` | ints / text | purchase_items.model_id, car_model, company_id, part | same | same | view Part No | — |
| Line: qty | `items[].qty` | whole, ≥ 1; edit: not below returned, stock must cover a decrease | purchase_items.qty, **product.stock** | `qty`, `original_qty`, `returned_qty` | qty | stock report, purchase report units, A1 | — |
| Line: rate (or TOTAL typed → rate) | `items[].rate` | ≥ 0 (0 allowed) | purchase_items.rate, **product.latest_purchase_rate** (newest bill only) | `rate` | rate | default rate on the next purchase | A-09 |
| Line: GST % | `items[].gst_percentage` | 0–100 | **purchase_items.subtotal / tax / cgst / sgst / igst; purchase.items_total / total_taxable_value / total_cgst / total_sgst / total_igst / total_tax / total** (F-34 rupee rounding, `computeBill`) | items + header totals | gst | GST input, purchase report tax | — |
| (hidden) line id | `items[].line_id` (edit) | must belong to the bill, once | reconcile by row | `items[].line_id` | line_id | — | — |
| DESCRIPTIONS | `descriptions` | — | purchase.descriptions | same | header | view | A-06 |
| NOTES | `notes` | — (column VARCHAR(255), form unlimited) | purchase.notes | same | header | view, list export | A-06, A-16 |
| P&F QTY / P&F TOTAL | `packing_forwarding_qty`, `packing_forwarding_rate` (rate derived; total never sent) | `packingAmount`: total = qty × rate; a total with no qty = 1 × total | purchase.packing_forwarding_qty / rate / **total** | same three | packing state | list P/F column + filter | — |
| PAYMENT STATUS | `payment_status` (create always; edit only when picked; 2 resent = "unchanged") | 0 / 1 only; Paid needs a mode; edit: Paid over allocations short of the total = Partial (owner) | purchase.payment_status; paid on create: vendor_payments (BILL_SPECIFIC, after advance), payment_allocations, vendor_ledger PAYMENT (ref `purchase`), vendor_details counters, vendor_balance_logs | `payment_status`, `payment_summary`, `payment_history` | status (Partial shown, not offered) | list badge + filter, purchase report paid / unpaid / part, outstanding, ledger account, cash book | A-01, A-02, A-03, A-04, A-10 |
| PAYMENT MODE | `payment_mode` (always; default Cash) | 0 / 1 | purchase.payment_mode; the payment's mode only when a payment is created | `payment_mode` (`?? 0`) | mode | list mode + filter; cash book uses the **payment's** mode | A-05, A-15 |
| GRAND TOTAL (preview) | not sent | same `computeBill` | purchase.total | `total` | — | everywhere | — (harness: preview 13,400 = server 13,400) |

### 1.3 Trace — Mark as Paid (`BillPaymentModal`, `POST /api/vendor-payments`)

| Modal field | Payload key | Server | Tables | Read back | Shown elsewhere | Break |
|---|---|---|---|---|---|---|
| (bill) | `vendor_id` = bill.party.id, `allocations[0].purchase_id` = bill.id | `!vendor_id` → 400 for vendor 0; allocation checked against what is left | — | — | — | A-11 (hidden for "Other" on the view, refused by the API) |
| Payment Amount (starts at outstanding) | `payment_amount`, `allocations[0].allocated_amount` | ≤ outstanding | vendor_payments.payment_amount (type BILL_SPECIFIC: not sent, server default), payment_allocations, purchase.payment_status recomputed | detail `payment_summary` / `payment_history` | list, outstanding, ledger PAYMENT row per bill (ref `purchase`), counters + logs | — |
| Payment Date (today) | `payment_date` | `convertDateToTimestamp` | payment_date, allocation_date, ledger date | history | cash book | — |
| Payment Mode (Bank default) | `payment_mode` | — | payment + ledger row mode | history "Bank" | cash book | — |
| Notes | `notes` (default "Payment for purchase N") | — | vendor_payments.notes; ledger notes | history | — | — |
| Twin | the sale modal also sends `payment_type: 'BILL_SPECIFIC'` and `fy`; harmless (server defaults / settings) | | | | | note |

### 1.4 Trace — list (`GET /api/purchases`) and delete

`billListParams` sends `page, limit, vendor, status, startDate, endDate, uid, billReference, itemCount,
paymentMode, totalTax, packingForwardingTotal, amountMin = amountMax (the "Total" box), sortBy, sortOrder`
(`notes` only for Invoice C) — exactly the names `parsePurchaseListQuery` reads (captured; test L1 builds the
same string from the hook). Opens `invoice_date desc, id desc` (owner). Rows: vendor name from the master,
"Other" from the bill's snapshot (captured: "Walk-in Supplier"), `item_count`, `total_paid`,
`remaining_amount`. Delete: `DELETE /api/purchases/[id]` (no body); disabled in the list when the row has
returns; refusals `HAS_RETURNS`, `INSUFFICIENT_STOCK`, `NOT_FOUND`, each with a `message` the snackbar shows.

### 1.5 Breaks found by the trace (all detailed in §3)

- **None** on names, units or shapes: no field sent and ignored, none required and never sent, no ₹/paise, IST /
  UTC or `"1"`/`1` mismatch, no error code without a message, no write left un-refreshed.
- Round-trip fidelity: the untouched form re-sent changes nothing on a bill with content (R1); on a bill with
  empty optional text, six columns go `'' → null` (A-06).
- Money behind the fields: A-01 … A-05, A-10, A-11. Product master: A-09. Lines: A-08. Export: A-12.

---

## 2. Coverage matrix — action × outcome → test

"Before" = the existing suites (`scenbills` P-scenarios, `scenmore`, `billcheck`, `editcheck`, `advvendor`,
`numcheck`, `listcheck`, `flow`, `check`); "After" adds `review-a-purchases` (RA) and `review-a-findings` (RF).
FX = driven with a captured screen body.

| Action | Outcome | Before | After |
|---|---|---|---|
| Create | unpaid, no tax / 18% intra / inter-state | P1.1, P1.2 | RA R2 (FX, tax off), R3 (FX, IGST) |
| | paid cash / bank | P1.3–1.6 | RA R1 (FX: two lines, tax, freight, P&F, staff, reference, bank — every column checked) |
| | paid, advance covers all / part | advvendor, flow P4 | — (RF A-04 adds the refund-credit case) |
| | "Other" unpaid | P1.10, billcheck, flow P3 | RA R3 (FX) |
| | "Other" **paid** | none | RF A-02a/b |
| | rate 0 | P8.1b | RF A-03 (paid, then priced) |
| | freight, P&F, paise / rounding, large | P1.8, billcheck, P8.3, P8.4 | RA R1 |
| | refusals: no vendor, Other w/o phone, no lines, qty 0, negative rate, GST > 100, unknown product, unknown vendor, paid w/o mode, partial asked, mode 2, negative freight, unknown staff, supply type unresolved, duplicate number | P8.1, P8.7, P8.8, billcheck (phone, product, duplicate) | RA X1 (all 14, each: status, code, message, nothing written) |
| Read for edit | detail → normalizeBill → form body | editcheck (loader) | RA "form mirror" (= the real screen's body, captured) |
| Edit | save unchanged | P2.1, P2.6 (helper body) | RA R1/R2/R3 unchanged (FX: every table diffed) + RF A-06 |
| | one header field | editcheck 5 | RA R1 notes (FX: only purchase.notes changes) |
| | qty up / down (unpaid, paid, partial), add / remove line | P2.2, 2.3, 2.7, 2.8, 2.11, 2.12, 2.15–2.17 | RA R1 qty (FX: allowed columns only, connectedness) |
| | status 0→1 / 1→0 / 2→0 / partial resent / paid by one payment with another bill | P2.4, 2.5, 2.9, 2.10, 2.13, 2.14, 2.18, 2.19, editcheck 6 | RA R2 (FX: Mark as Paid → Unpaid → Paid) |
| | lowered, then deleted / unmarked | none | RF A-01a/b/c |
| | payment mode changed on a paid bill | none | RF A-05 |
| | old bill marked paid by the form (payment date) | none | RF A-10 |
| | refusals: vendor change, foreign line, duplicate line, qty below returned, returned line removed, units sold (stock), fully returned | editcheck (vendor, foreign, removed), billcheck (stock) | RA X2 (all 7 + delete refusals, through the routes) |
| Delete | unpaid / paid / paid by payment screen / one of two bills / paid from advance | P2.20, 2.21, advvendor, flow | RA R1, R2, R3 (FX: every table back) |
| | refused: returns, units sold, unknown | billcheck, flow | RA X2 |
| | product latest rate / date | none | RF A-09 |
| Mark as Paid | part payment from the view | P3.x (helper body) | RA R2 (FX modal body) + harness |
| | "Other" | none | RF A-11, harness ("no Mark as Paid on an Other bill") |
| View | payment summary / history | P3.8 | RA R1 / R2 (`places()`) |
| | export line totals | none | RF A-12 |
| List | default newest first, filters, sort, paging | listcheck (SQL), P3.13, P3.14 | RA L1 (FX query strings through the hook and the route) |
| Connectedness | purchase report, GST input, outstanding, ledger account, balance logs, cash book, stock, dashboard, list row, detail | checkReports (16 reports) after each scenario | RA R1–R3: the 16 checks **plus** hand-worked figures per place after each step, dashboard and next number included |
| updated_at | moved by an edit | none | RF A-13 |

---

## 3. Findings (ranked)

Severity: **High** = money or the ledger wrong in a common case; **Medium** = wrong in a reachable case or
a report disagrees; **Low** = cosmetic / consistency. Each has a `test.failing` in
`review-a-findings.test.js` (run with `REVIEW_A_SHOW=1` to see why it fails today).

### A-04 (High) — a refund received from the vendor is spent as an advance, again and again
- **Evidence.** `lib/purchase-create.ts:192-195`, `lib/ledger-handler.ts:94-97`, `lib/transaction-handler.ts:686-689`
  count "advance" as `(total_paid − total_allocated) + (total_refunded − total_refund_allocated)`. A refund
  received is money the vendor gave **back**; the system's own `account_balance` (A2) subtracts it. Since
  refunds can no longer be allocated to returns (`REFUND_VIA_RETURN`), every refund stays "unallocated" forever.
  `allocateFromAdvance` then finds no payment row for that part and invents one (`advance-allocation.ts:75-91`,
  MIXED "carried advance", no ledger row, no total_paid), and `getCreateBalanceOps` (`balance-handler.ts:70-74`)
  counts the advance without the refund part, so the counters disagree as well.
- **What happens.** Advance 1000, refunded back 1000 (vendor square), then a 2000 purchase marked Paid: no new
  payment, a phantom 1000 "carried" payment, ledger shows 2000 still owed while the bill says Paid; cash book
  out 1000 short; A12 fails (RF A-04a). A 500 refund is re-spent on **every** later paid purchase (A-04b), and
  on the edit form's Unpaid → Paid (A-04c).
- **Expected.** A paid purchase is paid with an advance only if the vendor actually holds our money:
  `total_paid − total_allocated − (total_refunded − total_refund_allocated)`, never more than the payment rows'
  free money.
- **Fix.** Use one advance figure (the A2 `account_balance` formula, floored at 0) in the four places; drop the
  "carried" row path for refunds. **Risk:** medium — the same formula is on the sale side
  (`sale-create.ts:257`, `customer-ledger-handler.ts:113`, `customer-transaction-handler.ts:645`; reviewer B);
  existing data may hold carried rows created this way.

### A-01 (High) — a lowered bill's surplus payment loses its ledger row when the bill is deleted or unmarked
- **Evidence.** A bill-specific payment posts its ledger row tagged to the **bill** (`purchase-create.ts:256-271`;
  `vendor-payments/index.ts:231-247`, `reference_type 'purchase'`). Lowering the bill below what is allocated
  turns the payment MIXED (`advance-allocation.ts:164-186`, owner rule: the excess stays as advance). Deleting
  then deletes every ledger row of the bill (`transaction-handler.ts:1526-1531`, `executeLedgerReversal`), and
  unmarking deletes its PAYMENT rows (`ledger-handler.ts:150-161`) — while `releaseAllocations` keeps the MIXED
  payment (`advance-allocation.ts:133-135`) and total_paid stays.
- **What happens.** Paid 10000 → lowered to 8000 → deleted: the 10000 payment survives as advance, total_paid
  10000, but the ledger has no payment: the vendor shows square instead of 10000 in our favour; A12 fails
  (RF A-01a). Same when unmarked instead (A-01b), and with one payment for two bills (A-01c: the surviving
  bill's ledger keeps only its own share).
- **Expected (owner rules).** "Lowering … the excess stays with the vendor as advance (payment untouched)";
  "a MIXED payment's allocation returns to advance" — so its ledger credit must stay.
- **Fix.** When `trimAllocations` makes a bill-specific payment MIXED/DIRECT, re-tag its ledger rows to the
  payment (`reference_type 'payment'`, `reference_id` = payment id, as a MIXED payment from the screen is
  posted); or delete / shrink PAYMENT rows by `transaction_id` for exactly the payments `releaseAllocations`
  removed / reduced. **Risk:** medium (ledger tagging feeds A12 / A13 and the ledger account report). Twin:
  the customer side posts one row per payment (ref `payment`) and handles it in `releaseAllocations` — B to
  confirm it is not affected.

### A-02 (Medium) — "Other" paid on create skips the vendor counters; deleting it drives them negative
- **Evidence.** `balance-handler.ts:64-67` `getCreateBalanceOps` returns null for vendor 0; the edit path
  (`getPurchaseBalanceOps`) and the delete path (`transaction-handler.ts:1627ff`) do move vendor 0's counters.
- **What happens.** A cash purchase from a walk-in supplier (common) creates the payment and its ledger rows
  but total_paid / total_allocated stay 0 (A12: "vendor 0: total_paid 0 but its payments hold 2360"); deleting
  it leaves −2360 / −2360 (RF A-02a/b). Marking an "Other" bill paid by an edit does move them (probe).
- **Expected.** Owner: "Other" is a real vendor row and posts to the ledger — its counters follow like any
  vendor's. **Fix.** Remove the vendor-0 skip. **Risk:** low; existing vendor-0 counters need a one-off
  recompute from vendor_payments.

### A-03 (Medium) — a paid bill at rate 0, priced later, stays "Paid" and invents a payment in the counters
- **Evidence.** `purchase-edit.ts:223-225` keeps the requested Paid when the bill has no allocations
  (`isTypeA` false — a 0 bill has none); `balance-handler.ts:255-275` (1→1, not Type A) then adds the amount
  difference to total_paid and total_allocated; `ledger-handler.ts:407-438` updates only the PURCHASE row.
- **What happens.** Rate-0 bill created Paid (allowed); the user types the real rate (the form sends no
  status): bill 10000 "Paid", nothing allocated, total_paid +10000 with no payment row; ledger says 10000 owed.
  A3 and A12 fail (RF A-03).
- **Expected.** Owner: "Raising a paid bill makes it part paid (no automatic extra payment)" — here, with
  nothing paid, Unpaid. **Fix.** Derive the status from allocations whenever the total moves (0 allocated →
  Unpaid), and drop the legacy "Type B" counter branch for bills that have no payment ledger.
  **Risk:** low.

### A-05 (Medium) — changing the payment mode of a paid bill on the edit form does not reach its payment
- **Evidence.** `purchase-edit.ts:215-217, 233` writes purchase.payment_mode; nothing updates the bill's own
  BILL_SPECIFIC payment or its ledger row.
- **What happens.** Paid in cash, switched to Bank on the form: the bill and the list say Bank, the payment,
  the ledger row and the cash book say Cash (RF A-05).
- **Expected.** The bill's own payment follows (or the field is read-only once paid and the payment is edited
  on the payments screen). **Fix.** On a mode change of a paid bill, update its BILL_SPECIFIC payments made
  with it (and their PAYMENT rows), or make the field read-only for Paid / Partial. **Risk:** low. Twin: likely
  the same on sale (B).

### A-10 (Medium / owner question) — "Paid" picked on the edit form backdates the payment to the bill date
- **Evidence.** `purchase-edit.ts:227, 428` passes the bill date as `paymentDate`;
  `transaction-handler.ts:836-847`, `ledger-handler.ts:209, 218` use it for the payment, allocation and
  PAYMENT row. Mark as Paid uses the day it is recorded (`BillPaymentModal`, default today).
- **What happens.** A bill of 1 Oct marked Paid on 4 Oct records the payment on 1 Oct: the cash book of a
  closed day changes, and the backdated PAYMENT row is a new F-02 consequence (A2 flags it) (RF A-10).
- **Expected.** The same date whichever way the bill is marked — today, or a date the user picks.
  **Fix.** Use today (or add a payment-date field when "Paid" is picked on edit). Paid **on create** keeps the
  bill date (it is paid with the bill). **Risk:** low.

### A-11 (Low-Medium) — an "Other" bill cannot be paid or part-paid after it is saved
- **Evidence.** `vendor-payments/index.ts:54` `!vendor_id` reads vendor 0 as missing ("Missing required
  fields"); `BillView.tsx:100-102` hides Mark as Paid for "Other" ("no account to post a payment to").
- **What happens.** Only a full "Paid" through the edit form works; no part payment, and the API's message is
  wrong (RF A-11).
- **Expected.** Owner: "Other" is a real vendor row. **Fix.** `vendor_id === undefined || vendor_id === null`,
  and offer Mark as Paid for "Other". **Risk:** low (section C owns the route).

### A-09 (Low-Medium) — deleting a purchase leaves the product's latest purchase rate and date from it
- **Evidence.** `purchase-create.ts:213-219`, `purchase-edit.ts:392-398` set latest_purchase_rate /
  last_purchase_date; the delete path (`transaction-handler.ts:1282-1300`) restores stock only.
- **What happens.** A 1500 bill of 5 Oct is deleted; a 1000 bill of 3 Oct does not update the rate (its date
  is before the deleted bill's): the form keeps offering 1500 from a bill that no longer exists (RF A-09).
- **Expected.** Owner: delete rolls back completely. **Fix.** After a delete (and an edit that moves a date or
  rate) recompute both from the product's newest remaining purchase line. **Risk:** low (products phase may
  take it).

### A-08 (Low) — lines saved at create have no HSN
- **Evidence.** `purchase-create.ts:151-179` selects `hsn` but does not write it; `purchase-edit.ts:377` writes it
  for lines added by an edit. **What happens.** View and export show "N/A" for every line entered with the bill
  (detail fixture: `"hsn": ""`) (RF A-08). **Fix.** Write `hsn: product.hsn || ''` on create. **Risk:** none.

### A-12 (Low) — the purchase export's line "Total" is the taxable amount
- **Evidence.** `purchase-read.ts:115` sends `total: line.subtotal`; the screen recomputes subtotal + tax
  (`useBills.ts:275`), the export (`purchase-view-layout.ts:74`) prints the raw `total`. Its Returns table also
  reads `total_amount` (the whole return, not this bill's share), `items_count` (not sent) and a numeric
  `payment_status`. **What happens.** Line 10 × 1000 at 18%: screen 11,800, export 10,000 (RF A-12).
  **Fix.** Export `items[].total` = subtotal + tax and the returns' `this_bill_*` fields. **Risk:** none.

### A-06 (Low) — saving the untouched form turns empty text into NULL
- **Evidence.** Create stores `''` (`purchase-create.ts:109, 119`, and `bill_reference`, `descriptions`,
  `vehicle_number` as sent); edit writes `x || null` (`purchase-edit.ts:246-254`).
- **What happens.** notes, bill_reference, descriptions, transport, transport_name, vehicle_number go
  `'' → null` on any save of a bill that has them empty (RF A-06; RA R2 / R3 tolerate exactly these). Nothing
  shown changes. **Fix.** One rule on both paths. **Risk:** none.

### A-13 (Low) — an edit never moves `purchase.updated_at`
- **Evidence.** Written on create only (`purchase-create.ts:115`); `purchase-edit.ts:230-245` omits it (RF A-13).
  **Fix.** Add `updated_at: getLocalDateString()` to the header update. **Risk:** none.

### Questions for the owner (no failing test)
- **A-14** `POST /api/purchases` still honours a sent `invoice_number` (`purchase-create.ts:38-39`; `billcheck`
  relies on it). The form never sends one (owner: number assigned by the server, read-only), but any caller can
  pick a number and push the counter (probe: 50 → next 51). Keep, or ignore it like the other server-owned fields?
- **A-15** An unpaid purchase stores payment_mode 0 (the form always sends its Cash default,
  `BillForm.tsx:88, 218`): the list shows "Cash" on unpaid bills and the Cash filter includes them. The list
  was written to show "N/A" for null (`BillList.tsx:40`); PU-20 chose Cash as the default. Store null until paid?
- **A-16** `purchase.notes` is VARCHAR(255) but the notes box has no limit; MySQL refuses a longer note
  (P2000 → 400 "A value is too long for its column"), which the snackbar shows without saying which field.
  P8.5 asserts a 2,000-character note is saved — true only in the in-memory store. Add `maxLength={255}` (and
  correct P8.5)?
- Notes: `line-math.ts:101-102` still says "purchase stores [freight] beside the bill" (stale since BILLS_PLAN
  Q1). An "Other" bill's phone is required on create only (`purchase-create.ts:51`), not on edit. Dashboard
  "last purchase" orders by date only, so several bills of one day give an arbitrary one (section E).

### Twin notes (sale side is reviewer B's)
A-04's formula is also in `sale-create.ts:257` and the customer handlers; A-05 and A-10 likely apply to sale
edits too; A-01 should be checked against the customer ledger tagging (one row per payment); the sale
payment modal sends `payment_type`/`fy`, the purchase one does not (harmless).

---

## 4. Tests and fixtures added, and their run

### 4.1 Fixtures — `tests/backend/fixtures/purchases/` (captured from the real screens)
`create-paid.json`, `create-unpaid.json`, `create-other-unpaid.json` (POST bodies), `edit-notes.json`,
`edit-qty.json`, `edit-unmark.json`, `edit-mark-paid.json` (PUT bodies), `mark-paid-part.json` (Mark as Paid
body), `list-default-query.json`, `list-filter-query.json` (list query strings), `delete.json`,
`detail-after-create.json` (GET detail the edit form loaded), `capture-log.json` (the whole sequence). Dates are
typed in the harness, so a re-capture on another day gives identical files (checked).

Recapture: `cd harness && HOME=/home/claude/review/A ENTRY=review-a-capture.jsx OUT=review-a-capture.out.js node review-a-build.mjs && HOME=/home/claude/review/A TZ=Asia/Kolkata node review-a-capture.out.js`
— `review-a-build.mjs` is `build-e2e.mjs` with the backend suite's database stub (newer memtx) and a defined
`__dirname` for the SQLite mirror. The harness answers `/api/purchases*` and `POST /api/vendor-payments` with
the real routes over the in-memory store; master-data lists are fakes from the same store. **27 checks, ALL PASS**
(incl. preview total = server total, edit form loads every field, Update disabled with no change, raised paid
bill → part paid, Mark as Paid hidden on "Other", "Other" row shows the bill's supplier name, delete refreshes).

### 4.2 Backend tests
- `review-a-purchases.test.js` — **7 tests, all pass**: form mirror (normalizeBill body = captured screen body),
  R1 paid round trip (create → read → unchanged → notes → qty → delete; field-by-field columns, every table
  diffed, 16 report checks + A1–A14 after each step, hand-worked purchase report / GST / outstanding / ledger
  account / cash book / stock / list / detail / dashboard / next number), R2 unpaid round trip (unchanged → Mark
  as Paid → Unpaid → Paid → delete), R3 "Other", L1 list, X1 (14 create refusals), X2 (10 edit / delete refusals).
- `review-a-findings.test.js` — **17 `test.failing`, all failing by design** (A-01a/b/c, A-02a/b, A-03,
  A-04a/b/c, A-05, A-06, A-08, A-09, A-10, A-11, A-12, A-13).
- Run with the closely related suites: `scenbills, scenmore, billcheck, editcheck, advvendor, numcheck, listcheck,
  flow` + both new files — **10 suites, 220 passed, 3 skipped, 0 failed** (2 min 42 s).
  `TZ=Asia/Kolkata npx jest -c jest.backend.config.js --runInBand tests/backend/suites/review-a-*.test.js`
  alone: ~17 s.

### 4.3 In-memory store limits met (worked around in the tests, support files unchanged)
- A Prisma DateTime comes back as a `Date`; the store keeps the ISO string written, and `purchase-read` calls
  `.toISOString()` on it (500 in the harness). The tests and the harness convert `purchase.bill_reference_date`
  to a `Date` after each write (`prismaDates()`).
- The SQLite mirror returns a DateTime as seconds, so the **list's** `bill_reference_date` reads 1970 in the
  tests (MySQL returns a Date); not asserted.
- A `where: { col: null }` matches only a present `null`, not a missing key: products are seeded with
  `last_purchase_date: null` as MySQL has them.
- `update` ignores `connect` / `disconnect`, so a staff change on edit cannot be tested here (create is fine).
