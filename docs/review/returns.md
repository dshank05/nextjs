# Review D — Returns and stock

Reviewer D, 2026-10-04 (IST), per `docs/REVIEW_PLAN.md`. Scope: sale, Invoice C and purchase
returns (create, edit, view, list, delete, the bill pickers, the reasons) and dead stock; their
effects on the return tables, the bill's `return_status`, stock, the notes in the ledgers, the party
counters and balance logs, and the reports. No app code was changed. Added only:
`tests/backend/suites/review-d-{crud,findings,coverage}.test.js`,
`tests/backend/fixtures/returns/*.json`, `harness/review-d-{build.mjs,capture.jsx}` and this report.
No support file was changed: the one Prisma behaviour memtx lacks (a relation filter, D-05) is
emulated inside `review-d-findings.test.js` with `jest.mock`, and the harness build points the app's
`lib/db` at the backend suites' own `support/dbstub.js` + `memtx.js` so the screens ran on the same
store the jest replays use.

Read in full: the seven pages, `components/returns/{ReturnForm,BillPicker,ReturnView,ReturnList}`,
`components/deadstock/*`, `hooks/useReturns.ts`, `hooks/useDeadstock.ts`, every route under
`api/sale-returns`, `api/purchase-returns`, `api/return-reasons`, `api/deadstock`, `lib/sale-return.ts`,
`purchase-return.ts`, `return-list.ts`, `return-register.ts`, `note-counter.ts`, `deadstock.ts`,
`cash-book.ts`, the return paths of `customer-transaction-handler`, `transaction-handler`,
`customer-ledger-handler`, `ledger-handler`, `customer-balance-handler`, `balance-handler`,
`advance-allocation.returnCounterAmounts`, and the existing tests `scenreturns`, `retcheck`,
`vretcheck`, `rlistcheck`, `stockcheck`, `numcheck`, `scenmore`, `flow`, `partycheck` (dead stock),
harness `test9` (return screens) and `test10` (dead stock).

## 0. Summary

* The three kinds are well connected. Replaying the screens' own requests (captured in jsdom) through
  create → read as the form reads it → save unchanged → edit one field → delete, with A1–A14, the 16
  report checks and my connectedness checks after every step: **sale, Invoice C, the pending purchase
  return and dead stock round-trip cleanly** — an unchanged save writes nothing, an edit touches only
  its field and its consequences, a delete rolls everything back (the debit note number and the
  balance-log audit rows, netting to 0, stay).
* The kind (`invoice` / `invoicex`) travels everywhere it must: list row → view URL → Edit URL →
  `PUT ?type=` + body `invoice_type` + every line's `invoice_type` → `DELETE ?type=`, and every link
  into the view (register, cash book, outstanding, credit-notes report, PendingReturnsHint, party
  transactions, bill views). Without it the server answers 409 `AMBIGUOUS_RETURN` (tested).
* **The refunded purchase return** — editable since the owner's 29 Jan 2026 rule — is where it breaks:
  its edits move the vendor's refund counters with balance-log rows that carry no note number, so a
  later delete reverses the wrong amount (**D-01, D-02**), and an edit of one refunded from an
  on-account refund takes back refund money that was never added (**D-03**). All three end with A12
  failing and counters below zero / below the refunds on record.
* 18 findings: 3 high, 3 medium, 9 low, 3 questions for the owner. 13 are `test.failing` in the new
  suites (plus the D-01/D-02 round trip), 6 also show on screen in the harness.

## 1. Actions and field-by-field traces

Abbreviations: **S** = sale / Invoice C (customer) return, **P** = purchase (vendor) return.
`RF` = `components/returns/ReturnForm.tsx`, `BP` = `BillPicker.tsx`, `RV` = `ReturnView.tsx`,
`RL` = `ReturnList.tsx`, `UR` = `hooks/useReturns.ts`, `SR` = `lib/sale-return.ts`,
`PR` = `lib/purchase-return.ts`, `RLS` = `lib/return-list.ts`. "Refreshed": both save hooks call
`qc.invalidateQueries()` (UR:326-355) — every query on screen refetches (bills, products, parties,
ledgers, reports). Breaks are marked **✗ D-nn**.

