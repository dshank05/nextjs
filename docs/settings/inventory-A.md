# Inventory A — Product lookups, Mechanics, Staff, GST rates, States

Source: `/home/claude/settings` (read in full). Line numbers are 1-based in the file named.

## 0. Harness notes that apply to every screen

**Not in the bundle (must be mocked or supplied by the real repo):**
`components/ConfirmationModal`, `components/SnackbarProvider` (`useSnackbar`), `components/common` index
(`ClearableInput`, `ClearableTextarea`, `ExportMenu`), `components/common/ExportMenu`,
`components/common/SearchableSelect`, `hooks/useDebounce`, `lib/date-utils` (`getLocalDateString`),
`lib/db` (`prisma`), `lib/withObservability`. So the following are unknown from this bundle: the default
`confirmText`/`cancelText` of `ConfirmationModal` (states' save confirm and the lookups' confirm don't pass
`cancelText`; states' save confirm doesn't pass `confirmText` either), whether `ClearableInput` passes `required`/`min`/`max`/`maxLength`
through to the `<input>`, and how `SearchableSelect` is operated.

**Snackbar contract:** `showSnackbar(type, message)` with type `'success' | 'error' | 'warning' | 'info'`. Simplest
assertion path: mock `useSnackbar` to return a `jest.fn()` and assert `(type, message)` pairs.

**Router (`useUrlState`):** needs `next/router` mock with `isReady: true`, `query`, `pathname`, `replace`.
`search`, `sortBy`, `sortOrder` are mirrored in the URL (`router.replace({pathname, query}, undefined, {shallow:true, scroll:false})`);
a value equal to its default (or `''`) is removed from the query. `limit` and `page` are NOT mirrored.
Hydration from `router.query` happens once, in an effect, when `isReady` → a URL with `?search=x` produces a first
fetch with `search=` and a second with `search=x`.

**Debounce:** search goes through `useDebounce(search, 300)` (useListQuery.ts:87). The query string always uses the
debounced, trimmed value. Use fake timers (`advanceTimersByTime(300)`) or `waitFor` with >300 ms.

**Request query string** built by `useListQuery.params` (useListQuery.ts:131-145), in this key order:
`page, limit, search, sortBy, sortOrder`, then `fixedParams`, then `extraParams`. Defaults: `page=1&limit=50&search=&sortBy=<defaultSort>&sortOrder=asc`.
Search/sort/limit/extraParams changes force page 1 (derived, not an effect). `toggleSort(field)`: same field flips asc/desc;
other field → that field + `asc`.

**Shared list widgets (ListPagination.tsx):**
- `PageSizeSelect`: label "Items per page", `<select>` options `10`, `50`, `100` (default 50).
- `ListSummary`: "Showing {from} to {to} of {total} {noun}" and "Page {page} of {totalPages}" (from = 0 when no rows).
- `ListPagination`: renders nothing when `totalPages <= 1`; else "Previous" (disabled `page<=1`), numbered buttons
  page±2, "1 …" when page>3, "… {totalPages}" when page < totalPages-2, "Next" (disabled `page >= totalPages`).
- `SortIcon`: only rendered on the active sort column (lucide `ArrowUp`/`ArrowDown` svg) — assert on the svg presence in the header cell.
- Serial number column "S.N" = `(page-1)*limit + index + 1`.

**Stale-response guard:** every page calls `list.beginRequest()`; responses for superseded queries are dropped.

**Routing fetch → handlers in the test:** `/api/<x>?q` → `pages/api/<x>/index.ts`; `/api/<x>/<id>` → `[id].ts`
with `req.query.id = '<id>'`; `/api/<x>/<id>/status` → `[id]/status.ts` with `req.query.id`. Merge the URL search
params into `req.query` (string values). Body is `JSON.parse(init.body)`.

**API envelopes from `lib/api/respond.ts`:** `created` → 201 `{status:'success', message, data}`; `updated` → 200 same shape;
`badRequest` 400 / `notFound` 404 / `conflict` 409 → `{message}`; `fail()` maps Prisma `P2025`→404 "Record not found",
`P2002`→409 "That value is already in use", `P2003`→400 "Referenced record does not exist", `P2000`→400 "A value is too long for its column",
else 500 `{message: 'Failed to <context>'}`. `route()` → 405 `{message:'Method not allowed'}` with `Allow` header.
The in-memory Prisma stub should throw `{code:'P2025'}` from `update`/`delete` on a missing row to exercise this.

**Status route (`lib/api/status-route.ts`, used by mechanics/staff/gst):** PATCH or PUT only (else 405 `Allow: PATCH, PUT`);
bad id → 400 `A valid {label lower} ID is required`; `status` not exactly `'Active'|'Inactive'` → 400 `status must be 'Active' or 'Inactive'`;
missing row → 404 `{label} not found`; same status → 200 `{status:'success', message:'{label} is already {active|inactive}.', data:{id,status}}`;
change → 200 `{status:'success', message:'{label} activated.' | '{label} deactivated.', data:{id,status}}`.
Prisma calls: `findUnique({where:{id}, select:{id:true,status:true}})`, `update({where:{id}, data:{status}, select:{id:true,status:true}})`.

---

## 1. Product lookups (SETTINGS menu): `/products/category`, `/products/subcategory`, `/products/models`, `/products/company`

Pages are 15-24 line wrappers around `components/products/LookupTablePage.tsx`; API is `lib/product-lookups.ts`
(`pages/api/products/<resource>/index.ts` = `lookupCollection(CFG)`, `[id].ts` = `lookupItem(CFG)`).

| URL | resource | singular | plural | nameField | Prisma delegate | server label | report title / file prefix |
|---|---|---|---|---|---|---|---|
| /products/category | categories | Category | categories | category_name | product_category | Category | "Product Categories Report" / `Product_Categories` |
| /products/subcategory | subcategories | Subcategory | subcategories | subcategory_name | product_subcategory | Subcategory | "Product Subcategories Report" / `Product_Subcategories` |
| /products/models | models | Car Model | car models | model_name | car_models | Car model | "Car Models Report" / `Car_Models` |
| /products/company | companies | Company | companies | company_name | product_company | Company | "Companies Report" / `Companies` |

Subcategory adds `parent = {label:'Category', idField:'category_id', nameField:'category_name', sortKey:'category_name', searchParam:'category_search', optionsUrl:'/api/products/categories?dropdown=true', relation:'category'}`.

