# Journey Audit — product → purchase → sale/salex → return

Companion to `AUDIT_PLAN.md`, which stays the home of the phase plan, the statutory
reference and the master findings register. This document holds the **journey** work:
what each step is supposed to feed, what it actually feeds, and what breaks in between.

Finding IDs continue the same sequence as `AUDIT_PLAN.md` so they can be referenced
across both documents without collision.

Status: `open` · `in-progress` · `fixed` · `by design` · `wontfix` · `invalid`

---

## Phase 3 — Products

Surveyed 2026-09-20 against the live database (602 real products) and a running server
with a real session. Nothing changed yet; this is the find pass.

### What works, and should not be broken by later fixes

- **`/api/products/filters` is unpaginated.** Category, subcategory, company and car-model
  dropdowns call `findMany` with no `take`, so they are complete. This is the correct
  shape, and the counter-example to F-58.
- **Product create validates its foreign keys.** An invalid company, warehouse or GST rate
  is rejected with a 400 rather than written and discovered later.
- **The database protects sale history.** `invoice_items`, `invoice_itemsx` and `deadstock`
  all reference `product` with `ON DELETE RESTRICT`, confirmed against the live
  `information_schema`, not just the schema file.

### Findings

| ID | Sev | Area | Finding | Evidence | Status |
|---|---|---|---|---|---|
| F-62 | High | FE / list | **Sorting is silently ignored whenever the raw-SQL path runs.** `products/optimized.ts` handles only `product_name`, `part_no`, `stock` and `lastPurchaseDate` there, falling back to `p.id DESC`. The list page's **default** sort is `categoryName`, so applying the low-stock or car-model filter quietly discards the sort while the column header still claims it | Verified live: `sortBy=categoryName` returns Ac Switch, Ac Switch, Ac Switch, Belt, Blade on the Prisma path; the same request with `lowStock=true` returns Ac Switch, Heating Coil, Compressor, Compressor, Compressor | **fixed** — raw path now maps every sort field the Prisma path supports, via LEFT JOINs. Verified: categoryName asc/desc and companyName all order correctly under a low-stock or model filter |
| F-63 | High | CRUD / data flow | **Product delete is a hard delete, and purchase lines have no foreign key to protect them.** `DELETE /api/products/[id]` calls `prisma.product.delete()` with no reference check, even though `is_active` exists and there is a whole `inactive-products` settings page. A product that has been **sold** cannot be deleted — but the FK error surfaces as a raw `500 Server error`, not "this product is on 12 invoices". A product that has only been **purchased** *can* be deleted: `Purchaseitems.product_id` is a nullable `Int` with no relation and no FK, so its purchase lines are left pointing at a product that no longer exists, and the purchase-return items hanging off those lines with them | Live FK catalogue lists only `invoice_items`, `invoice_itemsx`, `deadstock` → RESTRICT. `Purchaseitems` carries `product_id Int?` and a denormalised `name_of_product`, with no `@relation` | **fixed** — DELETE now deactivates (`is_active = false`). Verified: list 602 → 601, row intact, restorable. The missing FK on `purchase_items.product_id` was also added, ON DELETE RESTRICT |
| F-64 | Low | Settings → product | The product form fetches `/api/warehouses` and `/api/gst-rates` with no `limit`, so both take the endpoints' default first page of 50. Same class as F-58, which was fixed for customers/vendors/staff/mechanics but not for these two | `products/create.tsx:166,177` | **fixed** — `dropdown=true` added to gst-rates and warehouses; form uses it. Verified: `limit=2` returns 2, dropdown returns all 4 |
| F-65 | Low | FE / list | The products list persists filters and sort in **sessionStorage** (`use-storage-state`), but not search or page number — and it is a third mechanism, now that settings pages use the URL (F-49) and other pages use neither. Filters also cannot be shared or bookmarked, because they never reach the URL | `products/index.tsx:27,46,48` | **fixed** — search and page persist in the same session storage as the filters |
| F-43 | High | Settings → product | *(carried from `AUDIT_PLAN.md`)* The list endpoint resolves a product's GST rate through the `gst_rate_id` FK; the detail endpoint matches `product.hsn` against `gst_tax_rate.hsn_code`. With `hsn` NULL on all 602 products, the detail path reports **0%** | `products/index.ts:319` vs `products/[id].ts:170` | **fixed** — detail endpoint resolves through `gst_rate_id`. Verified: with `hsn` still NULL, list and detail both report 18% |
| F-66 | **High** | Settings → product | **Deleting a category, subcategory or company silently strips it from every product that used it.** All three DELETE endpoints are unguarded hard deletes, and every one of those FKs is `ON DELETE SET NULL`. No count, no confirmation, no error — the products are simply un-categorised. The same app already does this correctly elsewhere: rack delete refuses with "Cannot delete rack. N product(s) are assigned to this rack", and warehouse delete is a soft delete. Five comparable resources, three different behaviours | `products/categories.ts`, `subcategories.ts`, `companies.ts` handleDelete; live FK catalogue shows SET NULL for all three | **fixed** — category and company deletes refuse with a count. Verified: category 23 → 409 "3 product(s) and 3 subcategory/subcategories", company 1 → 409 "168 product(s)", nothing deleted |
| F-67 | Medium | Settings → product | **`car_models` has no foreign key at all.** Products store `car_model_ids` as a comma-joined string, so deleting a car model leaves its id embedded in every product that referenced it. Nothing cleans up, and nothing can — the database cannot see the reference | `models.ts` handleDelete; `car_models` absent from the FK catalogue | **fixed** — car-model delete counts products by 4-position match on `car_model_ids`. Verified: model 185 → 409 "9 product(s)", matching the filter count |
| F-68 | Low | Ops | Deactivating a GST rate does not stop it applying. `status: 'Inactive'` removes it from the product form's dropdown, but products already pointing at it keep using its percentage, because the list endpoint reads the rate through the FK without checking status | `products/index.ts:319` | **by design** — decided: an inactive rate keeps applying to products already on it. Deactivating a rate withdraws it from future selection; it does not rewrite what products already carry |
| F-69 | Low | Ops | 51 `console.log`/`warn` calls in the product paths alone — 29 in `index.ts`, 15 in `optimized.ts`, 7 in `[id].ts`. A subset of F-24, noted here because of the concentration | `pages/api/products/*` | **fixed** — 51 `console.log`/`warn` removed from the three product API files; every `console.error` kept |
| F-70 | Low | Duplication | `pages/products/lowstock.tsx` computes low stock client-side from `useProducts({ fetchAll: true })`, while `reports/minimum-stock` computes it server-side with a different rule. Two answers to "what is low on stock" that can disagree | `lowstock.tsx:7` vs `reports/minimum-stock.ts:25` | **fixed** — one rule everywhere. Verified: all three views now return the same number |
| F-71 | Medium | Ops | `subcategories.ts` called `prisma.$disconnect()` in a `finally`, on the **shared singleton** from `lib/db` — tearing down the connection pool every other route uses, after every request | `products/subcategories.ts:227` | **fixed** — removed, with a comment saying why |
| F-72 | Medium | Ops | `companies.ts` and `models.ts` each constructed their own `new PrismaClient()` rather than using `lib/db`, and disconnected it per request. A second pool in production, and one leaked per reload under dev HMR | `products/companies.ts:4`, `models.ts:5` | **fixed** — both use the shared client |
| F-73 | Medium | Data | **A product has negative stock.** `id=211` (" Ford Fiesta Diesel Nob Switch IMP") holds `stock = -1`, and `opening_stock = -1` too, so the wipe preserved it as the reconciliation baseline. Nothing in the app prevents or reports stock going below zero | live query | open — needs a decision: correct the row, or let Phase 4 explain how it got there |
| F-74 | High | Data | **`min_stock` is unset on the entire catalogue** — 601 of 602 products have `min_stock = 0`, one has NULL, none has a real minimum. Every "low stock" feature therefore has nothing to measure against. This is what the `OR stock < 2` workaround in F-70 was hiding | live query | open — **data, not code**: the owner has to set minimums for the feature to mean anything |

