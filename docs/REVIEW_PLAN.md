# Five-section review — screen → payload → server → tables → reports

Status: **plan** (2026-10-03), waiting for the owner's go. Five reviewers (sub-agents), one
section each, check that every screen action reaches the database the way the screen means it,
comes back the way the screen reads it, and shows up correctly everywhere else — and that the
behaviour makes sense. They read the code and the existing tests of their section in full, and
add backend tests for what is not covered. They change **no app code**: what is wrong comes back
as a finding for the owner, as before.

## 1. Sections

| | Section | Screens (pages → components → hooks) | Server |
|---|---|---|---|
| **A** | Purchases | `purchases/*` → `components/bills` (kind `purchase`) → `useBills` | `api/purchases/*`, `lib/purchase*.ts`, `transaction-handler`, `ledger-*`, `balance-handler` |
| **B** | Sales and Invoice C | `sale/*`, `salex/*` → `components/bills` (kinds `sale`, `salex`) → `useBills` | `api/sales/*`, `api/salex/*`, `lib/sale*.ts`, `customer-transaction-handler`, `customer-ledger-*`, `customer-balance-handler` |
| **C** | Money: payments, refunds, party transactions, ledgers | `customer-transactions/*`, `vendor-transactions/*`, `entry/vendor-transaction`, `transactions/` → `components/transactions`, `PaymentHistory*` → `usePartyTransactions` | `api/{customer,vendor}-{payments,refunds}/*`, `api/{customer,vendor}-transactions`, `api/{customer,vendor}-ledger/*`, `lib/advance-allocation`, `payment-allocation*`, `party-transactions` |
| **D** | Returns and stock | `entry/salereturn*`, `entry/purchasereturn-vendor*`, `entry/deadstock` → `components/returns`, `components/deadstock` → `useReturns`, `useDeadstock` | `api/sale-returns/*`, `api/purchase-returns/*`, `api/deadstock/*`, `lib/sale-return`, `purchase-return`, `return-*`, `deadstock` |
| **E** | Parties, settings, dashboard, reports | `customers/*`, `vendors/*`, `entry/{customer,vendor}details`, `settings/*`, `index` (dashboard), `reports/*` → `components/{parties,reports}` → `useParties`, `useListQuery`, settings hooks | `api/{customers,vendors}/*`, settings APIs, `api/dashboard`, `api/reports/*`, `lib/*-report*`, `party-outstanding`, `cash-book`, `balance-log-report` |

Products (`products/*`, `api/products/*`) is the next phase and is left out; E notes where reports
or bills depend on it.

## 2. What each reviewer does, in order

1. **Read in full** — every screen, component, hook, route and lib of the section, including
   conditional sections, and its tests (`tests/backend/suites/*` named in section 5, the
   scenario tests by kind, and the UI page tests in the harness).
2. **List every user action** — create, edit, delete, status change (paid / unpaid / refunded,
   active / inactive), view, list (search, filters, sort, paging), export / print, and the
   refusals the screen expects to show.
3. **Trace each action end to end** and write one row per field:

   | Screen field | Payload key (method, URL) | Server reads | Validated / computed | Table.column written | Response field | Screen reads back | Cache refreshed | Shown elsewhere (lists, reports, ledgers) |

   Flag every break: a field sent and ignored; required by the server and never sent; a name or
   unit mismatch (₹ vs paise, IST day vs UTC, `"1"` vs `1`, 0 meaning cash vs "missing"); a
   server error code the screen does not show; a write the screen never refreshes; an edit form
   that loads a field it does not send back (or sends it changed).
4. **Prove the payloads are the screen's own** — render the real screen in the jsdom page
   harness, fill it, submit, and capture the exact request bodies. Those captured bodies become
   **fixtures** for the backend tests, so the saved tests stay backend-only but send what the
   screen really sends.
5. **CRUD round trips** (backend tests, from the fixtures): create → read as the edit form reads
   it → edit with what the form would send back unchanged → **nothing may change** (round-trip
   fidelity) → edit one field → only that field and what follows from it change → delete →
   everything it wrote is gone or rolled back. After each step: A1–A14 and the 16 report checks
   (`checkAll`, `checkReports`).
6. **Connectedness** — for each write, list every other place that must reflect it (the other
   kind's twin, party ledger, outstanding, balance logs, cash book, GST, stock, dashboard) and
   assert it in the same test.
7. **Does it make sense** — judge each behaviour against the owner's recorded rules
   (`docs/*_PLAN.md` decisions, the twin rule, direct adjustment for refunded returns, advance on
   a lowered bill, complete rollback on unmark / delete, rate 0 allowed). Anything odd becomes a
   finding with evidence (file:line), what happens, what the user would expect, a suggested fix
   and its risk. A finding whose behaviour is wrong today goes in as `test.failing` with its id
   (`A-01`, `B-03`…), so it turns red the day it is fixed.

## 3. Rules for the reviewers

- No app code changes, no commits, nothing written on the owner's computer.
- Each works in its own copy of the repo (`/home/claude/review/<A-E>`, cloud workspace) and adds
  only `tests/backend/suites/review-<section>-*.test.js`, fixtures under
  `tests/backend/fixtures/<section>/`, and its report.
- Tests go through the real routes over the in-memory store (`tests/backend/support`); jest runs
  with `--runInBand` on its own files (two cores shared by five).
- Read before claiming: every finding cites the line it comes from and, where it can, a failing
  test that shows it.

## 4. What comes back (per section)

`docs/review/<section>.md`:
1. the action list and the field-by-field trace table;
2. a coverage matrix — action × outcome (success, each refusal, each status path) → the test
   that covers it, before and after;
3. findings, ranked, with evidence and a suggested fix;
4. the tests and fixtures added, and their run result.

## 5. Merge and check (me)

Read each report and its tests; re-run every new test against the code myself; drop anything I
cannot reproduce; copy the tests, fixtures and reports into the repo; run the whole backend suite,
`tsc` and `next build`; commit per section. Then one summary: what is connected, what was broken,
the findings that need the owner — none fixed without the owner's word.

## 6. Starting point (for the reviewers)

- Backend tests: `npm run test:backend` — 25 files, 294 tests (291 pass, 3 skipped), covering
  the old manual docs' 265 scenarios, the flow story and the per-area suites.
- Page (jsdom) tests: harness `test3`–`test14` — bills, returns, parties, transactions, dead
  stock, settings, dashboard.
- Owner rules to judge against: BILLS_PLAN Q1–Q4, SETTINGS_PLAN D1–D4, DETAILS_PLAN §4,
  LEDGER_ASSERT_PLAN §6, SCENARIO_TESTS_PLAN §6.
