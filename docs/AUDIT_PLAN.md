# Inventory & Ledger Audit Plan

**Branch:** `dev_akaash` · **Started:** 2026-09-20 · **Last updated:** 2026-09-20

**Status:** Phase 1 done (bar one deferred item) · Phase 2 mostly done · environment ready

| Phase | State |
|---|---|
| 0 · Recon | done |
| 1 · Foundations | **done** — F-01 code unified, data repair no longer needed (see below), F-25 fixed. F-06/F-07 still open |
| 2 · Settings | **mostly done** — F-28 fixed, F-29 fixed, F-30 partial. 6 pages left |
| 3 · Products | next |
| 4 · Purchase | not started |
| 5 · Sale & Salex | not started |
| 6 · Returns | not started |
| 7 · Reports | not started — runs last, needs journey data |

Phases 3-6 are one continuous **product journey** (product → purchase → sale/salex →
return), run twice: a happy path first to establish a baseline and create data, then a
mutation pass (edit, partial return, second return, delete, backdated entry) where
essentially all the bugs are. The ledger is **not a phase** — its reconciliation
assertions (§7) run after *every* step, so the step that breaks the balance is the step
you are on.

**Statutory basis:** §4a records what Indian GST actually requires, checked 2026-09-20. Three
findings (F-34/35/36) come from the rules rather than from internal inconsistency, and three
existing design decisions were confirmed correct.

---

## 0. Resume here

Last session ended 2026-09-20. The environment is now set up and the database is clean,
so the next session can start on real work rather than setup.

### State of the world

- **Database:** `u348217822_test_v3` on Hostinger. Connected and working.
- **Financial year:** id=4, `2026-2027`, 2026-04-01 → 2027-03-31, set as current.
  Previously the app was stamping documents into FY 2025-2026, which closed 2026-03-31.
- **Data:** all transactional data wiped (384 rows, 37 tables). Kept 602 real products
  plus all master/config data. Customers and vendors were fake and were dropped too.
- **Stock baseline:** `opening_stock == stock` for all 602 products, so the stock
  reconciliation assertion in §7 is now meaningful. It was not before.
- **Backup:** `backups/backup-u348217822_test_v3-2026-09-20T08-35-49.sql`, verified
  57/57 tables. Contains the pre-wipe state including the F-01 corruption sample.
- **Auth:** working. Log in with `admin` / `admin123` (all five users are on seeded
  defaults — F-26). Two separate problems were fixed here:
  - **F-38, the real cause:** `PrismaAdapter(prisma)` was configured, but this schema has
    no `Account`, `Session` or `VerificationToken` models — `prisma.account`,
    `prisma.session` and `prisma.verificationToken` are all `undefined`. NextAuth
    validates the adapter at init, failed, and returned `error=Configuration` on every
    call. The adapter was never needed: sessions are JWTs and `authorize()` looks the
    user up directly, and NextAuth does not support database sessions with
    `CredentialsProvider` anyway. Removed.
  - **F-42:** `NEXTAUTH_SECRET` was missing from `.env`, and `NODE_ENV` was set manually
    (Next.js owns that variable). Both fixed.

  Note for future debugging: `/api/auth/error?error=Configuration` returns HTTP 500 **by
  design** — NextAuth classifies Configuration as a server error, so requesting that URL
  directly always 500s whether or not anything is wrong. The only meaningful test is a
  real sign-in POST: a healthy config returns `error=CredentialsSignin` for a bad
  password, a broken one returns `error=Configuration`. Also, changing
  `NEXTAUTH_SECRET` invalidates every existing session cookie, so clear site data for
  localhost after touching it.

### Live sweep, 2026-09-20

Every API route was probed against the running dev server with a real session:
65 static routes, 28 dynamic, plus every page. **Three hard failures were found and
all three are fixed** — F-11 (product list), F-45 (customer outstanding), F-48
(minimum stock). Everything else answers 200, or a correct 400/405.

All three were the same shape: code written against field names the schema does not
have, failing only at runtime because Prisma's `where`/`orderBy` are typed as `any`
at the call sites. Worth remembering when reading any endpoint that has not been
exercised yet — a clean read is not evidence it runs.

### Pick up with

1. ~~**Seed `gst_tax_rate`**~~ — **done.** Four slab rows exist: 0 (`0000`), 5 (`8714`),
   18 (`8415`), 40 (`8703`), all Active. These are the post-GST-2.0 slabs; 12% and 28%
   were withdrawn 22 Sep 2025.

   **Products were deliberately not wired to them.** The 602 products are real data and
   all still have `gst_rate_id = NULL` and `hsn = NULL`. Multi-slab test invoices are
   built by editing the per-line **GST %** field in the sale/purchase grid
   (`pages/sale/create.tsx:2139`), which is editable — so no product needs to be
   mis-tagged to exercise the tax paths. Wiring products is a separate, real decision
   about master data, not test setup.

   Note that until products carry an `hsn`, the detail endpoint reports every product at
   **0% tax** — see F-43, which this step uncovered.
2. **Finish Phase 2** — 6 settings pages left: `business-details`, `bank-details`,
   `staff`, `mechanics`, `users`, `return-reasons`, `warehouse`, and `financial-years`
   itself.
3. **Then Phase 3 (Products)** and into the journey.

### Not needed any more

**F-01's data-repair migration.** 26 rows across 9 tables carried calendar-year `fy`
values; the wipe deleted all of them. The pre-wipe sample is preserved in the backup if
the migration is ever needed for another environment. The *code* fix stands and prevents
recurrence.

---

## 1. Why this document exists

The app has the right *structure* (products → purchase → sale/salex → return → ledger → reports) but is unstable in the money-handling paths. The instability is not random: a recon sweep found a small number of **root causes** that each produce many visible symptoms. Auditing feature-by-feature without fixing the root causes first means fixing the same bug five times.

So the plan is ordered to fix **foundations before features**, and within that, **easiest first** — which happens to match the intuition of going settings → reports → product → purchase → sale → return. That ordering is correct and this plan keeps it, with one change: the cross-cutting defects in §4 are pulled forward into Phase 1, because three of them corrupt data written by *every* later phase.

---

## 2. Scope and method

### In scope

Settings, Reports, Products, Purchase, Sale, Salex, Sale Return, Salex Return, Purchase Return, Customer/Vendor ledgers, payments, refunds, allocations.

### Method, per module

Each module is audited in four passes. Do them in this order — a UI bug that is really an API bug wastes time if you start at the UI.

1. **Schema pass** — what does the data model actually permit? Missing FKs, nullable columns that code assumes non-null, join keys that aren't unique.
2. **API pass** — read the handler end to end. Check: input validation, server-side recomputation of money, transaction boundaries, stock effects, ledger effects, error paths.
3. **UI pass** — read the page. Check: what it sends vs. what the API reads, multi-step state, edit-mode rehydration, double-submit, stale cache after mutation.
4. **Round-trip pass** — create → view → edit → delete, and confirm stock, ledger and reports agree at each step. This is where multi-step bugs actually surface.

### Definition of done, per module

- Every finding has an ID, a severity, and a `file:line` reference.
- Every **Critical** and **High** finding has a written reproduction.
- Every fix has a regression test under `tests/` (see §7).
- Stock and ledger reconcile after a full create/edit/delete cycle.

### What recon could NOT check

No database is configured (`.env.local` absent), so nothing here was verified against a running app. Every finding below was derived by reading code. Findings are tagged:

- **[C]** Confirmed — the code is unambiguous, no DB needed to be sure.
- **[V]** Needs verification — likely, but confirm against real data before fixing.

Getting a database in front of this is the single highest-value setup step. See §7.

---

## 3. System map (read this before auditing anything)

### The three document families

| Family | Header table | Item table | Return table | Tax? |
|---|---|---|---|---|
| Purchase | `purchase` | `purchase_items` | `purchase_returns` | yes |
| Sale | `invoice` | `invoice_items` | `sale_returns` | yes |
| Salex | `invoicex` | `invoice_itemsx` | `salex_returns` | **no** |

Salex is the tax-free mirror of Sale. Most sale bugs have a salex twin — **always check both**, they are separate files that have drifted apart.

### Join keys — the single most important thing to know

`invoice_items.invoice_no` and `purchase_items.invoice_no` are **plain `Int` columns, not foreign keys**. There is no referential integrity between headers and their items. Worse, the two families use the column to mean *different things*:

- **Sale / Salex** store the header **primary key** in it — `pages/api/sales/index.ts:196` (`invoice_no: sale.id`).
- **Purchase** stores the **human invoice number** in it — `pages/api/purchases/index.ts:631` (`invoice_no: invoiceNumberToUse`).

Purchase items are therefore looked up by a value that is **not unique** (`pages/api/purchases/[id].ts:31`, `:516`, `:647` — all filter on `invoice_no` with no `fy` filter). Any two purchases that ever share an invoice number merge their line items.

### Stock

`product.stock` is a nullable `Int` mutated in place from ~12 call sites. There is no stock ledger, so stock cannot be audited or reconstructed — if it drifts, there is no record of why. An append-only `stock_movements` table is the recommended end-state; out of scope here, noted in §6.

### Ledgers

`vendor_ledger` / `customer_ledger` store a **running balance snapshot** per row, computed as `previous.balance + debit - credit` where "previous" is the row with the highest `id` (`lib/ledger-service.ts:85-92`). Rows are therefore ordered by *insertion*, but displayed ordered by *date*. Backdated entries make the stored `balance` column meaningless.

There are two independent ledger implementations that disagree:

- `/api/reports/*-ledger-accounting` reads the stored ledger tables. **This is what the UI uses.**
- `/api/reports/*-ledger-details` rebuilds the ledger from source documents, date-sorted. **This is orphaned — nothing calls it.**

### Financial year

`settings.currentfy` is a **foreign key to `financial_year.id`** — a small integer like `3` (`pages/api/financial-years/index.ts:350`). It is *not* a calendar year. Twelve endpoints assume it is. See F-01.

---

## 4. Cross-cutting defects (fix these first)

These are the root causes. Each one produces symptoms across several modules, which is why the app feels "unstable everywhere."

### F-01 · Two incompatible definitions of `fy` · **Critical** · [C]

`fy` is a `financial_year.id` (e.g. `3`) when written by create endpoints, but a **calendar year** (e.g. `2026`) when written by these nine:

```
pages/api/sales/[id].ts:514              pages/api/salex/[id].ts:532
pages/api/sale-returns/index.ts:444      pages/api/sale-returns/customer-return.ts:52
pages/api/purchase-returns/vendor-return.ts:123
pages/api/customer-payments/index.ts:256 pages/api/customer-payments/[id].ts:160
pages/api/customer-refunds/index.ts:256  pages/api/customer-adjustments/index.ts:233
```

all using `currentDate.getMonth() >= 3 ? currentYear : currentYear - 1`.

A **third** strategy existed in `vendor-payments/index.ts:81` and
`vendor-refunds/index.ts:82`: accept `fy` from the request body, else inherit it from
the allocated purchase or return. So the mirrored pair disagreed with itself —
`customer-payments` used the calendar year while `vendor-payments` inherited. This is
the duplication drift described in §1 showing up in the foundations.

**Effect:** editing a sale silently rewrites its `fy` from `3` to `2026`. The sale then vanishes from every FY-filtered report, and the invoice-number counter — which computes `MAX(invoice_no) WHERE fy = 3` — stops seeing it, so it re-issues numbers that are already in use. Returns and payments are created with the wrong `fy` from the start.

**Fix — code: DONE (2026-09-20).** Added `lib/financial-year.ts` as the single source of
truth (`getCurrentFinancialYear`, `getCurrentFinancialYearRecord`,
`isWithinCurrentFinancialYear`). All 11 sites now call it; `lib/invoice-counter.ts`
re-exports it for compatibility and uses it internally. Verified: no
`getMonth() >= 3` derivations remain, and no endpoint reads `settings.currentfy`
directly any more. `npx tsc --noEmit` clean.

**Fix — data: NOT NEEDED (2026-09-20).** Semantics confirmed against the live database:
`settings.currentfy` was `3`, and `financial_year` id=3 is `2025-2026` — so the `fy` column
does hold a `financial_year.id`, as assumed. 26 rows across 9 tables carried calendar-year
values (all 4 invoices, 6 customer_ledger, 4 customer_payments, and others). All were
deleted in the test-data wipe. The pre-wipe sample survives in
`backups/backup-u348217822_test_v3-2026-09-20T08-35-49.sql` should the migration ever be
needed elsewhere.

**Open question raised by this fix:** documents are stamped with the *current* FY
regardless of their own date, so a backdated document is booked into the open period
rather than the period it belongs to. `isWithinCurrentFinancialYear()` exists but is
unused pending a business decision. See §10.

### F-02 · Ledger running balance is insertion-ordered but date-displayed · **Critical** · [C]

`lib/ledger-service.ts:85` orders by `id: 'desc'` to find the previous balance; `recalculateBalancesAfter` (`:289`) likewise walks `id` order. The UI sorts by `transaction_date`. Any backdated document produces a balance column that does not tie out line to line.

**Fix:** stop storing a balance snapshot, or recompute date-ordered. Recommended: treat `debit`/`credit` as the source of truth and compute the running balance at read time, date-ordered, with a carried-forward opening balance. That is the same fix as F-03.

### F-03 · Ledger balance restarts at zero on every page and every date filter · **High** · [C]

`pages/api/reports/vendor-ledger-accounting.ts:65-70` (and the customer twin):

```js
let runningBalance = 0
entries.forEach(entry => { runningBalance = runningBalance + entry.debit - entry.credit; ... })
```

`entries` is already paginated (`skip`/`take`) and already date-filtered. So page 2 of a ledger starts from zero, and a date-filtered ledger ignores the opening balance. Also, zero-value rows are filtered out *after* pagination, so page sizes are inconsistent.

**Fix:** compute the opening balance as `SUM(debit) - SUM(credit)` over everything before the window, seed `runningBalance` with it, and filter zero rows before paginating.

### F-04 · Server trusts client-supplied money · **High** · [C]

`pages/api/sales/index.ts:118` —

```js
calculatedGrandTotal = itemsTotal + packing_forwarding_total + transport_cost + total_tax
```

where `total_tax` comes straight from `req.body`. Per-item `cgst`/`sgst`/`igst`/`tax` are also stored verbatim (`:209-213`). Nothing recomputes tax server-side, and nothing decides CGST+SGST vs IGST from the customer's state code on the server.

**Fix:** recompute all tax and totals server-side from `qty`, `rate`, `gst_percentage`, discount and the state-code comparison. Treat client totals as a checksum to validate against, not as input.

### F-05 · No role authorization · **Medium** · [C]

`middleware.ts` correctly protects all of `/api/*` except `/api/auth` — so the endpoints *are* authenticated. But there is no role check anywhere: `grep -rn "role" pages/api` returns nothing outside NextAuth. The README advertises Admin / Manager / Cashier roles. Any signed-in user can post vendor payments, change the financial year, or delete invoices.

### F-06 · `[id]-old.ts` is a live route · **Medium** · [C]

`pages/api/purchase-returns/[id]-old.ts` is 38 KB of superseded purchase-return logic that mutates stock (`:530`, `:1008`) and ledgers. Under the pages router it is reachable at `/api/purchase-returns/[id]-old`. Delete it.

### F-07 · Timezone-shifted dates · **Medium** · [C]

`lib/date-utils.ts` documents that `.toISOString().split('T')[0]` is wrong and must not be used — and 21 sites still use it, including the default invoice date on the sale form (`pages/sale/create.tsx:246`). In IST (UTC+5:30) any document created between 00:00 and 05:29 local is dated **the previous day**.

### F-28 · Sales are unsaveable for customers without a usable state code · **Critical** · [C]

`pages/sale/create.tsx` decides intra-state vs inter-state **twice, differently**:

| | Line | Expression | Null/0 state code |
|---|---|---|---|
| **Computes** the split | `:166` | `customerStateCode === BUSINESS_STATE_CODE` | → **IGST** |
| **Validates** the split | `:827` | `!customerStateCode \|\| customerStateCode === BUSINESS_STATE_CODE` | → expects **CGST+SGST** |

So when `customerStateCode` is `0`, `null` or `undefined`, the form computes IGST and then
its own validator rejects it: *"Intra-state transactions should not have IGST."* The sale
**cannot be saved at all**. `getStateCodeFromName` (`:229`) returns `undefined` whenever the
customer's state name is missing from the states table, so this fires for walk-in / "Other"
customers and for any state added through Settings (see F-29).