### Data flow — settings into product

| Setting | Reaches product as | State |
|---|---|---|
| Warehouse | `warehouse_id`, validated on create | works — but dropdown capped at 50 (F-64) |
| Warehouse rack | `rack_id` | works |
| GST rate | `gst_rate_id` | **two resolutions that disagree** (F-43); dropdown capped at 50 (F-64) |
| Category / subcategory | `product_category_id`, `product_subcategory_id` | dropdowns complete, but **delete silently un-categorises products** (F-66) |
| Company | `company_id` | same (F-66) |
| Car models | `car_model_ids`, a comma-joined string | **no FK at all** — deleted models leave dangling ids (F-67) |

### Data flow — product into the journey

| Consumer | Link | Protected? |
|---|---|---|
| Sale lines (`invoice_items`) | `product_id` FK | yes — RESTRICT |
| Salex lines (`invoice_itemsx`) | `product_id` FK | yes — RESTRICT |
| Deadstock | `product_id` FK | yes — RESTRICT |
| **Purchase lines (`Purchaseitems`)** | `product_id`, loose integer | **no FK at all** (F-63) |
| Returns (sale / salex / purchase) | via their parent line, not the product | yes, transitively |
| Ledger | no product link — ledger records documents, not items | n/a by design |

### The test this phase must run

