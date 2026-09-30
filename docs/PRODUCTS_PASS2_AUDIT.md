# Products — Second Pass (code quality, and what the read turned up)

Fourth audit document, alongside `AUDIT_PLAN.md`, `JOURNEY_AUDIT.md` (Phase 3 / 3b / 3c is
the **first pass** on products) and `DASHBOARD_SETTINGS_AUDIT.md` (whose §7 and Blocks 1–8
are the model for this pass).

**Started:** 2026-09-30 · **Status:** Block 1 done — every §2 defect fixed; Blocks 2–8 (quality) not started.

Finding IDs are **PQ-nn** so they do not collide with `F-nn`, `L-nn`, `P4-nn`, `D-nn`, `S-nn`.
Each finding is tagged **Defect** (wrong behaviour) or **Quality** (duplication, dead code,
contracts, types — nothing a user sees today). Confidence as in `AUDIT_PLAN.md` §2:
**[C]** confirmed from the code, **[V]** needs a live check.

Status: `open` · `in-progress` · `fixed` · `by design` · `wontfix` · `invalid`

---

## 0. Scope, method, and what changed since pass 1

### Method

**Every file below was read in full, top to bottom.** No grep conclusions, no probe scripts
(`DASHBOARD_SETTINGS_AUDIT.md` §0). Greps were used only to find *callers* after a file had
been read, and each is stated as such where it matters.

The first pass audited **data flow** — does the right value reach the right column, does
the edit path corrupt anything. This pass audits **code quality** by the same criteria the
settings audit used (§7a–7f there): duplicate code, endpoints that should merge, shared
types, shared helpers not used, one routing convention, dead code — plus the API contract
the settings work established (`lib/api/respond.ts`, `lib/api/list-query.ts`,
`lib/api/status-route.ts`, `useListQuery`, `<ListPagination>`). Reading every line for
quality also surfaces behaviour defects; those are recorded first, in §2, because they
outrank everything else here.

### Coverage — 28 files, 8,928 lines

| Layer | Files (lines) |
|---|---|
| Rules and types | `lib/product.ts` (284), `types/products.ts` (146) |
| Product API | `api/products/index.ts` (633), `[id].ts` (458), `optimized.ts` (553), `filters.ts` (96), `[id]/status.ts` (84) |
| Lookup-table API | `categories.ts` (183), `subcategories.ts` (232), `companies.ts` (109), `models.ts` (123) |
| History API | `[id]/sales.ts` (101), `[id]/salex.ts` (101), `[id]/purchases.ts` (121), `[id]/sale-returns.ts` (126), `[id]/purchase-returns.ts` (126) |
| Hook | `hooks/useProducts.ts` (242) |
| Pages | `products/index.tsx` (188), `create.tsx` (944), `view/[id].tsx` (535), `lowstock.tsx` (169), `category.tsx` (393), `subcategory.tsx` (523), `company.tsx` (386), `models.tsx` (385) |
| Components | `products/ProductTable.tsx` (655), `products/CreateProductModal.tsx` (543), `common/ProductSelectionPanel.tsx` (461) |

`settings/inactive-products.tsx` is products-adjacent but was rewritten in settings Block 8
and is not repeated here. Shared modules the product code imports (`ExportMenu`,
`useExport`, `ExportColumnSelector`, `lib/broadcast`, `lib/sessionStorage`,
`withObservability`) were read only where a finding depends on them.

**10% of the module is comments (912 lines); `lib/product.ts`, `index.ts`, `optimized.ts`,
`[id].ts` and `[id]/status.ts` run 21–28%.** Most of those are fix narratives with finding
IDs. See PQ-50.

### Pass 1, in one table — what it changed and what it left

| State | Findings |
|---|---|
| Fixed in pass 1 (3, 3b, 3c) | F-43, F-62–F-72, F-75, F-76, F-78–F-100, F-102–F-106, F-108–F-110 |
| Fixed later, in settings Block 5 | **F-111** (= S-34) and **F-112** (= S-35) — `inactive-products` now asks the API for `isActive=false` and the API honours `sortBy` |
| By design | F-68 (inactive GST rate keeps applying), F-77 (id prefix on edited names) |
| **Still open** | **F-73** (product 211 at stock −1 — owner), **F-74** (`min_stock` unset on the whole catalogue — owner data), **F-101** (`barcode` column holds a URL *and* a scanned code), **F-107** (`optimized.ts` cannot serve inactive products) |

Pass 1's fixes are all still in place in the code read here. None has regressed.

---

## 1. Summary

**Eighteen behaviour defects that the first pass did not reach** (§2), five of them High —
mostly in files pass 1 never opened (`[id]/sales.ts` and its siblings, `lowstock.tsx`, the
four lookup-table pages) or in seams between two files that were each read separately
(`view/[id].tsx` formatting a date the server already formatted).

**The quality picture, in numbers:**

- **Two list endpoints for one table** (`index.ts` GET and `optimized.ts`) with different
  parameter names, sorts, defaults, response shapes and price rules. The list page and all
  three document forms use `optimized`; `index.ts` GET has two callers and ~200 lines of
  filter code nobody sends (PQ-20).
- **Five hand-written list shells** (`ProductTable` and the four lookup-table pages) — the
  code settings replaced with `useListQuery` + `<ListPagination>`, still carrying the
  S-12…S-18 defects Block 8 removed (PQ-24).
