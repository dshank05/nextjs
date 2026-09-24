# Dashboard & Settings Audit

Third audit document, alongside `AUDIT_PLAN.md` (phase plan, master register, statutory
reference) and `JOURNEY_AUDIT.md` (the product journey, phases 3-6). This one covers the
**dashboard** and the **eleven settings pages**, end to end: front end, API, Prisma usage,
dead code, smells, load and query cost, filters, CRUD, deactivate, and print/export.

Finding IDs are **D-nn** (dashboard) and **S-nn** (settings) so they do not collide with
the `F-nn` / `L-nn` / `P4-nn` sequences in the other two documents.

Status: `open` · `in-progress` · `fixed` · `by design` · `wontfix` · `invalid`

---

## 0. Method, and a correction to how I ran it

**Read the file. Do not grep it. Do not write a probe script to guess at it.**

The user has now had to say this four times, the last two sharply. It is recorded here
because it is a finding about the audit, not about the code, and because the evidence is
one-sided:

- In Phase 3c, three files were grepped rather than read. Reading them in full **downgraded
  F-95** (the stock filter was not broken end to end — there is no stock control on the
  page at all, so it is unreachable), **upgraded F-96**, and **found F-111 and F-112**,
  which grep could not have surfaced.
- Starting this audit, I wrote two probe scripts (`scripts/audit-dashboard.js`,
  `scripts/audit-settings.js`) and ran them **before** opening the pages. They did find
  real defects, but two of my early conclusions from them were wrong and had to be
  corrected once I read the source:
  - I reported *"states sort is broken"*. It is not. `sortBy=id` is not a supported field
    and the API **silently falls back** to `state_name`. The defect is the silent fallback,
    which is a different and smaller thing.
  - I suspected the Users API leaked `password_hash` to the browser, because the page's
    `User` interface declares it. Reading `pages/api/users/index.ts:158-166` shows the
    `select` **excludes** it. There is no leak. The interface is simply stale.

A probe tests my guess about a file; only reading tests the file. **Live verification is
for confirming a finding already derived from reading — never for discovering one.**

### Coverage, stated honestly

**Read in full:** `pages/index.tsx`; `pages/api/dashboard/{stats,daily-stats,trends}.ts`;
`lib/db.ts`; `pages/api/debug/query-stats.ts`; `components/common/ExportMenu.tsx`;
`pages/settings/{warehouse,states,users,inactive-products}.tsx`;
`pages/api/warehouses/index.ts`; `pages/api/users/index.ts`.

**Read through the logic half** (state, effects, fetch, handlers — the render half of these
follows the same table/modal/pagination shape already characterised, and is noted where a
finding was taken from it): `staffdetails.tsx` (to 360/521), `mechanics.tsx` (to 150/506),
`bankdetails.tsx` (to 170/399), `businessdetails.tsx` (to 200/448), `financialyear.tsx`
(to 210/529), `gsttaxrate.tsx` (to 200/519), `warehouse-racks.tsx` (to 190/556).

**Superseded by §9 and §10. Coverage is now complete for this audit's scope:** all
eleven settings pages and all twelve settings APIs have been read end to end, plus the
dashboard page and its three endpoints, ExportMenu, lib/db and the debug route.

The partial-coverage breakdown above is left standing rather than tidied away, because it
is the record of what half-read files cost: the second pass (§9) corrected three findings
and added thirteen, and the third (§10) corrected two more and added nineteen.

---

## 1. Dashboard

`pages/index.tsx` (399 lines) over three endpoints: `/api/dashboard/stats`,
`/daily-stats`, `/trends`.

### Measured, against the running app

| Endpoint | Status | Median (warmed, 3 runs) |
|---|---|---|
| `stats` | 200 | **578 ms** |
| `daily-stats` | 200 | **280 ms** |
| `trends` | 200 | **574 ms** |

The page issues four calls on mount — `stats`, `trends`, and `daily-stats` **twice**.
That is roughly **1712 ms of API time, of which about 854 ms is waste** (D-01, D-02).

### Findings

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| D-01 | **High** | **`/api/dashboard/trends` is fetched on every load and never rendered.** `fetchTrendsData()` fills `trendsData`/`trendsLoading` and no JSX reads either — note the empty gaps at `:264-266` and `:395-396` where a chart was deleted. Cost: **574 ms and 15 queries** (5 days × sales aggregate + purchase aggregate + a raw-SQL fallback) on every dashboard view | `index.tsx:59,134-147`; no consumer in `:157-399` | **fixed** — the trends fetch and its endpoint are gone |
| D-02 | Medium | **The two daily-stats fetchers are the same function twice.** `fetchDailySalesStats` and `fetchDailyPurchasesStats` call the identical URL and differ only in which state they set. Both dates default to today, so the page makes **the same request twice on mount** (~280 ms duplicated) | `index.tsx:104-132`, `:49-54` | **fixed** — one request serves both panels; verified 4 calls/~1712ms → 1 call/~640ms |
| D-03 | **High** | **"Low Stock" disagrees with the rest of the app.** Dashboard shows **1**; `/api/reports/minimum-stock` and `/api/products?stockFilter=low_stock` both show **0**. The dashboard uses a *fourth* low-stock rule — `stock < min_stock AND min_stock IS NOT NULL` — and since `min_stock` is 0 across the catalogue (F-74) that reduces to `stock < 0`. **The card is displaying the known negative-stock row (F-73), labelled as low stock.** F-70 unified three rules and missed this one | `stats.ts:37`; verified live, all three views | **fixed** — uses F-70’s rule via `prisma.product.fields.min_stock`; verified live: dashboard 1 → **0**, matching the report and the product list |
| D-04 | Medium | **Missing parentheses in raw SQL — F-17 again.** `WHERE invoice_date >= ? AND invoice_date <= ? OR (invoice_date = ? OR invoice_date LIKE ?)` binds as `(A AND B) OR C OR D`, so the date window is bypassed entirely by the trailing ORs. It also compares an `Int` column against a `'YYYY-MM-DD'` string, which MySQL coerces to a number — `'2026-09-23'` becomes `2026` | `stats.ts:74-79` | **fixed** — the raw query is gone entirely |
| D-05 | Medium | **The whole "mixed date format" apparatus is dead weight, and it is duplicated.** `purchase.invoice_date` is an `Int`. The fallback branch, the `REGEXP '^[0-9]+$'` ordering and `UNIX_TIMESTAMP(invoice_date)` all defend against a string-dated row that the schema does not permit. The `REGEXP` forces a string conversion of every row, so the "last purchase" query is a full scan that cannot use an index. The same block is **copy-pasted** into `trends.ts:53-93` | `stats.ts:58-120`, `trends.ts:53-93` | **fixed** — both copies deleted with their endpoints |
| D-06 | Medium | **Two of the three dashboard endpoints have no request logging.** `daily-stats.ts` is wrapped in `withObservability`; `stats.ts` and `trends.ts` are **not** — so the app's landing page is its least observable route | `daily-stats.ts:80` vs `stats.ts:5`, `trends.ts:4` | **fixed** — the merged endpoint is wrapped |
| D-07 | Medium | **All three leak `error.message` on 500** — the F-81 / F-98 / P4-20 class, already fixed three times elsewhere in this codebase | `stats.ts:151`, `daily-stats.ts:75`, `trends.ts:110` | **fixed** — uses `fail()` |
| D-08 | Low | **Counts are unscoped and inconsistent with the rest of the app.** `prisma.product.count()` includes deactivated products (delete became deactivation in F-63); `invoice.count()` and `purchase.count()` have no FY filter while every report is FY-scoped | `stats.ts:34,40,43` | **partly fixed** — `product.count` is now `is_active: true`. The FY scoping of the sales/purchase counts is left alone deliberately and documented in the handler: the cards say "Total", and rescoping them changes what the number means rather than correcting it. Owner’s call |
| D-09 | Low | **"Today" is the server's today.** `new Date()` on the server decides the window. With the server in UTC and the business in IST, anything between 00:00 and 05:29 IST lands in the wrong day — F-07's class | `stats.ts:15-20` | **fixed** — the browser sends `today`, `salesDate` and `purchasesDate`; verified a supplied date is honoured and junk falls back |
| D-10 | Low | **Non-OK responses are swallowed.** All three fetchers do `if (response.ok)` with no `else`, so a 500 leaves the dashboard showing zeros with no error state and no retry | `index.tsx:93,108,138` | **fixed** — an error banner with a Retry button |
| D-11 | Low | `trends.ts:54` computes `formattedDateString` and never uses it. `stats.ts` selects `taxrate` and never reads it | read of both files | **fixed** — removed with the endpoints |
| D-12 | Low | **N+1 by construction in trends**: five day-buckets each issuing three queries, where two grouped queries over a date range would do | `trends.ts:35-103` | **fixed** — the five day-buckets are gone; the merged endpoint issues one `Promise.all` |
| D-17 | Medium | **`parseDateRange()` carries the bug its own file warns about.** `new Date("YYYY-MM-DD")` parses as UTC midnight and `.setHours(0,0,0,0)` then applies local hours, so in any timezone behind UTC the range starts a day early. `convertDateToTimestamp()` in the same file parses the parts by hand and is correct. Harmless in IST, and it has callers outside this audit | `lib/date-utils.ts:185-197` | open |

