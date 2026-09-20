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
- **Auth:** `NEXTAUTH_SECRET` added to `.env`; `NODE_ENV` commented out (Next.js sets it).
  That pair was causing `/api/auth/error?error=Configuration`.

### Pick up with

1. **Seed `gst_tax_rate`** — it is empty, so every test invoice comes out at zero tax and
   F-04 / F-34 cannot be exercised. Needs rows at **0 / 5 / 18 / 40** (post-GST-2.0 slabs;
   12% and 28% were withdrawn 22 Sep 2025), then wire a few products to them.
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

Status: `open` · `in-progress` · `fixed` · `wontfix` · `invalid`

| ID | Sev | Conf | Module | Finding | Evidence | Status |
|---|---|---|---|---|---|---|
| F-01 | Critical | [C] | Cross | `fy` written as calendar year by 9 endpoints, inherited from the allocated doc by 2 more; it is an FK to `financial_year.id` | fixed in `lib/financial-year.ts` | **fixed** — 26 corrupt rows removed by wipe |
| F-02 | Critical | [C] | Ledger | Running balance is insertion-ordered, displayed date-ordered | `lib/ledger-service.ts:85,289` | open |
| F-08 | Critical | [C] | Purchase | Purchase items joined by non-unique `invoice_no` with no `fy` filter | `purchases/[id].ts:31,516,647` | open |
| F-09 | Critical | [C] | Sale | Discounts dropped on create; total overstated | `sales/index.ts:117` vs `sale/create.tsx:1060` | open |
| F-10 | Critical | [C] | Return | No over-return validation on any write path | `sale-returns/index.ts:488-510` | open |
| F-03 | High | [C] | Reports | Ledger balance restarts at 0 per page / per date filter | `vendor-ledger-accounting.ts:65` | open |
| F-04 | High | [C] | Sale | Client-supplied tax and totals trusted | `sales/index.ts:118,209` | open |
| F-11 | High | [C] | Product | SQL injection + Postgres `ILIKE` on a MySQL database | `products/optimized.ts:252` | open |
| F-12 | High | [C] | Purchase | Duplicate product lines lose stock (`CASE` takes first match) | `purchases/index.ts:675-696` | open |
| F-13 | High | [C] | Purchase | Invoice-number race: non-atomic `MAX+1`, no unique constraint | `lib/invoice-counter.ts:19` | open |
| F-14 | High | [C] | Sale | Oversell: per-line stock check, not aggregate | `sales/index.ts:183` | open |
| F-15 | High | [C] | Return | `updateDebitNoteEntry` escapes the caller's transaction | `lib/ledger-service.ts:273` | open |
| F-28 | Critical | [C] | Settings/Sale | Sale unsaveable when state code is 0/null — compute and validate disagree | fixed in `lib/gst.ts`; 6 cases verified | **fixed** |
| F-29 | High | [C] | Settings | `states.code` hardcoded to 0 on create, no update path; it is the GST state code | fixed in `states/index.ts` + `[id].ts` + settings UI | **fixed** (no backfill needed — all 37 rows already valid) |
| F-30 | High | [C] | Settings/Sale | Business state code hardcoded in a component; `business_details` has no state column | `getBusinessStateCode()` added | **partial** — fallback remains until page fetches GSTIN |
| F-31 | Medium | [C] | Settings | 0% GST rate cannot be created (falsy guard); create/update drifted in one file | `gst-rates/index.ts:103` vs `:171` | open |
| F-32 | Low | [C] | Settings | Racks PUT resolves the rack by id without scoping to the URL's warehouse | `warehouses/[warehouseId]/racks.ts:185` | open |
| F-33 | Low | [C] | Settings | GST rates are mutated in place — no rate history for compliance | `gst-rates/index.ts:143` | open |
| F-34 | High | [C] | Sale | GST never rounded; entry grid, DB and view page show three different numbers | `sale/create.tsx:166`, `:1693`, `sale/view/[id].tsx:301` | open |
| F-35 | High | [C] | Return | No credit-note time limit (s.34(2), 30 Nov deadline) | `sale-returns/index.ts` | open |
| F-36 | High | [C] | Return | `sale_return_items` has no tax split — cannot issue a compliant credit note (Rule 53) | `schema.prisma:730-747` | open |
| F-37 | High | [C] | Ops | FY never rolled over — app stamped documents into a year closed since 2026-03-31 | `financial_year` had no 2026-2027 row | **fixed** — FY id=4 created and set current |
| F-38 | Medium | [C] | Ops | `NEXTAUTH_SECRET` missing and `NODE_ENV` set manually -> `error=Configuration` on every auth call | `.env` | **fixed** |
| F-39 | Medium | [C] | Ops | `gst_tax_rate` is empty — no tax rates configured, so no invoice can carry tax | `gst_tax_rate` 0 rows | open |
| F-40 | Medium | [C] | Product | `opening_stock` set on only 135 of 602 products — stock reconciliation had no valid baseline | reset at wipe | **fixed** |
| F-41 | Low | [C] | Ops | Existing clear scripts miss 6 tables incl. `note_counters`, so note numbering never restarts | `scripts/clear-*.js` | **fixed** in `clear-all-data.js` |
| F-05 | Medium | [C] | Cross | No role authorization despite documented roles | `grep role pages/api` → none | open |
| F-06 | Medium | [C] | Purchase | `[id]-old.ts` is a reachable route mutating stock | `purchase-returns/[id]-old.ts:530` | open |
| F-07 | Medium | [C] | Cross | 21 timezone-shifting `toISOString().split` sites | `sale/create.tsx:246` | open |
| F-25 | High | [C] | Security | `.env.test` tracked in a public repo with live DB credentials | `.gitignore` had no `.env.test` rule | **fixed** — untracked + ignored; creds being rotated |
| F-26 | Medium | [C] | Security | Seeded default passwords (`admin123`, `manager123`, …) | `scripts/create-user.js:60-64`, `lib/user-management.ts:168` | open |
| F-27 | Low | [C] | Cross | `tsconfig.tsbuildinfo` (a build artifact) is tracked | repo root | open |
| F-16 | Medium | [C] | Purchase | Two invoice-numbering schemes: per-FY server vs global UI | `last-invoice.ts:14` | open |
| F-17 | Medium | [C] | Product | Missing parentheses in car-model SQL disjunction | `products/optimized.ts:264` | open |
| F-18 | Medium | [C] | Return | `status` is `String` for sale returns, `Int` for purchase returns | `schema.prisma:710,758` | open |
| F-19 | Medium | [C] | Return | `sale_return_items` has no cgst/sgst/igst split | `schema.prisma:730-747` | open |
| F-20 | Medium | [C] | Reports | `*-ledger-details` endpoints orphaned; two ledger implementations disagree | no callers | open |
| F-21 | Medium | [V] | Purchase | `Promise.all` over one interactive `tx` | `purchases/index.ts:667` | open |
| F-22 | Low | [C] | Product | Two unconditional DEBUG queries per request | `products/optimized.ts:217-226` | open |
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