- **Duplicated helpers:** the FTP upload (byte-identical ×2), form parsing (×2, differing) (PQ-54),
  the latest-purchase-rate query (×3, disagreeing on tie-break), the four-position
  `car_model_ids` match (×4), the `/filters` fetch (×4), date parsing (×3, all with the
  D-17 timezone bug), and five history endpoints that are two templates (PQ-21, PQ-22, PQ-23).
- **None of the settings API contract is used.** `respond.ts`, `list-query.ts`,
  `status-route.ts`: zero imports in the product module. Five response envelopes, raw
  `error.message` in six 500 bodies, IDs in request bodies (PQ-30…PQ-35).
- **Dead code:** `CreateProductModal.tsx` (543 lines, imported nowhere, and broken if
  revived), the `?type=categories` branch, four commented-out delete handlers, dead props,
  dead state, dead buttons (PQ-40…PQ-44).

**Expected size change if §5 Blocks 2–6 are done: roughly −2,500 lines** (≈ −28% of the
module, before any comment trimming), almost all from deleting copies, with the new shared pieces already written for
settings.

---

## 2. Defects found on the read

These change what a user sees or what gets stored. **Fix before any refactor** — several
refactors below would otherwise have to preserve them.

| ID | Sev | Conf | Finding | Evidence | Status |
|---|---|---|---|---|---|
| PQ-01 | **High** | [C] | **Every date in the product view's five history tables is wrong.** The five `[id]/*` endpoints already return `date` formatted by `toLocaleDateString('en-IN')` — `"20/9/2026"` (d/m/yyyy) or `'-'`. The page formats it again with `new Date(x).toLocaleDateString('en-IN')`. JS reads `"20/9/2026"` as month 20 → **Invalid Date**; `"5/9/2026"` as **9 May** → day and month **swapped**; `'-'` → Invalid Date. Formatted twice, parsed once, wrongly | `view/[id].tsx:351,390,429,468,507` vs `[id]/sales.ts:75` (and the four siblings) | **fixed** (Block 1) |
| PQ-02 | **High** | [C] | **The product view's Sales and Sale X tables join on the wrong key.** Sale lines store the **header primary key** in `invoice_no` (`api/sales/index.ts:196,227,243` — `invoice_no: sale.id`; `AUDIT_PLAN.md` §3). `sales.ts` then looks the header up by `invoice.invoice_no IN (item.invoice_no)` — a PK compared against the human invoice number. The row shows the invoice number and customer of **whichever invoice happens to have that number**, or `-`. Same in `salex.ts` against `invoicex` | `[id]/sales.ts:31-41`, `[id]/salex.ts:31-41` | **fixed** (Block 1) |
| PQ-03 | **High** | [C] | **The product view's Purchases table merges purchases across financial years.** It finds headers by `invoice_no IN (…)` with no `fy`, and `purchase_items` carries `invoice_no` + `fy` with no `purchase_id`. Two purchases that share an invoice number in different years both match; the map keeps whichever came last. The L-1 class, on a read path Phase 4 did not list | `[id]/purchases.ts:31-37,55-57` | **fixed** (Block 1) |
| PQ-04 | **High** | [C] | **Low Stock page shows `-` for Category and Company on every row.** It renders `product.product_category` and `product.company`; `useProducts` produces `categoryName` and `companyName` | `lowstock.tsx:110-111` vs `hooks/useProducts.ts:63,66` | **fixed** (Block 1) |
| PQ-05 | **High** | [C] | **Saving a category, subcategory, company or car model fails silently.** `handleConfirmSubmit` ignores a non-OK response and the `finally` closes the confirm dialog. A duplicate category name (API 400) looks exactly like a successful save — the dialog closes, the list does not change, nothing is said. No page imports the snackbar. Load failures are silent too. The S-15 class, in all four | `category.tsx:202-224`, same in `company.tsx:205-227`, `models.tsx:205-227`, `subcategory.tsx` | **fixed** (Block 1) |
| PQ-06 | Medium | [C] | **Product view "Latest Rate" is always ₹0.** It renders `product.latestPurchaseRate \|\| product.rate`; the detail endpoint returns neither (it returns `latest_purchase_rate` and `sale_price`). The list shows a rate for the same product | `view/[id].tsx:259` vs `[id].ts:168-181` | **fixed** (Block 1) |
| PQ-07 | Medium | [C] | **The product form's Rack and Subcategory dropdowns stop at 50.** Both fetch a paginated endpoint with no `limit` or `dropdown`: `/api/warehouses/{id}/racks` and `/api/products/subcategories?category_id=`. F-64 fixed warehouses and GST rates on the same form and missed these two. **Consequence on edit:** a product whose subcategory is outside the first 50 loads with a blank subcategory name, and because the product name is built in the browser (PQ-12), **saving renames the product without its subcategory** | `create.tsx:219,243`; `ProductTable.tsx:190` has the same subcategory fetch | **fixed** (Block 1) |
| PQ-08 | Medium | [C] | **Typing a new category name in the Subcategory dialog creates that category.** The page sends `category_name` with `category_id: 0` whenever the text does not match an existing category; `subcategories.ts` POST and PUT **find-or-create** by name. A typo makes a stray category that then appears in every category dropdown | `subcategory.tsx:174`; `api/products/subcategories.ts:139-150,178-189` | **fixed** (Block 1) |
| PQ-09 | Medium | [C] | **The list page forgets its sort, and the arrow lies.** `ProductTable` keeps `sortBy`/`sortOrder` in local state initialised to `categoryName`/`asc` — never from the persisted sort, because `initialFilters` does not carry it. Back on the list, the query runs with the persisted sort but the arrow shows Category ↑, the next header click toggles from the wrong state, and **any filter change re-sends `categoryName asc`**, discarding the saved sort | `ProductTable.tsx:126-127,208-224`; `products/index.tsx:165-176` | **fixed** (Block 1) |
| PQ-10 | Medium | [C] | **The list page wipes a restored subcategory filter — F-88's mechanism on the list side.** An effect on `filters.categoryFilter` clears `subcategoryFilter`, and it fires on mount with the restored category. The UI then shows no subcategory while the query (parent state) still applies it; the next filter change sends `subcategory=''` and drops it. F-88's fix — clear on the user's pick, not in an effect — was applied to the form and not here | `ProductTable.tsx:163-171` | **fixed** (Block 1) |
| PQ-11 | Medium | [C] | **The Rate column sorts by a value it does not show.** `rate` in the list is the latest purchase rate; sorting by `rate` orders by `opening_rate` on both paths | `optimized.ts:315,347-348` vs `:431,438` | **fixed** (Block 1) |
| PQ-12 | Medium | [C] | **The product name is still decided in the browser.** `JOURNEY_AUDIT.md` 3b's own table says what a product is called should be decided "the server, from the FK ids it already has". It is still `generateProductDisplay()` in `create.tsx`, reading three lists loaded asynchronously and using **only the first car model**; `product_name` is not in `SERVER_OWNED_FIELDS`. F-77 (by design) covers the id prefix, not where the name is built. PQ-07's rename is this finding's worst case | `create.tsx:387-405,454`; `lib/product.ts:36-43` | **fixed** (Block 1) |
| PQ-13 | Medium | [C] | **The client chooses which file the server deletes, and what URL is stored.** On `PUT /api/products/[id]`, `fileStates.*.existingUrl` comes from the browser and is (a) written straight into `pic`/`barcode` on "keep existing", and (b) passed to `deleteOldFile()` after a new upload. Any caller can point `pic` at an arbitrary URL or delete any file in `/public_html/uploads` by name. The server has the stored URL and should use it — the §11 rule | `[id].ts:264-297,301-334` | **fixed** (Block 1) |
| PQ-14 | Medium | [C] | **A rejected edit can lose the product's picture.** Uploads — and deletion of the *old* file — happen before the concurrency check and the write. A 409 (someone else edited), or any database error after that point, returns with the new file orphaned and the **old file already deleted**, while the row still points at it. Order should be: upload → write → delete old, and delete the new upload if the write fails | `[id].ts:266-279,337-340` then `:373-389` | **fixed** (Block 1) |
| PQ-15 | Low | [C] | **The low-stock branch of `GET /api/products` reports every product at 0% GST.** The raw SQL selects `g.rate as gst_rate_value`; the shared mapper reads `p.gst_rate?.rate` (the Prisma relation shape). It also always orders `p.id DESC`, ignoring `sortBy` — F-62 again. Low: nothing sends `stockFilter=low_stock` to this endpoint today (PQ-20) | `index.ts:279,314,370` | **fixed** (Block 1) |
| PQ-16 | Low | [C] | **Deactivating from the product view leaves it on the list.** The toggle calls the status route with a bare `fetch`, then navigates to `/products` — but nothing invalidates the `['products']` query (`staleTime` 2 min) or broadcasts, so the product is still listed | `view/[id].tsx:105-117`; `hooks/useProducts.ts:103` | **fixed** (Block 1) |
| PQ-55 | Medium | [C] | **`display_name` goes stale on every edit.** It is written once, on create (`"{id} {product_name}"`), and is a `SERVER_OWNED_FIELD` that nothing on the update path rewrites. Edit a product's category or part number and `product_name` changes but `display_name` keeps the old text — and `display_name` is the **first** field both list endpoints search. The product stays findable by its old description | `index.ts:494-497`; `[id].ts` PUT (no `display_name`); `lib/product.ts:39` | **fixed** (Block 1) |
| PQ-17 | Low | [C] | **The Low Stock page has four buttons that do nothing** — Add Stock, Create Purchase Order, Export Low Stock Report, Set Up Alerts — no `onClick` | `lowstock.tsx:36,152,156,160` | **fixed** (Block 1) |

