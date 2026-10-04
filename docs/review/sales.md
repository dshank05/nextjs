# Review B — Sales and Invoice C

Reviewer B, 2026-10-03/04. Method: `docs/REVIEW_PLAN.md`. No app code changed. Everything below was
read in full first: `pages/sale/*`, `pages/salex/*`, `components/bills/{BillForm,BillLines,BillList,BillView,BillPaymentModal}`,
`hooks/useBills.ts` (+ `readJson`, `useParties.usePartyRows`, `usePartyTransactions.usePartyOptions`, `useStaff`, `useMechanics`, `useStates`, `useProducts`, `useBusinessDetails`),
`pages/api/{sales,salex}/*`, `lib/api/sale-routes.ts`, `lib/sale.ts`, `sale-create.ts`, `sale-edit.ts`, `sale-delete.ts`, `sale-read.ts`,
`sale-query.ts`, `customer-transaction-handler.ts` (sale edit / delete paths and executors), `customer-ledger-handler.ts`,
`customer-ledger-service.ts`, `customer-balance-handler.ts` (sale ops), `advance-allocation.ts`, `payment-allocation-service.ts`
(sale status), `invoice-counter.ts`, `line-math.ts`, `gst.ts` (supply type), `date-utils.ts`; the reports a bill feeds
(`bill-report`, `gst-report`, `ledger-report`, dashboard, commissions, mechanic / staff sales, transport cost, P&F, bill
reference, notes) and the existing tests (`scenbills` S/X, `scenmore`, `salecheck0`, `salecheckB`, `advcheck`, `listcheck`,
`flow`; harness `test5`, `test6`, `test14`).

**Headline.** The screens and the server agree on almost every field; a bill created, re-saved unchanged, edited and
deleted from the screens' own payloads leaves every table exactly as it should (17 round-trip tests, every step under
A1–A14, the 16 report checks and 10 more connectedness checks). Kind (sale vs Invoice C) is carried correctly through
every write, even with overlapping ids. Ten things are wrong today (B-01…B-07, B-09, B-10, B-13, B-14; one of them
**High**: money paid on a bill is under-recorded for a customer whose advance was refunded) and three are questions for
the owner (B-08, B-11, B-12).

---

## 1. Actions and the field-by-field trace

### 1.1 User actions

| # | Screen | Action | Request |
|---|---|---|---|
| A1 | `/sale/create`, `/salex/create` | Create for a registered customer (unpaid / paid, cash / bank) | `POST /api/sales` · `/api/salex` |
| A2 | same | Create for "Other" (walk-in) | same, `select_customer: 0` |
| A3 | same, `?edit=id` | Load the bill into the form | `GET /api/{sales,salex}/:id` → `normalizeBill` |
| A4 | same | Save an edit (any field; status only when touched) | `PUT /api/{sales,salex}/:id` |
| A5 | same | Add / edit (inline) / remove a line; tax and discount toggles; P&F | part of A1/A4 |
| A6 | `/sale/view/[id]`, `/salex/view/[id]` | View, payment history | `GET …/:id` |
| A7 | view | Mark as Paid (full or part) | `POST /api/customer-payments` (allocation `invoice_id` / `invoicex_id`) |
| A8 | view | Edit / Create Return links, Export (Excel / PDF) | navigation; export is browser-only |
| A9 | `/sale`, `/salex` | List: filters (number, bill ref, customer incl. Other, items, total, tax / notes, date range, mode, status, P/F), sort, paging, export page / all | `GET /api/{sales,salex}?…` (`billListParams`) |
| A10 | list | Delete (refused while the bill has returns) | `DELETE /api/{sales,salex}/:id` |
| A11 | form | "+ Add New Customer" (new tab, broadcast refresh) | customers section (E) |
| A12 | all | Refusals shown: snackbar with the server's `message` (`hooks/readJson.ts`) | every route |

### 1.2 Trace — create / edit form (`components/bills/BillForm.tsx`)

Columns: screen field → payload key → server reads → validated / computed → table.column → response → read back (GET →
`normalizeBill` → form / view) → cache → shown elsewhere. ✓ = verified by a test here; ⚠ = break (finding id).