### 1.1 Create a return (S: `/entry/salereturn-create`, P: `/entry/purchasereturn-vendor-create`)

Captured payloads: `fixtures/returns/{sale,salex,purchase}.json` steps `create-pending`, `create-refunded`.
POST S `/api/sale-returns/customer-return` → `createCustomerReturns` (SR:215); P
`/api/purchase-returns/vendor-return` → `createVendorReturn` (PR:198).

| Screen field | Payload key | Server reads / checks | Computed | Table.column | Response | Read back | Shown elsewhere |
|---|---|---|---|---|---|---|---|
| Customer / Vendor (dropdown "name (state)") | `customer_id` / `vendor_id` (string id) | `intOrNull`; every bill must be that party's: S `FOREIGN_BILL` (SR:253), P `FOREIGN_BILL` (PR:79) | — | S: via the bill (`invoice.select_customer`); P: `purchase_returns.vendor_id` | S `data.returns[]`, P `data.return` | view party block | list party column, register, ledgers, outstanding |
| Return Date (today, local) | `return_date` `YYYY-MM-DD` | `convertDateToTimestamp` (server-local midnight) | — | `*_returns.return_date` | — | `ymd()` → form / view | register date, stock report day, note `transaction_date`, list date filter |
| Return Status: Pending refund / Refunded | `payment_status` 0/1 | must be 0/1 (`VALIDATION`) | 1 ⇒ notes + counters | `payment_status` | — | view badge (REFUND_STATUS) | list, register settled/pending, cash book |
| Payment Mode (disabled while pending, default Bank) | `payment_mode` (always sent) | `intOrNull ?? 1` | — | `payment_mode`; S REFUND row `payment_mode` | — | view "Refunded on … · Cash/Bank" | cash book mode; list column **✗ D-11** (pending shows "Bank") |
| Payment Date (enabled when refunded, filled with today) | `payment_date` only when status 1 | `paymentDateTs ?? returnDate` | — | `payment_date` (null when pending) | — | view "Refunded on" | cash book day (by payment date, owner) **✗ D-08** S REFUND ledger row uses the return date |
| P&F (P only) | `packing_forwarding_amount` | ≥ 0 (`VALIDATION`) | refund = roundRupee(total + tax + P&F) | `packing_forwarding_amount`, `refund_amount` | — | view P&F | list P/F column + filter, register "charges", DEBIT_NOTE credit |
| Bill search | GET picker `search` | S: exact `invoice_no` or `bill_reference` contains; P same | — | — | bills | bill rows ("Bill #C-1" for Invoice C) | **✗ D-10** "C-1" finds nothing |
| Date range / Load More / pages | `from_date`, `to_date`, `page`, `limit=50` | picker routes | — | — | `pagination` | paging bar | — |
| Item search | S client-side; P `item_search` + client-side | P route ignores it | — | — | — | — | **✗ D-13** |
| Line Return Qty (capped at `available`) | `items[].return_qty` | `Math.round`; ≥ 1; ≤ what is left (`OVER_RETURN`); P ≤ stock (`INSUFFICIENT_STOCK`, PR:181) | — | `*_return_items.return_qty`; `product.stock` ± ; bill `return_status` (SR:188, PR:141) | — | view qty | stock report, A1, bill views; P picker **✗ D-05**, **✗ D-06** |
| Line Price (≤ ceiling) | `items[].unit_price` | ≤ net price (S: rate less discount, SR:84) / purchase rate (P) else `PRICE_ABOVE_*` | subtotal; tax = line GST %, split by the bill line's IGST; heads to the rupee | `unit_price`, `tax_amount` (S sale, P), P `cgst/sgst/igst`; header `total_amount`, `total_tax`, `refund_amount` | — | view rate / tax | GST credit/debit notes, profit (returns before tax), registers |
| Line Reason | `items[].return_reason_id` | `intOrNull ?? 1`, not checked | — | `return_reason_id` | — | view reason name | **✗ D-04** S default 1 = a purchase reason |
| Line kind (S) | `items[].invoice_type` | `KIND_REQUIRED`; one return per bill **and** kind (SR:238-306) | — | `sale_returns` or `salex_returns` | `returns[].kind` | view URL `?type=` | — |
| (S) `return_type: 'custom'` | `return_type` | only `'full'` is read (SR:229) | — | — | — | — | — |
| Return Notes | `return_notes` | — | — | `notes` | — | view notes, edit form | ledger note text |
| (summary, tax preview) | — | server recomputes (form says so) | — | — | — | — | — |