### Lead for Phase 4/5, not confirmed here

**The document forms read product fields the product hook never returns.** Purchase, sale
and salex all pick products through `useProducts` → `/api/products/optimized`, whose
transform returns `rate`, `categoryName`, etc. The forms read `product.gst_rate_percentage`,
`product.latest_selling_price`, `product.hsn` and `product.display_name` (counted by grep
across the three `create.tsx` files) — none of which the hook returns. Either they re-fetch
the product when a line is added, or GST and selling price default to something on every
line. **[V] — belongs to P4-15 (purchase) and Phase 5 (sale/salex); do not fix from here.**

---

## 3. Code quality findings

Grouped by the settings audit's §7 criteria so the two documents read the same way.

### 3a. Endpoints that should merge (settings §7a)

| ID | Finding | Evidence |
|---|---|---|
| PQ-20 | **Two list endpoints for one table.** `GET /api/products` (`index.ts`) and `/api/products/optimized` disagree on: parameter names (`categoryFilter`/`subcategoryFilter`/`modelFilter`/`companyFilter`/`quantityFilter`/`uidFilter`/`partNoFilter` vs `category`/`subcategory`/`model`/`company_id`/`quantity`/`uid`/`part_no` + `lowStock`), default sort (`id desc` vs `categoryName asc`), sort whitelist (8 vs 9 fields, different names), response shape (full row + four price fields vs a curated 17-field row with a pre-formatted date), rate precedence (stored ‖ computed vs computed ‖ stored ‖ opening), search (optimized adds three "normalised" clauses), car models (one vs many), and `is_active` (`index` supports all three states; `optimized` is active-only — F-107). **Callers** (grep, after reading): the list page, low stock and all three document forms use `optimized` through `useProducts`; `index.ts` GET is called only by `settings/inactive-products` (`isActive`, `sortBy`) and `DeadstockModal` (`limit=1000`). **Every advanced filter in `index.ts` GET — including the low-stock raw SQL F-92 fixed — has no caller.** Target: one list endpoint on `list-query.ts`, `optimized`'s vocabulary, `isActive` added (closes F-107), `index.ts` GET reduced to it | `index.ts:113-386`; `optimized.ts` whole file; `hooks/useProducts.ts:45` |
| PQ-21 | **Five history endpoints are two templates.** `sales.ts` and `salex.ts` differ only in table names; `sale-returns.ts` and `purchase-returns.ts` likewise; `purchases.ts` is the first template with a vendor. One `productHistory(kind)` helper with a per-kind config (item table, header table, join key, party) replaces ~575 lines with ~150 — and fixes PQ-01/02/03 in one place | `api/products/[id]/*.ts` |