---

## 2. Cross-cutting: `lib/db.ts` and the debug route

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| D-13 | Medium | **`/api/debug/query-stats` ships as a live route** that returns raw SQL text and timings. It is behind `middleware.ts` so it needs a session, but there are no roles (F-05), so any signed-in user can read it | `pages/api/debug/query-stats.ts` | **fixed** — route deleted; verified 404 |
| D-14 | Medium | **…and it has never worked.** The `query` event emitter it depends on is **commented out** at `lib/db.ts:14`, so the `$on('query')` handler never fires, `queryTracker` is always empty, and the endpoint always reports `totalQueries: 0`. Dead machinery behind a live route advertising a feature | `lib/db.ts:13-48` | **fixed** — tracker deleted from `lib/db.ts` |
| D-15 | Low | **A latent O(n) sweep per query.** If that emitter is ever re-enabled, `lib/db.ts:42-47` walks the entire tracker map on **every single query** to expire old entries | `lib/db.ts:41-47` | **fixed** — the O(n) sweep went with it |
| D-16 | Low | `lib/db.ts:11` reads `globalForPrisma.prisma` but `:20` writes `global.prisma`. Same object at runtime, two different declared types, one of them untyped | `lib/db.ts:3-20` | **fixed** — read and written through the same typed reference |

---

## 3. Export and print

All eleven settings pages except `businessdetails` mount the shared
`components/common/ExportMenu.tsx` (702 lines). There is **no server-side export** — no
`pages/api/export`, nothing in `pages/api/reports` that emits a file. Everything is
client-side, over whatever rows are currently in the page's state.

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-01 | **High** | **"Export as PDF" does not produce a PDF.** It injects a `<style>` block and calls `window.print()`. Whether a PDF appears depends entirely on the user picking "Save as PDF" in the browser's print dialog. A `Printer` icon is imported and never used, and the menu offers no Print option — so the one thing it actually does is the one thing it does not offer | `ExportMenu.tsx:79-311`, `:294`, `:2`, `:634-647` | **fixed** — relabelled "Print / Save as PDF", which is what `window.print()` does; the unused Printer icon is now the one shown |
| S-02 | **High** | **Stored XSS in the print header.** Business details are interpolated into `innerHTML` with no escaping — `name`, `tagline`, `address_line_1/2`, `pin_code`, `phone`, `phone2`, `email`, `fax`, `gstin`. A business name containing `<img src=x onerror=…>` executes in the operator's session on every export. Business details are editable from Settings by any signed-in user, and there are no roles (F-05) | `ExportMenu.tsx:267-286` | **fixed** — `escapeHtml()` in `lib/html.ts`, applied to every interpolation |
| S-03 | Medium | **Exported rows are only the current page.** `data` is the page's state array, so an export from a 50-row page of a 600-row table silently produces 50 rows, titled as a full report | every call site, e.g. `warehouse.tsx:270` | **partly fixed** — the dialog now states how many rows and columns will actually go. Exporting beyond the current page needs the endpoint to serve it, which is S-89 |
| S-04 | Medium | **The column selector is a decoration.** Every checkbox is `checked={true}` and `readOnly`, and the helper text says "All available columns will be exported". The modal offers a choice that does not exist | `ExportMenu.tsx:663-678` | **fixed** — the fake checkboxes are a plain list; a modal no longer offers a choice it cannot honour |
| S-05 | Medium | **Every page that mounts the menu fetches `/api/business-details` on mount**, whether or not the user ever opens Export — an extra request on eleven settings pages plus products, sales and purchases. `hooks/useBusinessDetails.ts` already exists (added for F-53), so this is a second, duplicate data path for the same record | `ExportMenu.tsx:51-65` | **fixed** — business details load when the menu is opened, not on every page mount |
| S-06 | Medium | **A generic component hardcodes domain knowledge.** `handleColumnSelection` is a 17-case switch over `invoice_no`, `customer_name`, `vendor_name`, `payment_status`, `payment_mode`, `stock_quantity`, `selling_price`… and `exportViewPageToExcel` is written **entirely for purchases** — "PURCHASE ITEMS", "Vendor GSTIN", `config.title \|\| 'Purchase Details'`. Settings pages fall through to the `default` branch | `ExportMenu.tsx:342-424`, `:433-612` | open |
| S-07 | Medium | **`0` exports as blank.** The `default` branch is `item[key] \|\| ''`, so a 0% GST rate, a stock of 0 or a status of 0 exports as an empty cell. The same falsy-guard class as F-31 | `ExportMenu.tsx:423` | **fixed** — `?? ''` instead of `|| ''`, so a real 0 exports as 0 |
| S-08 | Low | **Export ignores the page's own formatters.** Users exports `status` as the raw `10`/`0` and `created_at` as a Unix integer, while the table renders them through `getStatusText()` and `formatDate()` | `users.tsx:207-214` vs `:168-174` | open |
| S-09 | Low | `tableRef` and `pageType` props are declared and never used; `isViewPage()` sniffs `window.location.pathname` instead of reading the `pageType` prop that exists for exactly that | `ExportMenu.tsx:21,23,41-48` | **fixed** — `tableRef` removed; `pageType` is now read and beats the URL sniff |
| S-10 | Low | `require('../../lib/export-utils')` inside two functions rather than a top-level import — CommonJS in a TSX component, so the import is untyped and unbundleable | `ExportMenu.tsx:429,602` | **fixed** — top-level typed import |
| S-11 | Low | Print styles are removed on a fixed `setTimeout(…, 1000)`. If the print dialog is still open, the page restyles underneath the preview. The injected header is also removed by `querySelector`, so two overlapping exports remove the wrong node | `ExportMenu.tsx:297-306` | **fixed** — cleanup runs on `afterprint` and removes the header it created, not whichever one it finds |

---

## 4. Settings — cross-cutting

These repeat across pages. Each is one fix, not eleven.

| ID | Sev | Finding | Affected | Status |
|---|---|---|---|---|
| S-12 | Medium | **The debounce is defeated.** The effect keys on `debouncedSearchTerm` but the request sends the raw `searchTerm`. It usually agrees because the effect fires after typing stops, but any render that fires the effect mid-change sends the wrong term | `states.tsx:61`, `users.tsx:60`, `inactive-products.tsx:88`, `warehouse-racks.tsx:123`. Correct in `warehouse`, `staffdetails`, `bankdetails`, `financialyear`, `gsttaxrate` | **fixed** — all four pages send the debounced, trimmed term |
| S-13 | Low | **Sorting does not return you to page 1**, so re-sorting from page 3 lands you on page 3 of a different order | `states.tsx:81`, `users.tsx:80`, `inactive-products.tsx:64`, `warehouse-racks.tsx:77`. Correct in the other five | **fixed** — sorting returns to page 1 on all four |
| S-14 | Low | **Serial numbers restart at 1 on every page.** Rendered as `index + 1` rather than `(page-1)*limit + index + 1` | `states.tsx:256`, `users.tsx:262`. Correct in `warehouse`, `staffdetails`, `mechanics`, `bankdetails`, `gsttaxrate`, `inactive-products` | **fixed** — the page offset is applied; `bankdetails` uses the value it was already computing |
| S-15 | Low | **Two error-reporting mechanisms.** `states` and `users` use `window.alert()`; every other page uses `showSnackbar`. `states.tsx` does not import the snackbar at all | `states.tsx:177`, `users.tsx:164`, `ExportMenu.tsx:309,439,610` | **fixed** — `states` and `users` report through the snackbar, and a failed load now says so |
| S-16 | Low | **A redundant duplicate effect.** Two `useEffect`s both reset the page to 1, one on `[debouncedSearchTerm]` and one on `[debouncedSearchTerm, sortBy, sortOrder]`. The first is entirely covered by the second | `staffdetails.tsx:57-67`, `financialyear.tsx:45-65`, `gsttaxrate.tsx:55-84` | **fixed** — one page-reset effect in each of the three pages |
| S-17 | Medium | **`useSnackbar?.() \|\| { showSnackbar: () => {} }`** — a hook called conditionally and silently stubbed out if absent. It violates the rules of hooks and turns a missing provider into silence rather than an error | `staffdetails.tsx:23`, `mechanics.tsx:23` | **fixed** — `useSnackbar()` called unconditionally in both twins |
| S-18 | Low | **Pagination controls are copy-pasted verbatim.** `getPageNumbers()`, the Previous/Next block and the ellipsis logic are byte-identical across all nine list pages, ~25 lines each | all list pages | open |