**Fix: DONE (2026-09-20).** Added `lib/gst.ts` as the single resolver — `resolveSupplyType`,
`splitGst`, `calculateGstBreakdown`, `getBusinessStateCode`, `isValidGstStateCode`. Both the
calculation (`sale/create.tsx:170`) and the validator (`:821`) now call it, so they cannot
diverge again. The three cases are now decided deliberately:

| Customer state | Treatment | Basis |
|---|---|---|
| none recorded (walk-in / "Other") | **intra-state**, CGST+SGST | counter sale, no movement of goods — s.10(1)(c) |
| recorded, valid code (01-38) | same code -> intra-state; different -> inter-state | s.10(1)(b) |
| recorded, code 0 or invalid | **neither — blocks with a config error** | guessing would mis-charge tax |

That last row is the important one: code `0` is not "unknown location", it is a state whose
GST code was never configured (F-29). Defaulting it to intra-state would charge CGST+SGST on
a genuine inter-state sale and understate IGST. The form now says *"X has no GST state code
configured. Set it under Settings > States before billing to this state."*

Verified against six cases including Ladakh (38), an invalid code, and the walk-in path.
Salex needs no change — it is tax-free and has no state logic at all.

### F-29 · `states.code` is hardcoded to 0 and can never be set · **High** · [C]

`pages/api/states/index.ts:110` creates every state with `code: 0`, commented *"can be
updated later if needed"* — but `pages/api/states/[id].ts` has no `code` handling in its
PUT, so there is no later. `states.code` is the **GST state code**: it is the entire basis
for the CGST+SGST vs IGST decision. Every state created through Settings therefore carries
code `0`, never matches the business state code, and pushes its customers down the
inter-state path — while simultaneously triggering F-28 and making the sale unsaveable.

**Fix: DONE (2026-09-20).** `code` is now required on create and accepted on update, both
validated through `isValidGstStateCode()` from `lib/gst.ts` (1-38), with a uniqueness check
so two states cannot share a code. The settings page gained a **GST State Code** field
explaining what it controls; in edit mode a stored `0` renders as empty so it reads as
something to fill in rather than a real value.

**Backfill turned out to be unnecessary.** All 37 existing states already carry valid codes
(1-38), none are 0, and there are no duplicates — so this was a latent bug affecting only
newly-created states, not existing data. Worth recording, because the severity reads higher
than the actual production impact was.

### F-30 · The business's own state code is hardcoded in a React component · **High** · [C]

`pages/sale/create.tsx:24` — `const BUSINESS_STATE_CODE = 9; // Uttar Pradesh`. It is not
read from Settings, and `business_details` has **no state or state_code column at all**
(`schema.prisma:323-336`), so it cannot be configured.

**Fix: PARTIAL (2026-09-20).** `getBusinessStateCode(gstin)` in `lib/gst.ts` derives it from
the GSTIN's first two digits, so it can never drift from the GSTIN. `sale/create.tsx` now
calls it, falling back to `9` because the page does not yet fetch `business_details`.
**Remaining:** fetch business details on the sale/salex pages (or expose the code through a
hook) and drop the fallback.

### F-31 · A 0% GST rate cannot be created · **Medium** · [C]

`pages/api/gst-rates/index.ts:103` guards with `if (!description || !rate || !hsn_code)`.
`rate: 0` is falsy, so creating a 0% / exempt rate is rejected as missing. The **update**
handler in the same file got this right at `:171` (`rate === undefined`) — create and
update drifted apart inside a single file.

---

## 4a. Statutory reference (India GST)

Checked 2026-09-20 against current rules, because several findings turn on what the law
actually requires rather than on internal consistency. Sources listed in §11.

### What the app already gets right

- **Place of supply is the bill-to party**, not ship-to (IGST Act s.10(1)(b)). In a
  bill-to/ship-to transaction the tax follows the billing state even when goods are
  delivered to a third state; ship-to is recorded as the delivery address only. The app
  drives tax from `billing_state_code` — **correct**. Do not "fix" this to use shipping.
- **Invoice numbers reset per financial year** (CGST Rule 46(b)): a consecutive serial,
  unique *within a financial year*, max 16 characters. The server counter's per-FY design
  is statutorily right. Re-using a number in a later FY is permitted, so the UI's
  global-max scheme is also compliant — the bug in F-16 is the *conflict* between the
  two, not either one alone.
- **GST rate edits are not retroactive** — each invoice line snapshots `gst_percentage`.

### Where the app does not meet the rules

- **Rounding (CGST s.170 + Rule 51).** Tax must be rounded to the nearest rupee, on each
  component separately (CGST, SGST, IGST), at invoice level. The app never rounds. See F-34.
- **Credit-note deadline (CGST s.34(2)).** A credit note carrying a GST adjustment must be
  declared by **30 November following the end of the FY of the original supply** (or the
  annual return date, whichever is earlier). After that it can only be a *commercial*
  credit note — no tax reversal. The app applies no time limit. See F-35.
- **Credit-note contents (Rule 53).** A GST credit note must show the tax amount. Sale
  returns cannot, because `sale_return_items` has no tax breakdown — this is why F-19 is a
  compliance defect and not just a schema inconsistency. See F-36.
- **Duplicate invoice numbers (Rule 46(b)) — raises the priority of F-13.** The race in
  `getNextInvoiceNumber` can emit the same number twice inside one FY, which is a breach of
  the uniqueness requirement, not merely an internal inconsistency.

### Operational check for the owner (not a code defect)

GST 2.0 took effect **22 September 2025**: the 12% and 28% slabs were withdrawn, leaving
0 / 5 / 18 / 40. `gst_tax_rate` rows are user-maintained, so any products still pointing at
a 12% or 28% row will keep billing at an obsolete rate. Worth a one-off data check.

### F-34 · GST is never rounded, and three layers disagree on the number · **High** · [C]

s.170 and Rule 51 require tax rounded to the nearest rupee, **per component**, per invoice.
The app rounds nowhere on write: `calculateGSTBreakdown` (`sale/create.tsx:166-182`) does a
raw `taxAmount / 2`, and `pages/api/sales/index.ts` stores whatever it is handed.

The result is that the same invoice shows three different numbers:

| Layer | Treatment | `1234.5678` shows as |
|---|---|---|
| Entry grid | `Math.round(...)` in the JSX (`sale/create.tsx:1693`, `:1736`, `:2220`) | `1235` |
| Database / ledger | stored raw | `1234.5678` |
| View page | `toLocaleString('en-IN')`, 3 decimals by default (`sale/view/[id].tsx:301`) | `1,234.568` |

So the printed invoice, the stored total and the ledger entry disagree by up to a rupee per
line, and the error compounds into the ledger balances tracked in F-02/F-03. Rounding only
in JSX also means the displayed line totals need not sum to the displayed invoice total.

**Fix:** round on write, server-side, per component, once — at the same point F-04 moves
tax recomputation to the server. Then display raw stored values everywhere.

### F-35 · No credit-note time limit · **High** · [C]

s.34(2): a credit note may carry a GST adjustment only if declared by 30 November following
the FY of the **original supply**. After that the supplier's output tax stands and the note
is commercial-only. `pages/api/sale-returns/index.ts` applies no date check and always
reverses tax, so a return booked against an old invoice silently claims a tax adjustment
that is not available.

**Fix:** compare the return date against the original invoice's FY end + 30 November;
past it, either block the return or mark it commercial-only and skip the tax reversal.
Needs a product decision — see §10.

### F-36 · Sale returns cannot produce a compliant credit note · **High** · [C]

Rule 53 requires a credit note to show the tax charged. `sale_return_items` carries only
`tax_amount` with no CGST/SGST/IGST split (`schema.prisma:730-747`), while its purchase
counterpart `purchase_return_items` does carry all three (`:787-807`). The mirrored pair
diverged, and the sale side landed on the non-compliant version.

**Fix:** add `cgst`/`sgst`/`igst` to `sale_return_items` and `salex_return_items`, and
backfill from the parent invoice line's split.

---

## 5. Phase plan

Difficulty is scored on blast radius and how much state a change touches, not on line count. Do them in order.

### Phase 1 — Foundations · *Difficulty 2/5* · start here

