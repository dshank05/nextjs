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
| F-62 | High | FE / list | **Sorting is silently ignored whenever the raw-SQL path runs.** `products/optimized.ts` handles only `product_name`, `part_no`, `stock` and `lastPurchaseDate` there, falling back to `p.id DESC`. The list page's **default** sort is `categoryName`, so applying the low-stock or car-model filter quietly discards the sort while the column header still claims it | Verified live: `sortBy=categoryName` returns Ac Switch, Ac Switch, Ac Switch, Belt, Blade on the Prisma path; the same request with `lowStock=true` returns Ac Switch, Heating Coil, Compressor, Compressor, Compressor | open |
| F-63 | High | CRUD / data flow | **Product delete is a hard delete, and purchase lines have no foreign key to protect them.** `DELETE /api/products/[id]` calls `prisma.product.delete()` with no reference check, even though `is_active` exists and there is a whole `inactive-products` settings page. A product that has been **sold** cannot be deleted — but the FK error surfaces as a raw `500 Server error`, not "this product is on 12 invoices". A product that has only been **purchased** *can* be deleted: `Purchaseitems.product_id` is a nullable `Int` with no relation and no FK, so its purchase lines are left pointing at a product that no longer exists, and the purchase-return items hanging off those lines with them | Live FK catalogue lists only `invoice_items`, `invoice_itemsx`, `deadstock` → RESTRICT. `Purchaseitems` carries `product_id Int?` and a denormalised `name_of_product`, with no `@relation` | open |
| F-64 | Low | Settings → product | The product form fetches `/api/warehouses` and `/api/gst-rates` with no `limit`, so both take the endpoints' default first page of 50. Same class as F-58, which was fixed for customers/vendors/staff/mechanics but not for these two | `products/create.tsx:166,177` | open — latent: 4 warehouses, 4 GST rates today |
| F-65 | Low | FE / list | The products list persists filters and sort in **sessionStorage** (`use-storage-state`), but not search or page number — and it is a third mechanism, now that settings pages use the URL (F-49) and other pages use neither. Filters also cannot be shared or bookmarked, because they never reach the URL | `products/index.tsx:27,46,48` | open |
| F-43 | High | Settings → product | *(carried from `AUDIT_PLAN.md`)* The list endpoint resolves a product's GST rate through the `gst_rate_id` FK; the detail endpoint matches `product.hsn` against `gst_tax_rate.hsn_code`. With `hsn` NULL on all 602 products, the detail path reports **0%** | `products/index.ts:319` vs `products/[id].ts:170` | open |
| F-66 | **High** | Settings → product | **Deleting a category, subcategory or company silently strips it from every product that used it.** All three DELETE endpoints are unguarded hard deletes, and every one of those FKs is `ON DELETE SET NULL`. No count, no confirmation, no error — the products are simply un-categorised. The same app already does this correctly elsewhere: rack delete refuses with "Cannot delete rack. N product(s) are assigned to this rack", and warehouse delete is a soft delete. Five comparable resources, three different behaviours | `products/categories.ts`, `subcategories.ts`, `companies.ts` handleDelete; live FK catalogue shows SET NULL for all three | open |
| F-67 | Medium | Settings → product | **`car_models` has no foreign key at all.** Products store `car_model_ids` as a comma-joined string, so deleting a car model leaves its id embedded in every product that referenced it. Nothing cleans up, and nothing can — the database cannot see the reference | `models.ts` handleDelete; `car_models` absent from the FK catalogue | open |
| F-68 | Low | Ops | Deactivating a GST rate does not stop it applying. `status: 'Inactive'` removes it from the product form's dropdown, but products already pointing at it keep using its percentage, because the list endpoint reads the rate through the FK without checking status | `products/index.ts:319` | open — arguably correct for history, but it is not a decision anyone made |
| F-69 | Low | Ops | 51 `console.log`/`warn` calls in the product paths alone — 29 in `index.ts`, 15 in `optimized.ts`, 7 in `[id].ts`. A subset of F-24, noted here because of the concentration | `pages/api/products/*` | open |
| F-70 | Low | Duplication | `pages/products/lowstock.tsx` computes low stock client-side from `useProducts({ fetchAll: true })`, while `reports/minimum-stock` computes it server-side with a different rule. Two answers to "what is low on stock" that can disagree | `lowstock.tsx:7` vs `reports/minimum-stock.ts:25` | open — G-02 |

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