---

## 5. Settings — per page

### warehouse

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-19 | **High** | **The API accepts `status`, answers 200, and throws it away.** `PUT /api/warehouses` with an id in the **body** routes to `handlePut`, which reads only `{id, name, location}` and updates only those — the comment at `:187` says *"Status not updated - all warehouses are active"*, which is false: the page has a Deactivate button and the column holds `Inactive`. Verified live: PUT `{status:'Inactive'}` → **200 "updated successfully"**, row still `Active` | `warehouses/index.ts:146-202`, esp. `:184-188` | **fixed** — `handlePut` is a partial update and honours `status`; verified live: warehouse 2 Active → Inactive |
| S-20 | Medium | **One route, two PUT contracts, chosen by where the id is.** `handlePut` (id in body, full overwrite, ignores status) vs `handleIndividualPut` (id in query, proper partial update, honours status). The page uses **both** — body for edit (`:157-164`), query for the status toggle (`:208-214`) | `warehouses/index.ts:10-14`, `warehouse.tsx:157,208` | **fixed** — the toggle now uses `PATCH /api/warehouses/[warehouseId]/status`; the body-id PUT is a partial update and no longer the way to change status |
| S-21 | Medium | **Editing a warehouse cannot preserve its status**, because `handleEdit` never loads `status` into `formData` and the save sends `{id, name, location}`. It is only harmless because S-19 makes the endpoint ignore status — two defects cancelling out | `warehouse.tsx:133-141`, `:146` | **fixed** — a partial update cannot read an omitted field as a blanking |
| S-22 | Low | **Delete works, but not where anyone would look for it.** Soft delete lives at `DELETE /api/warehouses?id=4`; `DELETE /api/warehouses/4` is a 404 because there is no `[id].ts` — while `/api/warehouses/4/racks` *does* work. One resource, two routing conventions | `warehouses/index.ts:300`, `warehouses/[warehouseId]/racks.ts` | open |
| S-23 | Low | `const updatedWarehouse = await …` assigned and never used, three times | `warehouses/index.ts:182,281,312` | **fixed** — all three unused assignments removed |
| S-24 | Low | `status` is accepted on create with no validation — `status: 'Banana'` is stored. Name uniqueness is enforced in application code only, with no DB constraint, so two concurrent creates can both pass | `warehouses/index.ts:105,115-123` | open |

### users

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-25 | **High** | **A user cannot be deactivated.** `status: parseInt(status.toString()) \|\| 10` — `parseInt("0")` is `0`, which is falsy, so `\|\| 10` flips Inactive back to **Active**. Present on both update and create, so an inactive user can be neither made nor kept. The F-31 falsy-guard class, this time on access control | `users/index.ts:98`, `:270` | **fixed** — `parseUserStatus()`; verified live: manager 10 → 0, and `status: "7"` → 400 |
| S-26 | Medium | **Update is a POST.** The page always POSTs to `/api/users`, and `handlePost` forwards to `handleUpdate` when an `id` is present. Every other settings page uses PUT | `users.tsx:147-148`, `users/index.ts:199-201` | open |
| S-27 | Low | **The page's `User` interface is stale and alarming.** It declares `auth_key`, `password_hash` and `password_reset_token`, none of which the API returns — the `select` correctly excludes them. No leak; but the type invites the reader to believe there is one | `users.tsx:8-20` vs `users/index.ts:158-166` | **fixed** — `users.tsx` uses `UserRow`, which is `Omit`-ed from the Prisma model |
| S-28 | Low | **No deactivate action.** Status is changed only by opening the edit modal, unlike staff, mechanics and warehouse which have a toggle button — and it would not work anyway (S-25) | `users.tsx:277-279` | open |
| S-29 | Low | `auth_key` is generated with `Math.random().toString(36)` — not cryptographically random. NextAuth does not use it today, which is the only reason it does not matter | `users/index.ts:259` | open |
| S-30 | Low | The magic number `10` for "Active" is repeated in the page, the API and the status label helper with nothing naming it | `users.tsx:169,269`, `users/index.ts:98,270` | **fixed** — `USER_STATUS_ACTIVE` and `userStatusLabel()` replace the bare 10 |

### states

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-31 | Medium | **Two dead interfaces that describe a row that does not exist.** `State` declares `name`, `code: string`, `gstStateCode`, `capital`, `region`, `status`; the real row is `{id, state_name, code: number}` and the table has no `status` column at all. Neither interface is used — the real shape is re-declared **inline four times** | `states.tsx:9-23` vs `:26,35,37,123` | **fixed** — both dead interfaces gone; `StateRow` used in all four places |
| S-32 | Low | **`sortBy=id` is silently ignored.** Unsupported sort fields fall back to `state_name` rather than returning 400, so a caller gets data that looks sorted and is not | verified live; `warehouses/index.ts:52-53` shows the same pattern | open |
| S-33 | Low | States can be created and edited but never removed or deactivated, and there is no `status` column to deactivate into | `states.tsx:259-261` | open |

### inactive-products

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-34 | **High** | **F-111 confirmed.** The page fetches page 1 of *all* products with `includeInactive=true`, then filters **client-side** to `is_active === false`. With 601 of 602 products active and the endpoint ordering by `id DESC`, page one is almost entirely active rows — so the screen is near-empty however many inactive products exist. Pagination is then recomputed from the filtered count, so it is meaningless too. This matters precisely because F-63 made delete a deactivation | `inactive-products.tsx:94,102,107-113` | **fixed** — `/api/products` gained `isActive`, and the page filters server-side. **Verified live**: deactivating product 602 moved it to `isActive=false` (1) with `isActive=true` at 601; restored |
| S-35 | Medium | **F-112 confirmed.** `sortBy`/`sortOrder` are sent to `/api/products`, which hardcodes `orderBy: { id: 'desc' }`. Every sortable header is inert | `inactive-products.tsx:90-91` | **fixed** — the products list honours `sortBy`/`sortOrder` against a whitelist. **Verified live**: asc and desc now return different rows, where both used to return `id desc` |
| S-36 | Low | The Category and Company headers sort by `category_id` and `company_id` while the columns display `categoryName` and `companyName` — so even once S-35 is fixed they would sort by a raw foreign key, not the visible text | `inactive-products.tsx:256,259` vs `:274-275` | **fixed** — Category and Company are plain headings, rather than sorting by a foreign key while showing a name |

### warehouse-racks

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-37 | **High** | **One request per warehouse, then sort and paginate in the browser.** `fetchRacks` loops over every warehouse issuing a separate call with `limit: 1000`, concatenates the results, sorts client-side and slices client-side — while the API already supports search, sort and paging. Cost grows linearly with warehouse count | `warehouse-racks.tsx:107-185` | open |
| S-38 | **High** | **Racks in the 51st warehouse onward are invisible.** `fetchWarehouses` calls `/api/warehouses` with no `limit` and no `dropdown=true`, taking the default first 50. The rack loop only iterates what it got. The F-58 class, in a page that was never covered by F-58's fix | `warehouse-racks.tsx:95-105` | **fixed** — the rack page fetches `?dropdown=true`, so warehouses past the 50th exist for it |
| S-39 | Medium | **Pagination reports a total it does not hold.** `totalRacks` sums each warehouse's server-side `pagination.total`, but `allRacks` holds at most 1000 rows per warehouse — so `total` and the rows can disagree, and the page count with them | `warehouse-racks.tsx:135,174-178` | open |
| S-40 | Medium | **The `isFetching` guard drops requests.** The effect calls `fetchRacks()` only `if (!isFetching)`, and `fetchRacks` itself returns early when `isFetching`. A dependency change during an in-flight request is **silently discarded** with no retry, leaving the list stale for the new filter. `bankdetails.tsx` has the same guard | `warehouse-racks.tsx:65,108`; `bankdetails.tsx:64-68,76` | open |
| S-41 | Low | `warehouse_name`/`warehouse_location` are attached client-side but absent from the `WarehouseRack` interface, forcing `any` casts in the sort and index steps | `warehouse-racks.tsx:129-133,143,168` | open |

