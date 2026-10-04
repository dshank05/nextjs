# Backend tests

```
npm run test:backend            # everything (about 2 minutes)
npm run test:backend -- scenbills         # one file
npm run test:backend -- -t "P2.7"         # one scenario
```

No database, no server: each test drives the **real API routes and libs** over an in-memory
Prisma (`support/memtx.js`), and raw SQL (reports, `scripts/audit-assert.js`) runs on an
in-memory SQLite copy built from `prisma/schema.prisma` (`support/sqlmirror.js`). Needs
Node 22.5+ (`node:sqlite`). Dates are India days: the config sets `TZ=Asia/Kolkata`.

## What runs

| File | What |
|---|---|
| `suites/scenbills.test.js` | The old manual docs, batches 1–3: create, edit (incl. the 9 paid / unpaid / partial cases), payments — for sale (`S`), Invoice C (`X`) and purchase (`P`) |
| `suites/scenreturns.test.js` | Batches 4–6: return create, return edit, refunds |
| `suites/scenmore.test.js` | Batches 7–9: integration, edge cases, data integrity (each assertion catches its break) |
| `suites/flow.test.js` | One 45-step business story; hand-worked totals; tamper checks |
| `suites/assert.test.js` | A7–A11 pass on clean data and fail on broken data |
| the other `suites/*.test.js` | The earlier per-area suites (handlers, purchases, sales, payments, returns, reports…) |

A scenario's name is its paragraph in the doc: `P2.7` is purchase, `SALES_COMPREHENSIVE_TEST_SCENARIOS.md`
test 2.7. After **every** scenario, `audit-assert.js` A1–A14 must pass and 16 reports must agree
with the documents and the ledger (outstanding, ledger accounts, balance logs, sales / Invoice C /
purchase, GST, credit / debit notes, returns register, cash book, profit, stock).

## Open, known, skipped

- `[OPEN F-S…]` — a finding waiting for the owner's decision, run with `test.failing`: the suite
  stays green while it is open and turns **red when the behaviour changes** — then make it a plain
  `sc(...)`. The list is in `docs/SCENARIO_TESTS_PLAN.md`.
- `known: ['A2']` — F-02 (open audit item): the vendor ledger's stored balance runs in entry
  order, so a backdated entry trips A2.
- `test.skip` — concurrency (needs a real database) and product-name length (products phase).

`tests/batch-1-purchase-creation.test.js` is the older live-server test (needs a running app and
database); `npm test` runs it, not these.