From the journey → report map in `AUDIT_PLAN.md` §10: only `minimum-stock` reads the
`product` table at all. Every other report reads documents, which carry their own captured
lines. So:

> **Change a product's rate, then confirm an existing invoice's total does not move.**

If it moves, something is reading through to the product where it should be reading the
line — which would mean editing a product silently rewrites financial history. This cannot
be checked by reading the code alone; it needs a real invoice, so it runs once Phase 4 has
created one.

### What happens when a setting is deleted

Worth stating plainly, because the behaviour is inconsistent across five resources that
look alike:

| Resource | Delete behaviour | Effect on products |
|---|---|---|
| Warehouse | **soft delete** (status → Inactive) | none — safe |
| Warehouse rack | **guarded** — refuses with a count of assigned products | none — safe |
| GST rate | no DELETE endpoint exists | n/a |
| Category / subcategory / company | **unguarded hard delete**, FK is SET NULL | silently un-categorised (F-66) |
| Car model | **unguarded hard delete**, no FK exists | dangling ids left in `car_model_ids` (F-67) |

The two safe patterns are already implemented in this codebase. F-66 and F-67 are not
missing ideas, they are missing applications of a decision the team already made.

### Corrections to the first pass

**`subcategories.ts` was already guarded.** The first pass reported category, subcategory
and company deletes as all unguarded. Subcategory was not — it already refused with
"Cannot delete subcategory that has associated products". The automated check looked for a
`handleDelete` function, and that file uses an inline `else if`, so it returned a false
negative. Only category, company and car model needed the guard.

**F-70 was three rules, not two.** The Low Stock page asked the endpoint for
`stock < min_stock OR stock < 2`, then re-filtered the result client-side to
`stock < min_stock`, while the report used a third variant. It was fetching 362 rows to
display 1.

### A visible behaviour change, on purpose

Unifying the low-stock rule **changes what the products page's low-stock filter returns:
362 before, 0 now.** That is not a regression. The old filter counted every product with
0 or 1 in stock, which is 60% of the catalogue, because `min_stock` is unset everywhere
(F-74). The three views now agree, and they agree on the honest answer: nothing can be
below a minimum that was never set.

**The Low Stock page and the minimum-stock report will both be empty until minimums are
entered.** That is the feature telling the truth for the first time. Setting `min_stock`
on the products that matter turns it back on — no further code change needed.

---

## Phase 3b — the edit path

Added 2026-09-20 after the observation that every page follows
**list → add / view / edit**, where edit is the add form with data preloaded. That
pattern has one characteristic failure: a field the form does not LOAD, but does SAVE,
is silently overwritten. The first product pass audited the list and the API surface but
did not walk this path. It should have.