### staff / mechanics — the twin diff

The two pages are near-copies that have drifted. `staffdetails.tsx` is the better of the
two and is the right reference for the rest of Settings: debounced+trimmed search, sort
resets the page, offset-correct serial numbers, snackbar throughout, shared validators
from `lib/validators.ts`, RESTful `PUT /api/staff/{id}`, and an `AbortController` so a
cancelled status change actually cancels.

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-42 | Medium | **mechanics builds its query string by concatenation**, encoding only `search`; `sortBy` and `sortOrder` go in raw. staff uses `URLSearchParams` for all of it | `mechanics.tsx:70` vs `staffdetails.tsx:76-82` | **fixed** — `URLSearchParams` encodes the whole query string |
| S-43 | Low | **The twins disagree about who owns `status` on edit.** mechanics carries `status` in `formData` and sends it; staff has it **commented out** in three places | `mechanics.tsx:32,115,126` vs `staffdetails.tsx:32,132,143` | **fixed** — the vestigial `status` field is out of mechanics’ `formData` |
| S-44 | Low | mechanics does not `.trim()` the search term; staff does | `mechanics.tsx:70` vs `staffdetails.tsx:79` | **fixed** — the term is trimmed, matching its twin |
| S-45 | Low | mechanics merges the pagination response (`{...prev, ...data.pagination}`); staff replaces it wholesale | `mechanics.tsx:78` vs `staffdetails.tsx:91` | open |

### financialyear · gsttaxrate · bankdetails · businessdetails

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-46 | Medium | **Two PUT shapes on one endpoint again.** `handleSetAsCurrent` PUTs `{fyId}` while the save path PUTs the whole record — the same ambiguity as S-20 | `financialyear.tsx:100-104` | open |
| S-47 | Low | The date-formatting IIFE is copy-pasted twice inside one function, and `lib/date-utils.ts` already exists | `financialyear.tsx:151-164` | **fixed** — removed with `handleEdit` (S-58) |
| S-48 | Low | `fetchFinancialYears` has no `else` on a non-OK response — a failed load is silent | `financialyear.tsx:82-88` | **fixed** — a non-OK load reports through the snackbar |
| S-49 | Low | **Dead status-change state.** `showStatusChangeModal`, `changingRate`, `changingLoading` and `abortController` are declared, and `:161` records that the toggle handler was removed | `gsttaxrate.tsx:43-51,161` | open |
| S-50 | Low | Saving a GST rate shows no success snackbar, while the equivalent save on `warehouse` does | `gsttaxrate.tsx:187-193` | **fixed** — a successful save confirms, like its siblings |
| S-51 | Low | **A second implementation of a shared rule.** `businessdetails.tsx` defines its own `isTenDigits` while `lib/validators.ts` exports `isTenDigitPhone`, which staff and mechanics import. F-54's fix created a local copy instead of using the shared one | `businessdetails.tsx:88` vs `lib/validators.ts` | open |
| S-52 | Low | `businessdetails` is the only settings page with no export, and assumes `id: 1` as its default record | `businessdetails.tsx:24` | open |

---

## 6. What the probes measured

Recorded because the numbers are the evidence for several findings above, and because the
probes are checked in and re-runnable. **They are supporting evidence, not the method.**

**Validation is genuinely solid.** Every malformed payload was correctly rejected 400:
empty staff name, letters as a phone number, a negative GST rate, an out-of-range GST
state code, an empty warehouse name.

**CRUD round trip** (create → read back → update → deactivate → delete), test rows removed:

| Resource | Create | Returns id? | Read back | Update | Deactivate | Delete |
|---|---|---|---|---|---|---|
| staff | 201 | **no** | found | 200 `/7` | 200 → `Inactive` | 200 |
| mechanics | 201 | **no** | found | 200 `/2` | 200 → `Inactive` | 200 |
| warehouses | 201 | **no** | found | 200 (collection) | 200 → **still `Active`** (S-19) | 404 (S-22) |

| ID | Sev | Finding | Status |
|---|---|---|---|
| S-53 | Medium | **No create endpoint returns the new record's id** — staff, mechanics and warehouses all answer 201 with only a message, so a UI cannot navigate to, highlight or link what it just created | **fixed** — `created()` returns the record; verified live: staff create returned `data.id` |
| S-54 | Medium | **`return-reasons` ignores everything**: `limit` ignored, page 2 repeats page 1, `sortOrder` has no effect, and a nonsense `search` returns all rows. It is a bare dump — and per F-50 it has a GET-only API and no settings page at all | open |
| S-55 | Low | **`dropdown=true` never reached `users` or `states`.** F-58's fix landed on customers, vendors, staff, mechanics, warehouses and gst-rates. 37 states sits under the default 50, so it is latent rather than live | open |

---

## 7. Optimization — duplicate code, API merges, shared types, common functions

Requested explicitly. None of this changes what the app computes; all of it reduces the
surface on which the defects above keep recurring.

### 7a. Merge the three dashboard endpoints into one

`stats`, `daily-stats` and `trends` are three round trips for one screen, and `trends`
already computes per-day sales and purchases — which is exactly what `daily-stats` returns
for a single day. One `GET /api/dashboard?date=YYYY-MM-DD` would serve the whole page in a
single call. Combined with **D-01** (drop the unused trends fetch) and **D-02** (stop
fetching the same day twice), the dashboard goes from **four calls and ~1712 ms to one
call**.

### 7b. Extract the list-page shell

All nine list pages repeat the same ~120 lines: `pagination` state, `handlePageChange`,
`handleLimitChange`, `getPageNumbers`, `handleSort`, `getSortIcon`, the items-per-page
select, the "Showing X to Y of Z" line, and the Previous/Next/ellipsis block. Every
cross-cutting finding in §4 is a place where one copy drifted from the others.

A `useListQuery()` hook (search + sort + page + limit, URL-mirrored, correctly debounced)
plus a `<ListPagination>` component would delete roughly **900 lines** and make S-12
through S-18 structurally impossible.

### 7c. One place for shared types

`interface Warehouse` is declared in `warehouse.tsx` **and** `warehouse-racks.tsx`. The
pagination shape is re-declared in all eleven pages. `states.tsx` carries two interfaces
that describe a row that does not exist while re-declaring the real one inline four times
(S-31), and `users.tsx` declares columns the API deliberately does not send (S-27).

`types/settings.ts` exporting the row shapes and one `Paginated<T>`, generated from or
checked against Prisma's types, removes a whole class of "the page and the API disagree
about a field".

### 7d. Common functions that already exist and are not used

- `lib/validators.ts` has `isTenDigitPhone`; `businessdetails.tsx` wrote its own (S-51).
- `hooks/useBusinessDetails.ts` exists; `ExportMenu` fetches the record itself (S-05).
- `lib/date-utils.ts` exists; `financialyear.tsx` inlines date formatting twice (S-47).

### 7e. Settle one routing convention

Right now a single resource family offers: id in the body (`PUT /api/warehouses`), id in
the query (`PUT /api/warehouses?id=4`), id in the path (`PUT /api/staff/4`), a path
segment that 404s (`DELETE /api/warehouses/4`), a nested path that works
(`/api/warehouses/4/racks`), and POST-as-update (`/api/users`). Pick the path-segment form,
which `staff` already uses correctly, and make the others match.

### 7f. Delete what is dead

`/api/debug/query-stats` and the tracker behind it (D-13, D-14); the "mixed date format"
fallbacks (D-05); the fake column selector (S-04); the dead status-change state in
`gsttaxrate` (S-49); the unused interfaces in `states` and `users`; `const
updatedWarehouse` ×3 (S-23).

---

## 8. Suggested order

**Broken before wrong, and cheap before expensive.**