| Screen field | Payload key | Server reads | Validated / computed | Written to | Response | Read back | Cache | Shown elsewhere |
|---|---|---|---|---|---|---|---|---|
| Invoice number (read-only preview) | — (not sent) | `getNextInvoiceNumber(t.counter)` | max+1 in the **current** FY (Settings); P2002 retry ×3 | `invoice(x).invoice_no`, `fy` | `sale.invoice_no` | `invoice_no` | `nextBillNumber` staleTime 0 | ledger `reference_no`, list, reports ✓ |
| Bill reference | `bill_reference` | as sent | `''` default | `.bill_reference` | — | `bill_reference` | — | list filter / column, bill-reference report ✓ |
| Staff | `staff_id` (int / null) | `intOrNull`, must exist | create `connect`; edit `connect`/`disconnect` | `.staff_id` | — | `staff.name` → `staff_name` | — | view, staff-sales and commission reports ✓; ⚠ **B-14** inactive staff shows as "Select Staff" |
| Date | `date` `YYYY-MM-DD` | `requestedDate` → `convertDateToTimestamp` (server-local midnight) | — | `.invoice_date`, lines `.invoice_date`, SALE ledger `transaction_date` | — | `toDateInput` (browser day) | — | list column / range, every dated report, dashboard ✓; ⚠ **B-11** the bill's own payment keeps the old day |
| Customer | `select_customer` (create only) | `requestedCustomer`; 0 = Other | must exist; edit refuses a change | `.select_customer` | `sale.customer_name` | `party.id` | — | ledger `customer_id`, outstanding, list filter ✓ |
| Contact / email / GST / address 1–2 / city / state (+code) — read-only for a registered customer, typed for Other | `contact_number`, `email_id`, `gst_number`, `address`, `address_2`, `city`, `state`, `state_code` | snapshot; `state_code` → supply type | sale: unknown state code → `SUPPLY_TYPE_UNRESOLVED` | `bill_tosales(x).*`, `shipto(x).*` (copy) | — | `party.*` (snapshot first, master fallback) | — | list name / address / GSTIN, GST B2B/B2C ✓; ⚠ **B-06** edit rewrites ship-to |
| Customer name (Other: "Manual customer name") | `customer_name` | text | required for Other on create | `bill_tosales.billing_name`, `shipto.shipping_name` | `sale.customer_name` | `party.name` | — | list (snapshot), bill-reference report ✓; ⚠ **B-10** commission / mechanic / staff / freight / P&F reports use the master ("Unknown" for a walk-in) |
| Vehicle number | `vehicle_number` | `transportFrom` | — | `transport_details(x).vehicle_no` | — | `vehicle_number` | — | view ✓ |
| Transport name | `transport_name` | `transportFrom` | — | `transport_details(x).trans_mode` | — | `transport_name` | — | view ✓ (the transport-cost report shows no transport name for sales — E) |
| Freight | `transport_cost` | `requestedFreight` | ≥ 0; **in the total**, rupee-rounded (F-34) | `.freight`, `.total` | `sale.total` | `freight` | — | transport-cost report, ledger, every total ✓ |
| Mechanic | `mechanic_id` | must exist | connect / disconnect | `.mechanic_id` | — | `mechanic.name` | — | mechanic-sales, commissions ✓; ⚠ B-14 |
| Commission | `commission` | `Number()||0` | ≥ 0; not in the total | `.commission` | — | `commission` | — | commissions report ✓ |
| Enable Tax (sale) / Enable Discount | not sent: per-line `gst_percentage` / `discount` are 0 when off | — | Invoice C forces GST 0 | lines | — | re-derived on load (any GST > 0 / any discount > 0) | — | ✓ round trip |
| Line: product, car model, company, part | `invoiceItems[].product_id`, `model_id`, `company_id`, `part` | must exist | name, HSN, category from the product | `invoiceitems` / `invoice_itemsx` `.product_id`, `.model_id`, `.company_id`, `.part`, `.name_of_product`, `.hsn`, `.category_id` | — | `items[]` with `line_id` | — | stock, profit, top products ✓ |
| Line qty / rate / discount / GST % | `qty`, `rate`, `discount`, `gst_percentage` (+ `line_id` on edit) | `computeBill` | qty ≥ 1 (whole), rate ≥ 0 (0 allowed), discount ≤ qty×rate, GST 0–100; stock per product; edit: ≥ returned, returned line not removable | lines `.qty .rate .discount .discountrate .subtotal .gst_percentage .tax .cgst .sgst .igst`; `product.stock` | — | `items[]` | — | stock report, GST report, sales units ✓ |
| Line total (typed) | not sent — the rate is derived (`rateFromTotal`) | — | — | — | — | — | — | ✓ |
| Descriptions / Notes | `descriptions`, `notes` | as sent | — | `.descriptions`, `.notes` | — | same | — | Invoice C notes filter, notes report ✓ |
| P&F qty / P&F total | `packing_forwarding_qty`, `packing_forwarding_rate` (**total never sent**) | `packingAmount` | edit: missing total taken from the bill | `.packing_forwarding_qty/_rate/_total`, `.total` | — | `packing_qty/_rate/_total` | — | P&F report, list P/F ✓; ⚠ **B-02** clearing P&F on edit brings it back |
| Payment status | `payment_status` (create always; edit only when the user picks one) | 0 / 1 only; resent 2 ignored on edit | create Paid → advance first, then one BILL_SPECIFIC payment + allocation + PAYMENT_RECEIVED; edit → `customerTransactionHandler.handleSaleEdit` | `.payment_status`; `customer_payments`, `customer_payment_allocations`, `customer_ledger`, `customer_details.total_paid/_allocated`, `customer_balance_logs` | — | `payment_status` | every query invalidated | list status, report paid / unpaid counts, outstanding, cash book ✓; ⚠ **B-01** advance after a refund; ⚠ **B-05** walk-in |
| Payment mode | `payment_mode` (always sent, default 0 = Cash) | 0 / 1; required when Paid | edit: falls back to the stored mode, then 0 | `.payment_mode`; payment / ledger rows only when a payment is written | — | `payment_mode` | — | list column / filter, sales-report cash / bank, cash book; ⚠ **B-03** mode change on a paid bill; ⚠ **B-04** unpaid bill stored as Cash |
| Grand total (preview) | not sent | — | server `computeBill` (the same function) | `.total` | `sale.total` | `total` | — | ledger SALE debit, every report ✓ (harness: preview 3,212 / 2,870 = stored) |

