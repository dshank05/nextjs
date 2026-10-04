# Purchase and sale scenario tests — the old manual docs, automated

Status: **plan** (2026-10-03). Owner asked to test the purchase and sale scenarios and how they
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