1. **S-25** — users cannot be deactivated. Access control, one-line falsy guard.
2. **S-19 / S-20** — warehouse status silently discarded; one route, two contracts.
3. **S-02** — escape the business details before injecting them into the print header.
4. **D-03** — make the dashboard use the same low-stock rule as everything else.
5. **D-01 / D-02** — stop fetching what is never shown, and stop fetching it twice. Then §7a.
6. **S-34 / S-35** — Inactive Products cannot be trusted to list inactive products.
7. **S-37 / S-38** — racks: stop the per-warehouse loop; stop losing warehouses past 50.
8. **S-01** — either produce a real PDF or rename the action to Print.
9. **D-04 / D-05** — the SQL precedence bug and the duplicated dead date handling.
10. **D-06 / D-07** — observability on the two unwrapped endpoints; stop returning
    `error.message`.
11. **§4 cross-cutting** (S-12…S-18) as the single shared fix of §7b, not eleven patches.
12. Everything else, by severity.

**Not started:** the render halves of the seven pages listed in §0, and the settings APIs
other than warehouses and users. Several findings above are about pages whose API has not
yet been read, so their severity may move in either direction — which is exactly what
happened to F-95 and F-96, and to two of my own claims in §0.

---

## 9. Second pass — the halves that were unread

Added after reading every settings page end to end. §0 said the render halves were
outstanding and that severities could move in either direction. They did, in both
directions, which is the third time in this audit that finishing a file has changed an
answer.

### Corrections to findings above

| ID | Was | Actually |
|---|---|---|
| **S-18** | "Pagination controls are copy-pasted verbatim across all nine list pages" | **Wrong.** There are **two** implementations. `staffdetails` and `mechanics` use a simple Previous / "Page X of Y" / Next with no page numbers, no ellipsis and no `getPageNumbers()`, and they inline their page changes. The other seven use the ellipsis version. Worse than one copy: two competing behaviours. See S-56 |
| **S-43** | "The twins disagree about who owns `status` on edit — mechanics sends it, staff does not" | **Half wrong.** Both twins have the status select commented out (`staffdetails:454-466`, `mechanics:439-451`) — both deliberately treat status as a transition, which is correct. The real defect is narrower: **mechanics still carries `status` in `formData` and transmits it on every save** though nothing sets it (`mechanics.tsx:32,126,160`). A vestigial field, not a disagreement |
| **S-49** | "Dead status-change state in `gsttaxrate`" | **Invalid.** The machinery is live — `handleStatusChange:215`, `confirmStatusChange:228`, `cancelStatusChange:266`, wired to a real button at `:384-389`. Line 161's comment refers to an older `is_active` toggle, not this one. Withdrawn |
| **S-14** | "Serial numbers restart at 1 — `states`, `users`" | **Add `bankdetails`, and it is worse there.** It computes the offset-correct `index` in `fetchBankAccounts:96` and then renders `index + 1` from the map anyway (`:292`), discarding the value it just calculated |

### New findings

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-56 | Medium | **Two pagination components, and two different end-of-list rules.** `staff`/`mechanics` disable Next on `!pagination.hasMore`; the other seven disable on `page === totalPages`. Whichever is right, they cannot both be | `staffdetails.tsx:397-403`, `mechanics.tsx:382-388` vs e.g. `bankdetails.tsx:307-317` | open |
| S-57 | **High** | **Column names and UI labels are swapped, in two places.** In `gst_tax_rate` the form labels `description` as **"Applicable"** and `applicable_for` as **"Description"**, and the table and export both render `applicable_for` under "Description". In `bank_details`, `bank_name` is labelled "Account Name" and `bank_address` is labelled "Bank Name". The screens are internally consistent, so nothing looks wrong — but anyone writing a query, report or export against `gst_tax_rate.description` or `bank_details.bank_address` gets the opposite field | `gsttaxrate.tsx:429,461,372,315`; `bankdetails.tsx:242,244,275,281` | open |
| S-58 | Medium | **`financialyear`'s entire Edit path is unreachable.** There is no Edit button — the table's only action is "Set as Current" (`:428-438`). So `handleEdit` (`:146-167`), the `editingYear` state, the "Edit Financial Year" title and the read-only ID field are dead. `handleConfirmSubmit` only ever POSTs, so even if Edit were wired it would attempt a create | `financialyear.tsx:146,255-265,428-438,464-476` | **fixed** — the unreachable edit path is gone: no `editingYear`, no `handleEdit`, no ID field, and the modal only adds. Restoring FY editing is an owner decision and needs an API operation that does not exist |
| S-59 | Low | **`financialyear` has a fully-wired search with no search box.** The filter card is commented out (`:312-342`) while `searchTerm`, `useUrlState`, `useDebounce`, the fetch parameter and two page-reset effects are all live. The current-FY banner is also commented out (`:344-353`) while `currentFy` is computed at `:305` and never read | `financialyear.tsx:305,312-353` | **fixed** — the commented-out search card and banner removed, and the computed `currentFy` that nothing rendered |
| S-60 | Low | **`financialyear` exports a column the model does not have.** `status` is not on `FinancialYear`; the table derives Current/Inactive from `currentFyId` instead. The export therefore emits a permanently blank Status column | `financialyear.tsx:362` vs `:10-15,422-426` | **fixed** — exports `start_date`/`end_date` instead of a `status` column the model lacks |
| S-61 | Low | **Dead branch and a no-op ternary in one function.** `let url = '/api/warehouse-racks'` names a route that does not exist, then an `if/else` assigns **the same value in both branches**; `requestBody` is a ternary whose two branches are equivalent | `warehouse-racks.tsx:236-244` | **fixed** — the dead branch, the phantom route and the no-op ternary are gone |
| S-62 | Medium | **A rack cannot be moved between warehouses, but the form offers it.** The edit PUT goes to `/api/warehouses/${form.warehouse_id}/racks` — the *new* warehouse — while F-32 correctly scoped the API's rack lookup to the warehouse in the URL. Changing the warehouse in the edit modal therefore targets a warehouse that does not own the rack | `warehouse-racks.tsx:239`, `warehouses/[warehouseId]/racks.ts` (F-32) | **fixed** — the edit PUT addresses the warehouse that OWNS the rack; the destination travels in the body |
| S-63 | Low | **A state transition forced through a field-update endpoint.** The rack status toggle must send `rack_number` alongside `{id, status}`, with the comment *"Include current rack_number as required by API"*. This is exactly the shape F-91 established should get its own route | `warehouse-racks.tsx:304-308` | **fixed** — the page no longer resends `rack_number`; the handler never required it. Code-verified only, since no racks exist to exercise |
| S-64 | Medium | **The warehouse name is resolved two ways, and they disagree.** `fetchRacks` attaches `warehouse_name` to every row (`:129-133`), but the table ignores it and does its own `warehouses.find()` per row (`:428`), while the **export** uses the attached field (`:368`). When the warehouse list truncates at 50 (S-38) the table renders "Unknown Warehouse" and the export renders the correct name, for the same row | `warehouse-racks.tsx:129-133,368,428-434` | **fixed** — the table uses the `warehouse_name` already attached to each row, which is what the export was using |
| S-65 | Low | **Sort headers sort by id while the column shows a name.** "Warehouse" sorts `warehouse_id`, "Category"/"Company" sort `category_id`/`company_id` — so even where sorting works, it orders by a foreign key rather than the visible text | `warehouse-racks.tsx:400`, `inactive-products.tsx:256,259` | **fixed for racks** — sorts by `warehouse_name`. The inactive-products half is S-36 |
| S-66 | Medium | **`gsttaxrate` offers two ways to change status** — a dropdown inside the edit form (`:470-480`) *and* a Deactivate/Activate toggle (`:384-389`). Staff and mechanics deliberately removed the form control precisely so that status is only ever a transition | `gsttaxrate.tsx:384-389,470-480` | **fixed** — the status dropdown is gone from the edit form; the Deactivate button calls `PATCH /api/gst-rates/[id]/status` |
| S-67 | Low | **Three different phone-input behaviours.** `businessdetails` strips non-digits on every keystroke; `staff`/`mechanics` accept free text and validate on submit; `users` relies on an HTML `pattern`. `businessdetails` also uses raw `<input>` where every other page uses the shared `ClearableInput` | `businessdetails.tsx:333-338,224`, `staffdetails.tsx:432`, `users.tsx:337-343` | open |
| S-68 | Low | **The Save button on `businessdetails` fires twice.** It carries `onClick={handleSubmit}` and sits inside a `<form onSubmit={handleSubmit}>` with no `type`, so it defaults to `type="submit"` and triggers both. Harmless only because `handleSubmit` is idempotent | `businessdetails.tsx:206-211,216` | **invalid** — re-read: the Save button sits OUTSIDE the `<form>` (`:186-214` vs `:216`), so there is no double fire. Withdrawn |