### 3b. Shared list code (settings §7b)

| ID | Finding | Evidence |
|---|---|---|
| PQ-24 | **Five hand-rolled list shells.** `ProductTable` and the four lookup-table pages each carry their own pagination block, summary line, `getSortIcon`, `getPageNumbers`, page-reset effects and items-per-page select — the code settings Block 8 deleted from ten pages. They also carry the defects it removed: duplicate page-reset effects (S-16: `category.tsx:93-114`, three in `subcategory.tsx`), no stale-response guard (S-40), serial numbers written into rows by the server (`categories.ts:49-52` etc.) or restarting at 1 each page (`ProductTable.tsx:576`, S-14), state not in the URL (F-49). The four lookup pages move onto `useListQuery` exactly as settings did. `ProductTable` keeps its session-storage filter state (F-65, deliberate) but takes `<ListPagination>`, `<ListSummary>`, `<SortIcon>` and a page-size control |
| PQ-25 | **Four one-field CRUD pages that are one page.** `category`, `company` and `models` are the same 385 lines with names swapped (`diff` shows only renames); `subcategory` adds a category picker. ≈1,690 lines. A single `<LookupTablePage resource=… fields=…>` on `useListQuery` + `<ExportMenu>` is ~250 lines plus four ~15-line configs |
| PQ-26 | **`ProductTable`: seven copy-pasted auto-apply handlers** (~20 lines each) that differ in one key → one `applyFilter(patch)` | `ProductTable.tsx:299-489` |
| PQ-27 | **`ProductTable` has a page-size prop and no page-size control.** `itemsPerPage`/`onItemsPerPageChange` are accepted and never rendered, so the list is fixed at 50; `products/index.tsx` does not persist `limit` while it does persist `page` | `ProductTable.tsx:50-51,92-93`; `products/index.tsx:58` |

### 3c. Types in one place (settings §7c)

| ID | Finding | Evidence |
|---|---|---|
| PQ-28 | **Five `Product` shapes.** `types/products.ts`, `ProductTable.tsx:11`, `ProductSelectionPanel.tsx:5`, `CreateProductModal` form, and `create.tsx`'s form — with three spellings of category (`product_category`, `category_name`, `categoryName`), three of subcategory (+ `subcategoryNames`, which no endpoint sends), two of latest rate, two of GST (`gst_rate`, `gst_rate_percentage`) and a `company` string kept "for backward compatibility". None derives from Prisma. PQ-04 and PQ-06 are this finding causing a defect. Target: `types/products.ts` derived from `@prisma/client` like `types/settings.ts`, with one `ProductListRow` and one `ProductDetail` matching what the two endpoints return |
| PQ-29 | **`FilterOptions` declared four times**, ids typed `string` in `ProductTable` while the API sends numbers; `useFilterOptions()` exists and **none of the four fetchers uses it** (`ProductTable.tsx:173`, `create.tsx:183`, `ProductSelectionPanel.tsx:102`, `CreateProductModal`) |

### 3d. The settings API contract, not applied (settings Blocks 1 and 4)

