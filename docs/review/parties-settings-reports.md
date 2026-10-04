# Review E — parties, settings, dashboard, reports

Status: **review done** (2026-10-03), reviewer E. No app code changed, nothing committed.
Method: `docs/REVIEW_PLAN.md`. Every screen of the section was rendered in the jsdom page harness
with the real API handlers; every request it sent (method, URL, body, query string) was captured and
saved as a fixture; the backend tests replay those exact payloads and query strings over the
in-memory store, then run A1–A14 and the 16 report checks after every scenario.

Files added (only these):

| Kind | Path |
|---|---|
| Backend tests | `tests/backend/suites/review-e-parties.test.js` (13), `review-e-settings.test.js` (14), `review-e-reports.test.js` (20) |
| Fixtures (captured from the screens) | `tests/backend/fixtures/parties/captured.json`, `settings/captured.json`, `reports/captured.json` |
| Page harness | `harness/review-e-lib.jsx` (shared: fetch → real handler, capture, fixture writer, modal / select helpers), `review-e-parties.jsx`, `review-e-settings.jsx`, `review-e-reports.jsx` |
| This report | `docs/review/parties-settings-reports.md` |

Support files: **not changed**. Two things the in-memory store does not do that MySQL does are set
by the report test itself, in the story, not in `support/`: an unset foreign key is `NULL`
(memtx leaves it `undefined`, which `{ not: null }` lets through), and `deadstock.created_at`
defaults to now(). The 16 report checks use flowlib's `RANGE` (October); the report story runs
30 Sep → 1 Nov, so its scenarios widen `RANGE` at run time and put it back.

Run:
```
cd build && TZ=Asia/Kolkata npx jest -c jest.backend.config.js --runInBand tests/backend/suites/review-e-*.test.js
REVIEW_E_SHOW=1 ...same...        # runs the open findings as plain tests, to read why they fail
cd harness && HOME=<review home> ENTRY=review-e-parties.jsx OUT=review-e-parties.out.js node build-e2e.mjs \
  && HOME=<review home> TZ=Asia/Kolkata node review-e-parties.out.js        # rewrites fixtures/parties
```
(same for `review-e-settings.jsx`, `review-e-reports.jsx`; the report fixtures carry the capture
month — October 2026 — so the backend story is dated October 2026.)

---

## 1. Actions and field-by-field traces

Legend for the break column: **—** nothing wrong; **E-nn** a finding (section 3); *note* a
remark that is not a defect.

### 1.1 Customers and vendors (`components/parties/*`, `hooks/useParties.ts`, `lib/party-details.ts`)

**Create / edit customer** — `PartyForm kind=customer` → `useSaveParty` → `POST /api/customers` /
`PUT /api/customers/:id` → `createParty` / `updateParty` → `customer_details`. Captured bodies:
`fixtures/parties/captured.json` `customerCreateCopy`, `customerCreateShip`, `customerEditUnchanged*`, `customerEditCity`.