### What the second pass changes about the plan

Nothing in §8's order, but it strengthens the case for §7. Of the thirteen new findings,
**nine are a page and its API, or a page and its own export, disagreeing about what a
field is called or who owns it** — S-57, S-60, S-62, S-63, S-64, S-65, S-66, plus the
corrected S-18 and S-43. That is the same seam problem the Phase 4 completion pass found
in the service layer, in a different layer of the same codebase.

`staffdetails` remains the reference for the UI half: it is the only page where search,
sort, paging, serial numbers, error reporting, validation and the status transition are
all done the way the rest should follow. Its two blemishes are the redundant duplicate
effect (S-16) and the odd pagination control (S-56).

### Coverage is now complete for the pages

All eleven settings pages and `pages/index.tsx` have been read end to end, plus
`ExportMenu`, `lib/db.ts`, the debug route, the three dashboard endpoints, and the
warehouses, users and staff APIs.

**Still unread, and the remaining risk:** the settings APIs for bank-details,
business-details, financial-years, gst-rates, mechanics, states, return-reasons and
`warehouses/[warehouseId]/racks.ts`. Several findings above are inferred from the page's
call shape rather than the handler — S-62 in particular rests on F-32's recorded behaviour
rather than a fresh read. Those eight files are the next thing to read, before the
unification in §7 is designed against them.

---

## 10. Third pass — the settings APIs

Every settings API is now read end to end: `staff/{index,[id]}`,
`mechanics/{index,[id]}`, `states/{index,[id]}`, `bank-details`, `business-details`,
`financial-years`, `gst-rates`, `return-reasons`, `warehouses/[warehouseId]/racks`, plus
`warehouses/index` and `users/index` from the first pass. **Coverage of this audit's scope
is now complete.**

### Observability — the question answered

**Every settings API is wrapped in `withObservability`.** All twelve. The only unwrapped
routes anywhere in this surface are `dashboard/stats.ts` and `dashboard/trends.ts`
(**D-06**) and `debug/query-stats.ts` (**D-13**). So the concern about the "balance ones"
does not apply here — settings is fully instrumented, and the gap is on the dashboard.

### Corrections

| ID | Was | Actually |
|---|---|---|
| **S-53** | "No create endpoint returns the new record's id" | **One exception.** `financial-years` POST returns the created record (`:277-281`). Every other create — staff, mechanics, warehouses, bank-details, gst-rates, states, users, racks — returns only `{status, message}` |
| **S-62** | "The API refuses to move a rack between warehouses" | **Cause inverted, defect stands.** The API *does* support the move — `targetWarehouseId` is handled explicitly (`racks.ts:181-227`) and F-32's comment says so. The bug is in the **page**: it PUTs to `/api/warehouses/${form.warehouse_id}/racks`, the **destination**, while the URL-scoped lookup (`:194-199`) searches the warehouse that currently *owns* the rack. It should PUT to the rack's current warehouse with the new one in the body |

### New findings

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| S-69 | **High** | **Type checking is switched off for every rack query.** `(prisma as any).warehouse_racks` on all six calls, and `(prisma as any).product.count` too — `product` certainly exists on the client, so the cast is habit, not necessity. Nothing about a rack query is type-checked: not the field names, not the filters, not the result. This is the same class as the `: any` annotations the audit already counted in the money paths | `racks.ts:74,88,135,148,194,238,272,301,315,325` | open |
| S-70 | **High** | **Two tables store "which state" in two different formats.** The state-delete guard compares `customer_details.billing_state` against the state **name** and `vendor_details.state` against the state **id as a string**, in adjacent queries. Any code that joins, filters or reports on state has to know which convention each table uses | `states/[id].ts:149-160` | open |
| S-71 | Medium | **"Delete" means something different for states.** `staff`, `mechanics` and `warehouses` soft-delete to `status: 'Inactive'`; `states` and `racks` **hard-delete**. `states` has no `status` column to soft-delete into. Directly in scope for a single delete/deactivate convention | `states/[id].ts:169`, `racks.ts:325` vs `staff/[id].ts:128` | open |
| S-72 | Medium | **Five response envelopes across twelve endpoints.** `{staff, pagination}` / `{warehouses, pagination}` (resource-named key), `{success, data}` (return-reasons), `{status, message}` (most creates), `{status, message, data}` (bank-details PUT, business-details), `{financialYears, currentFyId, pagination}`. `bank-details` uses two of them **in one file** — POST returns `{status, message}`, PUT returns `{status, message, data}` | all settings APIs | **partly fixed** — `respond.ts` gives creates, updates and errors one shape, and `listResponse()` emits a canonical `data` key. The legacy resource-named list keys are still emitted alongside it, deliberately, because the sale and purchase forms read them; drop them once those move |
| S-73 | Medium | **`gst-rates` PUT never validates `id`.** It goes straight to `parseInt(id)`, so a missing id yields `findUnique({ where: { id: NaN } })`, a Prisma throw and a **500** where every sibling returns 400 | `gst-rates/index.ts:163-167` | **fixed** — `parseId()`; verified live: PUT with no id now 400, was 500 |
| S-74 | Medium | **The Indian FY rule is written twice.** `parseDate`, "must start April 1", "must end March 31", "must span exactly one year" exist in full in both `financialyear.tsx:179-210` and `financial-years/index.ts:138-188`. A statutory rule with two homes | both files | open |
| S-75 | Medium | **Sorting financial years by status loads the whole table.** The `status` branch does `findMany` with no `take`, sorts in JavaScript and slices — server-side client-pagination, the same shape as S-34 and S-37 | `financial-years/index.ts:45-78` | open |
| S-76 | Medium | **Two more blanket overwrites.** `business-details` PUT writes all eleven columns unconditionally, and `bank-details` PUT nulls `bank_address` and `ifsc` when they are omitted. Both are latent only because their pages always send every field — the F-78 shape | `business-details/index.ts:101-113`, `bank-details/index.ts:234-239` | **fixed** — `bank-details` PUT is partial. `business-details` still writes all eleven columns and is covered by S-88 below |
| S-77 | Medium | **`racks` has no sort support at all** — `orderBy` is hardcoded to `rack_number: 'asc'` and no `sortBy` is read. **This is why the page sorts client-side (S-37)**: the page is compensating for a missing API feature, not duplicating one | `racks.ts:86` vs `warehouse-racks.tsx:143-160` | open |
| S-78 | Low | **`isTenDigits` now has three implementations** — `lib/validators.ts` (`isTenDigitPhone`), `businessdetails.tsx:88`, and `business-details/index.ts:81`. S-51 recorded two | all three | **fixed** — the API copy now calls `isTenDigitPhone`; the page copy is S-67 |
| S-79 | Low | **A `select` built and then thrown away, in six files.** The create handler passes a `select` to Prisma, assigns the result to a const, and returns `{status, message}` without it — `staff:143`, `states:130`, `bank-details:133`, `gst-rates:138`, `mechanics:141`, `racks:148`, plus `warehouses:182,281,312`. The data the caller needs for S-53 is already being fetched and discarded | listed | **fixed** — the records are returned rather than discarded |
| S-80 | Low | **`parseInt` without a radix or a NaN guard** on ids in `bank-details` (`:196,211,233`), `business-details` (`:151,161`), `gst-rates` (`:167,179,199,222`) and `racks` (`:196,242,273`). `states/[id].ts` and `products/[id]/status.ts` do it correctly | listed | **partly fixed** — `gst-rates` uses `parseId()`. `bank-details`, `business-details` and `racks` still call bare `parseInt` and are covered by S-88 |
| S-81 | Low | **`settings.findFirst()` with no `orderBy`**, twice — the same non-determinism F-52 fixed for `business_details`. If a second `settings` row ever exists, the current financial year becomes whichever row the database feels like returning | `financial-years/index.ts:39,344` | **fixed** — both `settings.findFirst()` calls are ordered |
| S-82 | Low | **The same row fetched twice, four lines apart** — `existingState` then `stateRecord`, identical `findUnique` calls | `states/[id].ts:135,145` | **fixed** — the second lookup is gone |
| S-83 | Low | **`racks` takes the id from the query on DELETE and from the body on PUT**, in one file. The page never calls DELETE at all — it only toggles status | `racks.ts:172,292` | open |
| S-84 | Low | **The "case insensitive" duplicate checks are not.** Both `bank-details` and `states` OR the trimmed value with its `.toLowerCase()`, which catches an all-lowercase duplicate and nothing else — "HdFc" still passes. MySQL's default collation makes the whole clause redundant anyway | `bank-details/index.ts:114-121,208-221`, `states/index.ts:103-110` | **fixed** — the misleading `.toLowerCase()` clause removed from all four checks; MySQL collation already does this |
| S-85 | Low | **The state-delete guard misses document snapshots.** It checks live customers and vendors but not `bill_to` / `bill_tosales` / `shipto`, which also store a state. A state used on historical invoices can still be hard-deleted | `states/[id].ts:149-166` | open |
| S-86 | Low | `states/[id].ts` returns `id` as a **string** (`:113`) while every other endpoint returns a number. Its line 1 also begins with a stray leading space before `import` | `states/[id].ts:1,113` | **fixed** — returns the row, with `id` as a number |
| S-87 | Low | `financial-years` PUT round-trips a `Date` through a string and back — `parseDate(formatDbDate(date))` — whose only effect is dropping the time component | `financial-years/index.ts:313-329` | **fixed** — one `atMidnight()` helper replaces the string round-trip |
| S-88 | Low | **The tail of S-76 and S-80.** `business-details` PUT still writes all eleven columns unconditionally, so an omitted field is nulled; `bank-details`, `business-details` and `racks` still call bare `parseInt` on ids instead of `parseId()`. Split out from S-76/S-80 so the remainder is tracked rather than implied by a "partly fixed" | `business-details/index.ts:101-113,151,161`, `bank-details/index.ts:196,211,233`, `racks.ts:196,242,273` | open |
| S-89 | Medium | **An export still only covers the page on screen.** S-03 now says so in the dialog, but saying it is not serving it. A report titled "Warehouses Report" that silently contains 50 of 600 rows is the underlying problem, and fixing it needs the list endpoints to serve an unpaginated export set (they already can, via `dropdown=true`) and the menu to fetch it | `ExportMenu.tsx` `data` prop, every call site | open |