Not glamorous, but everything downstream depends on it, and the changes are small and mechanical.

- [x] F-01 (code) — unified via `lib/financial-year.ts`; 11 sites converted; typecheck clean
- [ ] F-01 (data) — repair script for rows already stamped with calendar years *(blocked: §10 + a populated DB)*
- [ ] F-01 (guard) — lint rule banning local FY math so it cannot regress
- [ ] F-06 — delete `[id]-old.ts`
- [ ] F-07 — replace the 21 `toISOString().split` sites with the `date-utils` helpers
- [ ] Get a working database + seed data (§7) — blocks all verification from here on *(Hostinger test DB exists and is empty; credentials being rotated)*
- [x] F-25 — `.env.test` untracked and added to `.gitignore`
- [ ] Strip or gate the 246 `console.log` calls; the two unconditional DEBUG queries in `pages/api/products/optimized.ts:217-226` run on every request

### Phase 2 — Settings · *Difficulty 1/5*

Small surface, no money math, but high blast radius: FY and GST rates feed everything.

- [ ] `financial-years` — switching FY mid-year. Validation at `:330-341` blocks setting a
      past FY as current; confirm that is intended for year-end close *(see §10 Q2)*
- [x] `gst-rates` — **not retroactive**, correct: documents snapshot `gst_percentage` on each
      line, so editing a rate only affects future documents. Found F-31 and F-33
- [x] `states` — **F-29 fixed**. Note `States.code` still has no unique constraint in the
      schema (`schema.prisma:37-44`); enforced in the API for now, worth a migration
- [x] Tax determination — **F-28, F-30**. This was the big one in Settings: a chain from
      `states.code = 0` through a hardcoded business state code to a form that cannot save
- [ ] `business-details`, `bank-details` — single-row upsert semantics; note
      `business_details` has no state/state_code column (see F-30)
- [x] `warehouse-racks` — solid handler overall; F-32 only
- [ ] `warehouse`, `staff`, `mechanics`, `users`, `return-reasons`
- [ ] `inactive-products` — confirm deactivation does not orphan open documents

### Phase 3 — Products · *Difficulty 2/5*

- [ ] **SQL injection + broken dialect** — `pages/api/products/optimized.ts:252` builds `p.${field} ILIKE '%${value}%'` from unescaped user search input. `ILIKE` is PostgreSQL syntax and **does not exist in MySQL**, so this whole branch throws a syntax error whenever a search is combined with a low-stock or car-model filter. Severity **High** [C]. Rewrite with parameterized `$queryRaw` and `LIKE`
- [ ] Operator precedence at `:264` — `AND a OR b OR c OR d` with no parentheses returns wrong rows [C]
- [ ] `product.stock` is nullable; `stock < qty` comparisons silently pass when `stock` is `NULL` (`pages/api/sales/index.ts:183`). Backfill to `0` and make it `NOT NULL`
- [ ] `car_model_ids` is a comma-delimited string — unindexable, matched with `LIKE`. Normalize to a join table (larger change; schedule separately)
- [ ] Product create/edit round-trip; `part_no` uniqueness; barcode lookup

### Phase 4 — Purchase · *Difficulty 4/5*

First phase that moves stock and money. Expect the item-join problem (§3) to dominate.

- [ ] **Duplicate product lines lose stock** — `pages/api/purchases/index.ts:675-696` builds `stock = CASE id WHEN 5 THEN stock+2 WHEN 5 THEN stock+3 END`. SQL `CASE` takes the **first** match, so the second line's quantity is discarded. Severity **High** [C]. Aggregate quantities by `product_id` before building the statement
- [ ] **Item lookups ignore `fy`** — `pages/api/purchases/[id].ts:31`, `:516`, `:647`. Combined with the per-FY counter, two purchases can share `invoice_no` and merge their items. Severity **Critical** [C]. Add `fy` to every purchase-item query, then migrate `purchase_items` to reference `purchase.id` and add a real FK
- [ ] **Invoice-number race** — `getNextInvoiceNumber` reads `MAX+1` in its own transaction (`lib/invoice-counter.ts:19`), the duplicate check is a separate non-atomic read (`pages/api/purchases/index.ts:429`), and there is no unique constraint. Two concurrent creates get the same number. Severity **High** [C]. Use a counter table with an atomic increment, plus a `UNIQUE(fy, invoice_no)` index
- [ ] **Two numbering schemes** — the server counter is per-FY (`MAX WHERE fy = currentFy`), but the UI prefills from `/api/purchases/last-invoice`, a **global** max with no FY filter. Pick one [C]
- [ ] `Promise.all` over a single interactive `tx` (`pages/api/purchases/index.ts:667`) — concurrent queries on one transaction client; serialize them
- [ ] Purchase edit: does it reverse the old stock effect before applying the new one?
- [ ] Purchase delete: stock reversal, ledger reversal, allocation cleanup
- [ ] Vendor advance-balance allocation (`:706-760`) — the balance is read and spent in separate steps with no lock

### Phase 5 — Sale & Salex · *Difficulty 4/5*

Everything in Phase 5, twice, plus tax. Audit Sale and Salex **side by side** — they are copies that have drifted.

- [ ] **Discounts are silently dropped on create** — `pages/sale/create.tsx` computes and sends item discounts (`:746`, `:1032`, `:1060-1061`), but `pages/api/sales/index.ts` never reads `discount` from the body, never stores `Invoiceitems.discount`, and computes `itemsTotal` as `qty * rate` with no discount subtracted (`:117`). The update path *does* handle it (`pages/api/sales/[id].ts:231`) and the view page reads it back (`:340`) — so a discounted sale is overcharged on create and the discount reappears only after an edit. Severity **Critical** [C]
- [ ] F-04 — server-side tax recomputation, and server-side CGST/SGST vs IGST from state code
- [ ] **Oversell on duplicate lines** — `pages/api/sales/index.ts:183` validates each line against the full stock independently, so two lines of the same product each pass while their sum exceeds stock [C]
- [ ] `invoice_items.invoice_no` holds `sale.id` — document it, then align it with purchase (§3) so reports can be written once instead of twice
- [ ] Sale edit stock arithmetic — `pages/api/sales/[id].ts:624`, `:687`, `:717` apply three separate adjustments; verify the net effect over an edit that changes a quantity, removes a line, and adds a line in one submit
- [ ] Payment status vs. allocations — `payment_status` is a column *and* derivable from `customer_payment_allocations`; confirm they cannot disagree
- [ ] Multi-step form: double-submit guard, edit-mode rehydration, cache invalidation after mutation, the `sessionStorage` draft lifecycle

### Phase 6 — Returns · *Difficulty 5/5*

Four return paths (sale, salex, purchase-by-bill, purchase-by-vendor) that each touch stock, ledger, credit/debit notes and refunds.

- [ ] **No over-return validation on any write path** — `pages/api/sale-returns/index.ts` never checks `return_qty` against `original_qty - already_returned`, and never checks that `invoice_item_id` belongs to the selected invoice. Same for `customer-return.ts` and `vendor-return.ts`. You can return more than you sold, which inflates stock and issues a bogus credit note. Severity **Critical** [C]
- [ ] The sale-return UI's own "available qty" hint is wrong — `sale-returns/[id].ts:255` uses `originalItem.qty` without subtracting prior returns, while the purchase-return twin does subtract (`purchase-returns/[id].ts:234-235`) [C]
- [ ] Schema inconsistency: `sale_returns.status` is a `String`, `purchase_returns.status` is an `Int`. `purchase_return_items` carries cgst/sgst/igst; `sale_return_items` only carries `tax_amount` — so sale returns cannot produce a GST-compliant credit note [C]
- [ ] Return edit and cancel — stock reversal at `sale-returns/[id].ts:957`, `:1024`
- [ ] `updateDebitNoteEntry` (`lib/ledger-service.ts:273-282`) writes via the **global `prisma`**, not the caller's `tx` — so it survives a rollback of the enclosing transaction. Severity **High** [C]
- [ ] Refund allocation and partial refunds
- [ ] Full round-trip: sale → partial return → edit return → second return → cancel, asserting stock and ledger after every step

---

### Phase 7 — Reports · *Difficulty 2/5* · do last