### List
- Fetch: `GET /api/products/{resource}?{params}` with `defaultSort = nameField`. Subcategory adds `category_search=<debounced parent search, trimmed>` (always present, may be empty).
- Columns: "S.N", "ID" (sortable `id`), [subcategory only: "Category" (sortable `category_name`, cell `row.category?.category_name || 'N/A'`)], "{singular} Name" (sortable nameField), "Actions" (only an **Edit** button).
- Search: label "Search {plural}" (e.g. "Search car models"), placeholder "Search {plural}..." → server `where[nameField] = {contains: search}` (name only). Debounced 300 ms.
- Subcategory extra search: label "Search by Category", placeholder "Search category..." → debounced 300 ms (LookupTablePage.tsx:54) → server `where.category = {category_name: {contains}}`. Not URL-mirrored.
- Sort: server-side; `sortFields` = `['id', nameField]` (+ `'category_name'` for subcategory via `sortMap` → `orderBy: {category: {category_name: order}}`). Unknown sortBy silently falls back to nameField.
- Paging: server via `parseListQuery` (limit capped at 500, invalid → 50; page invalid → 1), `buildPagination` (totalPages ≥ 1). Default 50/page.
- Loading: spinner div; empty: "No {plural} found." (e.g. "No car models found.").
- Load error snackbar: `('error', 'Could not load {plural}')`.
- Parent options (subcategory only): `GET /api/products/categories?dropdown=true` once on mount; maps `d.data` → `{id, name: p.category_name}`; failure → `('error', 'Could not load category options')`.
- Export: `ExportMenu` with `data=rows`, `fetchAll` = same params + `dropdown=true` (server returns all matching rows, `pagination.totalPages=1`), columns ID, [Category], "{singular} Name"; fileName `{prefix}_{getLocalDateString()}`.
- Status filter: none (no status column). **Delete: no button in the UI** (the guarded DELETE route exists but nothing calls it).

### Create / edit (modal)
- Opened by "Add {singular}" (e.g. "Add Car Model") or row "Edit". Heading "Add {singular}" / "Edit {singular}".
- Fields: [subcategory: "Category *" `SearchableSelect`, placeholder "Select category...", options from parent list], "{singular} Name *" (`ClearableInput`, `required`).
- Buttons: "Cancel" (closes), "Save" (submit).
- Client validation (LookupTablePage.tsx:111-123), in order:
  1. `!form.name.trim()` → `('warning', '{singular} name is required')` (e.g. "Car Model name is required").
  2. subcategory and no parent picked → `('warning', 'Choose a category from the list')`.
- Confirm (`ConfirmationModal`, :290-298): title `Add {singular}` / `Update {singular}`; message `Add the {singular lower} "{name trimmed}"?` / `Save the changes to "{name trimmed}"?`; confirmText `Add` / `Update`; cancelText not passed (component default).
- Request: create `POST /api/products/{resource}`; edit `PUT /api/products/{resource}/{id}`; JSON body `{ [nameField]: name.trim() }` plus subcategory `category_id: Number(parentId)`.
- Success (`response.ok`): form closes, `('success', '{singular} created' | '{singular} updated')` (e.g. "Car Model created"), list reloads with the same query.
- Failure: form stays open, `('error', data.message || 'Could not save the {singular lower}')`; network error `('error', 'Network error while saving the {singular lower}')`. Confirm closes in both cases.

