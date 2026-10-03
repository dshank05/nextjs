# Settings and Dashboard — test plan and fixes

Status: **plan** (2026-10-03). Owner asked to start the test phase with the Settings screens and
the Dashboard ("CRUD tests"). Every screen below was read in full with its API routes and libs;
the per-screen inventories (exact UI strings, request / response shapes, seed fields, ~150
candidate checks) are in `docs/settings/inventory-{A,B,C}.md`. The headline findings were
re-checked against the source before going in here. Database: nothing to run, no data changes.

## 1. Screens

| Sidebar (SETTINGS) | URL | What it does | API |
|---|---|---|---|
| Product Category / Sub Category / Car Models / Part Company | `/products/{category,subcategory,models,company}` | list, add / edit (modal), status | `/api/products/{categories,subcategories,models,companies}` (`lib/product-lookups.ts`) |
| Mechanic Details | `/settings/mechanics` | list, add / edit, activate / deactivate | `/api/mechanics`, `[id]`, `[id]/status` |
| Financial Year | `/settings/financialyear` | list, create (no edit / delete), set current | `/api/financial-years`, `[id]/current` |
| Users | `/settings/users` | list, add / edit (one modal), activate / deactivate | `/api/users`, `[id]/status` |
| Staff Details | `/settings/staffdetails` | list, add / edit, activate / deactivate | `/api/staff`, `[id]`, `[id]/status` |
| Warehouse | `/settings/warehouse` | list, add / edit, status | `/api/warehouses`, `[warehouseId]`, `status` |
| Warehouse Racks | `/settings/warehouse-racks` | list, add / edit, status | `/api/racks`, `/api/warehouses/[id]/racks` |
| Business Details | `/settings/businessdetails` | one record, edit in place | `/api/business-details` |
| Bank Details | `/settings/bankdetails` | list, add / edit (no delete) | `/api/bank-details` |
| GST Tax Rate | `/settings/gsttaxrate` | list, add / edit, status | `/api/gst-rates`, `[id]/status` |
| States | `/settings/states` | list, add / edit, delete (guarded) | `/api/states`, `[id]` |
| DASHBOARD | `/` | totals, low stock, day pickers for sales / purchases, last bills | `/api/dashboard` |

Lists share `hooks/useListQuery` (search 300 ms, server sort, paging, export, URL state).

## 2. Bugs found (verified unless marked *)

**Shared**
1. Changing the sort column drops `sortBy` from the URL on **every** `useListQuery` list (15
   screens): the two URL setters each copy the same stale `router.query`, so the second
   `replace` wipes the first. The page sorts right; a refresh or shared link loses it.
2. "Page 1 of 0" on an empty list — mechanics, staff, GST rates, states, financial years, users,
   warehouses and bank details compute `ceil(0 / limit)` themselves instead of
   `buildPagination` (which floors at 1).
3. Raw database error text sent to the browser from users, warehouses, racks, states PUT / DELETE
   and mechanics / staff `[id]` — what `respond.fail()` exists to stop.

**Masters (mechanics, staff, warehouse, racks, GST, states)**
4. Mechanics and staff PUT skip the phone (and staff email) format checks that POST and the form
   apply; PUT on a missing id is a 500, not a 404.
5. Mechanics, staff and warehouse POST accept a name of only spaces (stored empty); the duplicate
   phone / name check uses the untrimmed value, so `"Main "` sits beside `"Main"`.
6. Mechanics and staff POST and every rack write store any `status` sent (`'Banana'`).
7. GST: editing re-sends the status the row had when the form opened, so a rate deactivated
   meanwhile comes back Active; PUT skips POST's rate check (−5 or "abc" accepted).
8. GST: the rate box steps by 0.1, so the 0.25 % slab cannot be typed.
9. Racks: the Description column's sort does nothing (server doesn't allow the field); create
   with no warehouse chosen posts to `/api/warehouses//racks` instead of saying "select a
   warehouse".
10. Warehouse: a failed list load shows nothing (no message).
11. States: a refused save closes the form (the input has to be retyped); create / update show no
    success message.
12. Users: create / edit show no success message.

**Financial year**
13. The page's own overlap and "future year" checks never run: its date parser can't read the
    ISO dates the API returns, so the user only ever sees the server's refusal.
14. "Set as current" is refused on 31 March, the year's last day (`now > midnight of end date`);
    the create rule's "active year" lookup misses it the same day.

**Business and bank details**
15. Business GSTIN is validated case-insensitively but saved as typed (lowercase stays
    lowercase); email is never validated; a name of only spaces saves as empty. The form's
    `required` / `pattern` do nothing (Save is outside the `<form>`).
16. Bank: the server's "Bank name is required" / "Bank with this name already exists" refer to
    the field labelled **Account Name** (`bank_name`); the field labelled "Bank Name" is
    `bank_address`.

**Dashboard**
17. Low Stock counts inactive products while Total Products counts only active ones.
18. *Overlapping day changes can let an older response overwrite a newer one.

## 3. Owner decisions

| # | Question | Today | Recommended |
|---|---|---|---|
| D1 | Users: may someone deactivate their own login, or the last active user? | Allowed (no check) | Refuse both |
| D2 | Financial year: allow creating a **past** year (back-entry)? | Refused, with a "Cannot create future financial year" message | Allow past years that don't overlap; the message was wrong either way |
| D3 | GST form labels: the box labelled "Applicable" is the required `description`; the one labelled "Description" is `applicable_for` | Swapped, required one unmarked | Label them by what they store: "Description *" and "Applicable For" |
| D4 | Renaming a state that customers / bills use (they store the name) | Allowed; breaks the link and lets the state be deleted | Refuse while in use, like delete |

Defaults I'll take unless overruled: Low Stock counts active products only (17); GST rate box
steps by 0.01 (8); bank server messages name "Account name" (16).

## 4. Order and checks

S1 server fixes (shared pagination, `fail()`, validation parity, trims, status checks, FY rules,
GSTIN / email) → S2 page fixes (sort URL, messages, states form, FY parser, GST labels and step,
racks warehouse check, warehouse load error) → S3 page tests, one per group, each with real API
handlers over the in-memory store:
- **test12** lookups (×4), mechanics, staff, GST, states
- **test13** financial year, users, warehouse, racks
- **test14** business details, bank details, dashboard

Each test: list loads and shows seeded rows, search, sort (URL keeps it), empty state, create
(validation message, confirm, saved row, success message, list refreshed), edit (saved, status
kept), activate / deactivate or delete, one server refusal shown. Server suites, tsc and
`next build` after each step; commit per step.