`PUT /api/products/[id]` builds `finalData` as a **full 21-field overwrite**, not a patch.
Only `pic` and `barcode` are conditional. Every other field is written on every save, and
anything the client omits is written as `0` or `null` rather than left alone.

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| F-75 | **Critical** | **Editing a product resets its stock to its opening stock.** The form sends `stock: formData.opening_stock` — there is no current-stock field on the form at all — and the API writes it. So editing a product to fix a typo silently restores every unit ever sold or consumed | **Proven end to end**: product with `opening_stock=10, stock=3`, edited changing only `notes` → `stock` came back as **10**. Seven units of sales history reappeared | **fixed** — the server never accepts `stock` from a client; the form no longer sends it. **Verified**: opening_stock=10/stock=3, edited → stock still **3**; an explicit `stock: 9999` was ignored |
| F-76 | High | **Editing a product blanks its GST rate.** The edit form resolves `gst_rate` by matching `product.hsn` against `gst_tax_rate.hsn_code` — the same HSN-based resolution fixed on the backend in F-43, still living in the front end. `hsn` is NULL on all 602 products, so the match always fails, the field stays empty, and the save writes `gst_rate_id: null` | **Proven**: product set to `gst_rate_id=3` with `hsn` NULL, edited → `gst_rate_id` became **null** | **fixed** — the edit form loads `gst_rate_id` directly, and backfills HSN from the rate for display. **Verified**: rate 18% with `hsn` NULL survived an edit |
| F-77 | Medium | **Editing a product renames it.** `product_name` is regenerated on every save from `[uid, carModel, category, subcategory, company, part_no].join(' ')`, where `uid` is empty on create and the product id on edit. So a product created as `" Maruti Alto Compressor Behr"` becomes `"123 Maruti Alto Compressor Behr"` the first time anyone edits it. The create path also leaves a leading space on every new name | Live data: **541 of 602** names start with a space, **60** start with the id prefix, **11** contain a double space from omitted optional parts | **by design** — owner confirmed the id prefix is intended once a product is loaded. Note for later: `create` already writes `display_name = "{id} {name}"`, so the id has two homes |
| F-78 | Medium | The update endpoint has **no partial-update path**. Because `finalData` writes all 21 fields with `0`/`null` fallbacks, any caller that omits a field silently zeroes it. F-75 and F-76 are two instances; the shape invites more | `products/[id].ts` finalData | **fixed** — `buildProductData(..., { partial: true })` writes only fields the client actually sent |
| F-79 | High | **`PUT` validates almost nothing, while `POST` validates everything.** Create checks required fields and that the company, warehouse and GST rate exist. Update checks only that the payload is present and parses, plus part_no uniqueness. So edit accepts what create rejects | **Proven**: PUT with `product_name: ""` returned **200** and wrote an empty name (restored). PUT with `warehouse_id: 99999` and with `gst_rate_id: 88888` both returned **500** — the database caught what the endpoint did not | **fixed** — create and update share `validateProduct()` from `lib/product.ts`. **Verified**: empty name → 400 |
| F-80 | Medium | **Editing a product that does not exist returns 500, not 404.** `prisma.product.update` throws P2025 and it falls through to the generic handler | **Proven**: `PUT /api/products/999999` → 500 | **fixed** — existence checked first, plus P2025 mapped. **Verified**: missing product → 404 |
| F-81 | Medium | **Internal database errors are returned to the client.** The 500 body carries the raw Prisma message, including table and constraint names: `Foreign key constraint violated: warehouse...`. Schema detail should not leave the server | Response body of the F-79 probes | **fixed** — Prisma codes translated to 400/404/409; the raw message never leaves the server |
| F-82 | Medium | **`Product` has no `created_at`/`updated_at`** — 21 other models do. So there is no record of when a product last changed, no audit trail on the most frequently edited entity in the app, and no way to implement optimistic concurrency | `schema.prisma` Product model | **fixed** — `created_at`/`updated_at` added, nullable. The 602 rows that predate the columns carry the migration timestamp in `created_at`; see the open data note in §12 |
| F-83 | Medium | **Two people editing the same product silently overwrite each other.** No version check, no conflict detection — and none is currently possible, because of F-82 | consequence of F-82 + F-78 | **fixed** — the form sends back the `updated_at` it loaded and the server writes conditionally on it, answering **409** if the row moved on. **Verified**: a PUT carrying a stale `updated_at` is refused, the same PUT with the current one succeeds |
| F-84 | Low | **`rack_number` is derived in the browser.** The form looks the rack up in its own loaded list and sends the string alongside `rack_id`. The server has the id and could derive it; instead it trusts a denormalised string a client computed, which can drift from the rack it names | `create.tsx` productData, `rack_number` | **fixed** — `rack_number` derived server-side from `rack_id` |
| F-85 | Low | **The form has no current-stock field at all**, yet the payload writes `stock`. Someone editing a product cannot see, let alone correct, the value they are about to overwrite (F-75) | `create.tsx` formData | **fixed in effect** — the field is still absent from the form, but nothing writes `stock` from it any more |
| F-86 | Low | **Required-field rules live only in the browser.** `validateForm()` requires category, company and warehouse; the update endpoint requires none of them. Turn off JavaScript, or call the API directly, and the rules do not exist | `create.tsx` validateForm vs `products/[id].ts` PUT | **fixed** — the same rules now run server-side, where they cannot be bypassed |
| F-87 | High | **Any update that omitted `fileStates` wiped the product's image and barcode.** `imageUrl`/`barcodeUrl` were initialised to `null`, then spread under `imageUrl !== undefined` — which is always true for `null`. The documented "keep current value" branch was unreachable | Found by reading the file; invisible to grep | **fixed** — both initialise to `undefined` |
| F-88 | Medium | **Suspected, not confirmed:** the cascade effects clear subcategory and rack on edit load. `useEffect` on `product_category` unconditionally sets `product_subcategory: ''`, and the load sets category, so the effect should fire and clear it. Same shape for warehouse → rack | Code path is clear, but the data does **not** confirm it: 12 of 60 edited products still have a subcategory. The "edited" proxy (id-prefixed name) is unreliable | **confirmed and fixed** — mechanism below. The clear moved into `handleInputChange`, where the user actually picks a category; the effect now only fetches |
| F-89 | Low | `pages/api/products/companies.ts` is not wrapped in `withObservability`, unlike its siblings | read of the file | **fixed — and wider than written.** `pages/api/products/[id].ts` was unwrapped too, so the busiest route in the module had no request logging. Wrapping it needed `withObservability` widened from `Promise<void>` to `Promise<unknown>`, because that handler `return`s its responses |
| F-90 | Low | `calculateSellingPrice()` in the product form is dead code — the panel that used it is commented out. It also used a different formula from the server's `sale_price` | `create.tsx:264` vs `[id].ts:176` | **fixed** — helper and the commented-out panel both removed. `calculateTotalAmount()` beside it is live and was kept |

