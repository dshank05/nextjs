# Purchase and sale scenario tests — the old manual docs, automated

Status: **done** (2026-10-03) — results in section 6; the tests live in `tests/backend` (`npm run test:backend`). Owner asked to test the purchase and sale scenarios and how they
update the return, transaction (payment / refund / allocation) and ledger tables, using the older
test documents in `docs/`. None of those documents was ever automated; their trackers stand at 0.

## 1. Sources

| Doc | Tests | Detail |
|---|---|---|
| `SALES_COMPREHENSIVE_TEST_SCENARIOS.md` | 100 (9 batches) | 1 create 10, 2 edit 12, 3 payments 15 written out; 4 return create 10, 5 return edit 8, 6 refunds 15, 7 integration 12, 8 edge 10, 9 integrity 8 outlined |
| `PAYMENT_ALLOCATION_TEST_SCENARIOS.md` | 28 (purchase) | create 4, edit 4, payments 8, return create 4, return edit 2, refunds 6 |
| `COMPLETE_TEST_SCENARIOS.md` | 22 (purchase) | create 6, edit 8, return create 6, return edit 2 |
| `LEDGER_TESTING_CHECKLIST.md` | ~35 checks | ledger rows per action — covered by the checks below |

## 2. How each test runs

Each scenario starts from a fresh in-memory database, drives the **real API routes** with the
doc's own numbers (qty 10 × ₹1000, 18 %, ₹50,000 bills, …) and checks what the doc lists:

- the bill and its lines, stock, the billing snapshot / transport rows;
- the transaction tables: payments, refunds and their allocations, the bill's payment status;
- the return tables: returns, return lines, the bill's return status;
- the ledger: the party's rows and closing balance, and each bill / payment netting right;
- the party's counters and balance logs;

then **A1–A14** and the **16 report checks** from the flow suite after every scenario.

Sale scenarios also run for **Invoice C** (no tax) and **purchase** wherever the twin exists;
the purchase docs' scenarios also run for **sale**. Numbered as in the docs (`S2.7`,
`P10`, `C14`), so a failure points at the paragraph it came from.

## 3. Where the docs are older than the agreed behaviour

The tests follow today's agreed behaviour and record the difference; nothing is changed to
match an old document.

| Doc says | Today (agreed) |
|---|---|
| An edit adds `SALE_ADJUSTMENT` / `PURCHASE_ADJUSTMENT` / `RECEIPT_ADJUSTMENT` rows | The bill's row is updated in place (handler refactor); the amounts and the balance are what is checked |
| Receipt rows are `RECEIPT` | `PAYMENT_RECEIVED` |
| A walk-in ("Other") sale posts to the ledger | Posts nothing — the walk-in has no account |
| A pending return posts its note | Posts nothing until refunded |
| A refund is allocated to returns (partial / multiple / auto) | Refused (`REFUND_VIA_RETURN`); a return is refunded by completing it — a direct adjustment (owner) |
| Deleting a payment writes negative reversal records | The payment, its allocations and ledger rows are removed |
| One payment over three sale bills writes three ledger rows | Customer side: one row for the payment; vendor side: one per bill |

## 4. Not automatable here

Concurrency (S7.11, S8.10) needs a real database; FIFO suggestion (S3.14, P11, P25) is the
screen's — tested through the outstanding-bills API order. Listed in the results, not skipped
silently.

## 5. Order

T1 this plan → T2 shared test module (fresh store, A1–A14, reports) → T3 sale batches 1–3 (+
Invoice C, purchase twins) → T4 purchase docs → T5 sale batches 4–9 → T6 results table here,
counts, any bugs fixed in their own commits.

## 6. Results

`npm run test:backend` — 25 files, **288 tests: 285 pass, 3 skipped**, about 2 minutes, no
database or server. 265 of them are the docs' scenarios, one jest test each:

| File | Scenarios | Covers |
|---|---|---|
| `scenbills.test.js` | 131 | batches 1–3 × sale / Invoice C / purchase, plus the 9 status cases (2.13–2.19) |
| `scenreturns.test.js` | 78 | batches 4–6 × three kinds |
| `scenmore.test.js` | 56 (3 skipped) | batches 7–9: integration, edge cases, each assertion catching its break |

Plus the 45-step flow story, the assertion self-test and the 20 earlier per-area suites. After
every scenario A1–A14 pass and the 16 report checks agree.

The purchase documents map onto the same tests (`P` = purchase kind):

| Purchase doc test | Scenario |
|---|---|
| P1–P2, C1–C6 | P1.1–P1.6 |
| P3, P4, P13 | P3.1, P3.2 |
| P5, C8 | P2.2 · C7 P2.1 · C9 P2.4 · C10 P2.5 · C11 P2.6 · C12 P2.7 · C13 P2.9 · C14 P2.10 |
| P6, P7 | P2.7 (paid on create) and P7.4 (paid on the payments screen) |
| P8 | P3.15 |
| P9, P10, P11, P12 | P3.3, P3.5, P3.14, P3.10 |
| P14, P16 | P3.8 · P15 P3.13 |
| P17–P18, C15–C16 | P4.1, P4.2 |
| P19–P20, C17–C20 | P4.3–P4.4t (a refund goes through completing the return) |
| P21–P22, C21–C22 | P5.1, P5.2 |
| P23–P27 | P5.5 (refund to a return refused), P6.6, P6.9, P6.14 |
| P28 | P6.12 |

### Bugs found and fixed

| Commit | What |
|---|---|
| 50d79e3 | One vendor payment over several purchases (and the reversal rows of a status change) wrote its ledger rows in parallel; each read the same latest balance, so stored running balances were wrong (P3.4, P3.5) |
| ec690e5 | Editing a refund (both parties) left total_refunded at the old amount; deleting it afterwards left the difference behind (6.14) |
| 8ff35d0, badcab5 | Assertions: a 0.01 payment is a part payment (A3 / A8); purchase totals are rounded to the rupee (A4); refunds checked as a range (A12) |
| da4a8ed | A12 also checks each party's counters against its payments and refunds — the refund-edit bug was invisible to A1–A14 |

### Open — owner decision (each runs as `test.failing`)

| | Scenarios | What happens | Options |
|---|---|---|---|
| **F-S1** | S/X/P 2.8, 2.17 | A paid or part-paid bill lowered below what was paid keeps its old allocation (10000 on an 8000 bill). The counters treat the 2000 as returned, the ledger shows it as the party's credit, and the payment still says 10000 | (a) the 2000 stays as the party's advance — trim the allocation, counters follow (as L-31 does for part-paid bills); (b) the bill's own payment is reduced by 2000, as the old doc says |
| **F-S2** | S/X/P 2.14, 2.18; S/X 2.19 | Unmarking a bill that was paid on the payments screen deletes that payment. Customer side: its ledger row is left behind. A payment shared with another bill is left half allocated; vendor side drops that bill's ledger row | (a) unmarking only releases the allocation — the money stays as advance; (b) keep deleting, and make both parties remove the payment's rows and handle shared payments |
| **F-S3** | P5.2 | A refunded purchase return can be edited; the sale twin refuses (the docs expect refusal) | refuse, like the sale side |
| **F-S4** | S/P 8.1b | A bill at rate 0 (total 0) is accepted; the doc says refuse | refuse a zero-total bill, or allow free lines but not a zero bill |

### Where the docs are older (tests follow today's agreed behaviour)

Besides section 3: raising a paid bill makes it part paid rather than adding a payment (2.7);
marking a part-paid bill paid by an edit keeps it part paid — the rest is paid on the payments
screen (2.13); a missing sale product's error does not name its id (the purchase one does).

### Skipped

S7.11 and S8.10 (concurrency — need a real database), S8.6 (product-name length — products phase).
