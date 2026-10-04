# Fixing the review findings — what is fixed without the owner, and how

Status: **in progress** (2026-10-04). Owner: "Fix which you can without my input." Source: the ranked
list in `docs/review/README.md` and the section reports beside it. H1 (A-04 = B-01 = C-02) is done
(c3a537f).

## 1. Rules for every fix

- The owner's recorded rules decide what "right" is (BILLS_PLAN Q1–Q4, direct adjustment for refunded
  returns, a lowered bill's excess stays advance, unmark / delete rolls back completely, rate 0 allowed,
  "Other" vendor is a real vendor row that posts, walk-in sale posts nothing).
- URLs and API contracts stay; behaviour changes only where a finding names it. No data changes — where a
  fix leaves old rows wrong, the commit says which one-off recompute the owner may want to run.
- Twins stay in step (customer / vendor, sale / Invoice C / purchase).
- Each finding has a `test.failing` with its id. A fix turns it red; it then becomes a plain test. The
  whole backend suite, `tsc` and `next build` stay green; one commit per group.

## 2. Groups (one fixer each, run in parallel on separate branches, merged by me)

| | Group | Findings |
|---|---|---|
| F1 | Payments, refunds, ledgers (C) | H3: C-01, C-03 · M1: C-04 · M16: C-06 · M17: C-07 · C-05, C-08, C-09, C-10 · assertion gaps G-01 – G-04 |
| F2 | Bills: purchase, sale, Invoice C (A, B) | H2: A-01 · M1: A-05, B-03 · M2: A-02, A-11 · M3: A-03 · M4: B-02 · B-05, B-06, B-07, B-09, B-12, B-14 · A-06, A-08, A-09, A-12, A-13 |
| F3 | Returns and dead stock (D) | H4: D-01, D-02, D-03 · M5: D-07 · M6: D-04 · M7: D-05 · M8: D-08 · D-06, D-09, D-10, D-12, D-13, D-17, D-18 |
| F4 | Parties, settings, dashboard, reports, users (E) | H5: E-03 · H6: E-01 · M15: E-02 · M10: E-04 · M11: E-12 · M12: E-05, E-10 · M13: E-08 · M14: E-16 · B-10 · E-06, E-09, E-11, E-13, E-14, E-15, E-17, E-18 |

## 3. Left for the owner (not fixed)

| Finding | Why it waits |
|---|---|
| Walk-in cash sales not in the cash book (B, Q1) | Recording a payment for walk-in bills changes the "walk-in posts nothing" rule |
| Dashboard leaves out Invoice C (B-08) | May be intended |
| Payment date when "Paid" is picked on edit (A-10, B-11) | Bill date or today — a choice |
| Unpaid bills stored as Cash (A-15, B-04, D-11) | Storing no mode changes lists and reports |
| A state's GST code changed while in use (E-07) | Refuse or carry to parties — a choice |
| Party-report date range (E Q-2) | Which parties count — a choice |
| One phone rule (E Q-4) | Which rule |
| Mixed but fully allocated stays MIXED (C Q-01) | Decides the vendor ledger shape |
| Client `invoice_number` on `POST /api/purchases` (A-14) | API contract |
| Notes length (A-16) | Limit the box or widen the column |
| Purchase returns across bills; list "Total" pre-tax (D-15, D-16) | Design choices |
| Credit-note GST rounding per note (B-13, M9) | Rounding policy |
| Purchase create prices outside the transaction (D-14) | Concurrency; needs a real database to test |
| `/transactions` demo page, `POST /api/customer-adjustments` (C-11, C-12) | Unused; deleting them removes URLs |

## 4. Results

Status: **done** (2026-10-04). Every finding in §2 is fixed; only §3 is open. Backend suite: 41 files,
**518 tests — 515 pass, 3 skipped**; the open `test.failing` left are A-10, B-04, B-13, E-07 (owner).
`tsc` and `next build` clean.

| Group | How, in short |
|---|---|
| H1 | `availableAdvance()` in `lib/advance-allocation.ts` — refunds given back are taken off advance, everywhere it is read |
| F1 | New `lib/payment-ledger.ts`: a payment's / refund's ledger rows are rebuilt from the document and its allocations on create and edit (shape per party convention; rows reused by id so F-02 entry order holds; mode, date, notes follow; a note typed on the ledger screen is kept). Allocations under half a paisa ignored, Auto Allocate in paise. Party locked on edit (400 `PARTY_CHANGED`). Vendor refund create refuses allocations, as the customer twin. Blank notes stored as null on create and edit. Customer payment / refund lists filter by customer and type. New assertions **A15** (each payment's / refund's own rows: shape, amount, tag, date, mode) and **A16** (`total_allocated` = Σ allocations); A10 covers customer refund allocations |
| F2 | A payment that becomes MIXED / DIRECT when its bill is lowered gets one row tagged `payment` (both parties). Mode change on a paid bill reaches its own payment and ledger rows. "Other" vendor counters follow on create; "Other" bills can be part-paid. A paid bill with nothing allocated becomes Unpaid when its total moves. P&F clear sticks; ship-to and supply date kept on edit; Invoice C named in logs and particulars; `updated_at` one format and moved on edit; Export all pages through; inactive staff / mechanic / party shown on edit; HSN at create; deleting a purchase restores the product's latest rate; export line Total includes tax; walk-in Paid reads paid |
| F3 | A refunded purchase return's counters move by what it actually holds, logged under its debit note (edit and delete agree; a raise draws first on free on-account refund, as marking refunded later does). Pending clears the payment date. Lowering / deleting a sale or Invoice C return refuses negative stock (`INSUFFICIENT_STOCK`). Return reasons checked by kind (`INVALID_REASON`), placeholder takes the first reason of the kind. Bill picker counts returned qty per line, `item_search` works, "C-n" finds Invoice C. REFUND row dated by the payment date. Register words; customer filter by name |
| F4 | `auth_key` 32 characters. Shipping address kept as stored ("copy from billing" only when blank or identical). FY dates stored as the typed day. Stock report filters use the real product routes. Report pickers include inactive parties (marked) and load all. Settings saves refresh the shared caches. Report and party-list exports take every page. Reports name the customer from the bill. States used by a ship-to cannot be deleted. Empty lists "Page 1 of 1" / "Showing 0 to 0 of 0"; ledger leaves out 0/0 rows; no raw error text; debit notes search vendor name; user edit sends status only when changed |

### One-off data checks the owner may want to run (nothing was changed in the data)

1. `node scripts/audit-assert.js` — A15 / A16 now list payments whose ledger rows are stale (edited multi-bill vendor payments, moved allocations, old modes, ₹0 rows) and parties whose `total_allocated` drifted. The `rebuild*Ledger` helpers in `lib/payment-ledger.ts` are idempotent and can be run per listed payment.
2. Vendor 0 ("Other") `total_paid` / `total_allocated` — recompute from its payments (A-02).
3. Payments lowered into MIXED before this fix whose bill was then deleted — their ledger row is gone (A12 lists them).
4. Refunded purchase returns edited before this fix — their edit logs have no note number; the next edit or delete starts from the wrong base.
5. Financial years made in Settings — stored a day early (31 Mar – 30 Mar); move both dates forward a day.
6. Sale / Invoice C return lines saved with a purchase reason (id 1); refunded sale returns whose REFUND row is on the return date; pending purchase returns still carrying a payment date.
7. Products whose latest purchase rate came from a deleted purchase; purchase lines with empty HSN.
8. Customers whose shipping address was overwritten by billing — by hand.