### The pattern underneath all of these

Every one of F-75, F-76, F-77, F-84 and F-86 is the same mistake in a different place:
**a business decision being made in the browser.**

| Decision | Made in | Should be made in |
|---|---|---|
| What a product is called | `generateProductDisplay()` in the form | the server, from the FK ids it already has |
| Which GST rate applies | HSN string match in the form | the server — it owns `gst_rate_id` |
| What the stock level becomes | the form, as `stock = opening_stock` | nowhere: stock is a movement-derived value, not a form field |
| Which rack number to store | a lookup in the browser's loaded list | the server, from `rack_id` |
| Whether the product is valid | `validateForm()` | the server, which is the only place that cannot be bypassed |

The browser is entitled to decide what the **user typed**. It is not entitled to decide
what the **record means**. Right now the product edit form decides both, and the update
endpoint accepts whatever arrives — which is why F-75 corrupts stock, F-76 blanks a tax
rate and F-79 lets an empty product name through a door that create keeps shut.

A correct `PUT /api/products/[id]` would: load the existing row; accept only user-entered
fields; refuse to accept `stock`, `product_name` and `rack_number` at all and derive them;
validate required fields and every foreign key exactly as `POST` does; and leave anything
not supplied untouched.


### What does round-trip correctly

Checked field by field against the form, the payload and `finalData`: category,
subcategory, car models, company, part_no, min_stock, opening_stock, opening_rate, hsn,
warehouse, rack, descriptions, notes, mrp, discount and margin all load and save
correctly. `display_name`, `is_active`, `last_purchase_date` and `latest_purchase_rate`
are absent from `finalData` and so are correctly preserved.

So the edit path is sound for 16 of 19 fields. The three that are not are stock, GST rate
and the product's own name.

---


---

## Phase 3c — the second pass, all four surfaces

Run 2026-09-20 after Phase 3b's fixes, over **list, view, add and edit** together rather
than endpoint by endpoint. The brief was that it might turn up nothing. It turned up the
worst finding of the phase.

**Method note, and it matters.** Three files in the first pass of this section were
grepped rather than read: `ProductTable.tsx`, `products/view/[id].tsx` and
`settings/inactive-products.tsx`. Reading them in full changed three answers — one finding
down, one up, and two that grep could not have found at all. They are marked below. This
is the third time in this audit that grep has produced a wrong result, and the second time
the correction went in both directions.