### What the API pass changes

**Two of the page-level findings turn out to be the API's fault, not the page's** — S-77
explains S-37 (the racks page sorts client-side because the API cannot sort), and S-62
reverses (the API supports the move; the page addresses the wrong warehouse). Both are
arguments for fixing the contract rather than the symptom.

**The good news is that the server side is mostly sound.** Validation is real and shared
(`lib/validators`, `lib/gst`, `lib/bank`), sort fields are whitelisted almost everywhere,
duplicate checks return 409, `staff` and `states/[id]` are close to the target shape
already, and every route is instrumented. What is missing is **agreement**: five envelopes,
three id conventions, two delete semantics, two update semantics, and one model with type
checking switched off.

That is precisely the unification in §7, and the API pass does not change its shape — it
sharpens it:

- **`staff/{index,[id]}` is the reference for CRUD.** Path id, partial update, soft delete,
  shared validators, whitelisted sort, correct `dropdown`.
- **`products/[id]/status.ts` is the reference for transitions** (F-91). `gst-rates`'
  status-only branch (S-66, `gst-rates:177-186`), the racks toggle that must resend
  `rack_number` (S-63) and the warehouse query-param PUT (S-20) all become one
  `PATCH /api/<resource>/[id]/status`.
- **The `select`-then-discard in six creates (S-79) is the fix for S-53** — the record is
  already being fetched; it just needs returning.

---

## 11. Fix log

Worked in blocks, each one verified before the next is opened. A block is closed
only when `npx tsc --noEmit` is clean, the behaviour is checked against the running
app where it is checkable, and the findings it covers are marked above.

### Block 1 — foundations · done

Three new modules. No behaviour change on their own; they are what the later blocks
are written against.

| File | Replaces |
|---|---|
| `lib/api/respond.ts` | Twelve hand-rolled catch blocks that returned `error.message`, and five response envelopes (S-72, D-07). `fail()` logs in full and returns a sentence; Prisma codes are translated (P2025→404, P2002→409, P2003→400). `created()` / `updated()` return the record, which is what S-53 needs. `parseId()` gives a 400 where `parseInt(undefined)` used to give a 500 (S-73, S-80) |
| `lib/api/list-query.ts` | Twelve copies of page/limit/search/sort parsing that disagreed. `limit` is now bounded, so `limit=0` can no longer produce `totalPages = Infinity` and `limit=100000` is no longer a table scan. `dropdown=true` is handled in one place, which is how `users` and `states` get F-58's fix they never received (S-55). An unrecognised sort field still falls back rather than 400-ing, but now reports `sortFellBack` so a caller can tell (S-32) |
| `types/settings.ts` | Row shapes redeclared per page, three of which were **wrong**: `states.tsx` described a row with `name`, `capital`, `region` and `status` that does not exist (S-31); `users.tsx` declared credential columns the API never sends (S-27); `financialyear.tsx` exports a `status` column the model lacks (S-60). These derive from `@prisma/client`, so a renamed column fails the build instead of quietly emptying a screen |

**Migration note.** `listResponse()` emits the canonical `data` key **and** the old
resource-named key (`staff`, `warehouses`, …) side by side. Several of these endpoints are
read by the sale and purchase forms, not only by their own settings page, so a single
breaking rename would take out screens outside this audit's scope. Drop the legacy key once
every consumer reads `data`.

### Block 2 — the three things that were broken · done

Not inconsistencies. Each of these silently did the opposite of what it said.

| Finding | Fix | Verified |
|---|---|---|
| **S-25** — a user could not be deactivated | `parseUserStatus()`. `parseInt("0")` is falsy, so `\|\| 10` had been putting the account back to Active on **both** create and update. Absent now means "keep the default"; a value that is neither 10 nor 0 is refused instead of guessed | Live: `manager` 10 → **0**, then restored to 10. `status: "7"` → **400** |
| **S-19 / S-21** — warehouse status accepted, answered 200, discarded | `PUT /api/warehouses` is a partial update: it writes what it is given and leaves the rest alone. The comment claiming *"all warehouses are active"* is gone, since the page has a Deactivate button and the column holds `Inactive`. This also disarms S-21 — the page's edit sends no `status`, and a partial update cannot read that as a blanking | Live: warehouse 2 Active → **Inactive**, then restored. Empty PUT → **400**, `status: "Banana"` → **400** |
| **S-02** — stored XSS in the print header | `escapeHtml()` in `lib/html.ts`, applied to all nine interpolations. Business details are editable by any signed-in user and this app has no role checks (F-05), so this ran in the operator's session on every export | `tsc` clean; escaping is by construction |

**S-23** went with S-19 — three `const x = await prisma…update(…)` assignments that were
never read.

**Data touched and restored:** user 2 (`manager`) and warehouse 2 (`Lower`) were flipped
and flipped back, because both fixes are only meaningful against a real row. Both are
confirmed back at their starting values above.

### Block 3 — the dashboard · done

**All sixteen dashboard findings closed** (D-08 partly, deliberately — see below).

Three endpoints became one. `stats`, `daily-stats` and `trends` are deleted;
`pages/api/dashboard/index.ts` serves the whole page. `pages/index.tsx` was the only
consumer of all three, checked before removing them.

| | Before | After |
|---|---|---|
| Requests on mount | 4 | **1** |
| API time | ~1712 ms | **~640 ms** |
| Queries | ~20, fifteen of them for a payload nothing rendered | one `Promise.all` |

**No raw SQL anywhere in the dashboard.** The low-stock count and the last-purchase
lookup were the only two `$queryRaw` calls, and both are now plain Prisma. The count
needed a field-to-field comparison, which is what the raw query was for —
`prisma.product.fields.min_stock` does it in the query builder, which is also how
`reports/minimum-stock.ts` already did it. That removed D-04's missing-parenthesis bug
(`A AND B OR C OR D`) and D-05's `REGEXP '^[0-9]+$'` ordering over an `Int` column in one
step, rather than fixing either.

**D-03 is the one worth reading twice.** The dashboard's "Low Stock" card said **1** while
the minimum-stock report and the products list both said **0**. It was a fourth definition
of "low" — `stock < min_stock AND min_stock IS NOT NULL` — and because `min_stock` is 0
across the catalogue (F-74), that reduces to `stock < 0`. The card had been reporting the
known negative-stock row (F-73) under a label that meant something else. Verified after the
change: all three now say 0.

