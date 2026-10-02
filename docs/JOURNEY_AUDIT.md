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
---

## Phase 4 — Purchase · the plan

Written 2026-09-20, before any Phase 4 fix. Purchase is the first phase that moves **stock
and money at the same time**, and the first that routes through the shared service layer.
It is also the phase the whole journey depends on: `purchase_items` is empty today, so
nothing downstream — sale, salex, returns, most reports — can be round-tripped until this
phase produces data.

### What this plan is based on

Read in full before writing it: `lib/invoice-counter.ts`, `lib/customer-ledger-handler.ts`,
`prisma/schema.prisma` for the Purchase/Sale/Salex families and their satellites,
`pages/api/purchases/index.ts` from `handlePost` onward, and `lib/ledger-handler.ts`
`getPurchaseLedgerOps`. Everything those reads turned up is listed under **Leads** below
and is marked as a lead, not a finding — none of it has been reproduced yet.

**Not yet read**, and therefore step 1 of the work: `pages/api/purchases/[id].ts` (1115),
`pages/purchases/create.tsx` (3075), `pages/purchases/view/[id].ts` (811),
`pages/purchases/index.tsx` (172), `hooks/usePurchases.ts` (484),
`lib/transaction-handler.ts` (1673), `lib/balance-handler.ts` (588),
`lib/ledger-service.ts` (319), `lib/vendor-balance-service.ts` (331),
`lib/payment-allocation-service.ts` (366), `lib/rate-utils.ts` (225), and the GET half of
`pages/api/purchases/index.ts`.

### The surface

| Layer | Files | Lines |
|---|---|---|
| **FE pages** | `purchases/index.tsx`, `purchases/create.tsx`, `purchases/view/[id].tsx` | 172 · 3075 · 811 |
| **FE data** | `hooks/usePurchases.ts`, `hooks/useVendors.ts`, `hooks/useVendorTransactions.ts` | 484 · 23 · 351 |
| **BE routes** | `api/purchases/index.ts`, `api/purchases/[id].ts`, `api/purchases/last-invoice.ts` | 880 · 1115 · 31 |
| **Numbering** | `lib/invoice-counter.ts` | 85 |
| **Orchestration** | `lib/transaction-handler.ts` | 1673 |
| **Ledger** | `lib/ledger-handler.ts`, `lib/ledger-service.ts` | 507 · 319 |
| **Balance** | `lib/balance-handler.ts`, `lib/vendor-balance-service.ts`, `lib/balance-log-service.ts` | 588 · 331 · 60 |
| **Allocation** | `lib/payment-allocation-service.ts` | 366 |
| **Money helpers** | `lib/rate-utils.ts`, `lib/gst.ts`, `lib/financial-year.ts` | 225 · 160 · 107 |

About 6,600 lines of pages and routes over about 4,300 lines of shared service. The
service layer is the part Phase 3 never touched, and it is shared with sale, salex and all
four return paths — so a fix here pays four more times, and a mistake here breaks five
modules at once.

### The convention, and where purchase sits in it

Same **list → add / view / edit** shape as products, so JOURNEY_AUDIT §11 applies
unchanged. The data flow:

```
settings (vendor, staff, GST rate, FY, warehouse)
product (name, hsn, rates)
        |
        v
  PURCHASE created  ---> product.stock  GOES UP
        |                product.latest_purchase_rate, last_purchase_date overwritten
        |
        +--> purchase_items       (the captured lines)
        +--> bill_to              (billing snapshot)
        +--> vendor_ledger        (PURCHASE debit, PAYMENT credit)
        +--> vendor_details       (running balance columns)
        +--> vendor_payments + payment_allocations   (if paid)
        +--> vendor_balance_logs  (audit of the balance move)
        |
        v
  reports: bill-reference-purchase, vendor-ledger-accounting, vendor-outstanding,
           packing-forwarding, transport-cost, notes-mentioned, staff-sales
```

Stock goes **up** on purchase and **down** on sale. Worth stating because the two families
are easy to mix up: the sale tables are called `invoice`/`invoicex`, while `purchase` has a
*column* called `invoice_no`. Same word, two meanings, and that collision is F-08.

### The service layer: what "the cases" actually are

Purchase does not write the ledger directly. It hands a **change set** to a handler that
returns a list of operations, and a separate executor applies them:

```
api/purchases/[id].ts
   -> transactionHandler.handlePurchaseEdit({ oldStatus, newStatus, oldTotal, newTotal, ... })
        -> ledgerHandler.getPurchaseLedgerOps(changes)   -> { creates, updates, deletes }
        -> balanceHandler.getPurchaseBalanceOps(changes) -> BalanceOperation
        -> getPurchaseAllocationChanges(changes)         -> AllocationChange[]
   -> executes them inside one transaction
```

`getPurchaseLedgerOps` switches on `"oldStatus→newStatus"` where **0 = Unpaid, 1 = Paid,
2 = Partial**. That is the 3x3 = **9 transitions** the code comment refers to. This is the
heart of the phase and the thing to audit hardest, because every purchase edit lands in
exactly one of these branches and a missing branch is silent.

### Method

The four passes from AUDIT_PLAN §2 (schema, API, UI, round-trip), plus §11's three
questions, plus the question Phase 3c added, plus one more this phase needs:

1. Does every field **load**?
2. Does every field **save**?
3. Does the save write anything the user **did not touch**?
4. *(3c)* Does every parameter a page can send **do what its name says** at the other end?
5. *(new)* **Is the state space complete?** Enumerate every transition the code switches
   on and check each one is implemented, not just the ones someone hit.

Question 5 exists because of what the pre-read already found. Both
`getPurchaseLedgerOps` and `getSaleLedgerOps` document themselves as handling "all 9
cases" and both implement **eight** — `0→2`, Unpaid → Partial, is absent from both. The
return handlers *do* implement `0→2`, so the transition was known about. **Because both
twins are wrong in the same way, diffing them cannot find it.** Twin-diffing finds
divergence; only enumerating the state space finds a shared gap.

So the twin comparison is still worth running — it is how the mirrored pairs get
reconciled (G-02) — but it must not be the only check.

### Leads from the pre-read

Not findings. Each needs reproducing before it earns an F-number.