### Findings

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| F-91 | **Critical** | **Deactivating a product is a one-way door.** F-63 made DELETE set `is_active = false` and tell the user the product "can be restored from Inactive Products". It cannot. Both restore paths — the toggle on the product view page and the button on the Inactive Products screen — send `PUT /api/products/[id]` with a JSON body, but that route sets `bodyParser: false` and parses multipart form data. And had the body parsed, `is_active` is a `SERVER_OWNED_FIELD` that `buildProductData` never maps, so it would have failed a second time as "No changes supplied" | **Proven**: `PUT` with `{"is_active":false}` → **400 "Product data is required"**. A regression introduced by F-63's own fix | **fixed** — new `PATCH /api/products/[id]/status`, a state transition with its own body parser, and both callers point at it. **Verified**: 602 deactivated → 200, reactivated → 200 |
| F-92 | **High** | **`GET /api/products?stockFilter=low_stock` is a hard 500.** The branch built SQL *fragments* inside a `$queryRaw` **tagged template**, which binds every interpolation as a value — so MySQL received `WHERE ? ? ? ? ? ? ? ?`. It also carried a **third** low-stock rule (`stock > 0 AND stock <= min_stock`): F-70 unified the Low Stock page and the minimum-stock report and missed this endpoint | **Proven**: MySQL error **1064**. Had those fragments been interpolated as text instead, the search term went in unescaped and it would have been an injection | **fixed** — `$queryRawUnsafe` with bound parameters, and the same low-stock rule as everywhere else. **Verified**: 200 |
| F-93 | **High** | **`GET /api/products?startDate=…&endDate=…` is a hard 500.** It built `where.created_at`, a column `Product` did not have — the same shape as F-11/F-45/F-48, and missed by the live sweep because the sweep never passed those parameters | **Proven**: Prisma "unknown argument `created_at`" | **fixed** — filters `last_purchase_date`, which is what `/api/products/optimized` has always filtered and what the list page's Date Range control means beside its Last Purchase Date column. **Verified**: 200 |
| F-94 | **High** | **The batch purchase-rate lookup only ever matches product 1.** `IN (${productIds.join(',')})` inside a `$queryRaw` tagged template binds the joined string as a single parameter; MySQL coerces `'1,2,3'` to `1`. Nothing throws, so the fallback never runs either. Two copies: `products/index.ts` and `optimized.ts` | **Proven**: `IN (${ids.join(',')})` over `[1,2,3,601,602]` returned **1 row**; the literal list returned **5** | **fixed** — one placeholder per id in both copies. Invisible today only because `purchase_items` is empty; it would have mispriced the whole list from the first purchase in Phase 4 |
| F-96 | Medium | **The Subcategory filter on the products list filters nothing.** The hook sends the selected subcategory id as `subcategory`; `optimized.ts` read that parameter as a car-model **name** and looked it up in `car_models.model_name`. It never matched, so the request fell through to the Prisma path and the filter vanished. `product_subcategory_id` was never filtered on at all, though `subcategoryName` is both returned and sortable | **Upgraded by reading `ProductTable.tsx` in full**: the dropdown at `:341-366` is live, populated from `/api/products/subcategories`, emits real ids and auto-applies | **fixed** — `subcategory` is a subcategory id; car models keep their own `model` parameter |
| F-98 | Medium | **F-81 was only half fixed.** `[id].ts` translates Prisma errors, but `products/index.ts` returned the raw message **and `dbError.stack`** to the client, and the GET handler and `optimized.ts` leaked `error.message` | The F-92 and F-93 probes came back with the failing query and the schema in the response body | **fixed** — logged in full, returned as a bare message; P2002/P2003 translated on create |
| F-99 | Medium | **A partial update can attach a rack from another warehouse.** `validateProduct` compared `rack.warehouse_id` only against `input.warehouse_id`, so a payload carrying `rack_id` alone skipped the check entirely. The form always sends both, which is why nothing noticed — but the reason the rules moved server-side is that the form is not the only caller | `lib/product.ts` rack branch | **fixed** — falls back to the warehouse already stored on the product |
| F-100 | Medium | **Part-number uniqueness disagreed with the database.** `findConflictingPartNo` filtered `is_active = true`, but `part_no` carries a DB-level `@unique` across every row. Since F-63 turned delete into deactivation, inactive rows keep their part numbers: the app said yes and the database then said no, about a product the user cannot see anywhere | `lib/product.ts` vs `schema.prisma` | **fixed** — checks all rows and says which case it is |
| F-101 | Medium | **The `barcode` column holds two different things.** The server writes an uploaded image **URL** into `barcode VarChar(100)`, while the form carries a scanned **code** string in `formData.barcode` (loaded, rendered in a hidden input, never saved) and the view page renders the column as an image `src`. The delete branch passes whatever is stored to `deleteOldFile()`. 100 characters is also tight for a URL | read of `[id].ts`, `index.ts`, `create.tsx`, `view/[id].tsx` | open |
| F-102 | Medium | **`loadProductForEdit` re-ran and discarded typing.** Its effect depended on `filterOptions`, which resolves after mount, so the product was fetched twice and the second response overwrote anything already entered. This is also the other half of F-88's non-determinism: whether the wiped subcategory came back depended on whether the second load ran | `create.tsx` edit effect | **fixed** — keyed on the edit id alone |
| F-103 | Low | **The double-submit guard is inert.** `loading` was never set, so the submit button's `disabled` and its "Creating…/Updating…" label could never fire | `create.tsx` | **fixed** — uses the mutation hooks' real pending state |
| F-104 | Low | **Files uploaded before validation.** A product rejected for a missing warehouse or a duplicate part number had already pushed its image and barcode to FTP, where nothing would reference or remove them | `products/index.ts` handlePost order | **fixed** — validate, then upload |
| F-105 | Low | **`display_name` was written by an un-awaited background update** with a `.catch()` that only logged. If it lost the race or failed, `display_name` stayed NULL — and it is the first field both list endpoints search on, so the product was unfindable by name | `products/index.ts` | **fixed** — awaited |
| F-106 | Low | Dead code in `optimized.ts`: `lookupCache`/`getCachedLookupData` and `createSearchableText` had no callers | read of the file | **fixed** — removed |
| F-107 | Low | `optimized.ts` hardcodes `is_active: true` and cannot serve an inactive list, while `index.ts` supports `includeInactive`. Two list endpoints that disagree about what a product list is | `optimized.ts` where clause | open |
| F-108 | **High** | **The schema did not record the constraint F-63 applied.** `Purchaseitems.product` is an optional relation with no `onDelete`, so Prisma's default is `SET NULL`, while the live database has **RESTRICT**. `prisma migrate diff` wanted to drop and recreate it as `SET NULL` — the next `db push` would have silently undone F-63's protection | **Proven**: live `information_schema` says RESTRICT; `migrate diff` emitted the DROP/ADD | **fixed** — `onDelete: Restrict` stated explicitly. The sale-side FKs are required relations, so Prisma already defaulted them to Restrict and they were never exposed |
| F-109 | Low | `JSON.parse` on the create path was unguarded, unlike the update path, so a malformed payload answered 500 instead of 400 | `products/index.ts` | **fixed** |
| F-110 | Medium | **Nothing rejected negative quantities or money.** Not the form — `<input type="number">` with no `min` — and not the server. A negative `opening_stock` also becomes the starting `stock` on create, and `opening_stock` is the baseline the stock reconciliation assertion measures against. This is the most likely route to **F-73**, where product 211 holds `stock = -1` with `opening_stock = -1` behind it | `create.tsx` inputs vs `lib/product.ts` | **fixed** — `opening_stock`, `min_stock`, `opening_rate`, `mrp`, `discount` and `margin` rejected when negative |
| F-95 | Low | The stock-status filter is dead plumbing: the hook compares `stockFilter === 'low'` while every producer uses `'low_stock'`, and `in_stock`/`out_of_stock` were never forwarded | **Corrected by reading `ProductTable.tsx` in full**: there is **no stock-status control in the filter panel at all** — the nine filters are UID, Category, Subcategory, Car Models, Company, Part No, Quantity, Date Range, Clear. So this has **no user-visible effect today**. The first pass of this section claimed the filter was broken; it is unreachable | **fixed defensively** — mapping corrected and the values honoured, so the filter works if a control is ever added |
| F-111 | **High** | **The Inactive Products page cannot be trusted to show inactive products.** It fetches `/api/products?page=1&limit=50&includeInactive=true` and then filters **client-side** to `is_active === false`. The endpoint orders by `id DESC`, and 601 of 602 products are active, so page one is almost entirely active rows and the screen shows a near-empty list however many inactive products exist. Pagination is then recomputed from the filtered count, so it is meaningless too. This matters *because* F-63 made delete a deactivation and F-91 made restore possible | **Found by reading `settings/inactive-products.tsx` in full; grep could not have found it** | open |
| F-112 | Medium | The Inactive Products page sends `sortBy`/`sortOrder` to `/api/products`, which never reads them — `handleGet` hardcodes `orderBy: { id: 'desc' }`. Its sortable column headers do nothing | same read | open |

