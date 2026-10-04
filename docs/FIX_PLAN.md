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

(filled in as each group lands)