### Server (lib/product-lookups.ts)
- **GET** list (:57-71): `findMany({where, orderBy, include, skip, take})` + `count({where})` → 200 `{data: rows, pagination:{page,limit,total,totalPages,hasMore}, <legacyKey>: rows}` (legacyKey `categories|subcategories|companies|models`). Subcategory rows include `category` (full `product_category`). Subcategory also filters `category_id=<id>` if given. Error → 500 `Failed to load {legacyKey}`.
- **POST** (:72-87):
  - name = `String(body[nameField] ?? '').trim()`; empty → 400 `{label} name is required` (server label: "Car model name is required" — lower-case "model", unlike the client's "Car Model").
  - subcategory: `category_id` must parse to an existing `product_category.id` → else 400 `Choose an existing category`.
  - duplicate (`findFirst({where:{[nameField]: name, ...scope}, select:{id:true}})`, scope = `{category_id}` for subcategory) → 409 `A {label lower} named "{name}" already exists` (e.g. `A car model named "Swift" already exists`).
  - `create({data:{[nameField]: name, [category_id]}})` → 201 `{status:'success', message:'{label} created', data: row}`.
- **PUT /[id]** (:98-116): id via `parseId` → invalid → 400 `A valid {label lower} ID is required`; missing → 404 `{label} not found`; same name/category rules; duplicate excluding self → 409 `Another {label lower} named "{name}" already exists`; `update` → 200 `{status:'success', message:'{label} updated', data: row}`.
- **DELETE /[id]** (:117-131) (API only): 404 `{label} not found`; usage → 409 `Cannot delete this {label lower}. {usage} still reference it.` where usage is:
  - category: `"{n} product(s)"` (product.product_category_id) and/or `"{m} subcategory/subcategories"` (product_subcategory.category_id), joined with " and " — e.g. `Cannot delete this category. 2 product(s) and 1 subcategory/subcategories still reference it.`
  - company: `{n} product(s)` (product.company_id); subcategory: product.product_subcategory_id; car model: products whose `car_model_ids` (comma-joined string) is `v`, starts `v,`, ends `,v`, or contains `,v,`.
  - OK → 200 `{status:'success', message:'{label} deleted'}`.
- Other methods → 405.

### Prisma / seed
- `product_category {id, category_name}`; `product_subcategory {id, subcategory_name, category_id, category → product_category}`; `product_company {id, company_name}`; `car_models {id, model_name}`.
- `product {product_category_id, product_subcategory_id, company_id, car_model_ids}` — only `count` is used (DELETE guard).
- Stub must support: `contains` (string), `startsWith`, `endsWith`, `not`, `OR`, relation filter `category: {category_name: {contains}}`, relation orderBy `{category: {category_name}}`, `include: {category: true}`, `select`, skip/take, `count`, `findFirst`, `findUnique`, `create` (auto id), `update`, `delete`.

### Bugs / inconsistencies
- None confirmed in this flow. Notes for test authors only:
  - Client vs server wording differ for car models only: client "Car Model name is required" (warning), server "Car model name is required" (only reachable via API).
  - Duplicate detection is exact-match in code; the real DB is presumably case-insensitive by collation. An in-memory stub will be case-sensitive; don't assert case-insensitive duplicates.

### Page-test checks
1. **List (category):** seed 3 categories → render → wait for spinner gone → rows show S.N 1..3, IDs, names sorted by `category_name` asc; first fetch URL is `/api/products/categories?page=1&limit=50&search=&sortBy=category_name&sortOrder=asc`; "Showing 1 to 3 of 3 categories", "Page 1 of 1"; no Previous/Next.
2. **Search:** type "bra" in "Search categories..." → advance 300 ms → only matching rows; request has `search=bra`.
3. **Sort:** click "ID" header → request `sortBy=id&sortOrder=asc`; click again → `desc`, rows reversed.
4. **Paging:** seed 12, choose "10" in Items per page → "Showing 1 to 10 of 12", "Page 1 of 2"; click "Next" → S.N starts at 11, request `page=2&limit=10`.
5. **Create:** click "Add Category" → heading "Add Category" → type "  Brakes  " → Save → confirm title "Add Category", message `Add the category "Brakes"?` → click "Add" → POST body `{"category_name":"Brakes"}` → snackbar `('success','Category created')`, modal gone, row "Brakes" present (stored trimmed).
6. **Validation (client):** Add → leave name blank (or spaces) → submit the form (fireEvent.submit to bypass `required`) → `('warning','Category name is required')`, no confirm, no fetch.
7. **Server refusal (duplicate):** seed "Brakes" → Add "Brakes" → confirm → snackbar `('error','A category named "Brakes" already exists')`; form still open.
8. **Edit:** Edit row → heading "Edit Category", input prefilled → change → Save → confirm title "Update Category", message `Save the changes to "X"?`, button "Update" → PUT `/api/products/categories/{id}` → `('success','Category updated')`; row updated.
9. **Edit duplicate:** rename to another existing name → `('error','Another category named "…" already exists')`.
10. **Subcategory:** seed categories A,B and subcats → Category column shows names ("N/A" when null relation); "Search by Category" "A" → request `category_search=A`; Add without picking category → `('warning','Choose a category from the list')`; pick category via SearchableSelect + name → POST body `{subcategory_name, category_id:<number>}`; same name in same category → 409 message `A subcategory named "X" already exists`; same name in other category succeeds. Sort by "Category" header → `sortBy=category_name`.
11. **Car models / company:** smoke: "Add Car Model" button, column "Car Model Name", success `('success','Car Model created')`; companies "Add Company", "Company Name".
12. (API-level, no UI) DELETE category with products → 409 `Cannot delete this category. 1 product(s) still reference it.`

---

## 2. `/settings/mechanics` (pages/settings/mechanics.tsx)

### List
- Fetch `GET /api/mechanics?page=1&limit=50&search=&sortBy=name&sortOrder=asc&includeInactive=true` (fixedParams). Reads `data.mechanics` and `data.pagination`.
- Columns: "S.N", "Name" (sort `name`), "Phone" (sort `phone`), "City" (sort `city`; cell `city || '-'`), "Status" (sort `status`; badge text = status), "Actions" ("Edit", and "Deactivate" when Active / "Activate" otherwise).
- Search: label "Search Mechanics", placeholder "Search mechanics..." → server `OR` on `name`, `phone`, `city` (`contains`). Debounced 300 ms.
- Sort: server; allowed `name, phone, city, status, created_at`, else `name`.
- Paging: server; `pageNum = parseInt||1`, `limitNum = parseInt||50` (no cap); `totalPages = ceil(total/limit)` (0 when empty).
- Status filter: none in UI; always `includeInactive=true` so inactive rows show. Without the flag the API returns only `status='Active'`.
- Empty: single row "No mechanics found. Click "Add Mechanic" to get started."
- Load errors: non-OK `('error','Failed to load mechanics')`; throw `('error','Network error while loading mechanics')`.
- Export: columns Name, Phone, City, Status; title "Mechanics Report", fileName `Mechanics`; fetchAll `GET /api/mechanics?dropdown=true&includeInactive=true` (ignores current search/sort) → `d.data || d.mechanics`.

### Create / edit (modal)
- "Add Mechanic" → heading "Add Mechanic"; "Edit" → "Edit Mechanic" (prefilled name, phone, `city || ''`).
- Fields: "Full Name *" (placeholder "Enter mechanic's full name", `required`); "Phone Number *" (placeholder "Enter phone number", `required`, `maxLength=10`, onChange strips non-digits `replace(/\D/g,'')`); "City" (placeholder "Enter city (optional)"). No status field.
- Buttons: "Cancel", "Save" (shows "Saving..." and disabled while saving).
- Client validation (:106-116): `!name.trim() || !phone.trim()` → `('warning','Name and phone are required')`; `!isTenDigitPhone(phone)` → `('error','Phone number must be exactly 10 digits')`.
- Confirm: title "Add Mechanic" / "Update Mechanic"; message `Are you sure you want to add {name} as a new mechanic?` / `Are you sure you want to update {name}'s information?` (untrimmed name); confirmText "Add"/"Update"; cancelText "Cancel"; loadingText "Saving...".
- Request: `POST /api/mechanics` or `PUT /api/mechanics/{id}`; body `{name, phone, city}` (raw formData, untrimmed).
- Success: form + confirm close, list refetch, `('success','Mechanic created successfully' | 'Mechanic updated successfully')`.
- Failure: `('error', message || 'Failed to save mechanic')`, confirm closes, form stays. Network: `('error','Network error while saving mechanic')`.

### Activate / Deactivate
- Row button "Deactivate" (Active) / "Activate" (otherwise).
- Confirm: title "Deactivate Mechanic"/"Activate Mechanic"; message `Are you sure you want to deactivate {name}?`; confirmText "Deactivate"/"Activate"; cancelText "Cancel"; loadingText "Deactivating..."/"Activating..."; cancelLoadingText "Canceling...".
- Request: `PATCH /api/mechanics/{id}/status` body `{status:'Inactive'|'Active'}` (with AbortController).
- Success: refetch + `('success','Mechanic deactivated successfully' | 'Mechanic activated successfully')` (server message ignored). Failure: `('error', message || 'Failed to deactivate mechanic')`. Abort: `('info','Operation cancelled')`. Other: `('error','Network error while changing mechanic status')`.
- Server: status route with label "Mechanic" (see §0): e.g. 200 `Mechanic deactivated.`, 404 `Mechanic not found`, 400 `A valid mechanic ID is required`.

### Server
- **GET /api/mechanics** (index.ts:22-96): see List. 200 `{mechanics, pagination:{page,limit,total,totalPages,hasMore}}` (no `data` key). Error 500 `{message:'Failed to fetch mechanics', error:<raw>}`.
- **POST /api/mechanics** (:99-150): `!name || !phone` → 400 `Name and phone are required`; `!isTenDigitPhone(phone)` → 400 `Phone number must be exactly 10 digits`; `findFirst({where:{phone}})` (raw, untrimmed) → 400 `Mechanic with this phone number already exists`; `create({data:{name:trim, phone:trim, status (body.status ?? 'Active'), city:trim if non-empty}})` → 201 `{status:'success', message:'Mechanic created successfully', data}`; errors via `fail` → 500 `Failed to create the mechanic`.
- **GET /api/mechanics/[id]** (unused by page): 400 `Invalid mechanic ID`, 404 `Mechanic not found`, 200 row.
- **PUT /api/mechanics/[id]** ([id].ts:50-108): `parseInt` NaN → 400 `Invalid mechanic ID`; `name` given and blank → 400 `Name cannot be empty`; `phone` given and blank → 400 `Phone cannot be empty`; phone duplicate (trimmed, `id: {not}`) → 400 `Another mechanic with this phone number already exists`; update `{name, phone, city (''→null), status}` (each only if defined) → 200 bare row. Errors → 500 `{message:'Failed to update mechanic', error}`.
- **DELETE /api/mechanics/[id]** (unused by page): soft-delete → 200 `{message:'Mechanic deactivated successfully', mechanic}`; 404 `Mechanic not found`.
- Other methods → 405 `Method not allowed` (no Allow header).

### Prisma / seed
`mechanic {id, name, phone, city (nullable), status ('Active'|'Inactive'), created_at, updated_at}`.

### Bugs / inconsistencies
- **M-1 (high conf.) PUT skips the phone-format rule** — `pages/api/mechanics/[id].ts:65-70` only checks non-empty; POST (`index.ts:115`) and the form (`mechanics.tsx:113`) require 10 digits. API: `PUT /api/mechanics/1 {phone:'12'}` → 200, saved.
- **M-2 (high) PUT on a missing id returns 500 and the raw Prisma error** — `[id].ts:95-106` has no existence check; `update` throws P2025 → `{message:'Failed to update mechanic', error:'…'}` 500 instead of 404 (and leaks the DB message that `respond.fail` was introduced to hide). Same pattern in GET/DELETE catches.
- **M-3 (high) POST accepts a whitespace-only name** — `index.ts:109` checks `!name`, then `:133` stores `name.trim()` = `''`. API: `POST {name:'   ', phone:'9876543210'}` → 201 with empty name. (Form blocks it.)
- **M-4 (medium) POST duplicate-phone check uses the untrimmed value** — `index.ts:123` `where:{phone}` but validator trims and `:134` stores trimmed. API: existing `9876543210`, `POST {phone:' 9876543210'}` → 201 duplicate. (Form strips non-digits, so not reachable from UI.)
- **M-5 (medium) POST trusts `status` from the body** — `index.ts:105,135`; `POST {…, status:'Banana'}` → stored. Bypasses the status route's validation.
- **M-6 (high) "Page 1 of 0" when the list is empty** — `index.ts:76` `Math.ceil(0/limit)=0`; `ListSummary` prints `Page {page} of {totalPages}`. Search for a non-matching term → "Showing 0 to 0 of 0 mechanics" / "Page 1 of 0". (lookups use `buildPagination` which floors at 1.)
- **M-7 (plausible) Cancel during an in-flight status change** — `mechanics.tsx:195-196`, `209-219`: abort shows "Operation cancelled" and does not refetch, but the PATCH may already have been applied server-side → row shows the old status.
- Low: duplicate phone answers 400 (lookups/states use 409).

### Page-test checks
1. **List:** seed Active "Ravi"/`9876543210`/Pune and Inactive "Amit"/`9123456780`/no city → rows sorted by name (Amit, Ravi); Amit city "-", status "Inactive", button "Activate"; Ravi button "Deactivate"; request includes `includeInactive=true`.
2. **Search:** type "pun" → after 300 ms only Ravi (city match); type "91234" → only Amit (phone match).
3. **Sort:** click "Phone" → `sortBy=phone&sortOrder=asc`; click again → desc.
4. **Empty search:** "zzz" → "No mechanics found. Click "Add Mechanic" to get started." (and today "Page 1 of 0" — M-6).
5. **Phone input filtering:** type "98a76-54 321099" in Phone → value "9876543210" (strip + maxLength — maxLength only if ClearableInput forwards it; the strip is in the page).
6. **Client validation:** Add → name "X", phone "12345" → submit → `('error','Phone number must be exactly 10 digits')`, no confirm; name blank → `('warning','Name and phone are required')`.
7. **Create:** Add → "Suresh", "9000000001", "Nashik" → Save → confirm "Add Mechanic" / `Are you sure you want to add Suresh as a new mechanic?` → "Add" → POST body `{name:'Suresh', phone:'9000000001', city:'Nashik'}` → `('success','Mechanic created successfully')`; new row with status "Active".
8. **Server refusal:** Add with Ravi's phone → `('error','Mechanic with this phone number already exists')`; form still open with values.
9. **Edit:** Edit Ravi → fields prefilled → change city → confirm `Are you sure you want to update Ravi's information?` → "Update" → PUT `/api/mechanics/{id}` body `{name, phone, city}` (no status) → `('success','Mechanic updated successfully')`; changing phone to Amit's → `('error','Another mechanic with this phone number already exists')`.
10. **Deactivate:** click Ravi "Deactivate" → confirm title "Deactivate Mechanic", message `Are you sure you want to deactivate Ravi?` → "Deactivate" → PATCH `/api/mechanics/{id}/status` `{status:'Inactive'}` → `('success','Mechanic deactivated successfully')`; row badge "Inactive", button "Activate"; store row status `Inactive`.
11. **Activate** Amit symmetric (`Activate Mechanic`, `('success','Mechanic activated successfully')`).
12. **Status server refusal:** delete the row from the store between render and confirm → `('error','Mechanic not found')`.

---

## 3. `/settings/staffdetails` (pages/settings/staffdetails.tsx)

Structurally identical to mechanics, with `email` instead of `city`.

### List
- Fetch `GET /api/staff?page=1&limit=50&search=&sortBy=name&sortOrder=asc&includeInactive=true`; reads `data.staff`, `data.pagination`.
- Columns: "S.N", "Name" (`name`), "Phone" (`phone`), "Email" (`email`; cell `email || '-'`), "Status" (`status`), "Actions" (Edit + Deactivate/Activate).
- Search: label "Search Staff", placeholder "Search staff..." → server `OR` `name`, `phone`, `email` contains. Debounced 300 ms (server does not trim; client already trims).
- Sort: server; allowed `id, name, email, phone, status`, else `name`.
- Paging: server; `parseInt(page)`, `parseInt(limit)` with **no** fallback; `totalPages = ceil(total/limit)` (0 when empty).
- Empty: "No staff members found. Click "Add Staff Member" to get started."
- Load errors: `('error','Failed to load staff members')`, `('error','Network error while loading staff')`.
- Export: Name, Phone, Email, Status; "Staff Members Report", `Staff_Members`; fetchAll `/api/staff?dropdown=true&includeInactive=true` → `d.data || d.staff`.

### Create / edit (modal)
- "Add Staff Member" → heading "Add Staff Member"; Edit → "Edit Staff Member" (prefill `email || ''`).
- Fields: "Full Name *" (placeholder "Enter staff member's full name", required); "Phone Number *" (digits-only onChange, maxLength 10, placeholder "Enter phone number"); "Email Address" (`type="email"`, placeholder "Enter email address (optional)").
- Client validation (:109-124): `('warning','Name and phone are required')`; `('error','Phone number must be exactly 10 digits')`; email non-empty and `!isValidEmail` → `('error','Email address is not valid')`.
- Confirm: title "Add Staff Member"/"Update Staff Member"; message `Are you sure you want to add {name} as a new staff member?` / `Are you sure you want to update {name}'s information?`; confirm "Add"/"Update"; cancel "Cancel"; loading "Saving...".
- Request: `POST /api/staff` or `PUT /api/staff/{id}` body `{name, email, phone}`.
- Success `('success','Staff member created successfully' | 'Staff member updated successfully')` + refetch. Failure `('error', message || 'Failed to save staff member')`; network `('error','Network error while saving staff member')`.

### Activate / Deactivate
- Confirm title "Deactivate Staff Member"/"Activate Staff Member"; message `Are you sure you want to deactivate {name}?`; buttons as mechanics.
- `PATCH /api/staff/{id}/status {status}` → `('success','Staff member deactivated successfully' | '… activated successfully')`; failure `('error', message || 'Failed to deactivate staff member')`; abort `('info','Operation cancelled')`; network `('error','Network error while changing staff status')`.
- Server label "Staff member": `Staff member deactivated.`, `Staff member not found`, `A valid staff member ID is required`.

### Server
- **GET /api/staff**: 200 `{staff, pagination}`; errors via `fail` → 500 `Failed to fetch staff`.
- **POST /api/staff** (index.ts:94-151): `!name || !phone` → 400 `Name and phone are required`; phone → 400 `Phone number must be exactly 10 digits`; email truthy and invalid → 400 `Email address is not valid`; `findFirst({where:{phone}})` (untrimmed) → 400 `Staff member with this phone number already exists`; create `{name:trim, email: trim||null, phone:trim, status: body.status ?? 'Active'}` → 201 `{status:'success', message:'Staff member created successfully', data}`.
- **PUT /api/staff/[id]** ([id].ts:50-108): 400 `Invalid staff ID`; 400 `Name cannot be empty`; 400 `Phone cannot be empty`; dup phone → 400 `Another staff member with this phone number already exists`; update `{name, email (''→null), phone, status}` if defined → 200 bare row; errors → 500 `{message:'Failed to update staff member', error}`.
- GET/DELETE `[id]` unused by page (DELETE soft-deactivates: `{message:'Staff member deactivated successfully', staff}`).

### Prisma / seed
`staff {id, name, email (nullable), phone, status, created_at, updated_at}`.

### Bugs / inconsistencies
- **S-1 (high) PUT skips phone and email validation** — `pages/api/staff/[id].ts:65-70` vs `index.ts:110-120` and `staffdetails.tsx:116-124`. API: `PUT /api/staff/1 {name:'A', phone:'1', email:'nope'}` → 200.
- **S-2 (high) PUT on missing id → 500 with raw error** — `[id].ts:95-106` (P2025 not mapped).
- **S-3 (high) POST accepts whitespace-only name** — `index.ts:104` then `:134`.
- **S-4 (medium) POST duplicate phone check untrimmed** — `index.ts:123-125`.
- **S-5 (medium) POST trusts body `status`** — `index.ts:100,137`.
- **S-6 (high) "Page 1 of 0" when empty** — `index.ts:76`.
- **S-7 (low) GET has no page/limit fallback** — `index.ts:34-35`; `?limit=abc` → `take: NaN` → Prisma throws → 500 (`limit=0` → `totalPages = NaN`). Not reachable from the page.
- **S-8 (plausible)** abort-after-send leaves stale status (same as M-7, `staffdetails.tsx:204-207`).

### Page-test checks
1. List: seed Active "Neha" `9876500001` `neha@x.in`, Inactive "Bala" `9876500002` no email → Bala email "-", "Activate"; Neha "Deactivate".
2. Search "x.in" → only Neha (email match).
3. Sort "Email" header → `sortBy=email`.
4. Validation: email "neha@" → `('error','Email address is not valid')`; phone "123" → `('error','Phone number must be exactly 10 digits')`; blank name → `('warning','Name and phone are required')`.
5. Create: "Kiran", "9000000002", "" → POST body `{name:'Kiran', email:'', phone:'9000000002'}` → `('success','Staff member created successfully')`; store row `email: null`, `status:'Active'`.
6. Server refusal: duplicate phone → `('error','Staff member with this phone number already exists')`.
7. Edit: clear Neha's email → PUT body `{name, email:'', phone}` → `('success','Staff member updated successfully')`; store `email: null`; row shows "-".
8. Edit to a phone used by another → `('error','Another staff member with this phone number already exists')`.
9. Deactivate Neha → confirm "Deactivate Staff Member" / `Are you sure you want to deactivate Neha?` → PATCH `{status:'Inactive'}` → `('success','Staff member deactivated successfully')`, badge "Inactive".
10. Cancel on the status confirm (before confirming) → no request, modal closes.

---

## 4. `/settings/gsttaxrate` (pages/settings/gsttaxrate.tsx)

### List
- Fetch `GET /api/gst-rates?page=1&limit=50&search=&sortBy=description&sortOrder=asc&includeInactive=true`; reads `data.gstRates`, `data.pagination`.
- Columns: "S.N", "ID" (`id`), "HSN Code" (`hsn_code`), "Rate (%)" (`rate`, rendered `{rate}%`), "Description" (`applicable_for`!), "Status" (`status`), "Actions" (Edit + Deactivate/Activate). The `description` field is not shown in the table, yet it is the default sort.
- Search: label "HSN Code", placeholder "Search" → server `OR` `description`, `hsn_code`, `applicable_for` contains, plus `rate equals parseFloat(term)` when numeric. Debounced 300 ms.
- Sort: server; allowed `id, description, rate, hsn_code, applicable_for, status`, else `description`.
- Paging: server; `parseInt` page/limit, no fallback; `totalPages = ceil(total/limit)`.
- Empty: **no empty-state message** (table body just empty).
- Load errors: `('error','Failed to load GST rates')`, `('error','Network error while loading GST rates')`.
- Export: ID, HSN Code, Rate (%), Description (`applicable_for`), Status; "GST Rates Report", `GST_Rates`; fetchAll `/api/gst-rates?dropdown=true&includeInactive=true` → `d.data || d.gstRates`.

### Create / edit (modal)
- "Add GST Rate" → heading "Add GST Rate"; Edit → "Edit GST Rate" + read-only "GST Rate ID" input showing the id.
- Fields (formData `{id, description, rate, hsn_code, applicable_for, status}`):
  - "Applicable" → **`description`** (placeholder "Enter applicable information"; not required, no `*`).
  - "Rate (%) *" → `rate` (`type=number`, `min=0`, `max=100`, `step=0.1`, `required`, placeholder "Enter GST rate").
  - "HSN Code *" → `hsn_code` (`required`, placeholder "Enter HSN code").
  - "Description" → **`applicable_for`** (`ClearableTextarea`, rows 3, placeholder "Enter rate description").
  - No status control (but `status` is still in formData).
- Buttons "Cancel", "Save". **No JS validation** — only the HTML `required/min/max/step` attributes.
- Confirm: title `Create GST Rate?` / `Update GST Rate?`; message `Are you sure you want to create this GST rate?` / `…update this GST rate?`; confirmText "Create GST Rate"/"Update GST Rate"; cancel "Cancel"; loadingText "Creating GST Rate..."/"Updating GST Rate...".
- Request: **both** create and edit go to `/api/gst-rates` (no id in path): `POST` / `PUT`, body = whole formData `{id, description, rate (string), hsn_code, applicable_for, status}` (create: `id:0, status:'Active'`).
- Success: confirm + form close, form reset, refetch, `('success','GST rate created successfully' | 'GST rate updated successfully')`.
- Failure: `('error', message || 'Failed to save GST rate')`, confirm closes, form stays; network `('error','Network error occurred')`.

### Activate / Deactivate
- Confirm title "Deactivate GST Rate"/"Activate GST Rate"; message `Are you sure you want to deactivate {rate.description}?` (the hidden "Applicable" value); buttons "Deactivate"/"Activate", "Cancel", loading "Deactivating..."/"Activating...", "Canceling...".
- `PATCH /api/gst-rates/{id}/status {status}` → `('success','GST rate deactivated successfully' | '… activated successfully')`; failure `('error', message || 'Failed to deactivate GST rate')`; abort `('info','Operation cancelled')`; network `('error','Network error while changing GST rate status')`.
- Server label "GST rate": `GST rate deactivated.`, `GST rate not found`, `A valid gst rate ID is required` (label lower-cased → "gst rate").

### Server (pages/api/gst-rates/index.ts)
- **GET**: 200 `{gstRates, pagination}`; errors → 500 `Failed to fetch GST rates`.
- **POST** (:100-149): `!description || rate undefined/null/'' || !hsn_code` → 400 `Description, rate, and HSN code are required`; `parseFloat(rate)` not finite or < 0 → 400 `Rate must be a number of 0 or more` (no upper bound); `findFirst({where:{description}})` → 400 `GST rate with this description already exists`; create `{description, rate: parsed, hsn_code, applicable_for: applicable_for||'', status: status||'Active'}` (no trimming) → 201 `{status:'success', message:'GST rate created successfully', data}`.
- **PUT** (:151-232) (id in **body**): `parseId(body.id)` null → 400 `A valid GST rate ID is required`; missing → 404 `GST rate not found`; legacy status-only branch (all four fields undefined and `status` truthy) → 200 `{status:'success', message:'GST rate updated successfully'}` (no data); else `!description || rate === undefined || !hsn_code` → 400 `Description, rate, and HSN code are required`; dup description excluding self → 400 `Another GST rate with this description already exists`; update `{description, rate: parseFloat(rate), hsn_code, applicable_for||'', status if truthy}` → 200 `{status:'success', message:'GST rate updated successfully', data}`.
- No `[id].ts`; only `[id]/status.ts`. Other methods → 405.

### Prisma / seed
`gst_tax_rate {id, description, rate (number), hsn_code, applicable_for, status}`. Stub must support `rate: {equals: n}` and `contains` on the three strings.

### Bugs / inconsistencies
- **G-1 (high) Field labels are swapped against the model, and the required one isn't marked** — `gsttaxrate.tsx:351-357` labels `description` "Applicable" (no `*`, no `required`), `:383-389` labels `applicable_for` "Description"; the table's "Description" column is `applicable_for` (:284, :304). Server requires `description` with message "Description, rate, and HSN code are required" (index.ts:111-113). Scenario: Rate 18, HSN 8708, Description "Auto parts", Applicable blank → Save → confirm → 400 "Description, rate, and HSN code are required" although "Description" is filled. The duplicate message "GST rate with this description already exists" likewise refers to the "Applicable" field.
- **G-2 (high mechanism / medium impact) Edit resends a stale `status`** — formData keeps `status` from when the form opened (:91) and PUT sends the whole object (:119); the server writes it whenever it's truthy (index.ts:214-217). The comment at :392-395 says the form no longer controls status. Scenario: open Edit on an Active rate, it is deactivated elsewhere (other tab/user), Save → rate is Active again.
- **G-3 (high) PUT skips POST's rate validation** — index.ts:187-209 vs :117-122. API: `PUT {id, description:'x', hsn_code:'1', rate:-5}` → 200 stored -5; `rate:'abc'` → `parseFloat` NaN written (500 on a real DB). Server has no upper bound on either method (client `max=100` is HTML only).
- **G-4 (medium) `step="0.1"` rejects the 0.25 % slab** — :365; with `min=0` a browser flags 0.25 as a step mismatch, so that rate cannot be entered via the form (3, 5, 12, 18, 28, 1.5, 0.1 are fine).
- **G-5 (high) "Page 1 of 0" when empty** — index.ts:83; plus no empty-state text in the table.
- **G-6 (low) GET has no page/limit fallback** — index.ts:34-35.
- **G-7 (low) Misleading labels** — search box labelled "HSN Code" (:226) but searches four fields; default sort `description` (:26) is a column not shown; status confirm names `description` (:318, :421), which isn't visible in the row.
- **G-8 (low) No trimming** — `description`/`hsn_code` stored as sent; `"   "` passes `!description`; duplicates differ by whitespace.
- **G-9 (low) Dead legacy status branch in PUT** — index.ts:174-184, still reachable via API, returns no `data`.

### Page-test checks
1. List: seed `{id:1, description:'Parts', rate:18, hsn_code:'8708', applicable_for:'Auto parts', status:'Active'}`, `{id:2, description:'Oil', rate:28, hsn_code:'2710', applicable_for:'Lubricants', status:'Inactive'}` → rows show "18%", "Auto parts" under Description; row 2 button "Activate". Request has `sortBy=description&includeInactive=true`.
2. Search "28" → after 300 ms only Oil (rate equals 28); search "870" → only Parts (hsn).
3. Sort "Rate (%)" → `sortBy=rate`; "Description" header → `sortBy=applicable_for`.
4. Create: Add → Applicable "Tyres", Rate "28", HSN "4011", Description "Tyres and tubes" → Save → confirm title `Create GST Rate?` → "Create GST Rate" → POST `/api/gst-rates` body `{id:0, description:'Tyres', rate:'28', hsn_code:'4011', applicable_for:'Tyres and tubes', status:'Active'}` → `('success','GST rate created successfully')`; store `rate: 28` (number).
5. Server refusal (G-1): leave Applicable blank, fill the rest → submit → confirm → `('error','Description, rate, and HSN code are required')`; form still open.
6. Duplicate: Applicable "Parts" → `('error','GST rate with this description already exists')`.
7. Edit: Edit row 1 → "GST Rate ID" read-only shows `1`; change rate to 12 → confirm `Update GST Rate?` / "Update GST Rate" → PUT `/api/gst-rates` body includes `id:1, rate:'12', status:'Active'` → `('success','GST rate updated successfully')`; row shows "12%".
8. Edit duplicate: change Applicable to "Oil" → `('error','Another GST rate with this description already exists')`.
9. Deactivate row 1 → confirm "Deactivate GST Rate" / `Are you sure you want to deactivate Parts?` → PATCH `/api/gst-rates/1/status {status:'Inactive'}` → `('success','GST rate deactivated successfully')`, badge "Inactive".
10. Status refusal: remove the row from the store before confirming → `('error','GST rate not found')`.
11. (Regression for G-2, expected to fail today) open Edit on row 1, set store row status to `Inactive`, Save → store status should remain `Inactive`.

---

## 5. `/settings/states` (pages/settings/states.tsx)

### List
- Fetch `GET /api/states?page=1&limit=50&search=&sortBy=state_name&sortOrder=asc` (no includeInactive — there is no status). Reads `data.states`, `data.pagination`.
- Columns: "S.N", "Code" (sort `code`; shows raw number, 0 for unconfigured), "State Name" (sort `state_name`), "Actions" ("Edit", "Delete").
- Search: label "State Name", placeholder "Search states..." → server `OR` `state_name contains`, plus `code = Number(term)` when the term is an integer ("09" → 9). Debounced 300 ms.
- Sort: server; allowed `id, state_name, code`, else `state_name`.
- Paging: server; `parseInt` no fallback; `totalPages = ceil(total/limit)`.
- Empty: "No states found" + "Start by adding your first state to the database."
- Load error: `('error','Could not load states')`.
- Export: Code, State Name; "States Report", `States`; fetchAll `/api/states?dropdown=true` → `d.data || d.states`.

### Create / edit (modal)
- "Add State" → heading "Add State"; Edit → "Edit State" + read-only "State ID". Edit prefill: `code ? String(code) : ''` (0 shows blank).
- Fields: "State Name" (`required`, placeholder "Enter state name"), "GST State Code" (`type=number`, `min=1`, `max=38`, `required`, placeholder "e.g. 9 for Uttar Pradesh", help text "The official GST code for this state (1-38). This decides whether invoices to this state are charged CGST+SGST or IGST, so it must be correct.").
- Buttons "Cancel", "Save". No JS validation.
- Submit **closes the form** and opens the confirm (:85-90).
- Confirm: title "Confirm Add" / "Confirm Edit"; message `Are you sure you want to add "{state_name}" as a new state?` / `Are you sure you want to update this state to "{state_name}"?`; confirmText/cancelText not passed (component defaults); cancel ignored while loading.
- Request: `POST /api/states` or `PUT /api/states/{id}`; body `{state_name, code}` (code as string).
- Success: `await fetchStates()`, confirm closes. **No success snackbar.**
- Failure: `('error', message || 'Failed to save state')`; confirm stays open (loading cleared), form is already closed.

### Delete
- Row "Delete" → confirm title "Delete State", message `Delete "{state_name}"? This cannot be undone. It will be refused if the state is in use.`, confirmText "Delete State", cancelText "Cancel" (ignored while loading).
- `DELETE /api/states/{id}` → OK: `('success','State deleted')` + refetch; else `('error', body.message || 'Could not delete the state')`; network `('error','Network error while deleting the state')`. Dialog closes in every case.

### Server
- **GET /api/states** (index.ts:21-79): select `{id, state_name, code}`; 200 `{states, pagination}`; errors → 500 `Failed to fetch states`.
- **POST** (:81-144): name missing/non-string/blank → 400 `State name is required and must be a non-empty string`; code (`number` or `parseInt(code,10)`) not integer 1-38 → 400 `GST state code is required and must be between 1 and 38`; name exists (trimmed, exact) → 409 `State with this name already exists`; code used → 409 `GST state code {code} is already used by "{other name}"`; create `{state_name: trimmed, code}` → 201 `{status:'success', message:'State created successfully', data:{id,state_name,code}}`.
- **PUT /[id]** ([id].ts:26-122): `id` missing/non-string → 400 `Valid state ID is required` (checked before method); name rule as POST; `code` optional — if not `undefined/null/''` must be 1-38 → 400 `GST state code must be between 1 and 38`; `parseInt(id)` NaN → 400 `Invalid state ID`; missing → 404 `State not found`; dup name excluding self → 409 `Another state with this name already exists`; dup code excluding self → 409 `GST state code {code} is already used by "{name}"`; update → 200 `{status:'success', message:'State updated successfully', data, state}`; errors → 500 `{message:'Failed to update state', error}`.
- **DELETE /[id]** (:124-189): 400 `Invalid state ID`; 404 `State not found`; refused with 409 `Cannot delete this state: it is in use by customers, vendors or existing documents` when any of: `customer_details` with `billing_state` or `shipping_state` == state **name**; `vendor_details.state` == state **id as string**; `bill_tosales.billing_state` == state name. OK → 200 `{message:'State deleted successfully'}`; errors → 500 `{message:'Failed to delete state', error}`.

### Prisma / seed
- `states` delegate (`prisma.states`, type `States`) `{id, state_name, code (int; 0 = unconfigured)}`.
- `customer_details {billing_state, shipping_state}` (names), `vendor_details {state}` (id as string), `bill_tosales {id, billing_state}` (name) — `findFirst` with `OR` / equality only.

### Bugs / inconsistencies
- **ST-1 (high) Rename silently orphans references that the delete guard depends on** — customers and sale snapshots store the state **name** ([id].ts:146-166), but PUT ([id].ts:92-97) renames freely with no usage check or cascade. Scenario: customer has `billing_state:'Gujarat'`; rename state to "Gujarat State" → customer no longer matches any state, and the state can now be deleted (guard finds nothing).
- **ST-2 (high) A refused save loses the form** — `states.tsx:88` closes the form before confirming; on 400/409 the error snackbar shows and only the confirm stays (:125-131). Scenario: add "Kerala" with code already used → `GST state code 32 is already used by "…"`; Cancel → form gone, input must be retyped (Add resets it).
- **ST-3 (high) No success feedback on create/update** — `states.tsx:120-124`; delete says "State deleted", every other settings save shows a success snackbar.
- **ST-4 (high) "Page 1 of 0" when empty** — index.ts:63.
- **ST-5 (low) `parseInt` accepts junk codes** — index.ts:94 / [id].ts:40: `code:'9.5'` or `'9abc'` → saved as 9.
- **ST-6 (low) PUT/DELETE 500s leak `error.message`** — [id].ts:116-120, 183-187; GET/POST use `fail()`; `limit` has no fallback (index.ts:27).
- Note: name duplicate relies on MySQL case-insensitive collation (comment index.ts:102-104); a JS stub is case-sensitive.

### Page-test checks
1. List: seed `{id:1, state_name:'Gujarat', code:24}`, `{id:2, state_name:'Maharashtra', code:27}`, `{id:3, state_name:'Unset', code:0}` → order Gujarat, Maharashtra, Unset; Code cells 24, 27, 0.
2. Search "27" → only Maharashtra (code match); "guj" → Gujarat (with a case-insensitive stub; otherwise "Guj").
3. Sort "Code" → `sortBy=code`; again → `desc`.
4. Create: Add State → "Kerala", "32" → Save → form gone, confirm "Confirm Add" / `Are you sure you want to add "Kerala" as a new state?` → confirm → POST `/api/states` body `{state_name:'Kerala', code:'32'}` → store row `code: 32`; row appears; snackbar not called with success (documents ST-3).
5. Server refusal (code conflict): Add "Kerala2", code "24" → `('error','GST state code 24 is already used by "Gujarat"')`; confirm still open; form not present (ST-2).
6. Duplicate name: Add "Gujarat", "30" → `('error','State with this name already exists')`.
7. Out-of-range code (bypass HTML validation via fireEvent.submit): code "40" → `('error','GST state code is required and must be between 1 and 38')`.
8. Edit "Unset": code field empty → set "29" → confirm "Confirm Edit" / `Are you sure you want to update this state to "Unset"?` → PUT `/api/states/3` body `{state_name:'Unset', code:'29'}` → row Code 29.
9. Delete free state: click Delete on Maharashtra → "Delete State" / `Delete "Maharashtra"? This cannot be undone. It will be refused if the state is in use.` → "Delete State" → DELETE `/api/states/2` → `('success','State deleted')`, row gone.
10. Delete refusal: seed `customer_details {billing_state:'Gujarat'}` (or `vendor_details {state:'1'}`, or `bill_tosales {billing_state:'Gujarat'}`) → Delete Gujarat → `('error','Cannot delete this state: it is in use by customers, vendors or existing documents')`; row remains.

---

## 6. Shared-helper findings

- **SH-1 (high mechanism) Switching sort column drops `sortBy` from the URL** — `useListQuery.ts:104-106` calls `setSortBy(field)` then `setSortOrder('asc')` in one handler; each `useUrlState` setter (`useUrlState.ts:56-66`) copies the same stale `router.query`, so the second `router.replace` (which only deletes `sortOrder`) overwrites the first (which added `sortBy`). In-page state is correct; a refresh or shared link loses the sort. Test: mock `router.replace`, click "Phone" → last call's `query` has no `sortBy`.
- **SH-2 (low) `page` and `limit` are not URL-mirrored** although `useUrlState`'s header (useUrlState.ts:7-9) says losing the page number on refresh is what it fixes.
- **SH-3** "Page 1 of 0": every non-lookup endpoint here computes `Math.ceil(total/limit)` itself instead of `buildPagination` (mechanics index.ts:76, staff index.ts:76, gst-rates index.ts:83, states index.ts:63).

## 7. Prisma models touched (summary for the store)

| Model (delegate) | Fields read/written | Screens |
|---|---|---|
| `product_category` | id, category_name | category, subcategory (options, relation, extraData check) |
| `product_subcategory` | id, subcategory_name, category_id, relation `category` | subcategory; category DELETE guard |
| `product_company` | id, company_name | company |
| `car_models` | id, model_name | models |
| `product` | product_category_id, product_subcategory_id, company_id, car_model_ids | lookup DELETE guards (count only) |
| `mechanic` | id, name, phone, city, status (+created_at, updated_at) | mechanics |
| `staff` | id, name, email, phone, status (+created_at, updated_at) | staff |
| `gst_tax_rate` | id, description, rate, hsn_code, applicable_for, status | gst |
| `states` | id, state_name, code | states |
| `customer_details` | billing_state, shipping_state | states DELETE guard |
| `vendor_details` | state | states DELETE guard |
| `bill_tosales` | id, billing_state | states DELETE guard |

Stub operations needed: `findMany` (where, orderBy incl. relation, skip/take, include, select), `count`, `findFirst`, `findUnique`, `create`, `update` (throw `{code:'P2025'}` if missing), `delete`; where operators `contains`, `startsWith`, `endsWith`, `equals`, `not`, `OR`, `AND`, nested relation filter.