### F-88, finally explained

The first pass could not confirm it because the data disagreed with the code: 12 of 60
edited products still had a subcategory. Both are true, and the reason is a race.

`loadProductForEdit` sets `product_category` and `product_subcategory` in one
`setFormData`. The cascade effect keyed on `formData.product_category` then fires, because
the category changed from `''` to a real id, and unconditionally clears
`product_subcategory`. That is the wipe.

What decided the outcome is that the *load* effect also depended on `filterOptions`
(F-102), so it usually ran a **second** time once the options arrived. On that second run
the category was already set, so it did not change, so the cascade effect did **not** fire
— and the subcategory loaded on that pass survived. Whether a product kept its subcategory
came down to which of two async fetches landed first.

Both halves are fixed: the load effect is keyed on the edit id alone, and clearing a
dependent selection moved into `handleInputChange`, where a user actually picks a category.
An effect cannot tell a user's choice from a programmatic load. **The browser decides what
the user typed** — a load is not typing.

### What this pass says about the method

Seventeen findings on four pages that had already been audited once. The pattern is not
that the first pass was careless; it is that the first pass audited **endpoints**, and
these bugs live in the **seams**:

- F-91, F-96 and F-95 are all a caller and a callee disagreeing about a parameter.
- F-92, F-93, F-94 and F-109 are all a request shape nobody had sent.
- F-99, F-100 and F-110 are all a rule that exists on one side of a boundary.
- F-98 and F-108 are the same fix landing on one file and not its twin.

