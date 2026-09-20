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
| F-82 | Medium | **`Product` has no `created_at`/`updated_at`** — 21 other models do. So there is no record of when a product last changed, no audit trail on the most frequently edited entity in the app, and no way to implement optimistic concurrency | `schema.prisma` Product model | open |
| F-83 | Medium | **Two people editing the same product silently overwrite each other.** No version check, no conflict detection — and none is currently possible, because of F-82 | consequence of F-82 + F-78 | open |
| F-84 | Low | **`rack_number` is derived in the browser.** The form looks the rack up in its own loaded list and sends the string alongside `rack_id`. The server has the id and could derive it; instead it trusts a denormalised string a client computed, which can drift from the rack it names | `create.tsx` productData, `rack_number` | **fixed** — `rack_number` derived server-side from `rack_id` |
| F-85 | Low | **The form has no current-stock field at all**, yet the payload writes `stock`. Someone editing a product cannot see, let alone correct, the value they are about to overwrite (F-75) | `create.tsx` formData | **fixed in effect** — the field is still absent from the form, but nothing writes `stock` from it any more |
| F-86 | Low | **Required-field rules live only in the browser.** `validateForm()` requires category, company and warehouse; the update endpoint requires none of them. Turn off JavaScript, or call the API directly, and the rules do not exist | `create.tsx` validateForm vs `products/[id].ts` PUT | **fixed** — the same rules now run server-side, where they cannot be bypassed |
| F-87 | High | **Any update that omitted `fileStates` wiped the product's image and barcode.** `imageUrl`/`barcodeUrl` were initialised to `null`, then spread under `imageUrl !== undefined` — which is always true for `null`. The documented "keep current value" branch was unreachable | Found by reading the file; invisible to grep | **fixed** — both initialise to `undefined` |
| F-88 | Medium | **Suspected, not confirmed:** the cascade effects clear subcategory and rack on edit load. `useEffect` on `product_category` unconditionally sets `product_subcategory: ''`, and the load sets category, so the effect should fire and clear it. Same shape for warehouse → rack | Code path is clear, but the data does **not** confirm it: 12 of 60 edited products still have a subcategory. The "edited" proxy (id-prefixed name) is unreliable | open — **needs a browser test**, an API test cannot see a client-side race |
| F-89 | Low | `pages/api/products/companies.ts` is not wrapped in `withObservability`, unlike its siblings | read of the file | open |
| F-90 | Low | `calculateSellingPrice()` in the product form is dead code — the panel that used it is commented out. It also used a different formula from the server's `sale_price` | `create.tsx:264` vs `[id].ts:176` | open |

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