| ID | Finding | Evidence |
|---|---|---|
| PQ-30 | **`respond.ts` unused.** Five envelopes: bare object (`[id]` GET/PUT), `{products, pagination}`, `{status:'success', message}`, `{status:'failure', message}`, bare arrays with a server-side `sn` (history), and a text/plain 405 (`[id].ts:434`). Every handler hand-writes its own P2002/P2003/P2025 translation or has none | all 14 API files |
| PQ-31 | **Raw `error.message` in 500 bodies** — the F-81/D-07 class, in six files the pass-1 fix did not reach | `filters.ts:91`, `[id]/sales.ts:98`, `salex.ts:98`, `purchases.ts:118`, `sale-returns.ts:123`, `purchase-returns.ts:123`; `[id].ts:218` echoes the JSON parser's message and logs the raw payload |
| PQ-32 | **`list-query.ts` unused.** Six hand-rolled page/limit parsers, none bounded: `limit=0` → `totalPages = Infinity`, `limit=abc` → `NaN` skip, `fetchAll=true` unbounded; `totalPages` computed from `limitNum` even when `fetchAll` returned everything | `index.ts:144-148,376`; `optimized.ts:57-59,456`; `categories.ts:24-27`; `subcategories.ts:13-14,59-60`; `companies.ts:14-15`; `models.ts:13-14` |
| PQ-33 | **`status-route.ts` unused, and two routes for one transition.** `[id]/status.ts` re-implements the helper settings built for exactly this, with a different contract (`{is_active: boolean}` vs `{status: 'Active'\|'Inactive'}` — defensible, the column is a boolean) — and `DELETE /api/products/[id]` *also* deactivates, with a different message. Keep one (the status route) and make DELETE either call it or go | `[id]/status.ts`; `[id].ts:399-430` |
| PQ-34 | **Ids in request bodies.** Categories, subcategories, companies and models take the id in the body for PUT/DELETE; settings standardised on `/[id]` (§7e). A missing id reaches Prisma as `NaN` or throws P2025 → 500 | `categories.ts:103,146`; `subcategories.ts:163,203`; `companies.ts:66,79`; `models.ts:67,80` |
| PQ-35 | **Lookup-table rules disagree across four near-identical resources.** Duplicate-name check: categories yes (exact, untrimmed), subcategories no, companies no, models no. Delete-in-use answer: 409 (categories, companies, models) vs 400 (subcategories). Create returns the record: none (S-53 class). Names trimmed: none | the four lookup APIs |
| PQ-36 | **`models.ts` speaks "subcategory".** The model name travels as `subcategory_name` in the request and is echoed as `subcategory_name` in the response "for backward compatibility"; `models.tsx` sorts by `subcategory_name`, which the API silently replaces with `model_name` (S-32 class). The file was copied from subcategories and never renamed | `models.ts:39,55,67`; `models.tsx:26,40,72` |
| PQ-37 | **The five history endpoints are not wrapped in `withObservability`** — F-89 said "six of eight"; these five were not in the count | `api/products/[id]/{sales,salex,purchases,sale-returns,purchase-returns}.ts` |

### 3e. Helpers duplicated, or not shared (settings §7d, and G-01 / G-02)