Read-only and safe to poke, but it runs **last**, not first: with an empty database every
report renders zero rows and looks fine. The product journey in Phases 3-6 is what
generates the dataset that makes reports auditable — by then you know what each report
*should* say, which is the only way to tell a broken report from a broken document.
Treat a failing report as a symptom until the journey proves otherwise.

- [ ] F-03 — ledger pagination and opening balance
- [ ] Decide the ledger source of truth: wire up the orphaned date-sorted `*-ledger-details` endpoints, or fix `*-ledger-accounting`. Do not keep both
- [ ] `openingclosing.tsx` is a 5-line `<Underworks />` stub — decide: build or remove
- [ ] Every report: date-range boundary (does it include the last day?), FY filter correctness post-F-01, totals vs. line sums, export matches screen
- [ ] Cross-check: sales report total vs. sum of invoices vs. customer ledger debits

## 6. Deferred (not part of this audit)

Worth doing, too large to fold in:

- `stock_movements` append-only table so stock is auditable rather than a mutable integer
- Real foreign keys from item tables to header primary keys
- Normalizing `product.car_model_ids` out of a delimited string
- 297 `: any` annotations in `pages/api` and `lib` — TypeScript currently compiles clean (`npx tsc --noEmit` → 0 errors), but it is checking very little in the money paths

---

## 7. Verification setup

**This is done as of 2026-09-20.** `.env` has a working `DATABASE_URL` and
`NEXTAUTH_SECRET`, the schema is in place, 5 users exist, and `npm run dev` runs. See §0.

Before re-running anything destructive:

```bash
node scripts/db-backup.js          # dump first
node scripts/db-backup-verify.js   # confirm the dump is complete
node scripts/clear-all-data.js     # dry run
node scripts/clear-all-data.js --apply
```

There is already an integration-test pattern to copy:
`tests/batch-1-purchase-creation.test.js` calls the API over HTTP and then asserts against
the database with Prisma — exactly the right shape for catching the bugs above, because
most of them are invisible from the API response and only show up in `product.stock` and
`vendor_ledger`. Three things to fix before reusing it:

- it hardcodes `TEST_VENDOR_ID` / `TEST_PRODUCT_ID` to `1`, and **the wipe deleted all
  vendors**, so it needs to create its own fixtures
- it sends no session cookie, so `middleware.ts` will redirect it — needs an
  authenticated fetch helper
- `.env.test` still holds `CURRENT_FY=2024`, which is neither a `financial_year.id` nor
  the current year — the same confusion as F-01, in the test config

**Reconciliation assertions worth writing once and reusing everywhere:**

- `product.stock` == `opening_stock` + purchases − sales − salex + sale returns − purchase returns
- vendor ledger closing balance == purchases − debit notes − payments + refunds
- customer ledger closing balance == sales + salex − credit notes − receipts + refunds
- every `invoice.total` == sum of its items + freight + P&F + tax − discount

Run all four after every round-trip test. They catch the whole class of bugs in §4.

---

## 8. Findings register

Severity: **Critical** = wrong money or lost data · **High** = wrong results or a crash · **Medium** = wrong behaviour, recoverable · **Low** = hygiene.

Status: `open` · `in-progress` · `fixed` · `by design` · `wontfix` · `invalid`

`by design` means the behaviour was examined, understood and confirmed correct by the
owner. It is not a deferred fix and should not be revisited as one.