| # | Sev guess | Lead | Where |
|---|---|---|---|
| L-1 | **Critical** | **The first purchase of every new financial year may be impossible to create.** The counter is per-FY (`MAX(invoice_no) WHERE fy = currentFy`), so a new FY starts back at 1 — but the duplicate check queries `invoice_no` with **no `fy` filter**, so it finds last year's invoice 1 and returns 400. If so, purchase creation dies at every FY rollover until someone manually enters a number above the all-time max. Note the interaction: F-16's "wrong" global UI prefill may be the only thing masking this | `purchases/index.ts` counter call vs duplicate check |
| L-2 | **High** | **`bill_to` is keyed to the wrong invoice number.** The purchase is written with `invoiceNumberToUse` (the UI's number if supplied, else the generated one) but `bill_to` is written with `nextInvoiceNo` — always the generated one. Supply your own number and the billing snapshot attaches to a number no purchase has. `bill_to.invoice_no` is `@unique`, so the next auto-numbered purchase then collides | `purchases/index.ts` create block |
| L-3 | **High** | **`total` can be written as NaN.** `calculatedGrandTotal = itemsTotal + parseFloat(packing_forwarding_total?.toString()) + parseFloat(total_tax?.toString())`. Both use optional chaining with no `|| 0`, so a payload omitting either yields `parseFloat(undefined)` = NaN. The stored columns beside it *do* have `|| 0` fallbacks, so `total_tax` saves 0 while `total` goes bad | `purchases/index.ts` totals |
| L-4 | **High** | **A backdated purchase overwrites newer product state.** The stock UPDATE sets `last_purchase_date = <this invoice date>` and `latest_purchase_rate = <this rate>` unconditionally, with no `GREATEST()` and no date comparison. Entering a forgotten older bill rewrites the product's current rate | `purchases/index.ts` stock UPDATE |
| L-5 | **High** | **Create cannot produce a partial payment; edit presumably can.** Create validates `payment_status` against `[0, 1]` only, while the ledger case table is built on 0/1/2. Create and update disagreeing about what is valid is exactly F-79 | `purchases/index.ts` validation vs `ledger-handler.ts` |
| L-6 | **High** | **All money is client-supplied.** `total_cgst`, `total_sgst`, `total_igst`, `total_tax` and every per-item `cgst`/`sgst`/`igst`/`tax`/`gst_percentage` are taken from the request body and stored unverified. No server-side recomputation, and no CGST/SGST-vs-IGST determination from state codes. This is F-04 and the §4a statutory requirement, on the purchase path | `purchases/index.ts` |
| L-7 | Medium | **`0→2` is missing from the case table** — see Method above. Applies to purchase *and* sale | `ledger-handler.ts`, `customer-ledger-handler.ts` |
| L-8 | Medium | **The customer twin mislabels every salex ledger row.** The vendor handler hardcodes `reference_type: 'purchase'`; the customer handler derives it as `changes.invoiceId ? 'sale' : 'salex'`, and `handleSaleEdit` sets `invoiceId` for both types — so the ternary always picks `'sale'` and salex rows are written as sale. Same shape in the return handler with `returnId`. A real divergence between the twins, against the customer side. Phase 5's problem, found here | `customer-ledger-handler.ts` |
| L-9 | Medium | **The advance-balance calculation is duplicated within one function.** `handlePost` computes the advance breakdown once for the notes string and again for the payment records, querying `vendor_details` twice. Two copies of one rule, free to drift | `purchases/index.ts` |
| L-10 | Medium | **`vendor_id = 0` is a magic "Other" value written into an FK column.** `purchase.vendor_id` has a foreign key to `vendor_details`, so `0` requires a row with id 0 to exist. It then flows into `vendor_payments`, `payment_allocations` and the ledger. Needs an explicit test | `purchases/index.ts` |
| L-11 | Low | Error responses return `error.message` on both the GET and POST paths — the F-81 / F-98 class, already fixed twice elsewhere | `purchases/index.ts` |
| L-12 | Low | **Purchase has no per-item discount**, while sale and salex both do. Already noted in AUDIT_PLAN §9 as a product decision, not a defect. Confirm with the owner rather than assume | `schema.prisma` |
| L-13 | Low | **Transport is modelled twice.** Purchase denormalises `transport`, `transport_name`, `vehicle_number` onto the header; sale and salex use satellite `transport_details` / `transport_detailsx` tables. The `transport-cost` report has to read both shapes | `schema.prisma` |

### Already in the register

F-08 (Critical, items joined by non-unique `invoice_no` with no `fy` filter), F-12 (High,
duplicate product lines lose stock — `CASE id WHEN 5 ... WHEN 5 ...` takes the first
match, and the pre-read confirms `rateCases` has the identical flaw), F-13 (High,
invoice-number race — the counter reads `MAX+1` in a **read-only** transaction that holds
no lock, the duplicate check is a separate read, the insert is a third transaction, and
there is no `UNIQUE(fy, invoice_no)`), F-16 (Medium, two numbering schemes), F-21 (Medium,
`Promise.all` over one interactive `tx` — confirmed, the raw stock UPDATE and the ledger
write run concurrently on the same transaction client), F-06 (Medium, deferred to G-04).

### Order of work

**Step 0 — test data.** `vendor_details` is **empty**. Seed one realistic vendor with a
valid GSTIN and state code, and one with a different state code, so CGST/SGST vs IGST can
both be exercised. Minimum needed to test; the real vendor master is the owner's.

**Step 1 — read the unread.** In this order: `api/purchases/[id].ts`, then
`lib/transaction-handler.ts`, `lib/balance-handler.ts`, `lib/ledger-service.ts`, then
`purchases/create.tsx`, `view/[id].tsx`, `index.tsx`, `hooks/usePurchases.ts`. Whole
files. Grep has produced a wrong answer at every stage of this audit; in Phase 3c it both
inflated one finding and hid two others.

**Step 2 — the broken-before-wrong fixes.** L-1, L-2, L-3 first if they reproduce: each is
a create that fails or writes bad data. Then F-12 and F-13, which are the register's own
"broken" items. Then F-21.

**Step 3 — the item join, F-08.** Add `fy` to every purchase-item query as the immediate
fix, then migrate `purchase_items` to reference `purchase.id` with a real foreign key.
Do this *before* Phase 5, because sale already stores the header id in the same column
name and aligning them is what lets the reports be written once instead of twice.

**Step 4 — the §11 sweep on the edit path.** All five questions, field by field, on
create.tsx and `[id].ts`.

**Step 5 — the state-space sweep.** All nine transitions for purchase, each exercised for
real, with the ledger and balance checked after every one.

**Step 6 — the mutation pass.** Backdated entry (L-4), duplicate lines (F-12), quantity
change, line removal, line addition in one submit, delete-and-reversal.

### Reconciliation, run after every step

From AUDIT_PLAN §7, these are the assertions that say whether the step was clean:

1. `product.stock` equals `opening_stock` + purchases − sales − consumption + returns, for
   every product the step touched.
2. `vendor_ledger` running balance recomputed date-ordered equals `vendor_details`'s stored
   balance columns.
3. `SUM(payment_allocations.allocated_amount)` per purchase equals what `payment_status`
   claims.
4. Every purchase's `total` equals `items_total + packing_forwarding_total + total_tax`,
   and `total_cgst + total_sgst + total_igst` equals `total_tax`.
5. No purchase row has a `total` that is NaN or NULL (L-3).

Assertion 4 is new and is the one that catches L-6: if the server recomputed the tax it
would hold by construction; today it only holds if the client did its arithmetic right.

### Good to have, pulled forward on purpose

§9 says engineering quality goes last. Two exceptions earn their place in this phase
because the fix lands in the same file either way:

- **G-01, raw SQL.** The stock update is `$executeRawUnsafe` with product ids and
  quantities interpolated into the string. The values are numeric-parsed so injection is
  unlikely, but F-12 exists *because* it is hand-built SQL — a `CASE` with a duplicate
  `WHEN`. Fixing F-12 means rewriting that statement anyway; rewriting it as an aggregated
  Prisma `updateMany` per product, or a single grouped statement with bound parameters,
  fixes the class rather than the instance.
- **G-02, the mirrored pairs.** Not the whole collapse — that is a large piece of work —
  but this phase reads both `ledger-handler.ts` and `customer-ledger-handler.ts` anyway,
  and L-7 and L-8 are both products of the duplication. Write the reconciliation harness
  the memory calls for: a test that feeds the same change set to both handlers with names
  normalised and asserts the operation lists match. That test would have caught L-8 on the
  day it was introduced, and it is the thing that makes the eventual collapse safe.

Explicitly **not** pulled forward: G-03, G-04 (carries F-06), G-05.

### Exit criteria

- Every one of the nine status transitions exercised against a real purchase, with the
  five reconciliation assertions passing after each.
- A purchase created, edited (quantity up, quantity down, line added, line removed,
  backdated), and deleted, with stock and vendor balance returning to their starting
  values after the delete.
- Two purchases deliberately given the same invoice number in different financial years,
  proving F-08 and L-1 are closed.
- A purchase with the same product on two lines, proving F-12 is closed.
- `purchase_items` referencing `purchase.id` with a foreign key, or a written decision not
  to, with the reason.
- Every Critical and High finding has a written reproduction, per AUDIT_PLAN §2.
---

## Phase 4 — Purchase · the fix plan

> **This section is the working state of Phase 4. It is written to be picked up cold.**
> If you are starting a fresh session: read **Resume here** immediately below, then the
> task table. Do not re-derive anything already recorded here. Update this section after
> every batch, not at the end.

### Resume here

| | |
|---|---|
| **Last updated** | 2026-09-23 — **completion pass: Phase 4 was NOT complete.** The status column was stale and 16 of 22 read-queue files were unread. The service layer is now read and carries one reproduced **Critical** (L-36). See "Phase 4 — the completion pass" at the end of this document. Previously 2026-09-21 — **Phase 4 code work complete.** All five suites clean; assertions at baseline (only A5's pre-existing F-73). Only owner decisions and the deferred read queue remain |
| **Branch / HEAD** | **`audit/phase-4-completion`** (forked from `dev_akaash`, which is preserved untouched for reference) / **`0c61ea0`**. Previously `dev_akaash` / `efba4df` — working tree clean, database at baseline |
| **Next action** | **P4-15** — the §11 edit sweep — then **P4-17** (nine transitions exercised live). P4-27 through P4-32 are done. Previously: P4-27 (L-36, Critical, reproduced), then P4-28/29 (L-29, L-30), then P4-30 (the harness), then **P4-15** — the §11 edit sweep, the largest unfinished item. Phase 5 should not open until these land: L-29, L-30, L-33 and L-36 all have customer twins. Owner decisions (below) still stand, then Phase 5 Sale & Salex. Carry **L-8**, **L-24** and **L-25** into it — all three are sale-side or reports work this phase surfaced |
| **Server** | `npm run dev` on :3000, log in `admin` / `admin123`. Kill stray node processes first — a second server silently takes :3001 and you end up testing stale code |
| **Blocked on owner** | P4-11, P4-21, F-73, F-74, the `created_at` backfill |

**Environment facts confirmed 2026-09-20** (do not re-check these):

- `vendor_details` = **0 rows**. `staff` = 5. `mechanic` = 0. `states` = 37. `product` = 602.
- All transactional tables are empty: `purchase`, `purchase_items`, `invoice`, `invoicex`,
  all returns, both ledgers, `note_counters`.
- `settings.currentfy` = **4** → FY `2026-2027`, 2026-04-01 → 2027-03-31. FY id 3 is
  `2025-2026`, closed.
- `business_details` id 1, GSTIN **`09ABFPM3900M1ZI`** → state code **09, Uttar Pradesh**.
  So **intra-state = UP (9) → CGST+SGST; any other state → IGST.**
  `business_details` has no state column; `getBusinessStateCode(gstin)` in `lib/gst.ts`
  derives it from the GSTIN (F-30, partial fix).
- `gst_tax_rate`: id 1 = 0% (`0000`), id 2 = 5% (`8714`), id 3 = 18% (`8415`),
  id 4 = 40% (`8703`). All Active.
- Products carry `gst_rate_id = NULL` and `hsn = NULL` deliberately — real master data.
  Set the per-line GST % in the grid instead of tagging products.

### Step 0 — seed data (P4-00)

Two vendors, chosen so both tax paths can be exercised. Minimum needed to test; the real
vendor master is the owner's.

| Field | Vendor A (intra-state) | Vendor B (inter-state) |
|---|---|---|
| `vendor_name` | `AUDIT TEST VENDOR UP` | `AUDIT TEST VENDOR PB` |
| `state` / `state_code` | Uttar Pradesh / **9** | Punjab / **3** |
| `tax_id` (GSTIN) | `09AAACT2727Q1ZW` | `03AAACT2727Q1ZS` |
| `city` / `pin_code` | Agra / 282004 | Ludhiana / 141001 |
| `contact_no` | 9000000001 | 9000000002 |
| `status` | Active | Active |
| balances | all 0 | all 0 |

Vendor A gives CGST+SGST (same state as the business), Vendor B gives IGST. Record the
assigned ids in the table below once created, because every later step references them.

| | id | notes |
|---|---|---|
| **Other** | **0** | Not test data — the FK target the "Other vendor" option needs. Restored by the seed; see L-14 |
| **Vendor A (UP)** | **2** | state_code 9, GSTIN `09AAACT2727Q1ZW` — intra-state, expect CGST+SGST |
| **Vendor B (PB)** | **3** | state_code 3, GSTIN `03AAACT2727Q1ZS` — inter-state, expect IGST |

Seeded by `scripts/audit-seed-vendors.js` (idempotent, safe to re-run).

**Cleanup:** these two rows, plus every document created against them, are test data and
must be removed or left clearly marked before the phase closes. Name-prefixed
`AUDIT TEST` so they are easy to find. **Never touch the 602 real products** beyond
`stock` moving as a natural consequence of a purchase — and record which products were
used so their stock can be checked back.

### Baseline, recorded 2026-09-20 after P4-00 and P4-01

`node scripts/audit-assert.js` on the seeded-but-empty database:

| | Result |
|---|---|
| A1 stock reconciles | **PASS**, 602 products |
| A2 vendor ledger | PASS (nothing to check yet) |
| A3 allocations vs status | PASS (nothing to check yet) |
| A4 purchase totals | PASS (nothing to check yet) |
| A5 sanity | **FAIL — 1**: product 211 negative stock −1 (F-73, owner's decision, pre-existing) |
| A6 orphans | PASS |

That one failure is the expected pre-existing one. **Any new failure from here is
something this phase caused.** A1 passing across all 602 products is what makes the stock
assertion meaningful — it was not true before the 2026-09-20 wipe.

**L-14 (new, Low).** `scripts/fix_vendor_other_and_cascade.sql` inserts the "Other" vendor
with an explicit `id = 0`, but MySQL replaces an explicit 0 with the next AUTO_INCREMENT
value unless the session sets `NO_AUTO_VALUE_ON_ZERO`. Confirmed while seeding: the insert
landed at **id 1** and had to be moved to 0 explicitly. So that script never reliably did
what it claims, and the row it was meant to create is a hard dependency of the "Other
vendor" purchase path (L-10) — `purchase.vendor_id` has a foreign key, so without a row at
id 0 that path cannot insert at all. The seed script restores it and verifies the id.

### Reproductions, 2026-09-20 — all against the running server

Four leads promoted from lead to **confirmed**. Test data was created, observed and fully
removed; the harness is back to its exact baseline (A5's one pre-existing F-73 row).

**L-1 → CONFIRMED, Critical.** Seeded a FY 3 purchase carrying invoice_no 501, then POSTed
a purchase with no `invoice_number`. The counter correctly returned 501 for FY 4; the
duplicate check, which has no `fy` filter, found FY 3's row and rejected it:

```
POST /api/purchases  ->  400
{"message":"Invoice number 501 already exists","error_code":"DUPLICATE_INVOICE_NO"}
```

This is the financial-year rollover, exactly. On 1 April the counter restarts near 1 and
**every number up to the previous year's maximum is blocked**, so auto-numbered purchase
creation is dead until someone manually types a number above the all-time max. Guaranteed
annual, not a race.

**L-2 → CONFIRMED, High.** POSTed with an explicit `invoice_number: 500`. The purchase and
its items took 500; `bill_to` took **1**, the generated number:

| Table | `invoice_no` |
|---|---|
| `purchase` | 500 |
| `purchase_items` | 500 |
| **`bill_to`** | **1** |

The billing snapshot is orphaned. A6 detects it automatically. And because
`bill_to.invoice_no` is `@unique`, the next purchase that legitimately gets number 1 will
collide with it.

**L-3 → CONFIRMED, High — and it is a 500, not silent corruption.** POSTed omitting
`packing_forwarding_total` and `total_tax`. `calculatedGrandTotal` became NaN and Prisma
refused the insert:

```
HTTP 500 — Argument `total` is missing.
```

Note the asymmetry the response proves: `total_tax` stored as **0** via its `|| 0`
fallback, while `total` had none and went NaN.

**L-11 → CONFIRMED, and worse than written.** That same 500 returned the **entire Prisma
invocation** to the client — every field name and value, the vendor connect clause, the FY,
the internal timestamps. Not just a message: the whole call. Same class as F-81/F-98,
already fixed twice elsewhere.

**Verified working, do not break:** stock moves the right way. Product 602 went 0 → 2 on a
purchase of qty 2, `latest_purchase_rate` and `last_purchase_date` were set, the ledger
wrote `PURCHASE` debit 236 with `reference_type: 'purchase'` and `reference_id` = the
purchase id, and A1/A3/A4 all passed against the created document.

**Open question for the balance service (read R-9 and R-11 to settle).** After an **unpaid**
purchase, `vendor_ledger` ended at a debit balance of 236 while
`vendor_details.account_balance` stayed **0** — the balance block only runs when
`payment_status === 1`. Either `account_balance` does not mean "outstanding payable" and
assertion A2 is asserting the wrong thing, or an unpaid purchase never reaches the vendor
balance at all. **Do not fix until the service is read** — A2 may need correcting rather
than the code.

### Batch 1 complete — 2026-09-20

**Fixed and verified against the running server.** Test data created, observed, removed;
the harness is back to its exact baseline (A5's one pre-existing F-73 row).

| Task | Before | After |
|---|---|---|
| **P4-02** (L-1) | FY3 holds invoice 1 → auto-numbered create in FY4 returns `400` | `201`, invoice 1 created in FY4 |
| **P4-03** (L-2) | `invoice_number: 500` → purchase 500, `bill_to` **1** | purchase 500, `bill_to` **500** |
| **P4-04** (L-3) | omit `packing_forwarding_total`/`total_tax` → `500 Argument total is missing` | `201`, total computed with missing terms as 0 |
| **P4-20** (L-11) | 500 returned the whole Prisma invocation | bare message, P2002/P2003 translated |
| **P4-10** (F-08) | items fetched by `invoice_no` alone | `+ fy` at `[id].ts` GET and the return-validation lookup. **More sites remain** |

**L-19 (new, High) — found by fixing L-1, and it would have silently undone it.**
`bill_to.invoice_no` carried a **global** UNIQUE index, but the whole point of P4-02 is
that an invoice number may repeat in a later financial year. So the purchase insert
started succeeding and the billing snapshot then failed instead — the same number in two
FYs returned a constraint error from `bill_to`, not from `purchase`. Reproduced, then
fixed: `bill_to` gains an `fy` column and the key becomes `@@unique([invoice_no, fy])`,
matching how `purchase_items` already identifies a document. Re-verified: invoice 500 now
exists in FY3 and FY4 together.

> **Deployment note.** The migration adds `bill_to.fy` as NULL. Every existing `bill_to`
> row will therefore stop matching its purchase until `fy` is backfilled from
> `purchase.fy` on `invoice_no`. This database's `bill_to` was empty so nothing needed it
> here; **a production deploy does.** The A6 assertion detects the un-backfilled state.

**The first version of the P2002 handler was wrong and is worth remembering.** It said
"that invoice number is already in use in this financial year" — but the constraint that
actually fired was `bill_to`'s, across financial years. A confident error message that
names the wrong cause sends someone looking in the wrong place. It now describes the
conflict without claiming which key produced it.

**Also fixed while in the file:**

- **L-15 (Medium).** `staff_id` was read on the purchase list (`staffIds`, `staffMap`) but
  never included in either `select`, so it was always `undefined` and **every purchase
  showed blank staff name, phone and email**. Added to both select blocks.
- **L-16 (Medium).** Item counts were `groupBy(['invoice_no'])` with no `fy`, so a
  purchase's item count included the lines of every same-numbered purchase from every
  year. Now grouped and keyed on `invoice_no + fy`. The `bill_to` lookup on the same
  endpoint had the same flaw and was fixed with it.

**Still open, found while reading the edit path:**

- **L-5 → CONFIRMED.** Create validates `payment_status` against `[0, 1]`; edit validates
  against `[0, 1, 2]` and the server can even promote 1 → 2 itself. Create and edit
  disagree about what a valid purchase is — the F-79 shape. P4-13.
- **L-20 (new, Medium).** Create stores the client's `packing_forwarding_total` as sent;
  edit **recomputes** it as `qty × rate`. The same input therefore produces a different
  total depending on which path wrote it.
- **L-21 (new, Medium).** The edit path computes all three totals inside
  `if (items && Array.isArray(items))`. An edit that omits `items` leaves items, packing
  and tax at 0 and writes `total = 0` — the F-78 blanket-overwrite shape.
- **L-22 (new, Medium).** A4 caught this live: a purchase stored `total_tax = 0` while
  `total_cgst + total_sgst` came to 36, because the payload sent the components and
  omitted the total. Nothing cross-checks them. Folded into P4-12.

**One assertion was wrong and has been corrected.** A6 joined `purchase_items` to
`purchase` on `invoice_no` alone, so once the same number legitimately existed in two
financial years it reported that as a fault. It now pairs on `(invoice_no, fy)`, which is
the real F-08 condition: two purchases sharing a number *within one* financial year.
Worth noting that the harness needed the same fix as the code it checks.

### Batch 2 complete — 2026-09-20

| Task | Verification |
|---|---|
| **P4-05** (F-13) | `@@unique([fy, invoice_no])` applied to `purchase`. **The retry loop is still to write** — the index makes a collision impossible, but an auto-numbered create that loses the race currently surfaces as a 409 rather than taking the next number |
| **P4-07** (F-12) | Same product on two lines, qty 2 and 3 → **stock rose by 5**, and `latest_purchase_rate` took the **later** line's 150. Before: stock rose by 2, rate 100 |
| **L-4** | Backdated bill (2026-05-01, rate 999) entered after a 2026-09-20 bill at 150 → stock 5 → 6, `latest_purchase_rate` **stayed 150**, `last_purchase_date` **stayed 2026-09-20** |
| **P4-09** (F-21) | Stock update and ledger write serialised; no `Promise.all` over one interactive `tx` |
| **G-01** | That statement is now Prisma rather than `$executeRawUnsafe` with interpolated ids and quantities |

F-12, L-4 and G-01 were one edit on purpose. **F-12 existed because the statement was
hand-built SQL** — a `CASE` with a duplicate `WHEN` is not a mistake the query builder
lets you make. Fixing the instance without fixing the class would have left the next
person to rebuild the same trap.

### F-02 reproduced — 2026-09-20

The backdated-purchase test did something this audit had not managed before: it
**reproduced F-02**, the Critical cross-cutting ledger defect, live.

Two purchases for one vendor — ₹650 dated 2026-09-20, then ₹999 entered afterwards but
dated 2026-05-01:

| Ledger row | Stored `balance` | Recomputed date-ordered |
|---|---|---|
| row 6 — Sept, ₹650 | **650** | 1649 |
| row 7 — May, ₹999 (backdated) | **1649** | 999 |

The stored column is computed from the previous row **by id**, so it is insertion-ordered
— while the ledger is **displayed** date-ordered. Every intermediate balance is therefore
wrong the moment anything is backdated. The closing figure still agrees only because
addition is commutative; the statement a vendor would be shown does not add up line by
line.

This is exactly what assertion A2 was written for, and it fired on the second purchase of
the phase. F-02 is not a Phase 4 fix — it is cross-cutting ledger work (AUDIT_PLAN §4) —
but it now has the **written reproduction** AUDIT_PLAN §2 requires of every Critical
finding, and did not have before.

**L-23 (new, Low).** `purchase_items.qty` is a `Float` while `product.stock` is an `Int`,
so the aggregated increment is rounded before it is applied. The old raw SQL truncated it
too; this makes the rounding explicit rather than incidental. The mismatch itself is a
modelling question for the owner.

### Batches 3-5 complete — 2026-09-21

Three suites now guard this phase, all passing:

| Script | What it proves |
|---|---|
| `scripts/audit-assert.js` | The six standing reconciliation assertions (A1–A6) |
| `scripts/audit-p4-roundtrip.js` | Create → edit (quantity change + line removed + line added in ONE submit) → delete, with stock checked as a delta at each step |
| `scripts/audit-p4-tax.js` | The server computes tax and ignores the payload, for both intra-state and inter-state vendors |
| `scripts/audit-p4-flow.js` | Every table a purchase writes, every table it must NOT write, the four reports it should move, and full reversal on delete |

**Fixed in these batches:** P4-10 (F-08 at all three `[id].ts` join sites), the edit path's
own copies of F-12 / F-21 / L-4 / G-01, P4-06 (`last-invoice.ts` now per-FY), P4-05's retry
loop, P4-12/13/14 (`lib/purchase.ts`: one validator and one totals computation shared by
create and update, server-side tax and CGST/SGST-vs-IGST split), P4-16 (the missing `0→2`
transition, added to **both** twins), P4-19 (the "Other" vendor path works), P4-20, and
P4-24/P4-25.

### L-26 — deleting a paid purchase invented money

Found by the flow suite, and the most serious defect of the phase after L-1.

Creating a paid purchase increments **both** `vendor_details.total_paid` and
`total_allocated`. Deleting it decremented **only `total_allocated`**. So a vendor was left
holding `total_paid = 1180` and `account_balance = 1180` for a payment that no longer
existed anywhere — a phantom advance.

It then did further damage silently. The create path treats
`total_paid − total_allocated` as an available advance, so the *next* purchase for that
vendor "spent" the phantom 1180, concluded no new money was needed, and **skipped writing
its PAYMENT ledger entry altogether**. That is how it was caught: `vendor_ledger` grew by 1
instead of 2 on a paid purchase, with no error anywhere.

The fix distinguishes two things the old code conflated. A `BILL_SPECIFIC` payment was
created *by* this purchase, so deleting the purchase deletes it and `total_paid` must come
down with it. A `DIRECT` or `MIXED` payment is a real advance that existed before and still
exists after; only its **allocation** reverses. `total_paid` now moves by the payments
actually removed, never by the amount deallocated.

**Why it hid for so long:** the round-trip suite asserted `total_allocated` returned to its
starting value and never checked `total_paid`. Half a check passes quietly. Both are
asserted now.

### L-24 — duplicate product lines cannot be edited

A purchase may legitimately carry the same product on two lines — the same part bought at
two rates on one bill — and `createMany` has always written them as separate rows. But the
edit reconciliation keys everything by `product_id`, so a second line overwrote the first
in the map: its row id was lost, so it was never updated and never deleted, and its
quantity vanished from the stock arithmetic.

Reworking the reconciliation to key on the item **row id** is the real fix and is a larger
change. Until then the edit **refuses**, naming the problem and what to do about it, rather
than silently corrupting stock. Recorded as open.

### L-25 — `vendor-outstanding` reports paid purchases as outstanding

`/api/reports/vendor-outstanding` queries individual `vendor_ledger` **rows** for
`balance > 0` rather than each vendor's latest balance. A fully paid purchase leaves its
`PURCHASE` row at the full amount, with a later `PAYMENT` row bringing the vendor to zero
— so the paid purchase still reads as outstanding. **F-02 compounds it**: that stored
`balance` column is insertion-ordered and unreliable the moment anything is backdated.

This is a **reports** defect and belongs to Phase 7, so the flow suite reports it as a
NOTE rather than asserting it. Recorded here because the purchase journey is what exposed
it.

### Two assertions of mine were wrong, and are corrected

Worth recording, because in both cases the code was right and the check was not.

- **A6** joined `purchase_items` to `purchase` on `invoice_no` alone, so the legitimate
  reuse of a bill number in a later financial year read as a fault. It pairs on
  `(invoice_no, fy)` now.
- **The flow suite** expected `vendor_balance_logs` to return to its starting count after a
  delete. It is an **append-only audit trail**: deleting a purchase writes a
  `purchase_delete` row recording the reversal rather than erasing the history. Confirmed
  by reading one back (`source_type: 'purchase_delete'`, `change_amount: -1180`). It also
  read every report with a guessed response shape, which made four working reports look
  broken; each is now read with the parameters it requires and the key it returns.

### Phase 4 closing state — 2026-09-21

**Four suites, all clean**, and they are the regression net for this phase:

```
node scripts/audit-assert.js          six reconciliation assertions (A1-A6)
node scripts/audit-p4-roundtrip.js    create -> edit -> delete, stock as deltas
node scripts/audit-p4-tax.js          server computes tax, payload ignored
node scripts/audit-p4-flow.js         every table and report a purchase touches
node scripts/audit-twin-check.js      purchase vs sale ledger handlers agree
```

The only standing assertion failure is **A5's pre-existing F-73** (product 211 at stock
−1), which is the owner's call.

**P4-26, the twin harness.** Feeds one change set to both ledger handlers, normalises the
vendor vocabulary onto the customer one and compares structurally. All nine transitions
agree. Its header is explicit about what it cannot catch, because this phase produced one
of each kind:

- **L-7** (`0→2` missing) it would *not* have caught — both twins were missing it
  identically, and two identical wrongs compare equal. That is why every transition is
  **enumerated** and a reachable transition emitting nothing is reported as EMPTY. The
  state-space check finds shared gaps; the twin check finds drift.
- **L-8** it also cannot catch, because the normaliser maps `sale` and `salex` onto one
  token. L-8 is about what that ternary *evaluates to at runtime*, not the shape of the
  operation, so it needs the caller exercised — Phase 5.

Wording is compared separately from structure on purpose: "Payment made for purchase" and
"Payment received for sale" are each correct for their own side, and holding them
identical would drown a real divergence in cosmetic noise.

### What is left, and who owns it

| Item | Why it is not done |
|---|---|
| **P4-11** — migrate `purchase_items` (and `bill_to`) to reference `purchase.id` with a real FK | Owner decision on migration timing. Should land **before Phase 5**, because sale already stores the header id in the same column name and aligning them is what lets the reports be written once |
| **P4-21** — purchase has no per-item discount while sale and salex do | Owner decision on whether that is intended |
| **P4-23** — `purchase-returns/[id]-old.ts` is still a live route | The owner already deferred this to G-04 on 2026-09-20. Deferral confirmed, not re-litigated — and it is Phase 6 territory |
| **L-24** — duplicate product lines cannot be edited | Guarded, not solved. The edit refuses rather than corrupting stock. The real fix keys the reconciliation on the item row id |
| **L-25** — `vendor-outstanding` shows paid purchases | Reports defect, Phase 7 |
| **F-73**, **F-74**, `created_at` backfill | Owner's data decisions, carried from Phase 3 |
| **R-7 to R-18** | The rest of the read queue. The files that carried defects were read in full; these are the ones no finding has pointed at yet |

**Deployment note, repeated because it is easy to miss:** the `bill_to.fy` migration adds
the column as NULL. Existing rows stop matching their purchase until `fy` is backfilled
from `purchase.fy` on `invoice_no`. Assertion A6 detects the un-backfilled state.

### Step 1 — the read queue

"Leave no issue, however small" means every file below is read **in full** before its
findings are considered complete. Grep has produced a wrong answer at every stage of this
audit. Tick each off and record findings against it.

| # | File | Lines | Read? | Findings recorded |
|---|---|---|---|---|
| R-1 | `pages/api/purchases/index.ts` — `handlePost` onward | 380-880 | **done** | L-1…L-6, L-9…L-11, F-12, F-21 confirmed |
| R-2 | `lib/invoice-counter.ts` | 85 | **done** | F-13 confirmed |
| R-3 | `lib/ledger-handler.ts` — `getPurchaseLedgerOps` + helpers | 80-379 | **partial** | L-7 |
| R-4 | `pages/api/purchases/index.ts` — `handleGet` | 1-380 | **done** | L-15, L-16 |
| R-5 | `pages/api/purchases/[id].ts` | 1115 | **partial** (to ~690) | L-5 confirmed, L-20, L-21; two F-08 sites fixed |
| R-6 | `pages/api/purchases/last-invoice.ts` | 31 | no | |
| R-7 | `lib/ledger-handler.ts` — remainder | 1-80, 379-507 | no | |
| R-8 | `lib/transaction-handler.ts` | 1673 | no | |
| R-9 | `lib/balance-handler.ts` | 588 | no | |
| R-10 | `lib/ledger-service.ts` | 319 | no | |
| R-11 | `lib/vendor-balance-service.ts` | 331 | no | |
| R-12 | `lib/payment-allocation-service.ts` | 366 | no | |
| R-13 | `lib/balance-log-service.ts` | 60 | no | |
| R-14 | `lib/rate-utils.ts` | 225 | no | |
| R-15 | `pages/purchases/create.tsx` | 3075 | no | |
| R-16 | `pages/purchases/view/[id].tsx` | 811 | no | |
| R-17 | `pages/purchases/index.tsx` | 172 | no | |
| R-18 | `hooks/usePurchases.ts` | 484 | no | |
| R-19 | `pages/api/reports/bill-reference-purchase.ts` | 85 | no | |
| R-20 | `pages/api/reports/vendor-ledger-accounting.ts` | 116 | no | |
| R-21 | `pages/api/reports/vendor-outstanding.ts` | 189 | no | |
| R-22 | `pages/api/reports/vendor-balance-logs.ts` | 137 | no | |

### Step 2 — the fix tasks

Ordered **broken before wrong, easy before hard**. Status: `todo` · `doing` · `done` ·
`blocked` · `owner`. Update the status column as you go — this table is the resume state.

| # | Sev | Task | Source | Status |
|---|---|---|---|---|
| **P4-00** | — | Seed vendors A and B (Step 0) | setup | **done** — `scripts/audit-seed-vendors.js`; ids 0 / 2 / 3 |
| **P4-01** | — | Build `scripts/audit-assert.js` — the five reconciliation assertions, runnable after every step. This is the harness everything else is checked with; write it before fixing anything | method | **done** — `scripts/audit-assert.js`, six assertions A1–A6 |
| **P4-02** | **Critical** | **FY-scoped duplicate check.** The counter is per-FY but the duplicate check has no `fy` filter, so the first purchase of a new FY collides with last year's number 1. Add `fy: currentFy` to the check. **REPRODUCED** — see Reproductions above | L-1 | **done — verified** |
| **P4-03** | High | **`bill_to` keyed to the wrong number.** Purchase writes `invoiceNumberToUse`, `bill_to` writes `nextInvoiceNo`. Use one value. Also decide whether `bill_to` should key on `purchase.id` instead — it is a satellite of one purchase and `invoice_no` is not unique per FY. **REPRODUCED** | L-2 | **done — verified**, plus L-19 |
| **P4-04** | High | **`total` can be NaN.** `calculatedGrandTotal` adds two `parseFloat(x?.toString())` with no `|| 0`. Give them fallbacks, and add a server-side assertion that the total is finite before the insert. **REPRODUCED — it is a 500** | L-3 | **done — verified** |
| **P4-05** | High | **Invoice-number race (F-13).** The counter reads `MAX+1` inside a transaction that only READS, so it holds no lock; the duplicate check is a second read; the insert is a third transaction. Fix: `UNIQUE(fy, invoice_no)` on `purchase`, allocate inside the same transaction as the insert, and retry on P2002. The unique index is the part that actually makes it safe | F-13 | **done** — index plus a retry on P2002 for auto-numbered creates |
| **P4-06** | Medium | **Two numbering schemes (F-16).** Server counter is per-FY; `last-invoice.ts` is a global max with no FY filter. Make `last-invoice.ts` per-FY. **Note the interaction:** the global prefill may be the only thing currently masking P4-02, so do P4-02 first and verify together | F-16 | **done** — verified 2026-09-23: `last-invoice.ts:35` filters `fy` |
| **P4-07** | High | **Duplicate product lines lose stock (F-12).** `CASE id WHEN 5 THEN stock+2 WHEN 5 THEN stock+3` takes the first match. `rateCases` has the identical flaw, so `latest_purchase_rate` takes the first line's rate too. Fix by aggregating quantities per `product_id` before building the statement — and take **G-01** with it: replace the hand-built `$executeRawUnsafe` with bound parameters or per-product Prisma updates, because the hand-built SQL is *why* this bug exists | F-12, G-01 | **done — verified** |
| **P4-08** | High | **Backdated purchase overwrites newer product state.** `last_purchase_date` and `latest_purchase_rate` are set unconditionally. Only overwrite when this invoice date is newer than the stored one | L-4 | **done — verified** |
| **P4-09** | Medium | **`Promise.all` over one interactive `tx` (F-21).** The raw stock UPDATE and the ledger write run concurrently on the same transaction client. Serialise them | F-21 | **done** |
| **P4-10** | **Critical** | **Item join ignores `fy` (F-08).** Every purchase-item query filters on `invoice_no` alone. Add `fy` to all of them as the immediate fix. Find them by reading `[id].ts` in full, not by grep | F-08 | **done** — all three sites in `[id].ts`, plus the list endpoint |
| **P4-11** | **Critical** | **Migrate `purchase_items` to reference `purchase.id`** with a real FK, retiring the `invoice_no` join. Larger change and it aligns purchase with sale, which stores the header id in the same column name. **Do before Phase 5** so the reports can be written once. Needs an owner decision on migration timing | F-08 | owner |
| **P4-12** | High | **Server-side tax (L-6, F-04, §4a).** All of `total_cgst/sgst/igst/total_tax` and every per-item tax figure is client-supplied and stored unverified, with no CGST/SGST-vs-IGST determination. Recompute server-side from line qty/rate/GST% and decide the split from the vendor's `state_code` against `getBusinessStateCode(business_details.gstin)` = 9. Reject or correct a client total that disagrees beyond a rounding tolerance | L-6 | **done** — `lib/purchase.ts` computes tax server-side |
| **P4-13** | High | **Create and edit disagree on `payment_status`.** Create validates against `[0, 1]` only; the ledger case table is built on 0/1/2. This is the F-79 shape — one rule, both paths. Resolve which statuses a create may set and enforce it in one shared validator | L-5 | **done** — one shared validator in `lib/purchase.ts` |
| **P4-14** | High | **`lib/purchase.ts`, the §11 module.** Mirror `lib/product.ts`: `SERVER_OWNED_FIELDS` (every computed total, the tax split, the document number, stock effects), one `validatePurchase()` with a `partial` flag used by create **and** update, one `buildPurchaseData()`, and Prisma errors translated at the boundary (P2025→404, P2003→400, P2002→409) | §11 | **done** — verified 2026-09-23: `lib/purchase.ts` exists |
| **P4-15** | High | **§11 sweep on the edit path.** All five questions, field by field, across `create.tsx` and `[id].ts`: does every field load, does every field save, does the save write anything untouched, does every parameter do what its name says, **is the state space complete** | §11, 3c | **read done** — 34 findings (PU-01…PU-34) and the sale/salex twin list in `PURCHASE_PASS2_AUDIT.md`; **fixed** — Steps 1–2 and Blocks A–D (PURCHASE_PASS2_AUDIT §6); live DB click-through pending |
| **P4-16** | Medium | **Add the missing `0→2` transition.** `getPurchaseLedgerOps` documents "all 9 cases" and implements eight; Unpaid→Partial is absent. The return handler implements it, so the shape to copy exists. Do the same for `getSaleLedgerOps` or log it explicitly for Phase 5 — **note both twins are wrong identically, so a twin-diff will not catch it** | L-7 | **done for the LEDGER handlers only** — verified 2026-09-23 at `ledger-handler.ts:275` and `customer-ledger-handler.ts:265`. The BALANCE handlers never got it — see **L-29** |
| **P4-17** | High | **Exercise all nine transitions** against a real purchase, running the P4-01 assertions after each | method | todo |
| **P4-18** | Medium | **Deduplicate the advance-balance calculation.** `handlePost` computes the breakdown twice and queries `vendor_details` twice within one function | L-9 | todo |
| **P4-19** | Medium | **`vendor_id = 0` magic value.** `purchase.vendor_id` has an FK to `vendor_details`, so writing 0 needs a row with id 0. It then flows into `vendor_payments`, `payment_allocations` and the ledger. Test it explicitly; if it works only because the FK is unenforced, that is the finding | L-10 | **done** — the "Other" vendor path works |
| **P4-20** | Low | **Error leakage.** GET and POST both return `error.message`. Same class as F-81/F-98. **REPRODUCED** — a 500 returned the entire Prisma invocation, not just a message. Raise to **Medium** | L-11 | **done — verified** |
| **P4-21** | Low | **Purchase has no per-item discount** while sale and salex do. Confirm with the owner whether that is intended before changing anything | L-12 | owner |
| **P4-22** | Low | **Transport modelled twice.** Purchase denormalises `transport`/`transport_name`/`vehicle_number` onto the header; sale and salex use satellite tables. Note it, and check the `transport-cost` report reads both | L-13 | todo |
| **P4-23** | Medium | **`purchase-returns/[id]-old.ts` is a live route** mutating stock (F-06, deferred to G-04). Now that the rewrite is settled, delete it — or confirm the deferral still stands | F-06 | todo |
| **P4-24** | High | **Transaction flow verification** — Step 3 below | method | **done** — `scripts/audit-p4-flow.js` |
| **P4-25** | High | **Reporting verification** — Step 4 below | method | **done** — `scripts/audit-p4-flow.js` |
| **P4-26** | Medium | **G-02 reconciliation harness.** A test feeding one change set to both `ledgerHandler` and `customerLedgerHandler` with names normalised, asserting the operation lists match | G-02 | **done** — `scripts/audit-twin-check.js`; all nine transitions agree |
| **P4-27** | **Critical** | **Purchase edit corrupts the vendor ledger (L-36).** `executeLedgerUpdates` reseeds `recalculateBalancesAfter` from the row it just updated, whose own `balance` the `updateMany` could not touch. Pass the id BEFORE the earliest updated row, or rebuild from 0 as `executeLedgerDeletes` already does. Also give the `findMany` at `:356` an `orderBy: { id: asc }`. **REPRODUCED** — `scripts/audit-p4-ledger-edit.js` | L-36 | **done — verified**. Rebuilds from 0, as `executeLedgerDeletes` always did, and the `findMany` is ordered. `scripts/audit-p4-ledger-edit.js` reproduced it before and passes after |
| **P4-28** | High | **Add `0→2` to all four BALANCE case tables (L-29).** P4-16 fixed only the ledger handlers. `getPurchaseBalanceOps`, `getReturnBalanceOps` and both customer twins fall through to `default: return null`, so Unpaid→Partial writes ledger rows but never moves the balance columns | L-29 | **done**. `0→2` added to all four balance case tables, both twins |
| **P4-29** | High | **Edit-path balance asymmetry (L-30, L-31).** `1→0` and `2→0` decrement `total_paid` by amounts an advance-funded create never added — L-26 on the edit path. `2→2` is near-dead and carries the same flaw when it fires. Fix in both twins | L-30, L-31 | **done**. Callers pass `paidByThisDocument` (the BILL_SPECIFIC sum); `2→2` moves only the allocation. Falls back to the old behaviour for Type B, which has no allocations to measure |
| **P4-30** | Medium | **Fix the harness (L-37, L-38).** Drop or correct A2's `account_balance` comparison — it is unallocated advance, not outstanding payable — and KEEP its per-row half, which is what catches L-36. Make a zero-sample assertion report **EMPTY**, not PASS: A2/A3/A4 currently examine nothing at baseline | L-37, L-38 | **done**. A2 now checks `account_balance` against its own component columns and keeps its per-row half; a zero-sample assertion reports **EMPTY** |
| **P4-31** | Medium | **Transaction-safety sweep of the service layer (L-27, L-32, L-33).** `ledger-service.createEntry` does its `bill_to` lookup on the global client and without `fy`; `logMultipleChanges` runs `Promise.all` over one interactive `tx`; `calculatePaymentStatus`/`calculateRefundStatus` ignore `tx` while their vendor twins honour it | L-27, L-32, L-33 | **done** for L-27, L-32, L-33 (and F-15, found with them). L-34 taken at the same time |
| **P4-32** | Low | **Delete the dead money-layer modules (L-40).** `lib/vendor-balance-service.ts` (331) and `lib/rate-utils.ts` (225) have zero callers; `updateBalanceInTransaction` is dead in both balance handlers; `getOutstandingAmount` is a stub returning 0. They read as authoritative and one defines a third selling-price formula | L-40 | **done**. Both modules deleted, both dead `updateBalanceInTransaction` methods spliced out, `getOutstandingAmount` stub removed. `tsc` clean afterwards is the proof |

### Step 3 — transaction flow verification (P4-24)

For each operation, confirm every table below is written, **and that nothing else is**.
Snapshot before, act, diff after. Record actual vs expected in this table as you go.

| Table | Purchase **create** | Purchase **edit** | Purchase **delete** |
|---|---|---|---|
| `purchase` | 1 row | same row updated | removed / reversed |
| `purchase_items` | one per line | lines reconciled, not blindly replaced | removed |
| `bill_to` | 1 row, keyed correctly (P4-03) | updated if vendor changed | removed |
| `product.stock` | **up** by qty, aggregated per product | net delta only, old effect reversed first | **down** by qty |
| `product.latest_purchase_rate` / `last_purchase_date` | set only if newer (P4-08) | same | recomputed from remaining purchases |
| `vendor_ledger` | `PURCHASE` debit; `PAYMENT` credit if paid | per the nine-case table | reversed or deleted, consistently |
| `vendor_details` balance columns | `total_paid` / `total_allocated` move | move by the delta | returned to prior values |
| `vendor_payments` | 1 per advance portion + 1 per new payment | adjusted | removed |
| `payment_allocations` | 1 per payment, summing to the paid amount | adjusted | removed |
| `vendor_balance_logs` | 1 audit row | 1 audit row | 1 audit row |
| `Incexp` | only if the flow writes it — **confirm whether purchase touches it at all** | | |

**The delete test is the strongest single check in this phase:** create a purchase, note
stock and vendor balance, delete it, and both must return exactly to their starting values.
Anything left behind is a finding.

### Step 4 — reporting verification (P4-25)

From AUDIT_PLAN §10, a purchase should move these and only these. After creating one
purchase, check each report reflects it; after deleting it, check each report forgets it.

| Report endpoint | Page | Expected to move | Verified |
|---|---|---|---|
| `bill-reference-purchase` | `billreferencepurchase` | yes | |
| `vendor-ledger-accounting` | `vendor-ledger` | yes | |
| `vendor-outstanding` | `vendor-reports` | yes | |
| `vendor-balance-logs` | `vendor-balance-logs` | yes | |
| `packing-forwarding` | `packing` | yes, if packing values set | |
| `transport-cost` | `transport` | yes, if transport set | |
| `notes-mentioned` | `notes` | yes, if notes set | |
| `staff-sales` | `staff` | yes, if `staff_id` set | |
| `minimum-stock` | `minimumstock` | **only** via `product.stock` | |
| any sale/customer report | — | **must not move** | |

The last row matters: a purchase moving a customer-side report means the ledger
`reference_type` is wrong, which is the shape of L-8 on the sale side.

### The five reconciliation assertions (P4-01)

Run after **every** step. These are the definition of "the step was clean".

1. `product.stock` = `opening_stock` + purchases − sales − consumption + returns, per
   product touched.
2. `vendor_ledger` running balance, recomputed **date-ordered**, equals `vendor_details`'s
   stored balance columns. (Recomputing date-ordered rather than insertion-ordered is the
   point — F-02.)
3. `SUM(payment_allocations.allocated_amount)` per purchase equals what `payment_status`
   claims.
4. Per purchase: `total` = `items_total + packing_forwarding_total + total_tax`, and
   `total_cgst + total_sgst + total_igst` = `total_tax`. Holds by construction only once
   P4-12 lands; before that it is the test that catches client-supplied arithmetic.
5. No purchase has a `total` that is NaN, NULL or negative (P4-04).

### Working agreement for this phase

- **Agree the batch before each fix loop.** Propose the next 1-3 tasks and wait. Diagnosis
  and verification need no approval; changing code does.
- **Update this section after every batch**, not at the end — status column, Resume here,
  and any new findings into the read queue. Assume the session ends without warning.
- **Read whole files.** No grep for understanding or for claims.
- **Do not mass-modify real data.** The 602 products are the owner's.
- Line endings: this repo is mixed CRLF/LF and the Edit tool normalises them. After
  editing, repair terminators and check `git diff --stat` against
  `git diff --stat --ignore-cr-at-eol`. Never run `prisma db push` — use
  `prisma migrate diff` then `prisma db execute`.

---

## Phase 4 — the completion pass · 2026-09-23

Phase 4 was recorded as "code work complete" on 2026-09-21. It was not: the **Step 2
status column was stale**, and **16 of the 22 read-queue files had never been opened**,
including the whole shared service layer. This pass read them. It found one **Critical,
reproduced**, and it explains why the existing harness could not have caught it.

### First, the docs disagreed with the code

The Batches 3-5 prose said P4-06, P4-12, P4-13, P4-14, P4-16, P4-19, P4-24 and P4-25 were
done; the Step 2 table still said `todo`. Checked against the code, the prose was right:
`last-invoice.ts:35` filters `fy`, `lib/purchase.ts` exists, and `0→2` is present in both
ledger handlers. The status column has been corrected below. **The table is the resume
state — a stale one costs a session.**

### L-36 · Editing a purchase corrupts the vendor ledger · **Critical** · REPRODUCED · **FIXED**

`LedgerUpdateOperation.data` (`ledger-handler.ts:54-58`) can carry only `debit`, `credit`
and `notes` — it **cannot set `balance`**. So `updateMany` changes a row's debit and
leaves that row's own stored balance untouched. `executeLedgerUpdates`
(`transaction-handler.ts:372-378`) then calls
`recalculateBalancesAfter(vendorId, firstEntry.id)` — seeding the running balance from
**the stored balance of the row it just updated**, which is exactly the value that is now
stale, and walking only rows *after* it.

Reproduced against the running server with `scripts/audit-p4-ledger-edit.js`: two unpaid
purchases for vendor 2, ₹500 then ₹100, then the first edited to ₹900.

| Ledger row | Debit after edit | Stored `balance` | Correct |
|---|---|---|---|
| 28 — purchase A | 900 | **500** | 900 |
| 29 — purchase B | 100 | **600** | 1000 |

**This is worse than F-02.** F-02 scrambles the intermediate balances but the closing
figure still ties out, because addition is commutative. Here the **closing balance is
wrong by the full delta** — the vendor's statement understates what is owed, and stays
wrong until something else rewrites the column.

`executeLedgerDeletes` (`:414`) does the same job correctly, passing `0` for a full
rebuild. The two sit forty lines apart.

Two smaller things in the same function: the `findMany` at `:356` has no `orderBy`, so
`entries[0]` is not guaranteed to be the lowest id; and `:84` dumps the entire financial
payload through `console.log(JSON.stringify(params))` on every purchase edit.

### L-37 · Half of A2 compares two different quantities · Medium · **FIXED**

This settles the open question recorded under "Reproductions, 2026-09-20" — *does
`account_balance` mean outstanding payable, or does an unpaid purchase never reach the
vendor balance?* Reading `vendor-balance-service.ts:62` and `balance-handler.ts:428,561`
settles it: both compute

```
account_balance = total_paid - total_allocated - total_refunded + total_refund_allocated
```

That is the **unallocated advance** position — money paid but not yet applied to a bill.
Purchases never enter it. So an unpaid purchase leaving `vendor_ledger` at 236 while
`account_balance` stays 0 is **correct behaviour**, and it was the assertion that needed
fixing, not the code.

A2's **per-row half is right** and must be kept — it is precisely the check that catches
L-36. Only its final comparison (`audit-assert.js:101`) is wrong: the ledger's closing
balance is outstanding payable, `account_balance` is unallocated advance, and the two
agree only at zero.

### L-38 · The assertions report PASS on a zero sample · Medium · **FIXED**

`A2` skips any vendor with no ledger rows (`audit-assert.js:88`) and then reports PASS.
Every Phase 4 suite cleans up after itself, so the baseline holds **zero ledger rows** and
A2 examines nothing while printing `PASS … (0 checked)`. A3 and A4 are vacuous at baseline
for the same reason. The 2026-09-20 baseline table recorded this as "PASS (nothing to
check yet)" and nobody revisited it.

**That is why L-36 survived four suites.** P4-26's own header already drew this lesson for
transitions — a reachable transition emitting nothing is reported as EMPTY, not as
agreement. The assertion runner needs the same rule: **PASS with a zero sample is not a
pass.**

### L-29 · `0→2` is missing from all four *balance* case tables · High · **FIXED**

P4-16 added Unpaid→Partial to the two **ledger** handlers and stopped there. The
**balance** layer never got it:

| File | Function | `0→2` |
|---|---|---|
| `balance-handler.ts` | `getPurchaseBalanceOps` | absent |
| `balance-handler.ts` | `getReturnBalanceOps` | absent |
| `customer-balance-handler.ts` | sale twin | absent |
| `customer-balance-handler.ts` | return twin | absent |

All four fall through to `default: return null`. So Unpaid→Partial now writes ledger rows
but never moves `total_paid` / `total_allocated` — the ledger and the balance columns
disagree by construction. The customer twin carries it straight into Phase 5.

This is the same shared-gap shape as L-7, one layer down, and the twin harness cannot see
it for the same reason: both sides are missing it identically.

### L-30 · Paid→Unpaid destroys money that was never added · High · **FIXED**

`getCreateBalanceOps` scenario 1 (`balance-handler.ts:66-73`) funds a purchase entirely
from an existing advance by incrementing **only `total_allocated`**. But `1→0`
(`:183-190`) decrements **both** `total_paid` and `total_allocated` by `oldTotal`, and
`2→0` (`:192-199`) does the same by `totalAllocated`. Edit such a purchase back to Unpaid
and `total_paid` drops by money it never gained.

This is L-26 exactly — which was found and fixed on the **delete** path and left standing
on the **edit** path. Same asymmetry, same cause. Present in the customer twin at `:194`
and `:203`, so it is Phase 5's problem too.

### L-31 · `2→2` is near-dead, and wrong when it does fire · Medium · **FIXED**

`balance-handler.ts:226-241`: `oldAllocated = totalAllocated`, then
`newAllocated = Math.min(newTotal, totalAllocated)`. Whenever `newTotal >= totalAllocated`
the difference is 0 and it returns null, so the branch only fires when the new total drops
**below** what is already allocated — and then it reduces `total_paid`, which is L-30's
flaw again. Duplicated verbatim in `getReturnBalanceOps:368-382` and in both customer
twins (`:233`, `:372`).

### Findings from the service-layer read

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| L-27 | High | `createEntry` does its `bill_to` lookup on the **global** `prisma` inside a function that otherwise uses the passed client, so for `vendor_id = 0` it cannot see the `bill_to` row the same transaction just wrote and the ledger note falls back. The same lookup filters `invoice_no` with **no `fy`** — F-08's shape surviving in the ledger service, now that `bill_to` has an `fy` column (L-19) | `ledger-service.ts:46` | **fixed** — reads through the caller's client, with the `fy` filter |
| L-28 | High | `createDebitNoteEntry` credits `total_amount + total_tax + packing_forwarding_amount + freight_amount`; `updateDebitNoteEntry` credits only `new_total_amount + new_total_tax`. Editing a purchase return silently drops packing and freight from the credit. The F-79 shape inside the ledger service | `ledger-service.ts:217-221` vs `:263` | open — Phase 6 |
| L-32 | Medium | `logMultipleChanges` runs `Promise.all` over one interactive `tx` — F-21 / P4-09 exactly. P4-09 fixed the instance in `purchases/index.ts`; the class survives here, on the live path of every paid purchase create, edit and delete. Both twins | `balance-log-service.ts:50-57` | **fixed** — serialised in both twins |
| L-33 | High | `calculatePaymentStatus` and `calculateRefundStatus` take no `tx` and use the global `prisma`, while `calculatePurchasePaymentStatus` and `calculatePurchaseReturnRefundStatus` in the same file correctly do `db = tx || prisma`. The **vendor** pair is transaction-aware; the **sale/salex** pair is not | `payment-allocation-service.ts:12,43` vs `:160,192` | **fixed** — both take `tx`, and L-34 taken with it |
| L-34 | Medium | Tolerance drift in one file: purchase uses `totalPaid >= totalAmount - 0.01`, sale/salex uses `totalPaid >= totalAmount` with none. A sale paid to the paisa with float error sticks at "Partially Paid" | `payment-allocation-service.ts:184,220` vs `:35,66` | **fixed** — same 0.01 tolerance on both sides |
| L-35 | High | `validateRefundAllocation`'s customer branch resolves a return id by probing `sale_returns` then `salex_returns`. The two tables have independent auto-increment ids, so id 5 exists in both; sale wins, and a salex return is validated against the wrong document's refund amount | `payment-allocation-service.ts:326-336` | open — Phase 6 |
| L-39 | High | `getReturnLedgerOps` `1→0` and `2→0` push a DELETE whose `where` says `transaction_type: 'DEBIT_NOTE'` while the comment on the same line says *"Actually targeting REFUND_REVERSAL"*. It deletes the debit note itself, then pushes an UPDATE against the row it just deleted. Flagged in a comment and left | `ledger-handler.ts:482-489, 511-518` | open — Phase 6 |
| L-40 | Low | **Three dead modules in the money layer, ~600 lines.** `lib/vendor-balance-service.ts` (331) and `lib/rate-utils.ts` (225) have **zero callers**; `updateBalanceInTransaction` is dead in both balance handlers; `getOutstandingAmount` is a `return Promise.resolve(0)` stub. They read as authoritative — `rate-utils` defines a third selling-price formula (F-90 found a second, dead, in the product form) | verified by call-site search | **fixed** — deleted; `tsc` clean afterwards |

### What this pass fixed, and what it deliberately did not

**Fixed and verified** (`tsc --noEmit` clean, `npm run build` clean, all five suites
clean, and the L-36 reproduction inverted from CONFIRMED to NOT REPRODUCED):
L-36, L-29, L-30, L-31, L-27, F-15, L-32, L-33, L-34, L-37, L-38, plus P4-18 and P4-32.

**Deliberately not fixed**, and the reason matters: **L-28**, **L-35** and **L-39** are
all real, and all three live in the **returns** module, which has not been audited and has
no round-trip harness. Changing money code that nothing can verify is how this codebase
acquired its half-fixes in the first place. They are Phase 6's, recorded with
reproductions ready.

**P4-15 is the largest item still open** — the §11 edit sweep across `purchases/create.tsx`
(3075), `view/[id].tsx` (811), `index.tsx` (172) and `hooks/usePurchases.ts` (484), plus
the four report endpoints. In Phase 3 that same sweep produced F-75 and F-91, the two worst
findings of the audit. Phase 4 should not be called closed until it runs.

### Read queue — where it now stands

R-3, R-9, R-10, R-11, R-12, R-13 and R-14 are now **read in full**; R-6 too. R-8 is read
through the executor path (`1-120`, `348-430`, plus a full method map) — the delete and
allocation halves remain. Unchanged and still unread: **R-5 remainder** (`purchases/[id].ts`
from ~690), **R-15** `create.tsx` (3075), **R-16** `view/[id].tsx` (811), **R-17**
`index.tsx` (172), **R-18** `usePurchases.ts` (484), and **R-19…R-22**, the four report
endpoints.

Those remaining files are **P4-15 territory** — the §11 edit sweep, which is the single
largest unfinished item in the phase and the pass that produced F-75 and F-91 in Phase 3.

### What this pass says about the method

Every finding above came from reading a file the phase had already declared complete. The
shape repeats:

- **L-36** is a fix (`recalculateBalancesAfter`) applied correctly in one function and
  incorrectly in its neighbour, forty lines apart.
- **L-29** is a fix (P4-16) applied to one layer and not the layer beneath it.
- **L-30** is a fix (L-26) applied to the delete path and not the edit path.
- **L-32** is a fix (P4-09) applied to the instance and not the class.

Four fixes that each landed on one side of a seam. That is the same thesis the audit
started with, now turned on the audit's own repairs: **a fix is not done until its twin,
its layer and its class are checked.** And L-38 is why none of it showed — the harness was
green because it was measuring nothing.
