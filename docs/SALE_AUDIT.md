# Phase 5 — Sale & Salex: data-flow pass and code-quality pass

*Stage 1 of Phase 5 (audit only). Nothing in this document has been changed in code yet.
Stage 2 is the refactor, done in blocks after the owner has read §6.*

## 0. Scope and method

Both passes, the same way purchase was done:

- **Pass 1, data flow (§11 rule):** the browser sends decisions, the server computes every
  amount. For each path (create, edit, delete, list, view, reports) I followed one value
  from the form to the database and back.
- **Pass 2, code quality:** what each file does twice, what is dead, and what the
  purchase rewrite (Blocks A–D) already gives us to replace it.

Tags: **[C]** = confirmed by reading the code, **[V]** = needs a live check against data.

### Coverage — 17,410 lines

| Layer | Files (lines) | Read |
|---|---|---|
| API | `sales/index.ts` (731), `sales/[id].ts` (913), `salex/index.ts` (704), `salex/[id].ts` (922) | full |
| Handlers | `customer-transaction-handler.ts` (1,698), `customer-ledger-handler.ts` (559), `customer-balance-handler.ts` (595), `customer-ledger-service.ts` (696) | diffed against the vendor twins after normalising names; every difference read in full |
| Hooks | `useSales.ts` (442), `useSalex.ts` (226) | full |
| Pages | `sale/create.tsx` (2,694), `salex/create.tsx` (2,368), both `view/[id].tsx` (704, 640), both `index.tsx` (220, 216) | sale create: full logic, JSX scanned. Salex create: payload, loader, customer select, totals. Views and indexes: full (salex by diff against sale) |
| Components | `SaleTable.tsx` (883), `SalexTable.tsx` (895), `QuickCustomerPaymentModal.tsx` (280) | filters, delete, refresh; tables diffed against each other |
| Reports | `customer-ledger-accounting` (116), `customer-ledger-details` (356), `customer-outstanding` (193), `customer-balance-logs` (78), `bill-reference-sale` (132) | full |

`sales/analytics.ts` and the sale-return paths are not in scope (Phase 7 and Phase 6).

## 1. Summary — the verdict

Sale and salex never received any of the Phase 4 money work. The server still trusts the
browser for tax (sale) or for **every** amount (salex), and the two creates disagree with
each other on `fy`, P&F and line naming.

The worst defects are not in the forms. They are in the shared customer handler, which was
written for sale and switches on `invoiceId ? 'sale' : 'salex'`. That test is always true,
so **every salex edit reads and writes the ledger rows and payment allocations of the
sale that happens to have the same id** (SA-01).