| ID | Sev | Conf | Module | Finding | Evidence | Status |
|---|---|---|---|---|---|---|
| F-01 | Critical | [C] | Cross | `fy` written as calendar year by 9 endpoints, inherited from the allocated doc by 2 more; it is an FK to `financial_year.id` | fixed in `lib/financial-year.ts` | **fixed** — 26 corrupt rows removed by wipe |
| F-02 | Critical | [C] | Ledger | Running balance is insertion-ordered, displayed date-ordered | `lib/ledger-service.ts:85,289` | open |
| F-08 | Critical | [C] | Purchase | Purchase items joined by non-unique `invoice_no` with no `fy` filter | `purchases/[id].ts:31,516,647` | open |
| F-09 | Critical | [C] | Sale | Discounts dropped on create; total overstated | `sales/index.ts:117` vs `sale/create.tsx:1060` | open |
| F-10 | Critical | [C] | Return | No over-return validation on any write path | `sale-returns/index.ts:488-510` | open |
| F-03 | High | [C] | Reports | Ledger balance restarts at 0 per page / per date filter | `vendor-ledger-accounting.ts:65` | open |
| F-04 | High | [C] | Sale | Client-supplied tax and totals trusted | `sales/index.ts:118,209` | open |
| F-11 | High | [C] | Product | SQL injection + Postgres `ILIKE` on a MySQL database — **broke the product list**: any search combined with a low-stock or car-model filter returned `Raw query failed` (500) | `products/optimized.ts:252` | **fixed** — `LIKE` + `?` parameters; verified live |
| F-12 | High | [C] | Purchase | Duplicate product lines lose stock (`CASE` takes first match) | `purchases/index.ts:675-696` | open |
| F-13 | High | [C] | Purchase | Invoice-number race: non-atomic `MAX+1`, no unique constraint | `lib/invoice-counter.ts:19` | open |
| F-14 | High | [C] | Sale | Oversell: per-line stock check, not aggregate | `sales/index.ts:183` | open |
| F-15 | High | [C] | Return | `updateDebitNoteEntry` escapes the caller's transaction | `lib/ledger-service.ts:273` | open |
| F-28 | Critical | [C] | Settings/Sale | Sale unsaveable when state code is 0/null — compute and validate disagree | fixed in `lib/gst.ts`; 6 cases verified | **fixed** |
| F-29 | High | [C] | Settings | `states.code` hardcoded to 0 on create, no update path; it is the GST state code | fixed in `states/index.ts` + `[id].ts` + settings UI | **fixed** (no backfill needed — all 37 rows already valid) |
| F-30 | High | [C] | Settings/Sale | Business state code hardcoded in a component; `business_details` has no state column | `getBusinessStateCode()` added | **fixed** — `hooks/useBusinessDetails.ts` added and `sale/create.tsx` now reads the real GSTIN. See F-53 |
| F-31 | Low | [C] | Settings | 0% GST rate falsy guard (`!rate`) on create; create/update drifted in one file. The settings form posts `rate` as the string `"0"`, which is truthy, so only non-browser callers hit it. Downgraded Medium→Low | `gst-rates/index.ts:103` vs `:171` | **fixed** — matches handlePut's form, plus a NaN/negative check; verified: numeric `0` → 201, `"abc"` → 400 |
| F-32 | Medium | [C] | Settings | Racks PUT resolved the rack by id without scoping to the URL's warehouse, so `PUT /warehouses/1/racks` with `{id: 5}` edited a rack owned by warehouse 4 — the URL segment was decorative. `handleDelete` in the same file already scoped correctly. Raised Low→Medium: it is a cross-tenant write, not cosmetic | `warehouses/[warehouseId]/racks.ts:185` | **fixed** — verified: cross-warehouse edit → 404, same-warehouse edit → 200 |
| F-33 | Low | [C] | Settings | GST rates are mutated in place — no rate history for compliance | `gst-rates/index.ts:143` | open |
| F-34 | High | [C] | Sale | GST never rounded; entry grid, DB and view page show three different numbers | `sale/create.tsx:166`, `:1693`, `sale/view/[id].tsx:301` | open |
| F-35 | High | [C] | Return | No credit-note time limit (s.34(2), 30 Nov deadline) | `sale-returns/index.ts` | open |
| F-36 | High | [C] | Return | `sale_return_items` has no tax split — cannot issue a compliant credit note (Rule 53) | `schema.prisma:730-747` | open |
| F-37 | High | [C] | Ops | FY never rolled over — app stamped documents into a year closed since 2026-03-31 | `financial_year` had no 2026-2027 row | **fixed** — FY id=4 created and set current |
| F-38 | High | [C] | Auth | `PrismaAdapter` configured but Account/Session/VerificationToken models do not exist -> NextAuth failed adapter validation at init, `error=Configuration` on every auth call | `pages/api/auth/[...nextauth].ts` | **fixed** — adapter removed |
| F-42 | Low | [C] | Ops | `NEXTAUTH_SECRET` missing from `.env`; `NODE_ENV` set manually (Next.js owns it) | `.env` | **fixed** |
| F-39 | Medium | [C] | Ops | `gst_tax_rate` is empty — no tax rates configured, so no invoice can carry tax | `gst_tax_rate` 0 rows | **fixed** — 4 slab rows seeded (0/5/18/40) |
| F-40 | Medium | [C] | Product | `opening_stock` set on only 135 of 602 products — stock reconciliation had no valid baseline | reset at wipe | **fixed** |
| F-41 | Low | [C] | Ops | Existing clear scripts miss 6 tables incl. `note_counters`, so note numbering never restarts | `scripts/clear-*.js` | **fixed** in `clear-all-data.js` |
| F-43 | High | [C] | Product | A product's GST rate is resolved two different ways: the list endpoint follows the `gst_rate_id` FK, the detail endpoint matches `product.hsn` against `gst_tax_rate.hsn_code`. The two disagree, and with `hsn` NULL on all 602 products the detail path returns 0% | `products/index.ts:319` vs `products/[id].ts:170` | open |
| F-45 | Critical | [C] | Reports | Customer outstanding report is **dead** — `where` filters `customer_details.balance`, `customer` and `name`, none of which exist on that model (the column is `account_balance`). Every request throws `PrismaClientValidationError`. Also uses `mode: 'insensitive'`, unsupported on MySQL | `reports/customer-outstanding.ts:29,51,54` | **fixed** — real columns, MySQL-safe; verified live 200 (empty: no customers seeded) |
| F-46 | High | [C] | Reports | Vendor outstanding report lists ledger **rows**, not vendors — no grouping, so it returns every historical row whose stored running balance was > 0. A settled vendor still appears, once per such row, and `total` is a row count | `reports/vendor-outstanding.ts:81` | open |
| F-48 | Critical | [C] | Reports | Minimum-stock report was **dead** — 500 on every call. `sortBy` defaulted to `current_stock`, the response field name rather than the column, and the page never sends `sortBy`. Also referenced `category_id`, `model_id`, `part` and `mode: 'insensitive'`, none of which exist on `product`/MySQL | `reports/minimum-stock.ts:17,25-55` | **fixed** — column map + Prisma-side car-model matching; verified live |
| F-49 | Medium | [C] | Settings | **No settings page restored its list state.** Zero use of `router.query`, `useSearchParams` or `sessionStorage`, so search, sort and page reset on every refresh and every return from an edit, and a filtered list could not be linked | all of `pages/settings/*.tsx` | **mostly fixed** — `hooks/useUrlState.ts`, applied to search + sort on all 10 list pages. **Page number deliberately not synced** — see note below |
| F-50 | Medium | [C] | Settings | `return_reasons` has a **GET-only API and no settings page** — reasons are consumed by the sale and purchase return flows but can only be changed by running `scripts/seed_return_reasons.js` against the database | `pages/api/return-reasons/` (no `pages/settings` counterpart) | open — owner's call whether this is wanted |
| F-51 | High | [C] | Settings | Business GSTIN was never validated on save. Its first two digits are the supplier state code that picks CGST+SGST vs IGST on every document, so a typo silently mistaxes everything the business issues | `business-details/index.ts:57` | **fixed** — `isValidGstin()` in `lib/gst.ts`, enforced on the API and the page; verified: bad checksum length → 400, state code 99 → 400 |
| F-52 | Medium | [C] | Settings | `business_details` is a singleton the whole app reads with `findFirst()`, but PUT created a **new row** whenever `id` was absent, and GET had no `orderBy` — so a second row made the app answer inconsistently between calls | `business-details/index.ts:22,97` | **fixed** — id-less PUT updates the existing row; GET ordered. Verified: id-less PUT kept 1 row |
| F-53 | High | [C] | Settings/Sale | **Settings did not propagate.** `sale/create.tsx` took the supplier state code from `process.env.NEXT_PUBLIC_BUSINESS_GSTIN`, which is set in no `.env` file, so it always fell through to a hardcoded `9`. Correct only by luck — the real GSTIN starts `09`. Changing the GSTIN in Settings changed nothing on the page that depends on it most | `sale/create.tsx:27` | **fixed** — reads `useBusinessDetails()`; closes F-30 |
| F-54 | Low | [C] | Settings | Phone/landline validation checked `.length !== 10`, not digits, so `abcdefghij` was a valid phone number. The page also checked the untrimmed value while the API trimmed, so a 10-character value with a trailing space passed the form and was rejected by the server | `business-details/index.ts:63`, `businessdetails.tsx:82` | **fixed** — `/^[0-9]{10}$/` on both sides |
| F-55 | Medium | [C] | Settings | Bank IFSC was never validated. The live table already carries a bad one: row 2's IFSC is `5124142`, which is not an IFSC in any form | `bank-details/index.ts:128,219` | **fixed** — `lib/bank.ts`, enforced on API and page, stored uppercased. Verified: bad shapes → 400, lowercase normalised, omitted → null |
| F-56 | — | [C] | Settings | `bank_details` has no DELETE route and no `status` column, so a bank account can be added but never removed or deactivated | `pages/api/bank-details/` | **by design** — working as expected, confirmed by the owner 2026-09-20. Not a defect; do not "fix" it |
| F-57 | — | [C] | Settings | `bank_details` is write-only: no invoice, PDF, export or screen reads it. The only reference in the app is the nav link | no consumers found | **by design** — working as expected, confirmed by the owner 2026-09-20. Not a defect; do not "fix" it |
| F-58 | High | [C] | Cross | **Every dropdown in the app showed only the first 50 rows.** `dropdown=true` filtered to Active but still paginated, and the hooks passed no `limit`, so past 50 active records the customer, vendor, staff or mechanic simply was not in the list - no error, no "showing 50 of 300", just absent | `customers/index.ts:127`, `vendors/index.ts:60`, `staff/index.ts:60`, `mechanics/index.ts:60` | **fixed** — `dropdown=true` now skips pagination. Verified: `limit=2` returns 2 normally, all 5 in dropdown mode |
| F-59 | Low | [C] | Settings | Staff and mechanic phone/email never format-validated (`!name \|\| !phone` only), so `abcdefghij` was a valid phone. Left business-details enforcing a rule its twins did not | `staff/index.ts:99`, `mechanics/index.ts:100` | **fixed** — `lib/validators.ts` shared by both APIs and both pages; verified 400s |
| F-60 | Critical | [C] | Settings/Auth | **A user created through the Users page could never log in.** `users/index.ts:243` stored an unsalted SHA-256 digest — the comment `// Hash password - in a real app, you'd use bcrypt` was still in the file — while `authorize()` verifies with `bcrypt.compare()`, which rejects anything that is not a bcrypt hash. The correct helpers already existed in `lib/user-management.ts` and were simply not called | `users/index.ts:243` vs `[...nextauth].ts:50` | **fixed** — `lib/password.ts`; **verified end to end**: created a user through the API and signed in as them, which previously returned `CredentialsSignin` |
| F-61 | High | [C] | Settings | **No way to change any password anywhere in the app.** The settings form hides the password field when editing (`{!editingUser && ...}`), and `handleUpdate` did not even destructure `password`, so a password sent to it was silently dropped | `users/index.ts` handleUpdate, `users.tsx:356` | **fixed** — field shown on edit as optional, update hashes it when supplied. Verified: change works, blank is a no-op, under 6 chars → 400 |
| F-47 | High | [C] | Reports | Four different definitions of "what this party owes" coexist: party counters (`total_allocated - total_paid + ...`), the stored `*_ledger.balance` of the last row by id, `getAllOutstanding()`'s per-vendor max-id row, and `SUM(debit) - SUM(credit)` recomputed by the accounting reports. The vendor and customer reports do not even read the same table | `customer-outstanding.ts:126` vs `vendor-outstanding.ts:81` vs `ledger-service.ts:89,145` | open — decide the source of truth in Phase 7 |
| F-05 | Medium | [C] | Cross | No role authorization despite documented roles | `grep role pages/api` → none | open |
| F-06 | Medium | [C] | Purchase | `[id]-old.ts` is a reachable route mutating stock | `purchase-returns/[id]-old.ts:530` | **deferred → G-04** — kept deliberately as the reference the new `[id].ts` was written against. Owner's call 2026-09-20: delete during cleanup, not now |
| F-07 | Medium | [C] | Cross | 21 timezone-shifting `toISOString().split` sites | `sale/create.tsx:246` | open |
| F-25 | High | [C] | Security | `.env.test` tracked in a public repo with live DB credentials | `.gitignore` had no `.env.test` rule | **fixed** — untracked + ignored; creds being rotated |
| F-26 | Medium | [C] | Security | Seeded default passwords (`admin123`, `manager123`, …) | `scripts/create-user.js:60-64`, `lib/user-management.ts:168` | open |
| F-27 | Low | [C] | Cross | `tsconfig.tsbuildinfo` (a build artifact) is tracked | repo root | open |
| F-16 | Medium | [C] | Purchase | Two invoice-numbering schemes: per-FY server vs global UI | `last-invoice.ts:14` | open |
| F-17 | Medium | [C] | Product | Missing parentheses in car-model SQL disjunction — the ORs escaped the AND chain, so the filter returned the whole catalogue | `products/optimized.ts:264` | **fixed** — verified: model filter now narrows 602 → 9 |
| F-18 | Medium | [C] | Return | `status` is `String` for sale returns, `Int` for purchase returns | `schema.prisma:710,758` | open |
| F-19 | Medium | [C] | Return | `sale_return_items` has no cgst/sgst/igst split | `schema.prisma:730-747` | open |
| F-20 | Medium | [C] | Reports | `*-ledger-details` endpoints orphaned; two ledger implementations disagree | no callers | open |
| F-21 | Medium | [V] | Purchase | `Promise.all` over one interactive `tx` | `purchases/index.ts:667` | open |
| F-22 | Low | [C] | Product | Two unconditional DEBUG queries per request | `products/optimized.ts:217-226` | **fixed** — removed |
| F-23 | Low | [C] | Reports | `openingclosing` is an `<Underworks />` stub | `reports/openingclosing.tsx` | open |
| F-24 | Low | [C] | Cross | 246 `console.log` calls in production paths | repo-wide | open |