**D-08 is deliberately half-done, and says so in the handler.** `product.count()` now
excludes deactivated products, which is unambiguously right since F-63 turned delete into
deactivation. The sales and purchase counts are still all-time rather than FY-scoped:
every report is FY-scoped, but these cards are labelled "Total", so rescoping them changes
what the number means instead of correcting it. That is the owner's decision, not a bug
fix, and it is recorded in the code rather than left as a silent difference.

**D-13 to D-16 went with it.** `/api/debug/query-stats` returned raw SQL to any signed-in
user in an app with no role checks — and had never worked, because the `emit: 'event'`
line that would have fed it is commented out in `lib/db.ts`, so it always answered
`totalQueries: 0`. Route deleted, tracker deleted, and with it the trap in its cleanup
loop, which walked the whole map on every query and was waiting for someone to re-enable
the emitter. `lib/db.ts` is now twenty lines.

**Verified live:** merged endpoint 200 at ~640 ms over three runs; `/api/dashboard/stats`
and `/api/debug/query-stats` both 404; a supplied `salesDate`/`purchasesDate` is honoured
and junk falls back to today; the dashboard page, a settings endpoint and the page itself
all still 200. `npx tsc --noEmit` clean throughout.

**One thing found while fixing, not yet fixed.** `parseDateRange()` in `lib/date-utils.ts`
carries the exact bug the file's own header warns about: `new Date("YYYY-MM-DD")` parses as
**UTC** midnight and `.setHours(0,0,0,0)` then applies **local** hours, so in any timezone
behind UTC it lands on the previous day. `convertDateToTimestamp()` in the same file does
it correctly, by parsing the parts by hand. It is harmless for an India deployment (IST is
ahead of UTC) and `parseDateRange` has callers outside this audit's scope, so it is
recorded rather than changed here. New finding **D-17**, Medium.

### Block 4 — the settings APIs onto one contract · done

Sixteen findings closed, two partly and deliberately so.

**Creates return what they made (S-53, S-79).** Six handlers were already fetching the row
through a Prisma `select` and then answering `{status, message}` without it. They now use
`created()`. Verified live: `POST /api/staff` came back with `data.id`.

**One deactivate route for every resource (S-20, S-63, S-66).** `lib/api/status-route.ts`
builds the handler; `staff`, `mechanics`, `gst-rates` and `warehouses` each get a
four-line `[id]/status.ts`. Warehouses had to use `[warehouseId]` because Next.js will not
allow two differently-named dynamic segments at one level and `[warehouseId]/racks.ts` was
there first — so the helper takes an `idParam`.

This replaces four different mechanisms: a query-param PUT whose body twin discarded status
(S-19/S-20), a status-only branch hidden inside a full-update PUT that only fired when all
four other fields were absent (S-66), a toggle that had to resend `rack_number` because a
comment wrongly said the API demanded it (S-63), and a status dropdown sitting in an edit
form beside a Deactivate button that did the same thing.

Verified live, all four behaving identically:

```
warehouse  -> Inactive          {"message":"Warehouse deactivated."}
warehouse  -> Inactive again    {"message":"Warehouse is already inactive."}   (idempotent)
gst-rate   -> Inactive/Active   {"message":"GST rate deactivated."} / activated
staff      -> Inactive/Active   {"message":"Staff member deactivated."} / activated
bad status                      400 "status must be 'Active' or 'Inactive'"
missing record                  404 "Warehouse not found"
bad id                          400 "A valid warehouse ID is required"
```

Every row touched was restored.

**Errors stop leaking (D-07 class).** Twelve hand-rolled catch blocks became `fail()`,
which logs in full and returns a sentence, translating Prisma codes. This is the fifth time
this class has been fixed in this codebase (F-81, F-98, P4-20, D-07) and the first time it
has been fixed in one place.

**S-73 verified**: `PUT /api/gst-rates` with no id was a 500 — `parseInt(undefined)` reaching
Prisma as `where: { id: NaN }`. Now 400.

**Two left deliberately half-done, and recorded rather than hidden:**

- **S-72** — `listResponse()` emits a canonical `data` key, but the old resource-named keys
  (`staff`, `warehouses`, …) are still emitted beside it. Several of these endpoints are read
  by the sale and purchase forms, which are outside this audit; a single breaking rename
  would take out screens nobody has looked at. The legacy keys go when those consumers move.
- **S-76 / S-80** — `bank-details` is now a partial update and uses the shared helpers, but
  `business-details` still writes all eleven columns and three files still call bare
  `parseInt`. Tracked as **S-88** rather than left implied.

**A mistake worth recording.** Splicing `financial-years` between two anchors, I matched the
*first* occurrence of a comment that appears in both `handlePost` and `handlePut`, and
removed 5,622 characters instead of 608 — taking the whole create handler with it. `tsc`
caught it immediately (`Cannot find name 'financialYear'`), the file was restored from git,
and the change was reapplied anchored to a string unique to `handlePut`. Re-verified after:
GET lists, POST rejects a non-April start and a duplicate year, PUT rejects a missing id and
still sets FY 4 as current.

**Checks:** `npx tsc --noEmit` clean after every step, and `npm run build` clean at the end
of the block.

### Block 5 — the settings pages · done

Thirty-four findings closed, one withdrawn.

**The UI foundation exists, and is deliberately not yet adopted.**
`hooks/useListQuery.ts` and `components/common/ListPagination.tsx` make S-12, S-13, S-14
and S-16 impossible by construction — there is one way to build the query string and it
uses the debounced term; `toggleSort` resets the page; `serialNumber(index)` carries the
offset. The nine list pages have **not** been moved onto them.

That is a judgement, not an oversight. Swapping nine pages onto a new state container is a
restructure that wants clicking through, and the four underlying defects are fixed at the
call sites today. Moving the pages across is the remaining refactor, and it is what closes
**S-18 / S-56** (two pagination implementations disagreeing about when a list ends).

**Inactive Products actually works now (S-34, S-35).** The page was fetching page one of
*all* products and filtering in the browser, because `/api/products` could ask for "active"
or "both" and had no way to ask for "inactive". It gained `isActive`, and a whitelisted
`sortBy`/`sortOrder` — it had been hardcoding `id desc` and silently ignoring the sort the
page had always sent.

Verified end to end: deactivating product 602 moved it to `isActive=false` (1 row) with
`isActive=true` at 601; reactivating restored 602. Sorting by `product_name` asc and desc
now returns different rows, where both previously returned `id desc`.

**Racks (S-38, S-61, S-62, S-64, S-65).** The move-between-warehouses bug turned out to be
the page addressing the *destination* warehouse while the handler scopes its lookup to the
*owner* — so a move could never find the rack it was moving. The URL is the source now, the
body the destination. The warehouse list is fetched with `dropdown=true`, so racks in the
51st warehouse onward can exist. The table and the export finally agree on where the
warehouse name comes from.

**Financial years (S-47, S-58, S-59, S-60).** The entire Edit path was unreachable: no Edit
button exists, and `handleConfirmSubmit` always POSTs. The API has no update-fields
operation for a financial year either, so editing one is not a feature that broke — it is a
feature that was never finished. Removed rather than half-restored; adding it is an owner
decision.

**Export (S-01, S-03, S-04, S-05, S-07, S-09, S-10, S-11).** "Export as PDF" is now
"Print / Save as PDF", which is what `window.print()` actually does. The checkbox list that
was `checked readOnly` no longer pretends to offer a choice, and the dialog states how many
rows and columns will really go. Business details load when the menu opens rather than on
every page mount. A real `0` exports as `0`. Cleanup runs on `afterprint` rather than a
1000 ms guess, and removes the header it created rather than whichever one it finds.

**One finding withdrawn.** **S-68** claimed the Save button on `businessdetails` fires
twice, being inside a form with an `onClick`. Re-reading, the buttons sit *outside* the
`<form>` (`:186-214` vs `:216`). There is no double fire. Marked invalid rather than
"fixed", because changing working code to close a finding is how a fix log starts lying.

**Checks:** `npx tsc --noEmit` clean after every step; `npm run build` clean; all eleven
settings pages return 200 after the changes.

**A note on the environment.** The dev server was stopped mid-block by the harness, which
reclaims background processes under memory pressure. Its Next.js child processes survived,
so live verification above was done against the server that was already running — not one I
restarted.
