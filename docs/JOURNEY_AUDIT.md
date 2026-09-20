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