---

## 9. Conventions

- New findings get the next `F-NN`, appended to the register, sorted by severity.
- When a finding is fixed, set status `fixed` and add the test path in the Evidence cell.
- If a finding turns out to be wrong, mark it `invalid` and say why — **do not delete it**, otherwise the next person re-discovers it.
- A phase is closed only when its checklist is complete and §7's four reconciliation assertions pass for that module.

---

## 10. Open questions for the product owner

Answers change the work; recorded here rather than assumed.

1. ~~**`fy` semantics**~~ — **ANSWERED** by the live database: `settings.currentfy` was 3 and
   `financial_year` id=3 is `2025-2026`, confirming `fy` holds a `financial_year.id`. The
   migration is moot now the data is wiped.
2. **Backdated documents.** Should a document dated outside the open FY be rejected,
   warned about, or stamped with the FY its date falls in? Today it is silently stamped
   with the current FY. `isWithinCurrentFinancialYear()` is ready if enforcement is wanted.
3. **Purchase discounts.** Sale and salex support per-item discounts; purchase has no
   discount concept at all. Intentional?
4. **Over-return policy.** Should a return ever be allowed to exceed the original
   quantity (e.g. a goodwill return)? Assuming no — validation will be strict.
5. **Credit notes past the 30 November deadline (F-35).** Block the return outright, or
   allow it as a commercial credit note with no tax reversal? The second is more flexible
   and matches the law; it needs a `is_commercial` flag on `sale_returns`.
6. ~~**Obsolete GST slabs**~~ — **ANSWERED**: `gst_tax_rate` is empty, so there is nothing
   obsolete to clean up. It does need seeding at 0/5/18/40 before tax can be tested (F-39).
7. **Ledger source of truth.** Two implementations exist (§3). Recommendation: keep the
   stored tables for audit, compute the running balance at read time, and retire the
   orphaned `*-ledger-details` endpoints.

---

---

## 11. Sources

India GST rules checked 2026-09-20:

- Place of supply, bill-to vs ship-to — [taxreply](https://taxreply.com/gst/How_to_Determine_Place_of_Supply_of_Goods_on_BILL_TO_and_SHIP_TO_transactions-349.html), [Tally](https://tallysolutions.com/gst/place-of-supply-under-gst/)
- GST state codes 01-38 — [ClearTax](https://cleartax.in/s/gst-state-code-jurisdiction), [Tally](https://tallysolutions.com/gst/gst-state-code-list/)
- Rule 46 invoice numbering — [CBIC Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html), [taxreply](https://taxreply.com/gst/Is_it_mandatory_to_restart_GST_Invoice_Number_from_1_in_every_Financial_Year_-1535.html)
- Section 34 credit notes and the 30 November deadline — [CBIC s.34](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html), [TaxGuru](https://taxguru.in/goods-and-service-tax/section-34-understanding-credit-notes-gst.html)
- Section 170 rounding — [ClearTax](https://cleartax.in/s/rounding-off-tax-section-170-gst), [Masters India](https://www.mastersindia.co/blog/rounding-off-tax-under-gst/)
- GST 2.0 rate slabs effective 22 Sep 2025 — [ClearTax](https://cleartax.in/s/gst-rates), [Bajaj Finserv](https://www.bajajfinserv.in/gst-rates-in-india)

---

## 12. Tooling added during the audit

| Script | Purpose |
|---|---|
| `scripts/db-backup.js` | `mysqldump` replacement (not on PATH here). DROP/CREATE + batched INSERTs, FK checks off, transactional. `--data-only`, `--out <path>` |
| `scripts/db-backup-verify.js` | Parses a dump back and checks it against the live DB: CREATE per table, INSERT tuple counts, structure, and that sampled values survived escaping |
| `scripts/clear-all-data.js` | Clears all transactional data, keeps master/config. Dry-run by default, `--apply`, `--keep-parties`. Covers the 6 tables the three existing `clear-*` scripts miss, and sets the stock baseline |

The three pre-existing `clear-test-data.js` / `clear-sale-data.js` / `clear-salex-data.js`
are untouched and still useful for clearing one side only.

### Library modules added

| Module | Why |
|---|---|
| `lib/financial-year.ts` | Single source of truth for FY resolution (F-01) |
| `lib/gst.ts` | Single source of truth for CGST/SGST vs IGST (F-28), state-code validation (F-29), business state code from GSTIN (F-30) |

---

---

## 9. Good to have

Engineering-quality work, **not defects**. None of this changes what the app computes,
so none of it is scheduled until every issue above is closed. Listed here so it stops
competing for attention with things that are actually broken.

Ordered roughly by payoff.

| # | Item | Why it matters |
|---|---|---|
| G-01 | **Use Prisma everywhere.** Raw `$queryRawUnsafe` string-building survives in the product endpoints and several scripts. Raw SQL is what let F-11 (injection), F-17 (missing parens) and the Postgres/MySQL `ILIKE` mismatch happen at all | Every raw query is a place the schema and the code can drift apart silently. Prisma would have refused all three at compile time |
| G-02 | **Collapse the duplicated pairs.** `transaction-handler` ↔ `customer-transaction-handler`, `ledger-service` ↔ `customer-ledger-service`, sale ↔ salex, and the two outstanding reports are 71-96% identical after normalising names | This is the audit's central thesis: the copies are not the bug, the **divergence between them** is. Every pair is two chances to fix something once and miss the twin |
| G-03 | **One place for shared types, and hooks that live where their name says.** Interfaces are redeclared per file (`LedgerEntryData`, product shapes, report rows). **Partly done:** `hooks/useStaff.ts` also exported `useMechanics` and `useCustomers`, so three unrelated pages imported `useCustomers` from a file named after staff - now split into `useStaff`/`useMechanics`/`useCustomers`. Still misplaced: `useCurrentFY` lives in `hooks/useCustomers.ts` | Scattered types let the API and the page disagree about a field's name or nullability without anything failing to compile. Misfiled hooks hide duplicates - the split is what exposed that the dropdowns were all truncating (F-58) |
| G-04 | **Follow Next.js conventions.** Dead routes left in `pages/api`, no shared API-handler wrapper, inconsistent method dispatch, data fetching patterns that vary page to page. **Carries F-06**: `purchase-returns/[id]-old.ts` is the reference copy the rewritten `[id].ts` was worked against and is still serving traffic. Delete it once the rewrite is settled, together with the orphaned `*-ledger-details` endpoints (F-20) | In `pages/`, a file **is** a public route, so a reference copy left in the tree is a live endpoint. Safe to defer only because nothing links to it - not because it is inert |
| G-05 | **Code cleanup.** 246 `console.log` calls in production paths (F-24), commented-out blocks, `tsconfig.tsbuildinfo` tracked (F-27), unused imports | Noise hides real signal. The debug queries removed in F-22 had been running on every product request |

**Do these last.** The one exception is when a fix in an earlier phase naturally lands in
the same file - taking the cleanup with it is cheaper than a second pass, and the diff is
already under review.

---

## 8. Phase 2 page-by-page log

One row per settings page. The checks are the same each time: **CRUD** works end to
end; **filters and sorting** work; **state survives a refresh**; and the values
**propagate** to the screens that consume them. The last one is the point of the phase -
a setting that cannot reach the rest of the app is not a working setting.

| Page | CRUD | Filter/sort | Refresh restore | Propagation | Findings |
|---|---|---|---|---|---|
| `businessdetails` | read + upsert, no delete (correct for a singleton) | n/a - single record | n/a - refetches on mount | **was broken** | F-51, F-52, F-53, F-54 - all fixed |
| `bankdetails` | create + update; no delete **by design** (F-56) | correct: sort fields whitelisted, search on real columns, pagination sound | fixed (F-49) | none **by design** - write-only (F-57) | F-55 fixed; F-56/F-57 are expected behaviour, not defects |
| `staffdetails` | full, and **soft delete done properly** - status → Inactive, never a row removal | correct: whitelisted sort, search on real columns | fixed (F-49) | correct - Active-only by default, so deactivated staff leave the dropdowns | F-58, F-59 - both fixed |
| `mechanics` | identical to staff, soft delete too | correct | fixed (F-49) | correct | F-58, F-59 - both fixed |
| `users` | create + update; status field doubles as deactivate | correct: whitelisted sort, email/phone validated, uniqueness gives 409 | fixed (F-49) | **was broken** - new accounts could not authenticate at all | F-60, F-61 - both fixed. F-26 deferred |
| `warehouse` | create + update, no delete; `includeInactive` + status covers deactivation | correct | fixed (F-49) | correct | none |
| `warehouse-racks` | full, delete correctly scoped to its warehouse | correct | fixed (F-49) | correct | F-32 (fixed earlier this session) |
| `financialyear` | create + update + set-current | correct | fixed (F-49) | correct - `settings.currentfy` is the single source, read by `lib/financial-year.ts` | **none** |
| `inactive-products` | reactivate via PUT to products | correct | fixed (F-49) | inherits F-43 | none of its own |

Two systemic ones found before opening a single page, and they apply to every row above:
**F-49** (no page restores its list state) and **F-50** (`return-reasons` has no page at
all). F-49 is one shared fix, not eleven, so it is better done once at the end of the
phase than patched page by page.

**Live data already violated the rule F-55 now enforces.** Bank row id=2 (`SBI`) holds
`5124142` in its IFSC column. That row can still be read and still appears in the list,
but it can no longer be **saved** from the settings form until someone supplies the real
IFSC - the API validates the field on update as well as create. That is the correct
behaviour and it is worth knowing before someone hits it.

### Where Phase 2 stands

Four of eleven settings pages are done: `businessdetails`, `bankdetails`, `staffdetails`,
`mechanics`. `states` and `gsttaxrate` were done in earlier sessions. Left: `users`,
`warehouse`, `warehouse-racks`, `financialyear`, `inactive-products`.

**F-49 (no page restores its list state) is the one item deliberately left open.** It is a
single shared fix across every list page rather than eleven separate ones, so it is
better done once, at the end of the phase, than patched page by page.

The pattern worth carrying forward: on these four pages the *endpoints* were mostly
sound - whitelisted sorts, real search columns, correct soft deletes. What was broken was
at the seams. A setting that never reaches the screen using it (F-53), a dropdown that
truncates silently (F-58), a validator on one page and not its twin (F-59). The audit's
thesis holds: the copies are fine, the divergence between them is the bug.

### Two corrections to earlier notes in this document

**The financial-year overlap guard exists.** An earlier pass recorded that
`financial-years` had no overlap check on create. It does, at `index.ts:203`, along with
a duplicate check returning 409 and a strict Apr 1 → Mar 31 shape. The earlier grep
window simply stopped short of it. No fix was needed and none was made.

**F-49 is fixed for search and sort, not for page number.** `hooks/useUrlState.ts` mirrors
a value in the URL query and is a drop-in for `useState`, so each page changed by one line
per value. Page number was left alone on purpose: it lives inside a `pagination` object
that is written from six or more call sites per page, so syncing it means rewriting all of
them across ten files - a large, risky edit for a value that resets to 1 on nearly every
other interaction anyway. Worth doing later, with the pagination state itself tidied up.

What is verified: all eleven settings pages render cleanly with and without query
parameters, and the whole project type-checks. What is **not** verified: the browser-level
round trip - typing a search, refreshing, and seeing it restored. That needs a real
browser, not an HTTP probe, because these lists are fetched client-side.

---

## 10. Journey → report map

> Phase 3 onward is logged in **`docs/JOURNEY_AUDIT.md`**, not here. This document keeps
> the phase plan, the statutory reference and the master findings register; that one holds
> the journey work. Finding IDs run in one sequence across both.


Built before Phase 3, deliberately shallow: enough to know **which reports should move
when the journey changes something**, so that during phases 3-6 we can swing past the
affected reports and see whether they moved. Not a reports audit - that is Phase 7.

Derived from what each endpoint actually queries, not from its name.

| Journey step | Reports that should reflect it | Page |
|---|---|---|
| **Product** created / stock changed | `minimum-stock` — **the only report that reads `product` at all** | `minimumstock` |
| **Purchase** created / edited | `bill-reference-purchase`, `vendor-ledger-accounting`, `vendor-outstanding`, `packing-forwarding`, `transport-cost`, `notes-mentioned`, `staff-sales` | `billreferencepurchase`, `vendor-ledger`, `vendor-reports`, `packing`, `transport`, `notes`, `staff` |
| **Sale / Salex** created / edited | `sales`, `salex-report`, `bill-reference-sale`, `commissions`, `mechanic-sales`, `staff-sales`, `customer-ledger-accounting`, `customer-outstanding`, `packing-forwarding`, `transport-cost`, `notes-mentioned` | `sale`, `salex`, `billreferencesale`, `commissions`, `mechanic`, `staff`, `customer-ledger`, `customer-reports`, `packing`, `transport`, `notes` |
| **Sale return** | `credit-notes`, `customer-ledger-accounting`, `customer-outstanding`, `customer-balance-logs` | `customer-reports`, `customer-ledger`, `customer-balance-logs` |
| **Purchase return** | `debit-notes`, `vendor-ledger-accounting`, `vendor-outstanding`, `vendor-balance-logs` | `debit-notes`, `vendor-ledger`, `vendor-reports`, `vendor-balance-logs` |
| **Payment / refund** | both `*-ledger-accounting`, both `*-outstanding`, both `*-balance-logs` | `customer-ledger`, `vendor-ledger`, `customer-reports`, `vendor-reports`, `*-balance-logs` |

### What this map already tells us

**Reports are document-centric, not product-centric.** Only `minimum-stock` reads the
`product` table. Everything else reads invoices, purchases, returns and ledgers. So
editing a product after it has been invoiced *should not* retroactively change any
historical report - the documents carry their own captured lines. That is correct
behaviour and it is worth **testing for explicitly** in Phase 3: if changing a product's
rate moves an old invoice's total, something is reading through to the product when it
should be reading the line.

**There is no stock report.** Nothing reports stock on hand or stock valuation.
`minimum-stock` answers only "what is below its minimum". `deadstock` has an API and an
entry screen but no report. So the stock reconciliation assertion in §7 has **no UI to
check it against** - it has to be run against the database directly.

**`openingclosing` is a three-line stub** (F-23) - `return <Underworks />`. That is
precisely the report that would tie opening stock to closing stock across the journey,
which makes it the most valuable thing in the reports section to actually build, and the
reason Phase 7 cannot simply be "check the reports agree".

**The mirrored pair diverges here too.** `salex-report` is a dedicated line-item report
for salex; sale has no standalone equivalent, its line detail being folded into
`sales`. Both line-item tables are read by `sales.ts`, via raw SQL.