Edit specifics: the form sends no `select_customer` and no totals (✓ RB-*-1); lines carry `line_id` (✓); a part-paid
bill's status is not resent (✓ RB-*-4); the Update button is disabled until something changes (harness ✓); a fully
returned bill cannot be saved (form disabled, server `FULLY_RETURNED` ✓ RF-*-edit). Fields the form loads but does not
send back: P&F total (→ B-02), ship-to and supply date (→ B-06). Sent changed: `payment_mode` null → 0 (B-04); email
null → `''` (harmless).

### 1.3 Trace — view, Mark as Paid, list, delete

| Screen | Field / control | Request | Server → tables | Read back / shown | |
|---|---|---|---|---|---|
| View | every figure | `GET …/:id` (`lib/sale-read.ts`) | — | stored figures, snapshot party, staff / mechanic names, returns, `payment_summary` from allocations | ✓; ⚠ B-05 walk-in "Outstanding = total" on a Paid bill |
| View → Mark as Paid | amount (starts at the outstanding now), date, mode (default Bank), notes (default "Payment for invoice N" / "Invoice C N") | `POST /api/customer-payments` `{customer_id, payment_date, payment_amount, payment_mode, payment_type: BILL_SPECIFIC, fy, notes, allocations:[{invoice_id \| invoicex_id, allocated_amount}]}` | payment, allocation, PAYMENT_RECEIVED (ref `payment`), status 2 / 1, counters, logs | view refetches (all queries invalidated); cash book, outstanding, ledger | ✓ RB-*-4 (fixture) |
| View | Mark as Paid / Create Return | — | — | hidden for a walk-in (no account) | ✓ harness (note for D: walk-in sales cannot be returned at all) |
| List | filters → `billListParams` → `parseSaleListQuery` | `customer`, `status`, `uid`, `billReference`, `itemCount`, `amountMin=amountMax`, `totalTax` (sale) / `notes` (Invoice C), `paymentMode`, `packingForwardingTotal`, `startDate/endDate` (whole India days), `sortBy/sortOrder`, `page/limit` | one SQL query (`lib/sale-query.ts`), customer name from the snapshot first | rows (`toRow`), summary, paging | ✓ RB-*-8 (every filter, sort, paging, through the SQL mirror); ⚠ B-04 (`payment_mode ?? 0` shows null as Cash); ⚠ B-12 export-all capped at 1,000 |
| List | Delete | `DELETE …/:id` | registered: stock back, allocations released (bill-specific payment removed, shared one reduced, MIXED → DIRECT), lines / snapshots / transport (+`incexpx` on Invoice C), ledger rows deleted, counters + `sale_delete` log; walk-in: stock + rows only | list refetch, broadcast | ✓ RB-*-1…7 (every table back, logs net 0); ⚠ B-07 Invoice C logged as `sale_delete` |