| Screen field | Payload key | Server reads / validates (`party-details.ts`) | Column | Response / read back | Break |
|---|---|---|---|---|---|
| BILLING NAME * | `billing_name` (trimmed) | required | `billing_name` | `GET` shape, `null` for blanks | — |
| BILLING ADDRESS LINE 1 * | `billing_address` | required | `billing_address` | same | — |
| LINE 2 / CITY | `billing_address_2`, `billing_city` | `'' → null` | same | same | — |
| PIN CODE (digits only, 6) | `billing_pin_code` | `/^\d{6}$/` | same | same | — |
| BILLING STATE * (picker of `useStates` names) | `billing_state` (name) + `billing_state_code` (number, from the picked state's `code`) | name required; code `parseInt || 0` | `billing_state`, `billing_state_code` | same | E-07 (code copied once, never followed) |
| BILLING GSTIN (upper-cased as typed) | `billing_gstin` | 15 chars, upper-cased | same | same; reaches the bill snapshot `bill_tosales.billing_gstin` → GST B2B (E-R14) | — |
| Copy from Billing (ticked) | shipping_* = billing_* | shipping falls back to billing (NOT NULL column) | `shipping_*` | edit form re-ticks it when `shipping_name` is blank **or equals the billing name** | **E-01** |
| Copy unticked: SHIPPING * fields | `shipping_*` + `shipping_state_code` | optional on the server | same | edit form fills each blank shipping field from billing | **E-02** |
| CONTACT NUMBER * / PHONE 2 / PHONE 3 | `contact_no`, `contact_no_2`, `contact_no_3` (`'' → null`) | `/^[6-9]\d{9}$/` | same | same | *note*: masters (mechanic, staff, users, business) accept any 10 digits |
| EMAIL | `email` | shape | same | same | — |
| (status) | not sent | kept on edit, `Active` on create | `status` | — | — |
| Confirm → OK | — | 201 `{customer}` / 200 `{customer}`; 400 `{message, errors[]}` | — | snackbar lists `errors`; modal closes on refusal | — |
| after save | — | — | — | `invalidateQueries()` (everything) + broadcast; edit → view, create → list / close tab | — |

Vendor create / edit: same path (`vendor_name`, `address`, `address_2`, `city`, `pin_code`, `state` +
`state_code`, `contact_no*`, `email`, `tax_id`). Save-unchanged round trip is exact (E-P5,
`vendorEditUnchanged`). Vendor `state_code` blank stores `null`, customer `0` (*note*).

**Status** — PartyView "Deactivate / Activate" → `PUT /api/{customers|vendors}/:id/status {status, confirmed:true}`
(captured) → `setPartyStatus` → `status`. Refusals: no `confirmed` 400 CONFIRM, unknown word 400,
unknown id 404 (E-P3). Shown elsewhere: leaves `?dropdown=true` (every bill / payment form picker),
stays in the details list, stays on Customer / Vendor Reports while it owes, view shows the ledger
sum (E-P3). Also leaves the **report** pickers — E-05.

**Delete** — no screen calls it. `DELETE /api/{customers|vendors}/:id` → 409 HAS_HISTORY with any bill,
payment, refund or ledger row (vendor also purchase returns); fresh party deleted; 404 unknown (E-P4, E-P5).

**List** — PartyList → `GET /api/customers?page&limit&sortBy&sortOrder[&search]` (captured:
`customerListQueries`). Server: search over name / phone / email / city / GSTIN, sort name | city |
state | status (+ id), paging. Empty result → server `totalPages 0`, screen floors to "Page 1 of 1"
(E-P6, harness). Export holds the page on screen only — E-16.

**View** — `GET /api/{kind}s/:id` → record + `outstanding` = ledger sum; "Ledger" / "Transactions"
put the id in sessionStorage and open the report (harness: the ledger opens on the party for this month).

Renaming a party (E-P7): Customer Reports, the bill reports' top customers and the credit notes read
the master name; the bill snapshot keeps the billed name; Bill Reference Sale reads the snapshot.

### 1.2 Settings masters

All list screens use `useListQuery` (debounced search, sort in the URL, page reset) and plain `fetch`;
after a save they refetch their own list only — no shared react-query cache is touched (**E-08**).

| Screen action | Request (captured) | Server | Table.column | Owner rule / result | Break |
|---|---|---|---|---|---|
| Mechanics: Add | `POST /api/mechanics {name, phone, city}` | name trimmed, 10-digit phone, unique phone | `mechanic.*`, status Active | E-S1 | — |
| Mechanics: Edit (unchanged / city) | `PUT /api/mechanics/:id {name, phone, city:''}` | `'' → null` | only the edited column changes | E-S1 | — |
| Mechanics: Deactivate | `PATCH /api/mechanics/:id/status {status}` | status route; same status twice = success | `status` | leaves `useMechanics` (`?dropdown=true`); old bills still in Mechanic Sale | — |
| Staff: same three | `/api/staff…` (+ `email`) | same + email shape | `staff.*` | E-S1 | — |
| GST rate: Add / Edit / Deactivate | `POST /api/gst-rates {id:0, description, rate:"0.25", hsn_code, applicable_for, status}`; `PUT /api/gst-rates {id, description, rate, hsn_code, applicable_for}` (no status); `PATCH …/:id/status` | rate 0–100 both ways, unique description | `gst_tax_rate.*` | D3 labels; edit keeps Inactive; 0.25 % slab | — |
| States: Add / Edit / Delete | `POST /api/states {state_name, code:"6"}`; `PUT /api/states/:id`; `DELETE /api/states/:id` | code 1–38 unique; rename / delete refused while in use (customers billing/shipping, vendors by name or id, `bill_tosales`, `bill_tosalesx`, `bill_to`) | `states.*` | D4 (E-S3); refused save brings the form back with what was typed | **E-07** (code change in use), **E-09** (`shipto`/`shiptox` not checked) |
| Category / Subcategory / Model / Company: Add / Edit | `POST /api/products/<r> {<name>[, category_id]}`; `PUT /api/products/<r>/:id` | trimmed, unique (subcategory: within its category), category must exist | lookup tables | E-S4; DELETE route guarded (409 with products) — no screen calls it | *note*: SETTINGS_PLAN §1 lists "status" for these; there is none |
| Warehouse: Add / Edit / Status | `POST /api/warehouses {id:0, name, location}`; `PUT /api/warehouses {id, name, location}`; `PATCH /api/warehouses/:id/status` | trimmed, unique name | `warehouse.*` | E-S5; inactive warehouse leaves the rack form picker | — |
| Racks: Add / Edit / Move / Status | `POST /api/warehouses/:wid/racks {id:'', warehouse_id, rack_number, description}`; `PUT` to the **owning** warehouse with the target in the body; status `PUT {id, status}` | unique per warehouse | `warehouse_racks.*` | E-S5 | — |
| Bank: Add / Edit | `POST /api/bank-details {id:0, bank_name, account_number, bank_address, ifsc}`; `PUT` same with id | unique name / number, IFSC upper-cased | `bank_details.*` | E-S6 | — |
| Business details: Edit → Save Changes | `PUT /api/business-details {…all fields, id}` | GSTIN valid → upper-cased; email / phones checked | `business_details.*` | E-S6 | **E-08** (bill form keeps the old record up to 30 min) |
| Users: Add / Edit | `POST /api/users {username, email, phone, password, status:"10"[, id]}` (edit = POST with id, empty password keeps it) | bcrypt, unique username / email | `user.*` | D1: own login and the last active user refused on both paths (E-S7) | **E-03** (auth_key 48 chars into VARCHAR(32)); *note*: edit re-sends the status loaded with the form (E-18) |
| Users: Deactivate | `PATCH /api/users/:id/status {status:"Inactive"}` | D1 | `user.status` 0 | E-S7 | — |
| Financial year: Add / Set current | `POST /api/financial-years {start_date:"2025-04-01", end_date}`; `PUT /api/financial-years/:id/current` (no body) | 1 Apr → 31 Mar, no overlap, past years allowed; current only inside the year, 31 Mar included | `financial_year`, `settings.currentfy` | D2 (E-S8) | **E-04** (DATE written as the UTC day before) |
| Inactive products: Reactivate | `GET /api/products?…&isActive=false`; `PATCH /api/products/:id/status {status:"Active"}` | status route | `product.is_active` | dashboard Low Stock and Minimum Stock follow (E-S9) | — |

Every master's "save unchanged → nothing changes" and "edit one field → only it changes" was checked
both in the harness (store before / after) and in the backend tests from the captured bodies.

### 1.3 Dashboard (`pages/index.tsx` → `/api/dashboard`)

Screen sends `today`, `salesDate`, `purchasesDate` as the browser's YYYY-MM-DD (captured). Server:
whole India days; products = active count; Low Stock = active, `stock < min_stock`, `min_stock > 0`;
Total Sales / Purchases all-time counts; today / picked-day sums of `invoice.total` /
`purchase.total`; last sale / purchase. Checked in E-R13 / E-S9. **Invoice C bills are in none of the
sale figures** — Q-1.

### 1.4 Reports — screen filter → query string → server → SQL → totals → screen

Query strings below are the captured ones (October 2026, the capture month). "Range" = `reportDayRange`
→ `parseDateRange`: whole India days, `23:59:59` included.

| Screen (page → component) | Query string the screen sends | Server → source | Totals the screen shows | Test |
|---|---|---|---|---|
| Sale (`BillReport mode=sale`) | `dateFrom=2026-10-01T00:00:00&dateTo=2026-10-31T23:59:59&reportType=sale|both|salex` | `lib/bill-report.ts`: `invoice` (+`invoicex`) by `invoice_date` in range, lines by bill id, returns by `return_date` | bills, paid / part / unpaid, total, taxable, GST split, returns, net, cash / bank by bill mode, top parties / products, India days | E-R1 |
| Invoice C / Purchase | `dateFrom…&dateTo…` | same lib, `invoicex` / `purchase` | same (Invoice C: no GST card) | E-R1 |
| GST Summary | `dateFrom…&dateTo…` | `lib/gst-report.ts` (heads from bills, credit notes split as the line, B2B by snapshot GSTIN) | output, credit, input, debit, net per head, rate / HSN tables, non-GST | E-R2, E-R14 |
| Profit by Period | `dateFrom=2026-04-01T00:00:00&dateTo=<month end>` (FY start → month end) | `lib/profit-report.ts` (line subtotals, returns, cost = last purchase rate on the sale date) | sales, returns, cost, profit, margin, by month / product | E-R3 |
| Cash / Bank Book | `…&mode=all|cash|bank&page=1&limit=100` | `lib/cash-book.ts` (payments, refunds, completed returns; brought forward = before range) | opening, in, out, closing, running balance, page opening | E-R4 |
| Return Register | `kind=all|customer&page=1&limit=50&dateFrom…&dateTo…[&status=1][&search]` | `lib/return-register.ts` | count, taxable, tax, refund, settled, pending | E-R5 |
| Customer / Vendor Reports – outstanding | `page=1&limit=10&search=&customerFilter=&dateFrom=&dateTo=&amountMin=&amountMax=&sortBy=balance&sortOrder=desc` | `lib/party-outstanding.ts`: ledger SUM(debit−credit) to the end date | owed / credit totals, last transaction link | E-R6, E-P3, Q-2 |
| Customer Reports – credit notes | same + `paymentStatus=all` (sortBy stays `balance` → falls back to date) | `api/reports/credit-notes.ts` | refund total | E-R7 |
| Vendor Reports – debit notes / Debit Notes page | `…&paymentStatus=all…` (`sortBy=return_date` on the page) | `api/reports/debit-notes.ts` | taxable, tax, refund | E-R7 |
| Customer / Vendor Ledger (`PartyLedgerReport`) | after picking: `customer_id=1&page=1&limit=50&dateFrom=2026-10-01T00:00:00&dateTo=2026-10-31T23:59:59` | `lib/ledger-report.ts`: opening = before range + earlier pages; 0/0 rows not listed | opening, rows, running balance, closing | E-R8, E-14 |
| Balance logs (`PartyBalanceLogReport`) | `customer_id=1&page=1` and `customer_id=1&get_balance=true` | `lib/balance-log-report.ts` | per-column change totals vs counters | E-R9 |
| Opening / Closing Stock | `dateFrom…&dateTo…&page=1&limit=100&sortBy=product_name&sortOrder=asc[&all=1][&categoryFilter]` | `lib/stock-report.ts` (movements) | opening, in / out, closing, value, mismatch | E-R10; category filter dead — **E-12** |
| Minimum Stock | `page=1&limit=50&search=&categoryFilter=&companyFilter=&modelFilter=` | `api/reports/minimum-stock.ts` (active only) | list, "Page x of y" | E-S9; **E-11**, **E-12** |
| Mechanic / Staff / Commissions / Transport / Packing | `page=1&limit=50&dateFrom=&dateTo=&transactionType=all&<party>Id=` | the five routes (bills with mechanic / staff / commission / freight / P&F) | totals, per-person summary | E-R11; filters — **E-10** |
| Bill Reference Sale / Purchase | `page=1&limit=50&billReference=&dateFrom=&dateTo=` | UNION over both bill kinds, snapshot names | list | E-R12 |
| Notes Mentioned | nothing until a word is typed; then `page=1&limit=50&notesSearch=urgent&transactionType=all&dateFrom=&dateTo=` | three bill tables, `notes LIKE` | list | E-R12; **E-11** |

All 25 report screens loaded in the harness without an API error; every parameter the screens send is
read by its route (checked against each route's destructuring / `queryString` calls). Breaks: E-05,
E-06, E-10, E-11, E-12, E-13, E-14, E-16.

---

## 2. Coverage matrix (action × outcome → test)

"Before" = what covered it before this review (`partycheck`, `reportcheck`, `rptcheck`, `rpt2check`,
`custreportcheck`, `stockcheck`, `rlistcheck`, `listcheck`, `flow`, harness test10 / test12–14).
"After" = the test added here (file prefix `review-e-`).

| Area | Action | Outcome | Before | After |
|---|---|---|---|---|
| Customer | create (screen payload) | 201, stored as sent, in dropdown | partycheck (hand body), test10 | parties E-P1 (captured body) |
| Customer | edit saved unchanged | nothing changes | — | E-P1, E-P0; **E-01 / E-02 failing** |
| Customer | edit one field | only it changes, status kept | test10 (city) | E-P2 |
| Customer | status Inactive / Active | dropdown, list, outstanding, view follow; CONFIRM / bad word refused | partycheck (vendor), test10 | E-P3 |
| Customer | delete | 409 with history, 200 without, 404 | partycheck | E-P4 |
| Vendor | create / edit / status / delete | as customer | partycheck, test10 | E-P5 |
| Parties | list sort / search / limit / empty | server-side, screen query strings | partycheck, test10 | E-P6 |
| Parties | rename → elsewhere | reports read master name, snapshot kept | — | E-P7 |
| Parties | inactive party in report pickers | reachable | — | **E-05 failing** |
| Parties | Customer Reports paging on a new search | page 1 | — | **E-06 failing** (twin passes) |
| Mechanics / Staff | create / unchanged / edit one / status / dropdown / report | each | test12 | settings E-S1 ×2 |
| GST rates | create 0.25, unchanged, edit after deactivate, rate check, duplicate | each | test12 | E-S2 |
| States | create, unchanged in use, rename in use, delete in use (customer, vendor, bill_to, bill_tosalesx), delete unused | D4 | test12 | E-S3; **E-07, E-09 failing** |
| Lookups | create, unchanged, duplicate, delete guard, subcategory needs category | each | test12 | E-S4 |
| Warehouse / racks | create, unchanged, edit one, status, rack duplicate, move | each | test13 | E-S5 |
| Bank / business | create, unchanged, edit one, IFSC / GSTIN normalised, refusals | each | test14 | E-S6 |
| Users | create, unchanged, deactivate other, own login (both paths), last active | D1 | test13 | E-S7; **E-03 failing** |
| Financial year | past year, duplicate, overlap, not 1 Apr, current on 31 Mar 23:30 / refused 1 Apr | D2 | test13 | E-S8; **E-04 failing** |
| Inactive products | reactivate → dashboard / Minimum Stock | active-only rule | test14 (dashboard) | E-S9 |
| Bill reports | screen month, last day in, next month out, both / salex, returns, net | — | rptcheck (seeded), flow (fixed range) | reports E-R1 (route-made data, screen query) |
| GST | heads, credit / debit split, net, non-GST, B2B from party GSTIN | — | rpt2check (seeded), flow | E-R2, E-R14 |
| Profit | FY-to-date screen range, cost at the rate of the sale date | — | rpt2check | E-R3 |
| Cash book | brought forward, in / out, cash / bank, page 2 opening | — | rpt2check | E-R4 |
| Return register | all / customer / complete, search | — | rpt2check | E-R5 |
| Outstanding | ledger sum, totals, filter, search, amount, end date, last ref | — | rptcheck, reportcheck | E-R6; Q-2 |
| Credit / debit notes | screen views, totals | — | flow (counts) | E-R7 |
| Ledger account | opening from before range, rows, closing, page 2, 0/0 rows | — | reportcheck, custreportcheck | E-R8; **E-14 failing** |
| Balance logs | totals = counters | — | custreportcheck | E-R9 |
| Stock | opening / movements / closing / dead stock / sort | — | stockcheck | E-R10 |
| People & charges | mechanic, staff, commissions, transport, packing, one-day range | — | — | E-R11 |
| Bill reference, notes | search, both kinds | — | custreportcheck, reportcheck | E-R12 |
| Dashboard | totals, today, picked day, last sale, low stock | — | test14 | E-R13, E-S9; Q-1 |
| Empty lists | "Page 1 of 1" | — | — | **E-11 failing** |
| Filter dropdowns | routes exist | — | — | **E-12 failing** |

After every scenario (all `sc` tests): A1–A14 clean and the 16 report checks agree.

---

## 3. Findings (ranked)

Severity: **H** data loss or a screen that cannot do its job; **M** wrong or missing data shown /
saved in a common path; **L** cosmetic or rare. "Test" is the `test.failing` that turns red when fixed.

### E-03 (H, plausible on MySQL) — creating a user in Settings writes a 48-character `auth_key` into a VARCHAR(32)
- `pages/api/users/index.ts:307` `randomBytes(24).toString("hex")` (48 chars); `prisma/schema.prisma:628` `auth_key String @db.VarChar(32)`. `lib/user-management.ts:147` and `scripts/create-user.js:13` make 32.
- MySQL / MariaDB in strict mode (the default since 5.7 / 10.2) refuses the insert: Prisma P2000 → `fail()` → 400 "A value is too long for its column". The Users screen cannot add anyone. Without strict mode the key is silently truncated (harmless — NextAuth does not read it).
- Harness: captured create; stored key length 48. Test: settings `E-03`.
- Fix: `randomBytes(16).toString('hex')` (32). Risk: none.

### E-01 (H) — editing a customer whose shipping address differs but has the same name overwrites the shipping address with billing
- `components/parties/PartyForm.tsx:111` ticks "Copy from Billing" when `shipping_name` is blank **or equals `billing_name`**; while ticked, `values` (line 117) replaces every shipping field with billing. A firm shipping to its own godown under its own name loses the godown address on any edit (even a phone change); the confirm text says "with shipping address copied from billing" but the user did not choose it.
- Harness: edit opened with the box ticked; saved unchanged → `shipping_address` "Plot 7, Transport Nagar" became "12 Ring Road" (and city / pin / GSTIN). Fixture `customerEditUnchangedSameName`. Test: parties `E-01`.
- Fix: tick only when every shipping field equals its billing twin (or shipping is blank). Risk: low (form only).

### E-12 (M) — Opening / Closing Stock and Minimum Stock filters load from routes that do not exist
- `pages/reports/openingclosing.tsx:33` `fetch('/api/categories')`; `pages/reports/minimumstock.tsx:60-62` `/api/categories`, `/api/companies`, `/api/models`. The lookups live at `/api/products/{categories,companies,models}` (`?dropdown=true`, rows in `data` / `categories` / `companies` / `models`).
- Harness: all four requests 404; the Category / Company / Model filters offer only "All". The server filters (`categoryFilter`, `companyFilter`, `modelFilter`) work when given an id.
- Test: reports `E-12`. Fix: point the fetches at `/api/products/<r>?dropdown=true`. Risk: none.

### E-07 (M, owner question) — the GST code of a state in use can be changed, and nothing follows it
- `pages/api/states/[id].ts:101,105-120`: rename / delete are refused while in use (D4) but the code change is allowed by design ("Its GST state code can still be changed"). Customers / vendors store their own copy (`billing_state_code`, `state_code`); the party form copies the code only when a state is picked, so a saved party keeps the old code forever, and the bill takes its state code from the party (`lib/sale-create.ts` `billStateCode(body, customer?.billing_state_code)`): after correcting a wrong code, existing parties keep billing with the wrong CGST/SGST vs IGST split.
- Harness: code 9 → 10 saved with a customer on it; the customer keeps 9. Test: settings `E-07` (expects either a refusal or the parties carried along).
- Fix (owner to choose): refuse while in use, or update `customer_details.billing_state_code / shipping_state_code` and `vendor_details.state_code` by name in the same transaction. Risk: low.

### E-04 (M, plausible on MySQL) — a financial year created in Settings is written to the DATE columns as the day before
- `lib/financial-year-rules.ts:29-31` builds local midnight (`new Date(y, m-1, d)`), `pages/api/financial-years/index.ts:196-200` hands it to `@db.Date` columns. Prisma writes a DateTime to a DATE column as its UTC calendar day: 1 Apr 00:00 IST = 31 Mar 18:30 UTC → stored **2025-03-31**, end **2026-03-30**. Read back, `[id]/current` then refuses "Set as current" on 31 March of that year (the D2 rule "the last day counts" fails for every year made here). Years seeded directly in the DB are unaffected.
- Harness: the Date handed over is `2025-03-31T18:30:00.000Z`. Test: settings `E-04` (checks the value handed to Prisma; please confirm on the real database: `SELECT start_date, end_date FROM financial_year ORDER BY id DESC LIMIT 1` after adding a year).
- Fix: `new Date(Date.UTC(y, m-1, d))` for the stored value (keep local dates for the comparisons). Risk: low.

### E-05 (M) — ledger, balance-log and report party pickers leave out inactive customers / vendors that still owe
- `components/reports/PartyLedgerReport.tsx:38,42`, `components/reports/PartyBalanceLogReport.tsx:19-20`, `pages/reports/customer-reports.tsx:84`, `vendor-reports.tsx:104` load `?dropdown=true` — active only (the right list for bill and payment forms, the wrong one for reports). A deactivated customer with an unpaid bill cannot be picked on Customer Ledger (only reached through the view's "Ledger" button).
- Harness: Old Garage (inactive, owes 500) and Old Supplier (inactive, owed 700) missing from the pickers. Test: parties `E-05`.
- Fix: a `?dropdown=true&includeInactive=true` (or `status=all`) variant for report pickers, marking inactive ones. Risk: low.

### E-10 (M) — people / charges report filters load the first page of a list, active only
- `pages/reports/mechanic.tsx:47`, `staff.tsx:44`, `commissions.tsx:48,66` fetch `/api/mechanics` / `/api/staff` (active, first 50); `transport.tsx:54,72` and `packing.tsx:55,73` fetch `/api/customers` / `/api/vendors` — the **paged details list** (50 rows, sorted by name, inactive included). F-58 again: customers 51+ cannot be filtered on; a deactivated mechanic's sales cannot be filtered on.
- Harness: Transport offers 50 of 60 customers; Mechanic Sale omits the inactive mechanic.
- Fix: `?dropdown=true&includeInactive=true` for mechanics / staff, `?dropdown=true` (+ inactive, as E-05) for parties. Risk: none.

### E-08 (M) — settings saves do not refresh the caches the bill and party forms read
- Settings pages use plain `fetch` and refresh only their own list; nothing invalidates `['states']` (`hooks/useStates.ts:29`, 30 min), `['business-details']` (`hooks/useBusinessDetails.ts:43`, 30 min), `['mechanics']` / `['staff']` (5 min) used by `components/bills/BillForm.tsx` and `PartyForm`.
- Effect (same browser session, client-side navigation): a state added in Settings is missing from the party / bill state pickers; a corrected business GSTIN keeps deciding the bill's CGST/SGST vs IGST from the old one for up to 30 minutes; a new mechanic is not in the bill form.
- Harness: warm caches stay valid (`isInvalidated: false`) after the saves. Fix: `queryClient.invalidateQueries({ queryKey: [...] })` after each settings save (or move these pages onto the shared hooks). Risk: none.

### E-16 (M) — most report exports and the party lists export only the page on screen
- `ExportMenu` without `fetchAll` exports `data` as-is (`components/common/ExportMenu.tsx:37,388`). Only Cash Book, Opening / Closing and Return Register pass `fetchAll`. Customer / Vendor Reports export 10 rows (their page size), Debit Notes 10, Minimum Stock / Mechanic / Staff / Commissions / Transport / Packing / Bill Reference / Notes 50, the ledger 50, PartyList its page — while the settings lists export every row (S-89).
- Fix: add `fetchAll` (same query, `page=1&limit=<max>`). Risk: none.

### E-02 (M) — saving a separate shipping address fills its blank fields from billing
- `PartyForm.tsx:109` `next[s] = next[s] || next[b]` for every shipping field on load; saved unchanged, a blank shipping line 2 / city / pin / GSTIN becomes the billing one. (The view shows that fallback — the form should not store it.)
- Harness: Asha's separate shipping address gained billing's "Lane 2". Fixture `customerEditUnchanged`. Test: parties `E-02`.
- Fix: fall back only for `shipping_name`, `shipping_address`, `shipping_state` (the required ones), or not at all when copy is off. Risk: low.

### E-06 (L) — Customer Reports (and the Debit Notes / Minimum Stock pages) keep the page number when the search or a filter changes
- `pages/reports/customer-reports.tsx:235,245,257,268,278` set filters without `page: 1` (and switching view keeps the page); `vendor-reports.tsx:270,282,295,307,318` reset it (twin rule). Same on `debit-notes.tsx:219-253` and `minimumstock.tsx:181`.
- Harness: on page 2, typing "Old" sends `page=2&search=Old` → empty table, "Page 2 of 1". Test: parties `E-06` (captured query). Fix: reset to 1 as the vendor page does. Risk: none.

### E-11 (L) — empty lists read "Page 1 of 0" on Minimum Stock and Notes Mentioned (owner rule: "Page 1 of 1")
- `pages/api/reports/minimum-stock.ts:151`, `notes-mentioned.ts:159` (also `mechanic-sales.ts:180`, `staff-sales.ts:225`, `commissions.ts:181`, `transport-cost.ts:200`, `packing-forwarding.ts:210`) compute `Math.ceil(total / limit)` instead of `reportPagination` (floors at 1); `minimumstock.tsx:247` and `notes.tsx:162` print it, and both start from `totalPages: 0` (`:37`, `:33`) — Notes shows "Page 1 of 0" before any search.
- Harness: both seen. Test: reports `E-11`. Fix: `reportPagination(...)` in those routes, initial `totalPages: 1`. Risk: none.

### E-09 (L) — a state used only by a sale's ship-to snapshot can be deleted
- `pages/api/states/[id].ts:13-21` checks `bill_tosales`, `bill_tosalesx`, `bill_to` and the parties but not `shipto` / `shiptox.shipping_state`. Test: settings `E-09`. Fix: add the two lookups. Risk: none.

### E-14 (L) — the ledger account's `pagination.total` counts 0/0 rows it does not list
- `lib/ledger-report.ts:45` counts every row; `:66` drops 0/0 rows from the page. A rate-0 bill makes "Page x of y" count rows that are never shown. Test: reports `E-14`. Fix: add `NOT (debit = 0 AND credit = 0)` to the count / page query (balance is unaffected). Risk: low.

### E-13 (L) — Customer / Vendor Reports with no rows read "Showing 1 to 0 of 0"
- `customer-reports.tsx:296`, `vendor-reports.tsx:338` (PartyList and notes / minimum stock already guard with `rows.length > 0 ? … : 0`). Harness: seen. Also: the credit-notes view keeps a `paymentStatus` filter with no control on screen, and failed loads are silently ignored on these pages.

### E-15 (L) — Debit Notes returns the raw error text on a failure
- `pages/api/reports/debit-notes.ts:198` `error: String(error)` (the rule `respond.fail()` exists for). Credit notes answer `{error}` with no `message`. Fix: `fail(res, error, 'fetch debit notes')`.

### E-17 (L) — twin gaps between the customer and vendor note / outstanding screens
- Debit notes search only the note number (`debit-notes.ts`: `debit_note_no contains`); credit notes search the customer name or number (E-R7 shows "Bosch" finds nothing). Vendor Reports link only purchase / debit-note references; customer side links payments and refunds too (`vendor-reports.tsx:383-400`).

### E-18 (L) — the user edit form re-sends the status it loaded
- `pages/settings/users.tsx:93` sends `status` from the form; a user deactivated by someone else meanwhile is re-activated by an unrelated edit (GST had the same and was fixed by not sending status). D1 still guards self / last user.

### Questions for the owner (behaviour as designed today; tests pass and document it)
- **Q-1** Dashboard "Total Sales", "Today's Sales", "Daily Sales" and "Last Sale" count GST sale bills only; Invoice C bills are left out (`pages/api/dashboard/index.ts:99-115`). Test `Q-1`. Intended?
- **Q-2** Customer / Vendor Reports with a date range list only parties with ledger activity inside the range (`lib/party-outstanding.ts:88`); a customer owing since September disappears when October is picked, although the balance shown is "as of the end date". Test `Q-2`. Should a range mean "balance as of the end date, everyone who owes"?
- **Q-3** (with E-07) refuse a code change on a state in use, or carry it to the parties?
- **Q-4** Phone rule: parties require 10 digits starting 6–9; mechanics, staff, users and business accept any 10 digits (landline-style numbers). One rule?

Minor notes (no id): `/api/staff`, `/api/gst-rates`, `/api/warehouses`, `/api/users`, `/api/states`, `/api/bank-details`, `/api/financial-years` parse `page` / `limit` without a fallback (`?limit=abc` → 500; the screens never send junk); `mechanic-sales` groups its summary by mechanic **name**; `lib/financial-year.ts:37` reads `settings` without the `orderBy` the settings routes use (S-81).

---

## 4. Tests and fixtures added — results

```
TZ=Asia/Kolkata npx jest -c jest.backend.config.js --runInBand tests/backend/suites/review-e-*.test.js
Test Suites: 3 passed   Tests: 47 passed
```
- **47 tests**: 36 plain (pass), **11 `test.failing` by design** — E-01, E-02, E-05, E-06 (parties); E-03, E-04, E-07, E-09 (settings); E-11, E-12, E-14 (reports). With `REVIEW_E_SHOW=1` each of the 11 fails for the stated reason (checked).
- Every `sc` scenario ends with A1–A14 clean and 16 of 16 report checks agreeing.
- Also run together with the section's existing suites (partycheck, reportcheck, rptcheck, rpt2check, custreportcheck, stockcheck, rlistcheck, listcheck): 11 suites, 55 tests, all pass.
- Page harness: `review-e-parties.jsx` ALL PASS (+ 6 findings shown), `review-e-settings.jsx` ALL PASS (+ 5 shown), `review-e-reports.jsx` ALL PASS (+ 8 shown); each rewrites its fixture file.

Fixtures: `parties/captured.json` (17 entries: create ×3, edit unchanged ×3 with the record before, edit one,
status ×2, list / ledger / outstanding query strings), `settings/captured.json` (63: list query,
create, edit unchanged + record before, edit one, status / delete for every master), `reports/captured.json`
(25 screens: endpoint and the query strings sent on load and after the main filters).