Effects of a **refunded** create: S CREDIT_NOTE (credit = refund) + REFUND (debit = refund) on the
return date, counters `total_refunded` and `total_refund_allocated` + refund, logged under
`SR-n`/`SXR-n` (SR:284-302); P DEBIT_NOTE (credit = refund incl. P&F) + both counters, logged under
the DN number (PR:247-256). Pending: nothing in the ledger (owner). P takes a `DN-fy-nnn` number even
when pending (PR:216). After saving: S one return → its view, several → the list; P → its view.

### 1.2 Edit a return (`?id=` and, for S, `&type=`)

Captured: steps `edit-unchanged` (opened from the view's cache), `edit-qty`, `edit-reason`,
`edit-notes`, `edit-pf`, `edit-to-refunded`, `edit-refunded-*`, `edit-pending-to-refunded`.
PUT S `/api/sale-returns/:id?type=` (body also `invoice_type`) → `updateSaleReturn` (SR:311);
P `/api/purchase-returns/:id` → `updatePurchaseReturn` (PR:277).

| Loaded from (UR `normalizeDetail`) | Sent back as | Server | Verified |
|---|---|---|---|
| `return.return_date` (ymd) | `return_date` | same day stored again | round trip: nothing changes |
| `payment_status` → status box | `payment_status` | S: refunded ⇒ `REFUNDED_RETURN_EDIT_BLOCKED` (SR:316, owner); P: allowed | S 0→1 posts the CREDIT_NOTE only and may draw on an on-account refund (owner); P all transitions **✗ D-01 D-02 D-03 D-12** |
| `payment_mode`, `payment_date` | same (date only when refunded) | P keeps the old date when marked pending **✗ D-12** | — |
| `notes` → Return Notes | `return_notes` | `body.notes ?? body.return_notes` (SR:354), `return_notes ?? notes` (PR:330) | notes edit changes only `notes` |
| P `packing_forwarding_amount` | `packing_forwarding_amount` | `Number(..) \|\| 0` | P&F edit changes P&F + refund only |
| each line with `return_qty > 0`: qty, `unit_price` (stored), reason, line notes | `items[]` (S with `invoice_type`) | re-priced; S pinned to the return's bill (`FOREIGN_LINE`), `KIND_MISMATCH`; available = all but this return; lines deleted and re-written (new ids); stock: old back, new out (S no check **✗ D-07**; P checked) | qty edit changes qty, tax, totals, stock only |
| bill rows: S total = the return's pre-tax total, reference = bill number; P total = the return's portion | (display) | — | **✗ D-09** |
| the party (locked) | not sent | taken from the return | — |

`formEditPayload()` in `review-d-crud.test.js` rebuilds the PUT from `GET` + `normalizeDetail`
exactly as `RF.confirm()` does; for all three kinds it equals the captured screen request, and
sending it changes nothing (only the return lines' ids are renewed — nothing references them).
After saving: to the view; everything refreshed; the view's session cache is cleared by the form
after loading (RF:100).

### 1.3 Delete (from the list)

`DELETE /api/sale-returns/:id?type=` → `deleteSaleReturn` (SR:407) → `handleReturnDelete`: stock back
out (no check **✗ D-07**), refund allocations of RETURN_SPECIFIC refunds removed, items and return
deleted, every ledger row of the return deleted and balances recomputed, counters reversed by the
balance logs under the note number (`returnCounterAmounts`), bill status recomputed (SR:435).
`DELETE /api/purchase-returns/:id` → `deletePurchaseReturn` (PR:377) the same with stock back in and
every bill of its lines recomputed. Round trips: S, X, pending P fully rolled back; refunded P after
edits **✗ D-01 D-02**.

### 1.4 View (`/entry/salereturn/[id]?type=`, `/entry/purchasereturn-vendor/[id]`)

GET → `loadSaleReturnDetail` (SR:452) / `loadPurchaseReturnDetail` (PR:407) → `normalizeDetail`.
Banner `Return #no • party`; Total (= `total_amount`, pre-tax), Items, Return #, Debit Note (P),
Type (S), Date, Status words, "Refunded on date · mode"; party, GSTIN, address; Items Total, tax
heads (S: derived from the line tax and the bill line's IGST; P: stored), P&F (P), Refund; notes;
lines with Bill Ref (P). Edit: caches the detail in session storage; disabled for a refunded S
return (and the form shows a banner and disables Update — checked in the harness). P: Excel / PDF.

### 1.5 Lists (`/entry/salereturn`, `/entry/purchasereturn-vendor`)

Captured: `fixtures/returns/list-queries.json`. `GET /api/sale-returns` / `/api/purchase-returns` →
`listReturns` (RLS:247): merge, filter, sort, page in memory.

| Box | Param | Server | Notes |
|---|---|---|---|
| Return No | `search` | `SR-n` / `SXR-n` / `PR-n` / digits by id; text: party name, notes, debit note no | — |
| Invoice No | `uid` | bill number(s) contains | P multi-bill rows list "1, 2" |
| Customer (text) / Vendor (dropdown id) | `customer` / `vendor` | digits = id, else name contains | **✗ D-18** a number typed as a name is an id |
| Items Qty | `itemCount` | lines count equals | — |
| Date | `dateFrom` / `dateTo` | `return_date` in IST days | — |
| Payment Mode | `paymentMode` | `payment_mode` | pending returns match "Bank" (**D-11**) |
| Return Status | `status` 0/1 | `payment_status` | — |
| P/F (P) | `packingForwardingTotal` | equals | — |
| sort headers | `sortBy`, `sortOrder` | every column | — |

Columns read: `return_no`, `invoice_no`, `customer_name`/`vendor_name`, `invoice_type` (Type and
the view/delete kind), `item_count`, `total_amount` (**D-16**: pre-tax), `formattedDate`,
`payment_mode`, `payment_status`, `packing_forwarding_total`. Filters kept in session storage per
party. Delete → `useDeleteReturn` → refresh all.

### 1.6 Bill pickers and reasons

`GET /api/sale-returns/customer-items?customer_id&page&limit=50&from_date&to_date[&search]`: the
customer's sale and Invoice C bills with something left (`available_items > 0`), each line priced
at its net price with its own GST (Invoice C 0), kind-prefixed ids. Verified.
`GET /api/purchase-returns/vendor-items?vendor_id&…[&item_search]`: the vendor's bills with
`return_status ≠ 2`, lines with `current_stock`; already-returned counted through the return
header's bill **✗ D-05**; `available_items` counts every line **✗ D-06**; `item_search` ignored
**✗ D-13**. `GET /api/return-reasons?type=sale|purchase`: Invoice C uses the sale reasons (the seeded
`salex` reasons are never shown).

### 1.7 Dead stock (`/entry/deadstock`)

Captured: `fixtures/returns/deadstock.json`. Add: `{product_id, quantity, reason}` POST → whole
units, reason required, stock ≥ quantity inside the transaction, stock − q (`lib/deadstock.ts:87`).
Edit (product locked): `{product_id (ignored), quantity, reason}` PUT → only the increase must fit.
Delete → units back. List: search (reason, creator, product name / part), server sort, paging.
Stock report: dead stock by `created_at`. All verified; nothing wrong found (the form's "No changes
detected" stops an unchanged save; the server would accept it and change nothing — tested).

## 2. Coverage: action × outcome → test (before → after)

Before = existing suites; after = added by this review (`crud` = review-d-crud, `cov` =
review-d-coverage, `F` = review-d-findings, `H` = harness review-d-capture).

| Action / outcome | S sale | S Invoice C | P purchase |
|---|---|---|---|
| create pending, screen payload | scen 4.1/4.2, test9 → **crud + H** | scen → **crud + H** | scen, test9 → **crud + H** |
| create refunded (notes, counters, cash book date) | scen 4.3/4.4 → **crud** (+ payment date, logs) | → **crud** | → **crud** |
| read as the edit form reads it = screen PUT | — → **crud** | — → **crud** | — → **crud** (pending + refunded) |
| save unchanged changes nothing | — → **crud** | — → **crud** | — → **crud** |
| edit qty / reason / notes / P&F: only that changes | scen 5.1/5.6 (values) → **crud** (exact diff) | → **crud** (qty) | vretcheck, rlistcheck → **crud** (qty, P&F, reason) |
| pending → refunded by edit | scen 5.10, retcheck → **crud** | → **crud** | scen 5.10 → **crud** |
| refunded edit (S blocked / P allowed) | scen 5.2 → **crud** | scen 5.2, **cov** | scen 5.2 → **crud**, **F D-01** |
| refunded → pending (P) | — | — | — → **crud**, **F D-02, D-03, D-12** |
| refunded edit then delete (P) | — | — | — → **crud D-01/D-02**, **F D-01** |
| delete pending / refunded, full rollback | scen 5.8/5.9 (values) → **crud** (whole store diff) | → **crud** | → **crud** (pending) |
| OVER_RETURN create / edit | scen 4.7/4.8/5.7 | scen | scen, vretcheck, **cov** |
| PRICE_ABOVE create / edit | retcheck (lib) → **cov** (route, create + edit) | — → **cov** | vretcheck |
| FOREIGN_BILL | retcheck (lib) → **cov** | — → **cov** | vretcheck → **cov** (+ edit) |
| FOREIGN_LINE / KIND_MISMATCH (edit) | retcheck KIND_MISMATCH (lib) → **cov** both | — | n/a |
| DUPLICATE_LINE / UNKNOWN_LINE / qty 0 / no lines / status 2 / negative price | — → **cov** | — | — → **cov** (+ negative qty, P&F < 0) |
| KIND_REQUIRED / AMBIGUOUS_RETURN (GET, PUT, DELETE) / 404 | retcheck (lib) → **cov** (routes) | → **cov** | 404 → **cov** |
| INSUFFICIENT_STOCK create / edit | n/a (**F D-07**: delete / lower) | n/a | — → **cov** |
| REFUND_VIA_RETURN | scen 5.5 | scen 5.5 | scen 5.5, **cov** |
| several bills in one request | retcheck (lib) → **cov** (route, kinds mixed) | **cov** | — → **cov** (spans bills, D-15) |
| date edit moves the note, register, cash book | — | — | — → **cov** |
| lists: every filter as the screen sends it | rlistcheck, test9 → **cov** (captured URLs) | same | same |
| pickers (range, hidden, net price, kind, stock) | test9 (UI) → **cov**, **F D-10** | **cov** | test9 → **cov**, **F D-05 D-06 D-13** |
| reasons by type | — → **cov**, **F D-04** | **cov** | **cov** |
| view (refund, status, qty agree with tables) | test9 → **crud** (every step) | same | same |
| connectedness after every step (stock = documents, bill status, notes, view, lists, register, cash book) | — → **crud** | — → **crud** | — → **crud** |
| dead stock add / edit / delete round trip | partycheck, flow, test10 → **crud** (screen payloads, diffs) | | |
| dead stock refusals (no reason, no product, 0, unknown product, fraction / no reason on edit, 404) | partycheck (fraction, stock) → **cov** | | |

## 3. Findings (ranked)

Each wrong-today finding has a `test.failing` with its id (`REVIEW_D_SHOW=1` runs them as plain
tests and prints what they find).

### High

**D-01 — A refunded purchase return edited, then deleted, leaves the vendor's refund counters wrong.**
Evidence: `F` "D-01" and `crud` "D-01/D-02". `updatePurchaseReturn` (PR:350-371) calls
`transactionHandler.handleReturnEdit`, which returns no `context`; for a 1→1 amount change the only
ledger op is a DEBIT_NOTE *update*, which `executeInTransaction` does not recognise
(`lib/transaction-handler.ts:623-636` knows PAYMENT / REFUND_RECEIVED), so the counter change is
logged as `status_change` with `reference_no ''` (:655, :668). The delete reverses only the rows
logged under the DN number (`references: [debitNoteNo]`, :1081; `returnCounterAmounts`, :1668).
Refunded 5 → edited to 3 → deleted: counters −2000 / −2000; A12 fails. User: the vendor's
"refund owed/received" figures and the balance-log report are off for good. Suggested fix: log a
return edit's counter change under the debit note number (pass `context: { entityType: 'return',
entityId, referenceNo: debitNoteNo }` from PR:350, or recognise DEBIT_NOTE updates/deletes in
:623). Risk: low (only the log's `reference_no`).

**D-02 — Refunded → pending → refunded → deleted reverses the completion twice.** Same root
cause: the 1→0 reversal is logged under `''`, the second completion under the DN number, so the
delete sums two completions. 5000 → counters −5000; A12. Evidence `F` "D-02", `crud` "D-01/D-02".
Fix as D-01.

**D-03 — A purchase return refunded from an on-account vendor refund, then lowered or marked
pending, takes back refund money that was never added.** Owner: marking refunded later "may draw on
an earlier on-account refund in the counters" — 0→1 only raises `total_refund_allocated` when the
on-account refund covers it (`balance-handler.ts` 0→1). But 1→0 (:410-417) and 1→1 (:437-447)
assume the return raised both counters: `total_refunded −= oldTotal` (`refundedByThisDocument` is
never passed) and `± diff` on both. 3000 on account, return 2000 refunded by edit (3000 / 2000 ✓),
lowered to 1000 → 2000 / 1000 (vendor refund still 3000), pending → 1000 / 0. A12. Evidence `F`
"D-03". Fix: give `handleReturnEdit` what this return put on each counter (`returnCounterAmounts`
by the DN number, as the delete does) and reverse only that; on a 1→1 change move the allocation
and only the return's own part of `total_refunded`. Risk: medium (counter logic shared by 9 cases);
the customer twin has the same code (`customer-balance-handler.ts:399, 408`) but is unreachable
because a refunded sale return cannot be edited.

### Medium

**D-07 — Deleting (or lowering) a sale / Invoice C return can drive stock below zero.**
`deleteSaleReturn` and `handleReturnDelete` decrement stock with no check
(`customer-transaction-handler.ts:1214`, SR:430), `updateSaleReturn` too (SR:338). A sale refuses
`INSUFFICIENT_STOCK` (`lib/sale.ts:245-266`) and so does a purchase delete
(`lib/purchase-delete.ts:53-70`); the twin rule says the same here. Return 5, sell the rest, lower
to 1 → stock −4; delete → −5. Evidence `F` "D-07". Fix: `assertStockCovers` for the units going back
out, inside the transaction. Risk: low (refuses what used to pass; message to the screen exists).

**D-04 — A sale / Invoice C line is saved with reason id 1, a purchase reason, while its box shows
"Select reason…".** `normalizeBill` defaults `reasonId` to 1 (UR:178), BillPicker sends `?? 1`
(BP:41, 148), the server defaults `?? 1` and checks nothing (SR:108; PR:50). With the reasons as
`scripts/seed_return_reasons.js` creates them, id 1 is "Incorrect Quantity" (`type: purchase`); the
sale form's list (`?type=sale`) does not contain it, so the box shows the placeholder, the view then
shows "Incorrect Quantity". Harness: `FINDING D-04` (payload and view); `F` "D-04" replays the
captured request. A reason id that does not exist is refused by MySQL's FK with the bills' message
"A selected customer, staff member, mechanic or product does not exist" (`lib/api/sale-routes.ts:43`).
Fix: default to the first reason of the list (or require a choice) and validate the reason's
existence and type on the server. Risk: low; old rows may hold reason 1 on sale returns.

**D-05 — Vendor bill picker: lines returned on a return headed by another bill show as still
available.** `vendor-items` counts returned quantities through the return HEADER's bill
(`where: { purchase_return: { purchase_id: { in: page bills } } }`, `vendor-items.ts:159-171`). A
purchase return may span bills (header = first bill, PR:240); when that bill is not on the page
(fully returned → hidden by `return_status ≠ 2`, outside the date range, another page), the other
bill's lines show their whole quantity; the screen allows it and the server refuses `OVER_RETURN`.
Evidence `F` "D-05" (memtx ignores relation filters, so the file emulates Prisma's). Fix: count by
`purchase_item_id in (page line ids)` as `customer-items` does. Risk: low.

**D-08 — A sale / Invoice C return created refunded posts its REFUND on the return date, not the
payment date sent.** SR:292-297: `transaction_date: returnDate`, `payment_date: returnDate`; the
header stores the payment date and the cash book dates the money by it (owner). Return 4 Oct, paid
6 Oct: the customer ledger shows the refund on 4 Oct, the cash book on 6 Oct. Evidence `F` "D-08".
Fix: date the REFUND row by `paymentDateTs(body.payment_date) ?? returnDate`. Risk: low (balances
by date in the ledger account change between the two days). The CREDIT_NOTE stays on the return date.

### Low

**D-12 — A refunded purchase return marked pending keeps its payment date** (PR:333; SR:357 the
same, unreachable). Harmless for the cash book (status 0) but a pending return "has" a payment date.
`F` "D-12". Fix: `null` when status 0.

**D-14 — Purchase create validates and prices outside the transaction and takes the debit note
number before it** (PR:208-216; the sale twin prices inside, SR:245-250). Two simultaneous returns
can both pass the over-return / stock checks; a write that fails inside (e.g. the reason FK, D-04)
burns a DN number (a gap in the debit-note series). No test (needs concurrency / MySQL). Fix: price,
check and number inside one transaction. Risk: low-medium.

**D-06 — Vendor bill rows always say "n/n items available"** (`available_items:
availableItems.length` over every line, `vendor-items.ts:184-231`). Harness `FINDING D-06`, `F` "D-06".

**D-09 — The edit form's bill row shows the return, not the bill.** S detail: `total_amount` = the
return's pre-tax total, `bill_reference` = the bill number (SR:497, 561-563); P: the return's portion
with tax (PR:518). Create mode shows the bill's total and reference. Harness `FINDING D-09`
("Bill #1 1 • … • ₹2,000" for a ₹12,800 bill), `F` "D-09".

**D-10 — Searching "C-1" (as the picker shows Invoice C bills) finds nothing**
(`customer-items.ts:44-48`: digits only, else bill reference). Harness `FINDING D-10`, `F` "D-10".

**D-13 — `item_search` is sent but ignored by `vendor-items`** (`vendor-items.ts:25`); the screen
filters only the 50 bills it loaded. `F` "D-13".

**D-17 — The returns register says "Pending" / "Complete" / "Partial"** (`return-register.ts:85`,
`pages/reports/returns.tsx:78`) and the credit / debit note reports "Unpaid / Paid"
(`customer-reports.tsx:157`, `debit-notes.tsx:126`) — owner decision 4 is "Pending refund" /
"Refunded" everywhere. `F` "D-17" (register). Section E owns the report pages.

**D-18 — Customer filter: a number typed as a name is taken as a customer id** (RLS:265). The box
says "Enter customer name"; the id form exists for the Pending-returns hint. Fix: the hint sends
`customer_id`, the box `customer_name`. No test.

### Questions for the owner (not wrong by a rule; no failing test)

**D-11 — A pending return carries a payment mode.** The form disables Mode while pending but sends
the default (Bank); the list shows "Bank" next to "Pending refund" and the Payment Mode filter
finds unrefunded returns. Harness `FINDING D-11`. Store `null` / show "—" until refunded?

**D-15 — A purchase return may span several bills; a sale return is split one per bill.** The brief
lists "lines from one bill per return per kind" as decided; `MULTI_BILL_RETURN_DISPLAY_FIX.md` and
`purchase-read.ts` support multi-bill purchase returns. Today: header `purchase_id` = the first bill
(PR:240), the list shows all bill numbers, the register only the header's (`cov` "several bills"),
and D-05 follows from it. Keep (and fix D-05, the register) or split like the sale side?

**D-16 — The lists' "Total" is the pre-tax amount** (`total_amount`), not the refund; a taxed return
of ₹2,360 shows ₹2,000, P&F is left out. The view shows both "Total" and "Refund". Show the refund?

### Checked and fine (no finding)

The kind on every path (§0); server pricing at the net price with the line's own GST and per-head
rupee rounding; over-return, foreign bill / line, price ceiling; a refunded sale / Invoice C return
cannot be edited (server, view, form); direct adjustment as decided (S created refunded: CN + REFUND,
net 0; marked later: CN only, drawing on an on-account refund; P: DEBIT_NOTE only); a pending return
posts nothing; delete reverses stock, notes, counters (S, X, P without edits) and recomputes the bill;
REFUND_VIA_RETURN; cash book by payment date; every cache refreshed after a save or delete; line
notes carried through edits; dead stock (whole units, reason, stock out and back). Return lines are
re-written on every save (new ids) — nothing references them. A deleted purchase return's DN number
is not reused.

## 4. Tests and fixtures added, results

Run: `cd build && TZ=Asia/Kolkata npx jest -c jest.backend.config.js --runInBand tests/backend/suites/review-d-*.test.js`.

| File | Tests | Result |
|---|---|---|
| `suites/review-d-crud.test.js` | 6: sale, Invoice C, purchase pending, purchase refunded (to before the delete), **D-01/D-02** round trip with delete (failing by design), dead stock — each step followed by `checkAll` + `checkReports` + `connected()` | 5 pass, 1 failing-by-design |
| `suites/review-d-findings.test.js` | 13: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-12, D-13, D-17 | 13 failing-by-design (each verified with `REVIEW_D_SHOW=1` to fail for the reason named) |
| `suites/review-d-coverage.test.js` | 7: sale / Invoice C refusals (route-level, nothing written), purchase refusals, list filters from the captured URLs, pickers and reasons, several bills in one request, refunded purchase date edit, dead stock refusals and list | 7 pass |
| `fixtures/returns/{sale,salex,purchase,deadstock}.json` | the requests the screens sent (method, URL, body, status), in order, with the seed (reasons, bills, line ids) | — |
| `fixtures/returns/list-queries.json` | the list / picker / reasons URLs each filter box sends | — |
| `harness/review-d-capture.jsx` (+ `review-d-build.mjs`) | renders the 7 pages, drives create / edit / view / list / delete for the three kinds and dead stock, writes the fixtures; 33 checks pass, 6 `FINDING` lines (D-04 ×2, D-06, D-09, D-10, D-11) | ALL PASS |

Whole backend suite with the new files: 28 suites, 320 tests (317 pass, 3 skipped — the existing
ones); before: 25 suites, 294. Harness `test9` (return screens) still all pass.

Re-capturing the fixtures: `cd harness && HOME=/home/claude/review/D ENTRY=review-d-capture.jsx
OUT=review-d-capture.out.js node review-d-build.mjs && HOME=/home/claude/review/D TZ=Asia/Kolkata
node review-d-capture.out.js`. They were captured on 2026-10-04 (IST): the bills are dated
2026-10-02 and the returns "today"; the replays check reports for October 2026, so a re-capture
after October (or after the bills leave the pickers' 3-month window) needs those dates moved.