---

## 2. Coverage matrix — action × outcome → test (before → after)

"Before" = the suites and harness pages that existed; "after" adds `review-b-*` (RB = round trip, RF = refusal,
B-nn = finding) and the harness page `harness/review-b-capture.jsx` (H). S/X = `scenbills`/`scenmore` sale / Invoice C
scenarios; their bodies are hand-built, not the screens'.

| Action × outcome | Before | After |
|---|---|---|
| Create registered, unpaid — every field (staff, mechanic, commission, bill ref, vehicle, transport, freight, discount, two lines, P&F, notes, descriptions) | S1.1, S1.2, S1.7, S1.8, S1.9 (nested transport only), salecheckB; staff / mechanic / commission never asserted | **RB-sale-1, RB-salex-1** from the form's payload; H (view reads every field back) |
| Create paid (cash / bank) | S1.3–S1.6, salecheckB (advance) | **RB-*-6** (fixture) |
| Create paid, customer advance refunded on account | — | **B-01** (failing) |
| Create walk-in | S1.10, salecheckB | **RB-*-7**, H (view: no Mark as Paid / Return); **B-05** |
| Create refusals (22 kinds) | salecheckB (6, lib-level), scenmore UNKNOWN_PRODUCT | **RF-*-create** (route, message, nothing written) |
| Over-stock refusal shown on the form | — | H |
| Read for the edit form (GET → `normalizeBill` → payload) | salecheckB (snapshot name); test5 (mocked fetch) | **RB-*-1** (rebuilt payload = the real form's, every field) |
| Save back unchanged — nothing changes | S2.1, S2.6 (bill / ledger / counts only) | **RB-*-1**, **RB-*-6** (every table, field by field) |
| Edit one field (notes) | salecheckB (absent fields kept) | **RB-*-1** (only `notes` changes) |
| Edit qty / lines / amount | S2.2, S2.3, S2.11, S2.12, salecheckB | **RB-*-2** (exact set of changed columns) |
| Edit Unpaid → Paid | S2.4, S2.5, salecheckB | **RB-*-3**; **B-01** (after a refund) |
| Edit status cases 1→0, 2→0, 2→1, 1→2, lowered below paid | S2.7–S2.21 (owner rules) | unchanged (covered) |
| Edit payment mode only | — | **B-03** (failing) |
| Edit: clear staff / mechanic / commission / freight / vehicle / transport | — | **RB-*-5** |
| Edit: remove P&F | — | **B-02** (failing) |
| Edit date | salecheckB (lines follow) | **B-11** (question) |
| Edit walk-in name | — | **RB-*-7** |
| Edit with an inactive staff / mechanic / customer | — | H (**B-14**) |
| Edit refusals: 404, bad id, customer change, foreign line, duplicate line, over stock, paid without mode, below returned, returned line removed, fully returned | salecheckB (3, lib-level); editcheck (purchase) | **RF-*-edit** (route, both kinds, nothing written) |
| Mark as Paid (part) from the view | S3.x (hand-built payment bodies) | **RB-*-4** (the modal's payload; part-paid kept by a later edit; delete rolls back) |
| Delete unpaid / paid / part-paid / walk-in — complete rollback | S2.20, S2.21, salecheckB | **RB-*-1…7** (every table equals the pre-create copy; balance logs net 0) |
| Delete refusals (returns, 404, 405, signed out) | salecheckB (HAS_RETURNS, lib) | **RF-*-delete** |
| List: every filter, sort, paging | listcheck (purchase only), S3.13 | **RB-*-8** (sale and Invoice C through the SQL) |
| Sale vs Invoice C with the same id | salecheck0 (handler level) | **RB-both** (edit, pay, delete one; the other untouched) |
| Connectedness: ledger, outstanding, ledger account, balance logs, sales / Invoice C / purchase, GST, notes, returns, cash book, profit, stock | checkReports (16) | 16 + list, detail, dashboard, commissions, mechanic, staff, freight, P&F, bill reference after **every** step |
| Dashboard | test14 (page) | **B-08** (question) + `connected()` |
| Export (list / view) | — | not covered (browser-only; export libs stubbed in the harness) |

---

## 3. Findings (ranked)

Each wrong-today finding is a `test.failing` in `tests/backend/suites/review-b-findings.test.js` named with its id; each
was checked to fail for the stated reason (run as a plain test, the failure messages are exactly the ones quoted).

### B-01 — High — A bill paid for a customer whose advance was refunded under-records the money paid
- **Evidence.** The advance is computed as `(total_paid − total_allocated) + (total_refunded − total_refund_allocated)`:
  `lib/sale-create.ts:255-258`, `lib/customer-transaction-handler.ts:643-645`, `lib/customer-ledger-handler.ts:111-113`.
  An on-account refund is money paid **back** to the customer (REFUND_PAID debit) — it reduces the advance, so the sign is
  wrong. `allocateFromAdvance` (`lib/advance-allocation.ts:54-91`) then also treats the refunded payment's money as free
  and covers the rest with a "carried advance" MIXED row. On the edit path the balance handler uses a third formula,
  `total_paid − total_allocated` (`lib/customer-balance-handler.ts:133-135`), so the counters disagree with the rows.
- **What happens.** Ravi paid ₹500 on account, was refunded ₹500 (advance 0). A ₹2,360 sale marked Paid at the counter
  records ₹1,360 of new money; the ledger shows Ravi owing ₹1,000 on a Paid bill; the cash book is ₹500 short; A12 fails
  ("payments ₹2360 but the ledger rows for them net ₹1860"; "total_paid ₹1860 but its payments hold ₹2360"). Same for
  Unpaid → Paid on the edit form and for Invoice C. Tests: `B-01 sale/salex` (create and edit).
- **Expected.** Advance = `(paid − allocated) − (refunded − refund_allocated)`, never below 0; a refunded payment is not
  free money; the whole ₹2,360 is a new payment.
- **Fix.** One `customerAdvance()` used by create, the allocation, the ledger notes and the balance handler, and have
  `allocateFromAdvance` take at most that amount. The purchase twin has the same formula (`lib/purchase-create.ts:192-194`)
  — reviewer A / C.
- **Risk.** Medium: touches every "paid from advance" path; A12 and the cash-book check guard it.

### B-02 — Medium — P&F removed on the edit form comes back as one unit of the old amount
- **Evidence.** The form sends `packing_forwarding_qty` and `_rate` but never `_total` (`BillForm.tsx:216-217`). The edit
  takes each P&F field separately, the missing total from the stored bill (`lib/sale-edit.ts:116-118`), and
  `packingAmount` turns "qty 0 + a total" into 1 × total (`lib/line-math.ts:133-138`). Purchase does it right: the sent
  qty / rate are one set (`lib/purchase-edit.ts:187-190`).
- **What happens.** P&F ₹100 cleared on the form → saved as P&F 1 × ₹100, total unchanged (3,212 stays 3,212). The
  customer is billed for P&F the user removed; the form showed the lower total. Fixture `*-edit-pf-removed.json`, tests
  `B-02 sale/salex`.
- **Fix.** In `updateSale`, treat the P&F trio as one: if qty or rate was sent, use the sent values (total undefined →
  computed), as purchase does. **Risk:** low.

### B-03 — Medium — Changing the payment mode of a paid bill changes only the bill
- **Evidence.** `lib/sale-edit.ts:151-153,167-168` writes the header's mode; a 1 → 1 edit with no amount change has no
  ledger or payment operation (`customer-ledger-handler.ts` case `'1→1'`, `customer-balance-handler.ts` `'1→1'`).
- **What happens.** A bill paid in Cash corrected to Bank: the bill says Bank, the payment row, its PAYMENT_RECEIVED row
  and the cash book still say Cash (cash book: cash ₹2,360, bank ₹0). Fixture `*-edit-paid-mode.json` (the real form),
  tests `B-03 sale/salex`. Same on purchase (twin, A).
- **Fix.** When the mode changes on a bill whose payments are BILL_SPECIFIC to it alone, update those payments' mode and
  their ledger rows; when they are shared or from advance, refuse the change with a message (correct it on the
  payments screen). **Risk:** low–medium.

### B-04 — Low/Medium — An unpaid bill is stored, listed and reported as a Cash sale
- **Evidence.** The form always sends its default mode 0 (`BillForm.tsx:88,218`); an edit falls back to 0
  (`lib/sale-edit.ts:151-153`) even for a bill stored with none; the list API maps null to 0 too
  (`lib/sale-query.ts:167`). `lib/sale-read.ts:76` says unset should stay unset.
- **What happens.** The unpaid bill shows "Payment Mode: Cash" on the view and list (harness), the list's "Cash" filter
  finds it, the sales report counts its ₹3,212 in Cash sales (`lib/bill-report.ts:66-67`), and the list export says Cash.
  Tests `B-04 sale/salex`.
- **Fix.** Send `payment_mode: null` while the status is Unpaid (form), keep null on edit, stop `?? 0` in the list; or
  count cash / bank sales only for paid bills in the report. **Risk:** low (A3 / A8 do not read the mode).

### B-05 — Low/Medium — A walk-in bill marked Paid reads as wholly outstanding
- **Evidence.** A walk-in has no payment record (owner rule), and the paid amount is the sum of allocations:
  `lib/sale-read.ts:210-216,307-316`, `lib/sale-query.ts:145-173`.
- **What happens.** View: "Status: Paid", "Paid / Outstanding: ₹0 / ₹1,680" (harness); `outstanding_amount`,
  `remaining_amount` = total in the detail and the list. Tests `B-05 sale/salex`.
- **Fix.** For `select_customer = 0` take the bill's status: Paid → paid = total. **Risk:** low.

### B-13 — Low/Medium (sections D and E; found here) — Credit notes on a discounted line refund more GST than was charged, and the GST report disagrees with them
- **Evidence.** A return rounds each tax head of the note to the rupee (`lib/sale-return.ts:181`); the GST report sums the
  unrounded line tax (`lib/gst-report.ts:50-54`).
- **What happens.** The screens' own bill has 2 × ₹1,000 less ₹100 at 18 % (GST ₹342 = 171 + 171). Two returns of one unit
  each: each note 950 + 172 (85.5 → 86 twice) = ₹1,122; together ₹344 of GST refunded against ₹342 charged (₹2,244
  against a line of ₹2,242), and the GST report shows ₹342 of credit-note tax. The existing suites never hit it (round
  numbers). Test `B-13`.
- **Fix.** Owner to decide the rule for notes: cap a bill's notes at the tax it charged (last note takes the remainder),
  and have the GST report read the notes' own heads. **Risk:** low.

### B-06 — Low — An edit rewrites the ship-to from the billing details and empties the supply date
- **Evidence.** The form has no shipping block and no supply date; any edit sends billing fields, so
  `lib/sale-edit.ts:295-298` rebuilds `shipto(x)` from billing, and `transportFrom` writes `supply_date: null`
  (`lib/sale-edit.ts:299-302`, `lib/sale-create.ts:233-240`).
- **What happens.** A bill with its own ship-to and supply date (the older form; the API still takes and returns
  `shippingDetails` / `transportDetails`) loses both on a notes edit. Nothing in the app shows them today, so the loss
  is silent. Tests `B-06 sale/salex`.
- **Fix.** Only touch ship-to when `useShippingAddress` / `shippingDetails` is sent; leave `supply_date` alone when it
  is not sent. **Risk:** low.

### B-07 — Low — Invoice C loses its kind in balance logs and ledger particulars
- **Evidence.** Deleting any bill logs `source_type: 'sale_delete'`, reference `INV-n`
  (`lib/customer-transaction-handler.ts:1521`) though `salex_delete` exists (`customer-balance-log-service.ts:5`);
  an amount edit rewrites the SALE row's notes to "Sale n updated to ₹…" for both kinds
  (`customer-ledger-handler.ts:191,209,257,…`), and the ledger account shows notes as particulars (`ledger-report.ts:71`).
- **What happens.** Sale and Invoice C ids overlap, so a deleted Invoice C 1's log names Sale 1, and an edited Invoice C 1
  reads "Sale 1 updated to ₹3870" in the customer's ledger account. Test `B-07`.
- **Fix.** Pass the kind into the delete log and the update notes (`${label} ${no}`). **Risk:** none.

### B-10 — Low (section E) — Five reports name the customer from the master, not the bill
- **Evidence.** `pages/api/reports/commissions.ts:61-78`, `transport-cost.ts:59-71`, and the mechanic-sales, staff-sales and
  packing-forwarding twins look the name up in `customer_details`.
- **What happens.** A walk-in is "Unknown" (it has no master row) and a renamed customer's old bills show the new name;
  the list and the bill-reference report use the bill's snapshot. Test `B-10`.
- **Fix.** Join `bill_tosales(x)` as `lib/sale-query.ts` does. **Risk:** none.

### B-14 — Low — An inactive staff member, mechanic or customer shows as blank on the edit form
- **Evidence.** The dropdowns list active rows only (`pages/api/staff/index.ts:56-58`, mechanics and customers the same);
  `BillForm.tsx:369,396,491` look the saved id up in those lists.
- **What happens.** After Suresh, Mohan or Ravi is deactivated, editing their old bill shows "Select Staff", "Select
  Mechanic", "Select Customer"; the save still sends the ids, so nothing is lost — but the user may "fix" it by picking
  someone else (harness `inactive` checks).
- **Fix.** Add the bill's own staff / mechanic / customer to the options when missing (as "Name (inactive)").
  **Risk:** none.

### B-09 — Low — `updated_at` is written in two formats, the edit's in UTC
- **Evidence.** Create stores the India date `YYYY-MM-DD` (`lib/sale-create.ts:110`); an edit stores
  `new Date().toISOString()` as `YYYY-MM-DD HH:MM:SS` UTC (`lib/sale-edit.ts:181`); purchase edit does not touch it.
- **What happens.** An edit at 01:30 IST on 3 Oct stamps "2026-10-02 20:00:00". Test `B-09` (fixed clock). Nothing
  reads the column today. **Fix:** one helper, India time. **Risk:** none.

### B-12 — Low — List "Export all" stops at 1,000 bills without saying so
- **Evidence.** `BillList.tsx:114` fetches page 1 with limit 1,000; the API caps the limit at 1,000 (`lib/sale-query.ts:60`).
- **What happens.** A year of sales (≈ 10 a day) exports as its newest 1,000. Test `[B-12]` pins the cap (plain test).
- **Fix.** Page through, or warn when `pagination.total` > rows. **Risk:** none.

### Questions for the owner (plain tests pin today's behaviour)

- **B-08 — Dashboard counts GST sales only.** Invoice C is not in Total sales, Today's sales, the day total or Last sale
  (`pages/api/dashboard/index.ts:99-116`). Intended (Invoice C kept off the headline) or should the cards add it, or
  show it beside? Test `[QUESTION B-08]`.
- **B-11 — Moving the date of a bill paid on create.** The bill and its SALE row move; the payment taken with it, its
  allocation and its PAYMENT_RECEIVED row stay on the old day, so the cash book shows the money on the old day
  (`lib/sale-edit.ts:161-162,306-309`; purchase the same). Should the bill's own bill-specific payment follow the bill?
  Test `[QUESTION B-11]`.
- **Owner rule worth a second look — walk-in sales and the cash book.** "Walk-in sales post nothing and have no payment
  record, so they are not in the cash book." At a parts counter most cash sales are walk-ins, so the cash book's closing
  will not match the drawer. A walk-in Paid sale could write a payment row with no customer ledger (customer 0), or the
  cash book could list paid walk-in bills directly. (Not filed as a finding: the rule decides it.)

### Smaller notes (no id)
- Walk-in sales cannot be returned (the view hides Create Return for party 0) — section D to confirm that is intended.
- The Mark as Paid modal defaults to Bank, the form to Cash.
- The payment-status and payment-mode selects have a clear (×) button; clearing sets Unpaid / Cash, and on a paid bill
  a save then unmarks it (full rollback). The select shows "Unpaid", so it is visible.
- A bill backdated into the previous FY takes the current FY's number and `fy` (owner rule: server numbers per FY from
  Settings).
- `pages/api/sales/analytics.ts` is not called by any screen.
- Invoice C's view export layout prints CGST / SGST / IGST rows (all ₹0).

### Twin divergences (sale / Invoice C vs purchase — purchase is reviewer A's)
| | Sale / Invoice C | Purchase |
|---|---|---|
| P&F on edit | each field picked separately → B-02 | sent qty / rate as one set (correct) |
| `updated_at` on edit | UTC timestamp (B-09) | untouched |
| "Other" party | posts nothing (owner) | posts to vendor 0 (owner) |
| Advance formula (B-01), mode change on a paid bill (B-03), date move of the bill's own payment (B-11) | as described | the same — same defect / question |

---

## 4. Tests, fixtures and harness added — and their run

| File | What | Tests |
|---|---|---|
| `tests/backend/suites/review-b-roundtrip.test.js` | RB-sale-1…8, RB-salex-1…8, RB-both: create → GET → `normalizeBill` → the form's payload rebuilt = the captured one → unchanged save (no table changes, field by field) → one-field edit (exactly that column) → delete (every table equals the pre-create copy; balance logs net 0); qty edit, paid by edit, Mark as Paid, clear extras, paid on create, walk-in, list filters / sort / paging, overlapping ids. After every step: `checkAll` (A1–A14), `checkReports` (16), `connected()` (list, detail, dashboard, commissions, mechanic, staff, freight, P&F, bill-reference reports) | 17 pass |
| `tests/backend/suites/review-b-refusals.test.js` | RF-*-create (22 refusals + rate 0 allowed + Invoice C with an unknown state allowed), RF-*-edit (12), RF-*-delete / route (404, returns, 405, 401): status, `error_code`, the message the snackbar shows, and nothing written | 6 pass |
| `tests/backend/suites/review-b-findings.test.js` | B-01 ×4, B-02 ×2, B-03 ×2, B-04 ×2, B-05 ×2, B-06 ×2, B-07, B-09, B-10, B-13 as `test.failing`; B-08, B-11, B-12 as plain tests | 18 failing by design, 3 pass |
| `tests/backend/fixtures/sales/*.json` | 26 request bodies captured from the real screens (create ×3, edit ×7, Mark as Paid, list query, delete — per kind) + `seed.json` (the masters both sides use) | — |
| `harness/review-b-capture.jsx` | Renders `/sale/*` and `/salex/*` (form, view + Mark as Paid modal, list) over the real handlers; fills every field, saves, captures and writes the fixtures; edits are captured "dry" (the store is restored after each PUT) so every edit fixture is relative to the created bill; checks the preview total, view read-back, refusal message, walk-in view, inactive masters, list filters, delete | 134 checks, ALL PASS |

Run (2026-10-04, `TZ=Asia/Kolkata npx jest -c jest.backend.config.js --runInBand`): **28 suites, 338 tests: 335 pass
(18 of them `test.failing` by design), 3 skipped** (the earlier 294 unchanged). Harness:
`cd harness && HOME=/home/claude/review/B ENTRY=review-b-capture.jsx OUT=review-b-capture.out.js node build-e2e.mjs && HOME=/home/claude/review/B TZ=Asia/Kolkata node review-b-capture.out.js` → ALL PASS.
Each assertion family was mutation-checked (a wrong expectation fails with the expected message).

**Support files changed (this copy only)** — `tests/backend/support/memtx.js`, so the store behaves like Prisma / MySQL
where the sale edit depends on it; the whole suite passes with them:
1. `update` with a relation `connect` / `disconnect` now sets / clears the foreign key (`staff_id`, `mechanic_id`) — it
   was silently ignored, so no test could see a staff or mechanic change on an edit (sale or purchase).
2. `where: { col: null }` and `{ col: { not: null } }` treat a column never set as NULL, as MySQL does — the mechanic /
   staff reports' `{ not: null }` counted every bill without one.

How the fixtures replay: the edit fixtures carry the harness's line ids and bill id; the suites map line ids to the
bill's rows by position (what the form does: it sends back what it loaded) and use the created id in the URL. The Mark
as Paid fixture's `payment_date` is the day the harness ran.