| ID | Finding | Evidence |
|---|---|---|
| PQ-54 | **FTP upload, byte-identical ×2; form parsing ×2 and different** (one has a 30-second timeout and five empty event handlers, the other neither); `deleteOldFile` does not close the client if `access()` throws and swallows every error without logging. → `lib/product-files.ts` | `index.ts:11-108`; `[id].ts:11-107` |
| PQ-22 | **Latest purchase rate computed three ways.** `index.ts` (window function, `invoice_date DESC, rate DESC`, returns rate + date, number keys), `optimized.ts` (same SQL, rate only, **string** keys, parse-back-and-forth), `[id].ts` `enhanceProduct` (`findFirst` by `invoice_date` only — ties break differently). Both batch versions swallow their error with no log and fall back silently. And the stored `latest_purchase_rate` column is preferred over the computed value in `index.ts`, the other way round in `optimized.ts` | `index.ts:541-613`; `optimized.ts:486-551`; `[id].ts:113-119` |
| PQ-23 | **Four-position `car_model_ids` match written four times** (Prisma `OR` ×2, SQL `LIKE` ×2) → one `carModelWhere(id)` / `carModelSql(id)` | `index.ts:208-227,300-304`; `optimized.ts:285-295`; `models.ts:93-102` |
| PQ-38 | **Date parsing ×3, every copy with D-17's bug** — `new Date("YYYY-MM-DD")` is UTC midnight, `setHours` is local — while `lib/date-utils` `parseDateRange` was fixed for exactly this in settings Block 7. Plus two server-side display formatters that use the **server's** timezone (`optimized.ts:449` `format()`, and `toLocaleDateString` in all five history endpoints) | `index.ts:241-254`; `optimized.ts:67-86` |
| PQ-39 | **Three selling prices, two formulas.** List: `display_rate`, `latest_selling_price`, `calculated_selling_price`, `selling_price` (= calculated, from `opening_rate`). Detail: `sale_price` (from the latest purchase rate). The same product has two "selling prices" depending on the screen — the F-43 pattern for price. Needs one owner decision (which base rate) and one function | `index.ts:356-371`; `[id].ts:178` |
| PQ-19 | **Two hand-written Prisma-`where` → SQL translators.** Both raw paths build a Prisma `where` object and then re-derive SQL from it field by field; each new filter has to be added twice or silently vanishes on the raw path (F-62's cause). With PQ-20 there is one raw path; it should build SQL from the *parsed query*, not from a Prisma object | `index.ts:285-304`; `optimized.ts:226-261` |
| PQ-18 | **`enhanceProduct` runs seven `findMany({ id: { in: [one id] } })`** and builds a `Map` for each, to name one category, one company, one warehouse… One `findUnique` with `include` of the relations the schema already has (`category_ref`, `subcategory_ref`, `product_company_ref`, `gst_rate`) plus one `car_models` query | `[id].ts:121-181` |
| PQ-45 | **`validateProduct` makes up to seven sequential round trips** (warehouse, category, company, subcategory, GST, rack, product) — independent lookups that can run in one `Promise.all`. `resolveRackNumber` then fetches the rack validation already loaded. `toInt` is `parseInt`, so `"12abc"` is 12 and `"1.9"` is 1; `toFloat("abc")` is `null` and is written as `null` without an error. `car_model_ids` and `hsn` are not validated at all. `findConflictingPartNo` is two raw queries for one lookup that `findFirst` expresses (MySQL's collation is already case-insensitive — G-01) | `lib/product.ts:45-55,64-180,194-214,232-239` |

### 3f. Dead code (settings §7f)

| ID | Finding | Evidence |
|---|---|---|
| PQ-40 | **`CreateProductModal.tsx` — 543 lines, imported nowhere.** And broken if revived: it POSTs JSON to a multipart-only endpoint (→ 400), sends names instead of ids, a `stock` the server owns, GST as a hard-coded 5/12/18/28 list with no 0% (F-31), warehouse and rack as free text, never sends the picked image, and loads car models from the **subcategories** endpoint ("car models are stored as subcategories" — they are not). Delete | whole file |
| PQ-41 | **`GET /api/products/subcategories?type=categories`** — a second categories list inside the subcategories handler; no caller. Delete | `subcategories.ts:11-57` |
| PQ-42 | **Delete is commented out on all four lookup pages** (handler and button), so the F-66/F-67 guards in the APIs have no UI. Owner decision: ship delete (the guards make it safe) or remove the DELETE branches | `category.tsx:173-188,313`; same in `company`, `models`, `subcategory` |
| PQ-43 | **Dead state, props and fields.** `create.tsx`: `formData.rack_number` (never sent), `formData.barcode` + hidden input (F-101), `errors.submit` (never set), an unreachable display-name check in `validateForm`. `ProductTable`: `onExport`, unused `debouncedSearchTerm`, five unused icon imports. `products/index.tsx`: `onExport={() => {}}`. `optimized.ts`: `index: undefined` on every row, the `lowStock` flag beside `stockFilter`, `normalizeSearchText` (adds three clauses that can only match text with no spaces). `useProducts`: accepts `'low'`, the value F-95 said nothing produces — `lowstock.tsx:8` still sends it and works only because the hook also sends `lowStock=true`; maps `subcategoryNames`, which nothing sends. `filters.ts`: `source: 'products'` on every option. `view/[id].tsx`: writes the product into `SessionStorageService` on Edit, which `create.tsx` never reads (only removes). `ProductSelectionPanel`: commented-out Select All block leaves `handleToggleSelectAll` dead. `lowstock.tsx`: unused `useState` |
| PQ-44 | **Misfiled:** deadstock types and hooks live in `types/products.ts` and `hooks/useProducts.ts` (G-03); `useProducts.ts` has an `import` statement in the middle of the file (`:187`) |

### 3g. Smaller things

| ID | Finding |
|---|---|
| PQ-46 | `filters.ts` comments claim the tables are "already pre-sorted by existing index" and omit `ORDER BY`. SQL guarantees no order without one; dropdown order is whatever the engine returns |
| PQ-47 | `create.tsx` and `CreateProductModal` form field names differ from the API (`product_category`↔`product_category_id`, `warehouse`↔`warehouse_id`, `gst_rate` holding an **id**↔`gst_rate_id`, `car_models`↔`car_model_ids`), mapped by hand in both directions. The HSN dropdown uses `hsn_code` as option id, so two rates sharing an HSN (or both empty) collide |
| PQ-48 | The image-delete protocol is a `null` vs `''` convention: `existingImageUrl` is typed `string` and set to `null` as a "delete signal" (`create.tsx:595,624`), which the server decodes from `fileStates`. With PQ-13 the server decides from the stored value and this protocol reduces to a `removeImage: true` flag |
| PQ-49 | UI copy: create confirmation says "This action cannot be undone" (it can — edit, deactivate); the deactivate button reads "🚫 Inactive"; GST 0 renders "N/A%"; the lookup pages confirm with "Do you want to edit - X category?" |
| PQ-50 | **Comment weight.** 912 comment lines; the five server files carrying the pass-1 fixes run 21–28% comments, mostly narratives ("This used to… so… (F-nn)"). They were written deliberately so the next reader does not undo a fix, and that job is real. But the history belongs in these documents and in `git log`; the code needs the **rule** and the finding ID. Proposal: trim each narrative to one or two lines stating the invariant plus the ID (e.g. `// Server-owned: never read from the payload (F-75).`). Estimated −500 lines with no behaviour change. **Owner's call** — flagged, not assumed |
| PQ-51 | `ProductSelectionPanel`: its subcategory filter lists every subcategory regardless of the chosen category; it re-sorts results by name client-side, overriding the server's order; indentation mixes 2 and 4 spaces |
| PQ-52 | `subcategory.tsx` re-fetches **every category** (`limit=1000`) on every page, search and sort change — `fetchCategories()` sits in the list's fetch effect; it hand-rolls a dropdown with a document `mousedown` listener where `SearchableSelect` exists; validation uses `alert()` |
| PQ-53 | The lookup pages still use the old export path (`useExport` + `ExportColumnSelector` + `require('../../lib/export-utils')` inside functions — S-10) with a `switch` per page to rename columns; settings moved to `<ExportMenu>`. `ProductTable`'s export covers only the visible page and numbers it from 1 (S-89, S-14) |

---

## 4. Target shape

What the module looks like when §5 is done:

- **Server:** `lib/product.ts` (rules, now also owning the product **name** and the
  **selling price**), `lib/product-files.ts` (upload / delete / parse, server-decided),
  `lib/product-query.ts` (one list query: `list-query.ts` parsing, one raw path for
  low-stock and car models, one latest-rate function), `lib/product-history.ts` (the five
  tables from one config). Every handler answers through `respond.ts`.
- **Routes:** `GET /api/products` (the one list, `optimized`'s vocabulary, `isActive`),
  `POST /api/products`, `GET|PUT /api/products/[id]`, `PATCH /api/products/[id]/status`,
  `GET /api/products/[id]/history?kind=…` (or the five paths kept as thin wrappers), and
  `/api/products/{categories,subcategories,companies,models}[/id]`. `/optimized` becomes an
  alias for one release, then goes.
- **Client:** `types/products.ts` from Prisma; `useProducts` without a second mapping layer;
  `ProductTable` on the shared pagination pieces with one `applyFilter`; one
  `<LookupTablePage>`; `view/[id]` with one `<HistoryTable>`; `CreateProductModal` gone.

---

## 5. Suggested order

Defects first, then the refactors that remove the most copies per change. Each block ends
with `tsc`, `next build`, and a click-through against the real database.

| Block | Contents | Rough size |
|---|---|---|
| **1 — defects** | PQ-01…PQ-11, PQ-13, PQ-14, PQ-16 (PQ-12 needs the decision below) | small, mostly one-line fixes; PQ-13/14 reorder `[id].ts` PUT |
| **2 — delete** | PQ-40, PQ-41, PQ-43, PQ-44 | ≈ −650 |
| **3 — server contract** | PQ-30…PQ-37 onto `respond.ts` / `list-query.ts` / `status-route.ts`; PQ-54 file helpers | ≈ −150 |
| **4 — one list endpoint** | PQ-20, PQ-19, PQ-22, PQ-23, PQ-38, PQ-15 (closes F-107) | ≈ −350 |
| **5 — history** | PQ-21 (+ PQ-01…03 already fixed in Block 1, now in one place) | ≈ −420 |
| **6 — client** | PQ-24…PQ-29, PQ-51…PQ-53 | ≈ −1,100 |
| **7 — rules** | PQ-12 (name on the server), PQ-39 (one selling price), PQ-45, PQ-18 | small, needs Block 1's decisions |
| 8 — comments | PQ-50, only if the owner agrees | ≈ −500 |

Blocks 2–6 are behaviour-neutral by intent; Block 1 and Block 7 change behaviour on purpose.

---

## 6. Questions for the owner

1. **PQ-12** — may the server build `product_name` from the FK ids (all car models, not just
   the first)? This changes names on the next save of existing products.
2. **PQ-39** — which base rate defines "selling price": latest purchase rate, or opening
   rate? Today the list and the detail page use different ones.
3. **PQ-42** — ship delete on the four lookup pages (the in-use guards already exist), or
   remove the DELETE endpoints?
4. **PQ-33** — keep `DELETE /api/products/[id]` as a synonym for deactivate, or remove it
   in favour of the status route?
5. **PQ-50** — trim fix narratives in code to one-line invariants plus IDs?
6. Still open from pass 1: **F-73** (product 211 at −1), **F-74** (`min_stock` unset — the
   low-stock features stay empty until it is), **F-101** (what `barcode` should hold).

---

### Answers so far (2026-09-30)

| Q | Answer |
|---|---|
| 1 · PQ-12 / PQ-55 | **The server builds the name and keeps it updated.** Same parts as the form used (category, subcategory, company, part no) but **all** car models, built from the stored FK ids on create and on every edit; `display_name` is rewritten with it |
| 2 · PQ-39 | **Selling price = latest purchase rate + margin − discount; opening rate until the product has been purchased.** One function, used by every endpoint that reports a selling price |
| 3 · PQ-42 | **No new feature.** No delete buttons. Remove the commented-out delete code from the four pages; the guarded DELETE endpoints stay as API-only |
| 4 · PQ-33 | **Use the working one:** `PATCH /api/products/[id]/status` stays; `DELETE /api/products/[id]` (no caller) is removed |
| 5 · PQ-50 | **Yes** — trim fix narratives to one-line invariants plus the finding ID |
| 6 · F-73, F-74, F-101 | **Keep all as they are.** No data change, no column change |

## 7. Fix log

### Block 1 — every defect in §2 · done (2026-09-30)

Scope widened on the owner's instruction: **the product list, view and add/edit pages
should carry no known bug**, so Block 1 also took the pieces of later blocks that were
bugs rather than tidiness.

**Server**
- `lib/product.ts`: `buildProductName()` — the name is built from the stored ids, all car
  models joined with ` / `, id in front; `product_name` joins `SERVER_OWNED_FIELDS`;
  `sellingPrice()` — latest purchase rate (opening rate until the first purchase) + margin
  − discount (PQ-12, PQ-39).
- `POST /api/products`: insert and name in one transaction; `display_name` = name
  (PQ-12, PQ-55, F-105).
- `PUT /api/products/[id]`: the name and `display_name` rebuilt on every save from the
  stored row overlaid with the update; files decided from the **stored** URL, never the
  client's; order upload → write → delete replaced file, with the new upload removed if
  the write fails or is refused; the parse-error body no longer echoes the parser
  (PQ-12, PQ-13, PQ-14, PQ-55, PQ-31 for this file).
- `DELETE /api/products/[id]` removed; `PATCH …/status` is the one deactivate route (PQ-33).
- `GET /api/products/[id]` returns `latestPurchaseRate` and `sale_price` from `sellingPrice()` (PQ-06, PQ-39).
- `/api/products/optimized` now returns what the purchase/sale/salex pickers read —
  `latest_selling_price`, `gst_rate_percentage`, `gst_rate_id`, `hsn`, `display_name`,
  `opening_rate`, `latest_purchase_rate` — and `useProducts` passes them through. **This
  closes the §2 lead:** a sale line no longer defaults to the purchase rate and 0% GST
  (PQ-39). Sorting by Rate orders by the value shown (PQ-11).
- `GET /api/products` low-stock rows report their GST; the three selling-price fields
  carry the one rule (PQ-15, PQ-39).
- History endpoints: ISO dates; sales/salex find the header by id; purchases match
  `(invoice_no, fy)`; no `error.message` in 500s (PQ-01, PQ-02, PQ-03, PQ-31).
- `subcategories.ts`: the category must already exist — no find-or-create (PQ-08).
- `models.ts`: the name is `model_name`, trimmed; no `subcategory_name` alias (PQ-36).

**Pages**
- List (`products/index.tsx`, `ProductTable`): restored sort and subcategory survive
  (PQ-09, PQ-10); subcategories from the loaded filter options, no 50 cap (PQ-07); serial
  numbers continue across pages; `<ListPagination>`, `<ListSummary>`, `<SortIcon>`;
  export covers every matching row (S-89); `initialFilters` memoised.
- View: dates formatted once, Latest Rate, GST display, list invalidated and broadcast
  after (de)activation (PQ-01, PQ-06, PQ-16).
- Add/edit (`create.tsx`): no `product_name` sent — the preview mirrors the server rule;
  subcategories from filter options and racks with `limit=1000` (PQ-07); current rack
  listed even if inactive; one HSN option per distinct code; "cannot be undone" removed.
- Low Stock: Category/Company filled, `stockFilter: 'low_stock'`, dead buttons removed (PQ-04, PQ-17).
- Category / company / car model / subcategory: onto `useListQuery` (one request per
  change, page reset derived, stale responses dropped, serials continue), save and load
  failures reported, commented-out delete code removed (PQ-05, PQ-24 for these pages,
  PQ-42). Subcategory: category must be picked from the list; categories load once (PQ-08, PQ-52).
- `ProductSelectionPanel`: subcategory filter narrowed to the chosen category (PQ-51).
- `useListQuery` gained `extraParams` — changing filters that are part of the query (the
  subcategory page's category search).

**Checks:** `tsc --noEmit` clean. `next build` clean (before the export change). Behaviour
against mocked APIs: product view, low stock, list restore, edit form round trip and the
four lookup pages (29 checks), and the product PUT/history routes against an in-memory
database (17 checks) — all passing; the settings suite (88) re-run after the hook change,
passing. Further tests skipped at the owner's request.

**Not verified against the real database.** Run `npm run dev` and click through: list →
filter/sort → view → back; edit a product (name, image replace/remove); the Sales and
Purchases tables on a product with history; adding products to a sale in the picker.

**Known and left, by decision:** F-73, F-74, F-101 (owner: keep as is); list page size
fixed at 50 (no page-size control — no new feature); quality Blocks 2–8.

### Block 2 — delete · done (2026-09-30)

- **PQ-40** `CreateProductModal.tsx` deleted (543 lines, no importer).
- **PQ-41** `GET /api/products/subcategories?type=categories` branch removed (no caller).
- **PQ-43** dead code removed: `create.tsx` `rack_number` state, the never-set `errors.submit`
  block and the `SessionStorageService` pair with `view/[id].tsx` (written, never read);
  `ProductTable`'s unused `onExport`, `itemsPerPage`/`onItemsPerPageChange` props and
  `subcategoryNames`; `products/index.tsx`'s unused limit setter and `handleLimitChange`;
  `optimized.ts`'s `lowStock` flag and `normalizeSearchText` (`stockFilter=low_stock` is the
  one low-stock switch; `useProducts` no longer accepts `'low'`); `filters.ts`'s
  `source: 'products'`; `ProductSelectionPanel`'s commented-out Select All block and its
  dead handler.
- **PQ-44** deadstock types → `types/deadstock.ts`, hooks → `hooks/useDeadstock.ts`;
  `useProducts.ts` imports at the top.
- Kept on purpose: `create.tsx`'s hidden `barcode` field (F-101, owner: keep as is).

**Checks:** `tsc --noEmit` clean.

### Block 3 — server contract · done (2026-09-30)

- **PQ-54** `lib/product-files.ts`: one form parser, one upload, one delete (which now
  always closes its FTP client and logs failures). `products/index.ts` and `[id].ts` no
  longer carry their own copies.
- **PQ-30, PQ-31, PQ-32** onto `lib/api/respond.ts` and `lib/api/list-query.ts`:
  `[id].ts` (`parseId`, `route`, `ok`/`badRequest`/`notFound`/`conflict`, `fail`),
  `POST /api/products` (`created()` — the response is now `{status, message, data}`;
  `create.tsx` reads `data.id`), `filters.ts` (`fail`, and `ORDER BY` name — PQ-46).
  A failed create now also removes any file it had already uploaded.
- **PQ-33** `[id]/status.ts` is built by `makeStatusRoute` and takes
  `{ status: 'Active' | 'Inactive' }` like every settings resource; the product view and
  Inactive Products send that.
- **PQ-34, PQ-35, PQ-36** the four lookup tables are one factory, `lib/product-lookups.ts`,
  behind `/api/products/<resource>` (GET list, POST) and `/api/products/<resource>/[id]`
  (PUT, DELETE). Names trimmed and required; duplicates refused with 409 (subcategories:
  within the same category); "in use" refused with 409; creates and updates return the
  record; bounded paging and `dropdown=true`; no server-written `index`. The legacy
  list keys (`categories`, `companies`, `models`, `subcategories`) stay beside `data`.
  The subcategory page loads its category picker with `dropdown=true` (the old
  `limit=1000` is now capped at 500). `carModelWhere()` is the one four-position match
  for the car-model guard (PQ-23, part).
- Deferred to Block 5: the five history endpoints (PQ-31/PQ-37 for those files).

**Checks:** `tsc --noEmit` clean.