§11's third question — *does the save write anything the user did not touch?* — catches the
F-75 class. This pass says to add a fourth: **does every parameter this page can send
actually do what its name says at the other end?** Four of the seventeen were answered by
pressing a control and watching the request, which is cheaper than reading either side.


---

## 11. The convention fix plan

Written 2026-09-20 while Phase 3 was being fixed. Products is now the worked example;
this is what to apply to purchase, sale, salex and returns, each of which follows the same
**list → add / view / edit** convention and therefore almost certainly carries the same
defects.

### The rule

**The browser decides what the user typed. The server decides what the record means.**

Every product bug in Phase 3b was a violation of that one line.

### The shape to copy

`lib/product.ts` is the reference implementation. For each module, build the equivalent:

1. **A `SERVER_OWNED_FIELDS` list.** Derived values a client may never set. For products
   that is `stock`, `rack_number`, `display_name`, `is_active`, `last_purchase_date`,
   `latest_purchase_rate`. For purchase and sale it will include every computed total, the
   tax split, and the document number.
2. **One `validate*()` used by BOTH create and update**, with a `partial` flag so an update
   re-requires only what it was sent. Create and update drifting apart is what let an empty
   product name through an edit.
3. **One `build*Data()`** that maps payload → columns, takes only client-writable fields,
   and in partial mode includes only what was actually sent. No blanket overwrite with
   `0`/`null` fallbacks.
4. **Errors translated at the boundary.** P2025 → 404, P2003 → 400, P2002 → 409, and the
   raw database message never returned.

### The checks to run on every module

Per entity, walk the edit path field by field and answer three questions:

| Question | What it catches |
|---|---|
| Does every field **load**? | Fields silently blanked on save (F-76) |
| Does every field **save**? | Edits that appear to work and do not |
| Does the save write anything the user **did not touch**? | F-75, the worst class — silent corruption of derived data |

Then confirm the front end and back end **agree**: same required fields, same formats, same
messages. Where they disagree, the server wins and the browser copies it.

### Order

Purchase first — it is next in the journey, and it writes stock. Sale and salex next, as
a pair, checked against each other as much as against the rule. Returns last.

**Do not trust a grep on these.** F-87 was invisible to one, and the two false negatives
earlier in this audit (a guard that already existed, an overlap check that already existed)
were both grep artefacts. Read the file.