Seven Criticals are small, standalone fixes (SA-01 to SA-05, SA-34, and SA-08's guard). They should
go in first, before any rewrite, the same way the purchase delete keys did.

| Block | What gets rewritten | Size now → est. after | Removes |
|---|---|---|---|
| **0. Fix now** | Pass `type` through the customer ChangeSet; fix the allocation delete; fix the payment/refund edit columns; server ignores body `fy`; view passes the sale id; loader does not clear lines | ~60 lines changed | SA-01–05, 08 |
| **B. Server money** | One `lib/sale.ts` (`computeSaleTotals`, `validateSale`) shared by sale and salex: lines, discount, GST split from the bill state, F-34 rounding. Create and edit both call it; edit reconciles by line id (the purchase `updatePurchase` shape) | API 3,270 → ~1,500 | SA-06, 07, 09–16, 21–23, 27 |
| **A. Line editor** | Both create pages onto `PurchaseLines` + `lib/line-math.ts` (generalised: discount column, no-tax mode for salex) | 5,062 → ~1,600 | SA-08 (properly), 24, 30, quality |
| **C. Lists** | Both lists onto `lib/sale-query.ts` + one `SaleTable` for both types (purchase Block C shape) | ~2,700 → ~900 | SA-20, 25, 26 |
| **D. Reports** | Customer reports onto `lib/api/report-query.ts`, opening balance, one payment per payment | 875 → ~450 | SA-17–19, 29 |
| **Dead code** | 16 legacy exports in `customer-ledger-service.ts`, an empty `SaleReturnTable.tsx`, the SessionStorage edit hand-off | −~550 | quality |

Expected net removal is about **7,000 lines**, roughly double the purchase rewrite, because
everything exists twice.

## 2. Defects

### Critical

| ID | Conf | Finding | Evidence | Block |
|---|---|---|---|---|
| SA-01 | [C] | **Editing a salex changes another bill's ledger and payments.** The customer handler names the document type with `changes.invoiceId ? 'sale' : 'salex'`. The salex PUT passes `invoiceId: salex.id`, so the answer is always `'sale'`; the `type: 'salex'` parameter is accepted and never used. Results: (a) amount-change UPDATEs and 1→0 DELETEs match `reference_type 'sale', reference_id = <salex id>`, i.e. the SALE with the same id, which may belong to another customer; (b) 0→1 and 2→1 create the allocation with `invoice_id = <salex id>`, pointing at that sale, or failing the FK when there is no such sale; (c) rows the salex edit creates are labelled `'sale'`, so deleting the salex later (which looks up `'salex'`) leaves them behind. This is L-8, and it is worse than a label | `customer-ledger-handler.ts:155-312`; `customer-transaction-handler.ts:734, 755, 496-497`; `salex/[id].ts:554` | 0 |
| SA-02 | [C] | **Marking a paid sale or salex as unpaid never removes its payment allocations.** The delete uses `where: { invoice_id: X, invoicex_id: X }`, but an allocation has only one of the two set, so nothing matches. The ledger and balance are reversed, while the allocation and its `customer_payments` row remain → the view shows it paid; `total_allocated` drifts | `customer-transaction-handler.ts:876-890` | 0 |
| SA-03 | [C] | **Editing a customer payment's amount writes the wrong ledger column.** PAYMENT_RECEIVED rows are created as a credit; the edit writes `debit: newAmount` and leaves the old credit, so the row carries both and the balance moves the wrong way. The REFUND edit has the mirror bug (created as a debit, edit writes credit). The vendor twin is correct. Payments are Phase 6, but this is the same file and a two-line fix | `customer-transaction-handler.ts:287, 358`; created at `customer-payments/index.ts:410`, `customer-return.ts:224` | 0 |
| SA-04 | [C] / [V] data | **Every sale made from the form is stamped with the calendar year as `fy`.** The form sends `fy: new Date().getFullYear()` (2026); the API stores `fy \|\| currentFy`. `fy` is a financial-year **id** (3, 4…). The invoice counter reads `MAX(invoice_no) WHERE fy = currentFy`, so it never sees these sales → **duplicate invoice numbers**; FY filters and reports miss them; lines and ledger carry the real id. Salex uses `currentFy` throughout and is unaffected. Live check: `SELECT COUNT(*) FROM invoice WHERE fy > 100` | `sale/create.tsx:1066, 1090`; `api/sales/index.ts:144` | 0 (+ data repair if the count > 0) |
| SA-05 | [C] | **"Mark as Paid" on a sale's view page pays the wrong invoice.** The sale GET returns no `id`, so the view passes `invoice.invoice_no` as `invoiceId`; the payments API looks up `invoice.id = <invoice number>`. Either another sale (if the same customer owns it) gets the payment, or the request is refused. Salex passes `invoice.id` correctly | `sale/view/[id].tsx:690`; `api/sales/[id].ts:314` (no `id` in the response) | 0 |
| SA-06 | [C] | **Salex create takes every amount from the browser.** `items_total`, `total_taxable_value`, `total`, line `subtotal`, `discount`, `discountrate` and the header discount are stored as sent; the server computes nothing. `parseFloat(total)` is unchecked (NaN → 500) | `api/salex/index.ts` POST | B |
| SA-07 | [C] | **Sale create ignores the discount** (already logged in AUDIT_PLAN Phase 5): `items_total = Σ qty × rate`, so a discounted sale is overcharged by the discount on create, and the form's total differs from the stored one | `api/sales/index.ts` POST | B |
| SA-08 | [C] timing | **Editing a registered customer's sale or salex can erase its lines.** The edit loader calls `handleCustomerSelect(id)` in a `setTimeout`; that handler clears `selectedProducts` (right for a new pick). If the lines are already in place, they are wiped. Saving then sends no items; the PUT keeps the rows but recomputes `items_total = 0`, so the bill total collapses to P&F + tax and the handler moves money on that figure. It also overwrites the loaded bill address with the customer master | `sale/create.tsx` loader; `salex/create.tsx` loader | 0 guard, A properly |
| SA-34 | [C] | **Marking a sale paid by editing it adds the payment to what the customer owes.** Found while fixing SA-01. The customer ledger handler writes PAYMENT_RECEIVED as a **debit** on the edit paths (0→1, 2→1, 0→2, and the Type B amount update); every create path, and the vendor twin, writes it as a credit. The running balance is debit − credit, so the bill shows as owed twice. Data repair: `scripts/repair-sale-data.js` part 2 | `customer-ledger-handler.ts` 0→1, 2→1, 0→2 creates; Type B update | 0 |

### High

| ID | Conf | Finding | Evidence | Block |
|---|---|---|---|---|
| SA-09 | [C] | Sale tax trusted from the client: `total_tax`, `total_cgst/sgst/igst` and line tax are stored as sent; grand total = Σ qty × rate + P&F + freight + **client** `total_tax`. The form computes the split with a hard-coded state fallback (9). F-04 / P4-12 twin | `api/sales/index.ts` POST; `sale/create.tsx` totals | B |
| SA-10 | [C] | **Salex edit drops the discount on every save.** PUT recomputes `items_total = Σ qty × rate`; a kept line's discount is never updated, a new line's discount is not stored | `api/salex/[id].ts` PUT | B |
| SA-11 | [C] | **Changing the customer on edit splits the bill from its money.** Salex: the header moves to the new customer while every ledger and balance operation is posted to `existingSalex.select_customer`. Sale: the opposite — the header keeps the old customer (not in the update) while the handler posts to the new one. Either way the two customers' balances are wrong | `salex/[id].ts:553-574`; `sales/[id].ts:533-540` | B (refuse a customer change once money is attached, or move it properly) |
| SA-12 | [C] | L-30 twin: the customer balance handler accepts `paidByThisDocument` (added in P4-29) but neither PUT computes or passes it → unmarking an advance-funded sale takes `total_paid` down by money that was never paid in | `customer-transaction-handler.ts:100-141`; both PUTs | B |
| SA-13 | [C] | Edit line reconciliation (PU-14–17 twins, worse): a kept line is saved only when its **qty** changed, so a rate-only edit is lost; lines are keyed by product, so duplicates collapse (L-24); line dates not updated; **no returned-qty guard**, so removing a returned line restocks its full qty and deletes a row the return still points to | both `[id].ts` PUT | B |
| SA-14 | [C] | Create: no qty/rate validation (negative qty **adds** stock); each duplicate line is checked against the full stock → oversell | both `index.ts` POST | B |
| SA-15 | [C] | Create accepts `payment_status 2` (Partial) with no allocation or ledger behind it | both `index.ts` POST | B (Partial is derived, as purchase) |
| SA-16 | [C] | No `UNIQUE(fy, invoice_no)` on `invoice`/`invoicex`, no retry → two concurrent creates can take the same number (P4-05 twin). The "next invoice" preview uses `sort=-invoice_no`, which the API ignores, so it shows the latest-**dated** number + 1, not what the server will assign | schema; `useSales.ts:367`, `useSalex.ts:219` | B |
| SA-17 | [C] | Customer ledger *details* report: a payment allocated to N bills is listed N times at its **full** amount → outstanding over-reduced; unallocated (advance) payments never appear; payments are filtered by the bill's date, not their own; balance starts at 0 | `customer-ledger-details.ts:178-332` | D |
| SA-18 | [C] | Customer ledger *accounting*: running balance restarts at 0 on every page and ignores everything before `dateFrom` (PU-26 twin, fixed for vendors in Block D) | `customer-ledger-accounting.ts:65` | D |
| SA-19 | [C] | Bill-reference (sale) report 500s on every search: `mode: 'insensitive'` is not supported on MySQL. End date excluded (00:00 UTC) — PU-28 twin | `bill-reference-sale.ts:27-37` | D |
| SA-20 | [C] | **Four Invoice C list filters wipe themselves.** `SalexTable` emits `billRef`, `items`, `notes`, `pf`; the page stores them as-is; the hook reads `billReference`, `itemCount`, `packingForwardingTotal`; the table's sync effect then resets its own inputs from the (empty) proper keys. The notes filter has no API parameter at all | `SalexTable.tsx:228-270, 186-200`; `useSalex.ts:28-31` | C |

### Medium

| ID | Conf | Finding | Evidence | Block |
|---|---|---|---|---|
| SA-21 | [C] | Sale GET shows a registered customer from the **master**, not the bill's snapshot (`bill_tosales`): a later master edit rewrites every old invoice. `address_2`, `city`, `state`, `pin_code` are always `''`; shipping comes from the master and `useShippingAddress` is always false. The edit form loads these blanks and saves them back. Salex is snapshot-first ✓ | `api/sales/[id].ts:314-381` | B |
| SA-22 | [C] | Salex create: a registered customer id is never checked to exist; line name/category/subcategory/company come from the browser (sale reads them from the product) | `api/salex/index.ts` POST | B |
| SA-23 | [C] | Salex edit: bill reference, P&F and commission are sent only when non-empty, and the PUT keeps the stored value for anything absent → they cannot be cleared | `salex/create.tsx` payload; `salex/[id].ts` PUT | A + B |
| SA-24 | [C] | UTC dates: a new sale or salex made between 00:00 and 05:30 IST is dated yesterday; the edit loader converts with `toISOString` (PU-36 twin); the list's full-return date too | both create pages; `sale/index.tsx:135` | A |
| SA-25 | [C] | Sale list: status `2` (Partial) ignored by the API and not offered in the select; after picking a status the select shows blank (it stores `'1'`, options are `'paid'`); changing status drops every other filter; delete refresh resends a subset (PU-37 twin); items filter is `>=` and applied after paging; sorting by customer or item count loads every row; the customer filter list is capped at 50 (no `dropdown=true`) | `SaleTable.tsx:205, 399-407, 643-676`; `api/sales/index.ts` GET | C |
| SA-26 | [C] | Invoice C list: the "Invoice No" filter (`uid`) matches `invoicex.id`, not `invoice_no`; the list key is `salexs` | `api/salex/index.ts` GET | C |
| SA-27 | [C] | Salex GET: `total_allocated` hard-coded 0 → "outstanding" always equals the total | `api/salex/[id].ts` GET | B |
| SA-28 | [V] | Create with advance: the advance-used portion is written as a `BILL_SPECIFIC` payment row while `total_paid` only rises by the new money; deleting the bill (which reduces `total_paid` by its BILL_SPECIFIC rows) may take the advance off too. Same shape on the purchase side — check with the harness | both `index.ts` POST | B |
| SA-29 | [C] | Customer balance-logs report: no paging, no date range, unknown customer returns `{balance: null}` 200, Decimals returned raw (vendor twin rewritten in Block D) | `customer-balance-logs.ts` | D |
| SA-30 | [C] | Sale view line table: taxable = qty × rate (ignores the line discount), tax recomputed in the browser instead of read; footer puts `items_total` (pre-tax) under the tax-inclusive Total column (PU-31 twin); rows keyed by `product_id` | `sale/view/[id].tsx:529-582` | A |

### Low

| ID | Finding | Evidence |
|---|---|---|
| SA-31 | Payment status / mode default to 1 (Paid / Bank) when null, in the GET and the form; salex PUT's status message says "1 (Partial), 2 (Paid)" — inverted; `tax: sale.notes`; `updated_at` and `billing_address2` (sale) taken from the body / master; P&F stored as `null` by salex, `0` by sale; ~40 `console.log` in sale create, 5 in salex; every sale/salex API and two reports return `error.message` on 500 | various |
| SA-32 | Customer `recalculateBalancesAfter` has no `orderBy: { id: 'asc' }`; correct today by engine order only. (The L-36 twin is **not** present: it seeds from the row before `entryId` and uses `gte`) | `customer-ledger-service.ts` |
| SA-33 | `invoice_items.invoice_no` / `invoice_itemsx.invoice_no` hold the header id but have no index and no FK — every per-bill line lookup scans the table; orphans possible | `schema.prisma` `Invoiceitems`, `invoice_itemsx` |

### Already fixed (earlier commits, recorded for completeness)

Sale/salex delete keys and the salex delete crash (`7337e8e`); sale delete refused while
returns exist; PUT keeps the stored `fy`; `String(id)` cache keys (`eac808d`); L-29/L-33/L-36
customer twins (P4-28/29/31); customer-outstanding per customer (F-45).

## 3. Code quality — what each block replaces

- **Two creates, two edits, two lists, two views, written as copies that drifted.** Every
  Medium above is one copy getting a fix the other did not (snapshot-first view, `fy`,
  P&F null vs 0, filter key names, the `uid` filter). Block B makes one `lib/sale.ts`
  with a `type: 'sale' | 'salex'` table map (the `INVOICE_TABLES` map in the handler
  already exists); the APIs become thin routes like `api/purchases/[id].ts` (~105 lines).
- **The forms are the tax engine.** `sale/create.tsx` computes per-line CGST/SGST/IGST,
  validates its own figures against themselves and sends four totals the server half uses.
  After Block B the form sends qty, rate, discount, GST %, state; the totals it shows come
  from `lib/line-math.ts`, the same function the server uses.
- **`customer-ledger-service.ts`:** all 16 legacy exports are dead (three are imported by
  sale-returns, customer-payments and customer-refunds but never called) — ~480 lines that
  read as authoritative. Only the `CustomerLedgerService` class is live.
- **`customer-transaction-handler.ts`** (1,698) mirrors the vendor handler line for line;
  the only real differences are the two-table map and the bugs in SA-01–03. Stage 2 keeps
  it and fixes it; merging the two handlers is a later decision, not part of this phase.
- **Dead or stub UI:** `components/transactions/SaleReturnTable.tsx` is an empty file; the
  view writes a SessionStorage snapshot that the create page never reads; salex export is
  a "coming soon" alert; the index print button is an alert; view `formatDate` has a dead
  string branch; ~100 lines of interfaces per view duplicate `types/sales`.

## 4. Twin table — purchase vs sale vs salex (after this audit)

| Concern | Purchase (after Phase 4) | Sale | Salex |
|---|---|---|---|
| Server computes amounts | ✓ `computePurchaseTotals` | tax from client (SA-09), discount ignored (SA-07) | everything from client (SA-06) |
| `fy` on create | current FY ✓ | **body / calendar year** (SA-04) | current FY ✓ |
| `fy` on edit | kept ✓ | kept ✓ | kept ✓ |
| Unique number per FY | ✓ (P4-05) | ✗ (SA-16) | ✗ (SA-16) |
| Edit reconciles by line id | ✓ | ✗ (SA-13) | ✗ (SA-13) |
| Discount on edit | n/a (P4-21) | ✓ | **dropped** (SA-10) |
| Ledger rows labelled correctly | ✓ | ✓ | **as sale** (SA-01) |
| Unmark removes allocations | ✓ | ✗ (SA-02) | ✗ (SA-02) |
| `paidByThisDocument` on edit | ✓ (L-30) | ✗ (SA-12) | ✗ (SA-12) |
| Customer/vendor change on edit | n/a | header ≠ ledger (SA-11) | header ≠ ledger (SA-11) |
| View reads the snapshot | ✓ | ✗ master (SA-21) | ✓ |
| Mark as Paid targets | ✓ id | **invoice no** (SA-05) | ✓ id |
| List filters reach the API | ✓ | partly (SA-25) | 4 broken (SA-20) |
| Ledger report opening balance | ✓ | ✗ (SA-18) | — |
| Bill-ref report | ✓ | 500 (SA-19) | — |

## 5. Rounding (F-34, decided 2026-10-02) and owner questions

**Rule, as agreed:** rates and line amounts stay exact (2 dp); CGST, SGST and IGST are each
rounded to the nearest rupee (half up) on the bill totals; the grand total is rounded to
the nearest rupee. `lib/sale.ts` applies it in one place; the purchase side gets the same
helper so both documents round identically. Salex carries no tax, so only the grand-total
rule applies there.

**Owner questions before Block B:**

1. **Freight in the sale total.** Sale adds `freight` (transport cost) into the grand total;
   purchase excludes it. The sale form always sends 0, so today it only matters for
   imported or API-created bills. Keep it in the sale total, or match purchase?
2. **Customer change on edit (SA-11).** Refuse it once any payment or allocation exists
   (simple, safe), or move the money to the new customer (bigger)?
3. **SA-04 repair.** If the live count of `invoice.fy > 100` is non-zero, those rows need
   their `fy` set from the invoice date and their numbers checked for collisions. I will
   write the script; it needs your go-ahead to run.
4. **F-47** (what "outstanding" means for a customer) is still open and affects Block D.

## 6. Proposed order

1. **Block 0 — fix now** (money; needs your approval): SA-01, SA-02, SA-03, SA-04 (server
   stops reading `fy` from the body; form stops sending it), SA-05 (GET returns `id`, view
   passes it), SA-08 guard (the loader's customer select does not clear lines). Harness
   checks for each in `$HOME/harness`, as for purchase.
2. **Block B** (server first), then **A**, then **C**, then **D**. Commit per block;
   `tsc` + `next build` after each.
3. Live: the SA-04 count, SA-28 with the harness, and P4-17 (later, as agreed).

## 7. Stage 2 — done (2026-10-02)

Owner decisions: Block 0 go; keep sale and purchase in sync; freight **added** to the sale
total (and a freight field on the form); customer change on edit **blocked** (as vendor
change on purchase); SA-04 data **repaired by script**; F-34 rounding as §5.

| Commit | Block | Findings closed |
|---|---|---|
| `b25216d` | 0 — handler type, allocations, payment columns, sale fy, view id, loader | SA-01, 02, 03, 04, 05, 08 (guard), **34** |
| `b274fa7` | B — `lib/sale*.ts`, one route factory, schema + migration | SA-06, 07, 09–16, 21, 22, 27, 31, 33, **35** |
| `c1a23b7` | A + C — `components/bills/*` (form, lines, view, list), `hooks/useSaleBills.ts` | SA-08, 20, 23, 24, 25, 26, 30 |
| `fbeb254` | D — shared ledger / balance-log routes and pages, bill-ref UNION, dead code | SA-17 (orphan removed), 18, 19, 29, **36** |

Net across Phase 5: **68 files, +5,286 / −16,233 lines.**

### New findings while fixing

| ID | Sev | Finding | Fix |
|---|---|---|---|
| SA-34 | Critical | Edit paths wrote PAYMENT_RECEIVED as a **debit** (0→1, 2→1, 0→2, Type B update): marking a bill paid by editing it doubled what the customer owed | Block 0; data: `repair-sale-data.js` part 2 |
| SA-35 | High | The sale list had no `remaining_amount`; the customer-payment screen filters on it, so it offered no sale bills | Block B (list returns both names) |
| SA-36 | Low | Customer ledger note edit called `/api/customer-ledger/[id]`, which did not exist | Block D |
| SA-37 | Medium | Vendor balance-log page (Block D of purchase) audited only the 50 loaded rows against the counters → false discrepancies | Block D (server totals) |

SA-32 was already right (`orderBy: { id: 'asc' }` is there) — no change.

### Kept in sync with purchase

- One bill engine, `lib/line-math.ts computeBill`, used by the purchase API, the sale API and
  every form preview: lines keep paise, CGST/SGST/IGST and the grand total round to the
  rupee half up (F-34). **Purchase totals now round too.**
- One line editor, `components/bills/BillLines.tsx` (purchase passes no discount).
- Party change on edit refused on both sides; Partial derived on both; reconcile by line id
  on both; delete refused with returns on both; `oldTotal/oldStatus` captured before the
  update on both.
- Reports: one ledger route, one balance-log route, one ledger page, one balance-log page.

The one intentional difference: **freight** is in the sale total and outside the purchase
total (purchase unchanged until the owner says otherwise).

### What the owner runs (in order)

1. `node scripts/repair-sale-data.js` — dry run; read it.
2. `node scripts/repair-sale-data.js --apply` (add `--renumber` only to reassign colliding sale numbers).
3. `node scripts/migrate-sa-16.js` — stops and lists if duplicates or orphan lines remain.
4. `npx prisma generate`, restart dev.
5. Then the Phase 4 leftovers: `node scripts/audit-p4-15.js`, `node scripts/audit-assert.js`.

### Checked

`tsc` and `next build` clean. Harnesses (outside the repo): Block 0 14/14 (11 fail on the old
code), server create/edit/read/delete 48/48, customer reports 12/12, sale form 17/17, sale
list 5/5; purchase delete/edit/list/report/page suites all still pass.

### Carried to Phase 6 (returns, payments)

- Sale returns refund at the line **rate**, ignoring the line discount.
- `handleCustomerPaymentEdit` puts sale and salex ids in one `invoicesToUpdate` list.
- The customer-payment screen lists sale bills only, never Invoice C.
- Refund-allocation branches in the customer handler write `return_id`, a column that does
  not exist (dead today: `getReturnAllocationChanges` returns nothing).
- SA-28 [V]: the advance portion of a paid-on-create bill is a BILL_SPECIFIC payment — the
  same on purchase; check with the live harness.

## 8. Phase 6 carry list — done (2026-10-03)

Owner: "Fix all". Every item below was fixed on **both** sides where the twin had it.

| Commit | What | Closes |
|---|---|---|
| `c1e2ccb` | `lib/advance-allocation.ts`: advance is allocated from existing payments, never a new BILL_SPECIFIC row; release deletes only money paid with the bill; unmark keeps the party's own advance | SA-28 (both), L-26, L-30 |
| `efe3731` | Customer payment/refund delete called recalc functions that did not exist; return delete looked up refund allocations by a non-existent `return_id`; return delete never reversed `total_refunded` / `total_refund_allocated` (both ledgers) | SA-38, 39, 40 |
| `8223d5d` | `lib/sale-return.ts`: returns priced at the line's **net** price, server tax, over-return guard, kind-explicit ids, status by header id, one return per bill; list, credit-note report and forms | SA-41 … 47 |
| `3ccb1d2` | `lib/purchase-return.ts`: the same guards and pricing for purchase returns | SA-48, 49 |
| `4f74fc0` | `lib/payment-allocations.ts`: one allocation check for customer and vendor, create and edit; Invoice C on the payment screen; refunds kind-explicit; refund ledger rows | SA-50 … 56 |

### Findings

| ID | Sev | Side | Finding |
|---|---|---|---|
| SA-38 | High | C | Payment / refund delete called `recalculateInvoiceStatus` / `recalculateSaleReturnStatus`, which did not exist: the delete threw |
| SA-39 | High | C+V | Return delete removed refund allocations by `return_id` (no such column); vendor side also deleted DIRECT refunds |
| SA-40 | High | C+V | Completing a return raised the refund counters; deleting it never lowered them. Now reversed from the balance log rows under the note number (net, so a reused id is safe); a return older than the logs falls back to its refund amount |
| SA-41 | Critical | C | Sale returns refunded the gross **rate**; a discounted line refunded more than was paid. Now rate less discount, per unit, paise kept; the form may lower it, never raise it |
| SA-42 | High | C | The return form sent `unit_price: Math.floor(rate)` and `tax_rate: 0`: sale returns carried no GST. Tax is now the line's own %, split as on the bill, F-34 rounding |
| SA-43 | High | C+V | No over-return guard: a line could be returned again and again (only stock was checked on purchase) |
| SA-44 | High | C | Sale and Invoice C line / return ids overlap. Create looked an id up in **both** tables and returned it twice; GET / DELETE opened the sale return for an Invoice C id; edit never sent its type, so Invoice C returns were edited as sale returns. Every id now carries its kind; an ambiguous id is refused |
| SA-45 | Medium | C | Return status recomputed by the printed number (other years' bills); never recomputed on delete. Now by header id, on create, edit and delete (both sides) |
| SA-46 | Medium | C | Return list paged each table separately: up to twice the page size, wrong total, customer filter after paging |
| SA-47 | Medium | C | Credit-note report: search and customer filters used columns that do not exist (every search a 500); note numbers were bare ids |
| SA-48 | High | V | Purchase return edit split tax on `item.vendor_state_code`, which the form never sends: every edit became IGST. Edit compared a total without P&F to one with it |
| SA-49 | Medium | V | Purchase return delete left the bill marked returned; edit could take out more than stock |
| SA-50 | Critical | C | Payment edit: the form folded Invoice C allocations into sale ones; the route guessed the kind by looking the id up in the sale table. Statuses landed on the wrong bill |
| SA-51 | High | C | The customer-payment screen listed sale bills only; Invoice C could be paid only with the bill |
| SA-52 | High | C+V | Allocations unchecked: customer create capped at the bill **total** (a bill could be paid twice); vendor create ran the customer validator, which checks invoice ids, so nothing; edits checked nothing. Now: the party's bill, at most what is left after other payments, at most the payment |
| SA-53 | High | C+V | Payment type taken from the form (`'RECEIPT'` by default on the customer side) though the counters, ledger and advance model branch on it. Now derived from the allocations |
| SA-54 | High | C | Refund delete and edit matched ledger rows `REFUND` by `transaction_id` — what a **completed return** writes with the return's id. The refund's own `REFUND_PAID` row stayed; a return's row went |
| SA-55 | Medium | C | Refund create resolved a bare `return_id` to the sale return; edit defaulted the kind to sale and destructured bare ids (no status recalculated) |
| SA-56 | Medium | C | `payment_mode` / `refund_mode` 0 (cash) became 1 through `\|\| 1` |

Also: five routes made their own `PrismaClient` (connection leak in dev); vendor payment edit
created allocations in parallel with deleting them.

### Still open (owner)

- **Return completion** through create writes CREDIT_NOTE **and** REFUND; through edit,
  CREDIT_NOTE only. Which is right? (Counters move the same either way.)
- **Purchase freight**: sale totals include freight; purchase totals still do not.
- Sale returns: a completed return cannot be edited; purchase returns can. Kept as is.

### Checked

`tsc` and `next build` clean. New harnesses: sale returns 29/29, purchase returns 15/15,
payments / refunds 17/17, advance 9/9 + 5/5; all earlier suites still pass (out 16, edit 27,
list 10, report 10, num 10, sale0 13, saleB 49, custreport 12, page tests 3–6).
