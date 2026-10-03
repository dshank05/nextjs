# Inventory B — Settings: Financial Year, Users, Warehouse, Warehouse Racks, Inactive Products

Source root: `/home/claude/settings`. Every file listed in the brief was read in full.

## 0. Before you start: files the brief names that are NOT in the folder

| Missing | Who imports it | What a test must do |
|---|---|---|
| `lib/date-utils.ts` | named in the brief for screen 1, but **nothing in screen 1 imports it** (only `pages/index.tsx`, `pages/api/dashboard`, `components/products/LookupTablePage.tsx` do) | nothing for these screens |
| `lib/db.ts` (`export const prisma`) | every API handler | `jest.mock('<root>/lib/db', () => ({ prisma: store }))` |
| `lib/withObservability.ts` | every API handler (`export default withObservability(handler)`) | mock as identity: `withObservability: (h) => h`. Its body is unknown, so it may or may not do auth. |
| `hooks/useDebounce.ts` | `hooks/useListQuery.ts:3` | use the real one from the repo, or stub `useDebounce(v, ms)` (default 300 ms) |
| `components/SnackbarProvider` (`useSnackbar().showSnackbar(type, message)`) | all 5 pages | mock it and record `(type, message)` so you can assert the exact strings |
| `components/ConfirmationModal` (`isOpen,title,message,confirmText,cancelText,showLoading,loadingText,onConfirm,onCancel`) | all 5 pages | use the real one, or a stub that renders title/message/buttons when `isOpen` |
| `components/common/ExportMenu`, `components/common` (`ClearableInput`, and `ExportMenu` re-export for inactive-products) | all 5 pages | stub. `ClearableInput` must forward `value/onChange/type/required/pattern/placeholder` to an `<input>` |
| `components/common/SearchableSelect` (`options[{id,name}], selectedValue, onSelectionChange(value), placeholder`) | warehouse-racks | stub as a `<select>`, or use the real one |
| `pages/api/products/index.ts`, `pages/api/products/[id]/status.ts` | inactive-products | **absent**: only `pages/api/products/{categories,companies,models,subcategories}` exist. See §5. |

`next/router` must be mocked for `useUrlState`: `{ isReady: true, query: {}, pathname: '/settings/x', replace: jest.fn() }`.

Shared list behaviour (`hooks/useListQuery.ts`, `components/common/ListPagination.tsx`), used by all 5 pages:
- The query string is always `page, limit, search (debounced 300 ms, trimmed), sortBy, sortOrder` plus `fixedParams`. Default `limit` is 50. Default order is `asc` unless the page passes another.
- `toggleSort(field)`: on the same field it flips asc/desc. On a new field it sets that field with `asc`. Changing search, sort or limit sends the page back to 1 (this is derived, not done in an effect).
- `search`, `sortBy` and `sortOrder` are mirrored to the URL via `router.replace(..., {shallow:true})`. A value equal to its default, or `''`, is removed from the URL. `limit` and `page` are NOT in the URL.
- `serialNumber(i) = (page-1)*limit + i + 1` (the S.N column).
- `ListSummary` shows `Showing {from} to {to} of {total} {noun}` and `Page {page} of {totalPages}`.
- `ListPagination` renders nothing if `totalPages <= 1`. Otherwise it shows `Previous`, numbered buttons page±2 with `1 ...` / `... N`, and `Next`. Next is disabled when `page >= totalPages`.
- `PageSizeSelect` has the label `Items per page` and options `10 / 50 / 100`.
- `beginRequest()/isCurrent()` drops stale responses.

---

## 1. `/settings/financialyear`

Files: `pages/settings/financialyear.tsx`, `pages/api/financial-years/index.ts`, `pages/api/financial-years/[id]/current.ts`, `lib/financial-year-rules.ts`.

### List
- Request: `GET /api/financial-years?page=1&limit=50&search=&sortBy=fy&sortOrder=desc` (`useListQuery({defaultSort:'fy', defaultOrder:'desc'})`, no fixedParams).
- The page reads `data.financialYears`, `data.pagination` and `data.currentFyId`.
- Columns: `S.N` | `ID` (sort `id`) | `Financial Year` (sort `fy`, cell = `fy`) | `Status` (sort `status`) | `Actions`.
  - Status cell is `Current` (green badge) when `year.id === currentFyId`, otherwise `Inactive`.
  - Actions: a `Set as Current` button on every non-current row. It shows `Setting...` and is disabled while its request is in flight. The current row has no button.
- **No search input** (removed per comment S-59). `search=` is still sent, empty. **No PageSizeSelect.** No status filter.
- Sorting is server-side. `status` is a derived sort done in the handler (see Server).
- Empty state: `No Financial Years Found` / `Get started by adding your first financial year`.
- Export: `ExportMenu` over the current page's rows only (no `fetchAll`). Columns `ID, FY, Start Date, End Date`, title `Financial Years Report`, file `Financial_Years`.
- Load errors: a non-OK response shows snackbar `error` `Could not load financial years`. A thrown fetch shows `Failed to load financial years`.

### Create (no edit: there is no edit feature, S-58)
- `Add Financial Year` opens an in-page modal with heading `Add Financial Year`.
- Fields: `Start Date` and `End Date`, both `<input type="date" required>`, values `YYYY-MM-DD`. When both are filled, a preview reads `Financial Year: {new Date(start).getFullYear()}-{new Date(end).getFullYear()}`. Buttons: `Cancel`, `Save`.
- Client validation on submit uses `validateFinancialYear`. On the first failure it shows snackbar `error` with:
  - `Start date and end date are required`
  - `Invalid date format`
  - `End date must be after start date`
  - `Financial year must start on April 1`
  - `Financial year must end on March 31`
  - `Financial year must span exactly one year (e.g. April 1, 2024 → March 31, 2025)`
- After that come two client checks that are **effectively dead** (see Bugs B1):
  - overlap: `This financial year overlaps with an existing financial year`
  - active year: `Cannot create future financial year. Current FY {fy} is active until {toLocaleDateString()}`
- If all checks pass, a confirm dialog opens:
  - title `Create Financial Year?`
  - message `Are you sure you want to create financial year {YYYY}-{YYYY}?`
  - confirm `Create Financial Year`, cancel `Cancel`, loading `Creating Financial Year...`
- Request: `POST /api/financial-years`, JSON body `{ start_date, end_date }` (strings).
- On OK: both modals close, the form resets, the list is refetched, and snackbar `success` shows `Financial year created successfully!`. The client string has `!`; the server's does not.
- On non-OK: snackbar `error` shows the server `message` (fallback `Failed to create financial year`). The confirm dialog closes and the form modal stays open.
- On network error: `Failed to create financial year: {err.message}`.
- Cancel in the confirm dialog closes only the dialog. The form stays open.

### Make current
- Request: `PUT /api/financial-years/{id}/current`, no body.
- On OK: `currentFyId = id` locally, with **no refetch**. Snackbar `success` shows the server message, `Financial year {fy} set as current`.
- On non-OK: snackbar `error` shows the server message (fallback `Failed to set current financial year`).
- On throw: `Failed to set current financial year`.
- There is no confirm dialog and no delete.

### Server
**GET `/api/financial-years`** (`index.ts:23-125`)
- `page`, `limit` are `parseInt` with **no bounds or NaN check**. `sortBy` defaults to `fy`, `sortOrder` to `desc` (anything else than `asc` counts as `desc`). `search` filters `fy: { contains }`.
- `currentFyId` = `prisma.settings.findFirst({orderBy:{id:'asc'}})?.currentfy || null`.
- When `sortBy === 'status'` it does `findMany({where, select:{id,fy,start_date,end_date}})` (all rows), then sorts in JS:
  - `asc`: current first, then `fy` by localeCompare ascending.
  - `desc`: current last, others `fy` descending.
  - Then it slices the page.
- Otherwise the sort field must be one of `['id','fy','start_date','end_date']` (else `fy`), with `skip/take`.
- `count({where})`, `totalPages = Math.ceil(total/limit)` (**0 when empty**), `hasMore = page < totalPages`.
- 200 `{ financialYears:[{id,fy,start_date,end_date}], currentFyId, pagination:{page,limit,total,totalPages,hasMore} }`. Errors go through `fail()`: 500 `Failed to fetch financial years`.

**POST `/api/financial-years`** (`index.ts:127-236`), in this order:
1. `validateFinancialYear(start_date, end_date)` → 400 `{message}` with the same messages as the client. Dates are parsed as LOCAL midnight. `fy = "${startYear}-${endYear}"`.
2. `findFirst({where:{fy}})` → 409 `Financial year {fy} already exists`.
3. Overlap: `findFirst` where (`start<=newStart && end>=newStart`) OR (`start<=newEnd && end>=newEnd`) OR (`start>=newStart && end<=newEnd`) → 409 `Cannot create financial year. It overlaps with existing FY {fy}`.
4. Active FY: `findFirst` where `start_date <= now && end_date >= now`. If found and `newStart < active.end_date` → 409 `Cannot create future financial year. Current FY {fy} is still active and ends on {YYYY-MM-DD}`.
5. `financial_year.create({data:{fy,start_date,end_date}, select:{id,fy,start_date,end_date}})` → **201** `{ status:'success', message:'Financial year created successfully', financialYear }`. The key is `financialYear`, not `data`.
- Catch: `fail()` → 500 `Failed to create the financial year` (or the Prisma code mapping).

**PUT `/api/financial-years`** (legacy, body `{fyId}`, not used by the page; `index.ts:238-313`):
- 400 `Financial year ID is required`
- 404 `Financial year not found`
- 400 `Cannot set FY {fy} as current. This financial year hasn't started yet (starts {date})`
- 400 `... has already ended (ended {date})`
- then upserts settings. 200 `{status, message:'Financial year {fy} set as current', currentFy:{id,fy}}`.

Any other method: 405 `{message:'Method not allowed'}`, with **no Allow header**.

**PUT|PATCH `/api/financial-years/[id]/current`** (`current.ts`)
- Other methods: 405 `Method not allowed`, `Allow: PUT, PATCH`.
- `parseId(query.id)` null → 400 `A valid financial year ID is required`.
- `findUnique({where:{id}})` missing → 404 `Financial year not found`.
- `now < midnight(start_date)` → 400 `Cannot set FY {fy} as current: it has not started yet`.
- `now > midnight(end_date)` → 400 `Cannot set FY {fy} as current: it ended on {midnight(end).toLocaleDateString()}`.
- `settings.findFirst({orderBy:{id:'asc'}})`. If a row exists: `settings.update({where:{id}, data:{currentfy:id}})`. Otherwise `settings.create({data:{currentfy:id}})`.
- 200 `{ status:'success', message:'Financial year {fy} set as current', data:{id,fy} }`.
- Catch → `fail()` 500 `Failed to set the current financial year`.

**Prisma**:
- `financial_year { id Int, fy String, start_date DateTime, end_date DateTime }`.
- `settings { id Int, currentfy Int? }`. Only `currentfy` is written. "Make current" sets the single settings row's `currentfy` (the lowest id) to the FY id, creating the row if the table is empty.

### Bugs / inconsistencies
- **B1 (high).** The client overlap check and the "future FY" check never fire (`financialyear.tsx:120-123`, used at `126-138` and `147-158`).
  - `parseDate` splits on `-`, but the API returns `start_date`/`end_date` as JSON ISO strings (`"2026-04-01T00:00:00.000Z"`). The day part becomes `Number("01T00:00:00.000Z") = NaN`, so every Date is Invalid and every comparison is false.
  - Failure: with 2026-2027 already listed, submitting 2026-04-01..2027-03-31 does not show the client overlap message. The confirm dialog opens, and the refusal comes from the server (409 `Financial year 2026-2027 already exists`).
  - The client checks would only work if the stub returned bare `YYYY-MM-DD` strings. Seed real `Date` objects so the test matches production.
- **B2 (high).** "Make current" is refused on the last day of the FY.
  - `current.ts:353` compares `now > atMidnight(end_date)`, so at 31 March 10:00 the year counts as ended.
  - Failure: system time 2027-03-31T10:00 local, FY 2026-2027 → 400 `Cannot set FY 2026-2027 as current: it ended on 31/3/2027`.
  - The legacy PUT has the same issue (`index.ts:276`). The active-FY lookup in POST also misses the active year on 31 March (`index.ts:195`, `end_date >= now`).
- **B3 (medium; the rule may be intended, the message is wrong).** Backfilling a past year is refused with a "future" message.
  - `index.ts:201` refuses any year whose start is before the active FY's end, which includes every earlier year.
  - Failure: today 2026-10-03, only 2026-2027 exists, create 2024-2025 → 409 `Cannot create future financial year. Current FY 2026-2027 is still active and ends on 2027-03-31`.
- **B4 (high, cosmetic).** The summary reads "Page 1 of 0" on an empty list. `index.ts:108` gives `totalPages = Math.ceil(0/50) = 0`, so `ListSummary` renders `Page 1 of 0`. Users (`users/index.ts:210`) and warehouses (`warehouses/index.ts:83`) have the same bug. Racks use `buildPagination` and are not affected.
- **B5 (medium; not reachable from the page).** GET does not validate `page`/`limit` (`index.ts:27-28`).
  - `limit=0` gives `totalPages: Infinity`.
  - `page=abc` gives `skip: NaN`, Prisma throws, and the response is 500.
  - `lib/api/list-query.ts` exists to fix this but is not used here.
- **B6 (low).** Export covers only the visible page, because there is no `fetchAll` (`financialyear.tsx:220`). Users and warehouse have `fetchAll`.
- **B7 (low).** POST answers `{financialYear}` instead of the `data` envelope from `respond.created` (`index.ts:228-232`). The collection 405 has no `Allow` header (`index.ts:19`).

### Page-test checks (fake "now" to 2026-10-03, TZ fixed, e.g. `TZ=Asia/Kolkata`)
Seed: FYs `{id:1, fy:'2025-2026', 2025-04-01..2026-03-31}` and `{id:2, fy:'2026-2027', 2026-04-01..2027-03-31}`; `settings {id:1, currentfy:1}`.
1. **List.** Rows show in `fy` desc order: `2026-2027` then `2025-2026`. Row id 1 shows `Current` with no button; row id 2 shows `Inactive` and a `Set as Current` button. The summary reads `Showing 1 to 2 of 2 financial years` and `Page 1 of 1`. No search box is present.
2. **Sort.** Click `Status`. The request has `sortBy=status&sortOrder=asc` and the current row (2025-2026) comes first. Click again: `desc`, current row last. Click `ID`: `sortBy=id&sortOrder=asc`.
3. **Make current.** Click `Set as Current` on 2026-2027. Assert the snackbar `success` `Financial year 2026-2027 set as current`, row 2 shows `Current`, row 1 shows `Inactive` plus a button, and `store.settings[0].currentfy === 2`.
4. **Create.** Click `Add Financial Year`, type start `2027-04-01` and end `2028-03-31`. The preview `Financial Year: 2027-2028` appears. Click `Save`. The dialog shows `Create Financial Year?` / `Are you sure you want to create financial year 2027-2028?`. Click `Create Financial Year`. Assert the POST body is `{start_date:'2027-04-01', end_date:'2028-03-31'}`, the snackbar `success` reads `Financial year created successfully!`, the modal is gone, a new row `2027-2028` appears after the refetch, and the store holds `fy:'2027-2028'`.
5. **Client validation.** Start `2027-05-01`, end `2028-03-31`, `Save`. The snackbar `error` reads `Financial year must start on April 1`, no confirm dialog opens, and there is no POST. Repeat with end `2029-03-31` → `Financial year must span exactly one year (e.g. April 1, 2024 → March 31, 2025)`.
6. **Server refusal (duplicate).** Start `2026-04-01`, end `2027-03-31`, then Save and confirm. The snackbar `error` reads `Financial year 2026-2027 already exists` (this documents B1). The form modal is still open and the confirm dialog is closed.
7. **Server refusal (make current).** Seed a future FY `2027-2028` (id 3) and click its `Set as Current` → snackbar `error` `Cannot set FY 2027-2028 as current: it has not started yet`. `currentfy` is unchanged.
8. (Optional, documents B2.) Set now to `2027-03-31T10:00` and make 2026-2027 current. Expect a 400 `...it ended on...`.
9. **Empty.** With no rows, `No Financial Years Found` is shown (and `Page 1 of 0`, B4).

---

## 2. `/settings/users`

Files: `pages/settings/users.tsx`, `pages/api/users/index.ts`, `pages/api/users/[id]/status.ts`, `lib/password.ts`, `types/settings.ts`.

### List
- Request: `GET /api/users?page=1&limit=50&search=&sortBy=created_at&sortOrder=desc`. The page reads `data.users` and `data.pagination`.
- Columns: `S.N` | `ID` (sort `id`) | `Username` (sort `username`) | `Email` (sort `email`) | `Phone` (no sort; shows `-` when empty) | `Status` (sort `status`) | `Created` (sort `created_at`) | `Actions`.
  - Status shows `Active` when `status === 10`, otherwise `Inactive` (`userStatusLabel`).
  - Created is `new Date(created_at*1000).toLocaleDateString('en-IN')`, so `created_at` is **unix seconds**. Example: `2/10/2025`.
  - Actions: `Edit`, plus `Deactivate` (title `Deactivate user`) when active or `Activate` (title `Activate user`) when inactive.
- Search: label `Search Users`, placeholder `Search users...`, debounced 300 ms, server-side on `username` OR `email` `contains`.
- PageSizeSelect 10/50/100. Server-side sort. No status filter. **No empty-state row**: the body is just empty.
- Export: `ExportMenu` with `fetchAll` = `GET /api/users?dropdown=true` → `d.data || d.users`.
  - Columns: `ID, Username, Email, Phone, Status` (formatted Active/Inactive) and `Created Date` (formatted).
  - Title `Users Report`, file `Users`.
- Load error: snackbar `error` `Could not load users`.

### Create / Edit (one modal)
- `Add User` opens heading `Add User`. A row's `Edit` opens heading `Edit User`, which adds a read-only `User ID` input.
- Fields (HTML-only validation; there are **no JS validation messages**):
  - `Username`: ClearableInput text, `required`.
  - `Email`: ClearableInput `type=email`, `required`.
  - `Phone`: ClearableInput `type=tel`. onChange strips non-digits. `pattern="[0-9]{10}"`, title `Phone number must be exactly 10 digits`, placeholder `Enter 10-digit phone number`. Optional.
  - `Status`: `<select required>` with options `Select status` (`""`), `Active` (`"10"`), `Inactive` (`"0"`). On edit it is prefilled with `String(user.status)`.
  - `Password` on create (`required`) or `New password` on edit (not required). Placeholder on edit `Leave blank to keep the current password`, with helper text `Leave blank to keep the current password.`
  - Buttons: `Cancel`, `Save`.
- **No confirm dialog.** Submit sends `POST /api/users` for both create and edit. Body: `{ username, email, phone: phone || null, password, status: "10"|"0" }`. On edit it adds `id` (number).
- On OK: the modal closes and the list is refetched. **No success snackbar** (B10).
- On non-OK: snackbar `error` shows the server `message` (fallback `Failed to save user`), and the modal stays open.

### Activate / Deactivate
- The row button opens the ConfirmationModal:
  - title `Deactivate User` / `Activate User`
  - message `Are you sure you want to deactivate "{username}"?` (or `activate`)
  - confirm `Deactivate` / `Activate`, cancel `Cancel` (Cancel is ignored while loading)
- Request: `PATCH /api/users/{id}/status`, body `{status:'Inactive'|'Active'}`.
- On OK: refetch, snackbar `success` `User deactivated` / `User activated` (client strings, no period).
- On non-OK: `error` with the server message (fallback `Could not change the user status`).
- On throw: `Network error while changing the user status`.
- The dialog always closes (`finally setChangingUser(null)`). There is no delete.

### Server
**GET `/api/users`**
- `page`/`limit` parseInt, unchecked.
- Sort whitelist `['id','username','email','status','created_at','updated_at']`, else `created_at`. Order `desc` only if `'desc'`, else `asc`.
- Search: `OR[{username:{contains}},{email:{contains}}]`.
- `count`, then `findMany({where, select:{id,username,email,phone,status,created_at,updated_at}, orderBy, skip/take unless dropdown==='true'})`.
- 200 `{ users, pagination:{page,limit,total,totalPages: ceil(total/limit), hasMore} }`. There is no `data` key.
- 500 `{message:'Failed to fetch users data', error: err.message}`.

**POST `/api/users`**
- If `body.id` is truthy, it goes to `handleUpdate`.
- Create order:
  1. `username` missing, non-string or blank → 400 `Username is required and must be a non-empty string`
  2. `email` the same → 400 `Email is required and must be a non-empty string`
  3. `phone` present and not 10 digits after trim → 400 `Phone number must be exactly 10 digits`
  4. password not a string of ≥6 chars → 400 `Password is required and must be at least 6 characters long`
  5. email not `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` → 400 `Please provide a valid email address`
  6. status: absent, null or `''` → 10. `parseInt` must give 10 or 0, else 400 `Status must be 10 (Active) or 0 (Inactive)`
  7. duplicate `findFirst({where:{OR:[{username},{email}]}})` (trimmed values) → 409 `Username already exists` if the found row's username matches, else `Email already exists`
- Then: `password_hash = bcrypt.hash(pw, 12)`, `auth_key = randomBytes(24).hex` (48 chars).
- `user.create({data:{username, email (trimmed), phone: trim|null, auth_key, password_hash, password_reset_token:null, status, created_at: now_s, updated_at: now_s}, select:{...}})`.
- 201 `{status:'success', message:'User created successfully'}`. There is no `data` in the response.
- 500 `{message:'Failed to create user', error}`.

**PUT `/api/users`** (and POST with `id`), `handleUpdate`:
1. `!id || !parseInt(id)` → 400 `Valid user ID is required`
2. username → 400 `Username is required and must be a non-empty string`
3. email → 400 `Email is required and must be a non-empty string`
4. phone → 400 `Phone number must be exactly 10 digits`
5. email format → 400 `Please provide a valid email address`
6. `findUnique({where:{id}})` missing → 404 `User not found`
7. conflict `findFirst({where:{AND:[{id:{not:id}},{OR:[{username},{email}]}]}})` → 409 `Username already exists` / `Email already exists`
8. status (fallback = existing status) → 400 `Status must be 10 (Active) or 0 (Inactive)`
9. If password is a non-empty string shorter than 6 → 400 `Password must be at least 6 characters long`
- `user.update({where:{id}, data:{username, email, phone|null, status, [password_hash if a new password], updated_at: now_s}})`.
- 200 `{status:'success', message:'User updated successfully'}`. 500 `{message:'Failed to update user', error}`.
- Other methods: 405 with `Allow: GET, POST, PUT`.

**PATCH|PUT `/api/users/[id]/status`**
- Other methods: 405, `Allow: PATCH, PUT`.
- `parseId` null → 400 `A valid user ID is required`.
- `status` must be one of `10`, `"10"`, `"Active"` → 10, or `0`, `"0"`, `"Inactive"` → 0. Anything else → 400 `status must be 10 (Active) or 0 (Inactive)`.
- `findUnique({where:{id}, select:{id,status}})` missing → 404 `User not found`.
- Same status → 200 `{status:'success', message:'User is already inactive.' | 'User is already active.', data:{id,status}}`.
- Otherwise `update({data:{status, updated_at: now_s}, select:{id,status}})` → 200 `{..., message:'User deactivated.' | 'User activated.', data}`.
- Catch → `fail()` 500 `Failed to change the user status`.

**Prisma**: `user { id, username, email, phone?, status Int (10|0), created_at Int (unix s), updated_at Int, auth_key, password_hash, password_reset_token? }`.
- **No session or auth check anywhere**. Nothing imports next-auth, so there is nothing to stub, and there is no self-deactivation guard (B9).

### Bugs / inconsistencies
- **B9 (high: the guard is absent).** There is no self-deactivation or last-active-user guard.
  - Neither `users/[id]/status.ts:397-416` nor `handleUpdate` (`users/index.ts:105-131`) reads the session.
  - Failure: the logged-in admin clicks `Deactivate` on their own row → 200 `User deactivated.` and they are locked out. Deactivating the only active user is also allowed.
- **B10 (high).** Create and edit give no success feedback (`users.tsx:110-111`). Every other screen shows a `success` snackbar. Here the modal just closes.
- **B11 (high).** The raw error text is returned to the browser.
  - The catch blocks return `error: error.message` (`users/index.ts:139-142, 225-228, 339-342`).
  - This is exactly what `respond.fail()` (F-81) exists to stop.
  - Failure: a Prisma failure during create sends the Prisma message to the client.
- **B4** applies too: `users/index.ts:210` gives `totalPages: 0` when empty, so the page shows `Page 1 of 0`.
- **B12 (low).** POST and PUT answer without `data`, even though create already `select`s the row (`users/index.ts:322-336`), contrary to S-53. Create returns 201 but update returns 200 with no record.
- **B13 (medium; the "verify" note in §6 applies).** Server validation messages are unreachable through `Save` in a real browser, because the inputs are `required` / `type=email` / `pattern`. To test them, submit the form directly.

### Page-test checks
Seed users:
- `{id:1, username:'admin', email:'admin@x.com', phone:'9876543210', status:10, created_at:1700000000, updated_at:1700000000, auth_key:'k', password_hash:'$2a$12$...', password_reset_token:null}`
- `{id:2, username:'bob', email:'bob@x.com', phone:null, status:0, created_at:1700000100, ...}`

Checks:
1. **List.** The default order is `created_at desc`, so `bob` comes first. bob's row shows `-` for phone, `Inactive`, an `Activate` button, and the date `new Date(1700000100e3).toLocaleDateString('en-IN')`. The summary reads `Showing 1 to 2 of 2 users`.
2. **Search.** Type `adm` in `Search users...` and wait past 300 ms. Assert the URL query has `search=adm`, only `admin` remains, and `router.replace` was called with `search:'adm'`.
3. **Sort.** Click `Username`. The request has `sortBy=username&sortOrder=asc`, the order is admin then bob, and the SortIcon is on Username. (This also exposes B14: check the last `router.replace` query for `sortBy`.)
4. **Create.** `Add User`. Fill Username `carol`, Email `carol@x.com`, Phone `98a76543210x` (assert the input value becomes `9876543210`), Status `Active`, Password `secret1`, then Save.
   - Assert the body is `{username:'carol', email:'carol@x.com', phone:'9876543210', password:'secret1', status:'10'}` with no `id`.
   - The modal closes, `carol` appears, and **no** success snackbar is shown (B10).
   - The store row has `password_hash` set by the bcrypt mock, `auth_key` 48 hex chars, `status:10`, and numeric `created_at`.
5. **Edit.** On admin's row, `Edit`. The heading is `Edit User`, `User ID` shows `1`, status is preselected `Active`, and Password (label `New password`) is blank. Change email to `root@x.com` and Save.
   - The body includes `id:1, password:''`.
   - The store email is updated and `password_hash` is unchanged.
6. **Status.** On bob, `Activate`. The dialog reads `Activate User` / `Are you sure you want to activate "bob"?`. Click `Activate`. Assert the PATCH `/api/users/2/status` body `{status:'Active'}`, the snackbar `success` `User activated`, and the row now shows `Active` with a `Deactivate` button. The store has `status:10`.
7. **Server refusal (duplicate).** `Add User` with username `admin`, a new email, a valid password and a status. The snackbar `error` reads `Username already exists`, the modal stays open, and nothing is added to the store.
8. **Server validation (bypass HTML).** Fill a 5-char password and `fireEvent.submit(form)` → snackbar `error` `Password is required and must be at least 6 characters long`. Edit with new password `abc` → `Password must be at least 6 characters long`.
9. Paging: with `limit` 10 and 12 users, page 2 shows S.N 11 and 12, and `Next` is disabled.

---

## 3. `/settings/warehouse`

Files: `pages/settings/warehouse.tsx`, `pages/api/warehouses/index.ts`, `pages/api/warehouses/[warehouseId]/index.ts`, `pages/api/warehouses/[warehouseId]/status.ts`, `lib/api/status-route.ts`.

### List
- Request: `GET /api/warehouses?page=1&limit=50&search=&sortBy=name&sortOrder=asc&includeInactive=true`. The page reads `data.warehouses` and `data.pagination`.
- Columns: `S.N` | `ID` (sort `id`) | `Name` (sort `name`) | `Location` (sort `location`) | `Status` (sort `status`, text `Active`/`Inactive`) | `Actions`.
  - Actions: `Edit`, plus `Deactivate` (title `Deactivate Warehouse`) or `Activate` (title `Activate Warehouse`).
- Search: label `Search Warehouses`, placeholder `Search warehouses...`, debounced, server-side on `name` OR `location` `contains`.
- PageSizeSelect. Server-side sort. **There is no status filter UI**: inactive rows are always included. No empty-state row.
- Export: `fetchAll` = `GET /api/warehouses?dropdown=true&includeInactive=true`. Columns `ID, Name, Location, Status`, title `Warehouses Report`, file `Warehouses`.
- Load failure only does `console.error`, with **no snackbar** (B17).

### Create / Edit (one modal + confirm)
- `Add Warehouse` opens heading `Add Warehouse`. `Edit` opens heading `Edit Warehouse`, which adds a read-only `Warehouse ID`.
- Fields: `Warehouse Name` (ClearableInput, `required`) and `Location` (ClearableInput, `required`). No JS validation. Buttons `Cancel`, `Save`.
- Save opens a confirm dialog:
  - title `Create Warehouse?` / `Update Warehouse?`
  - message `Are you sure you want to create this warehouse?` / `...update this warehouse?`
  - confirm `Create Warehouse` / `Update Warehouse`, cancel `Cancel`
  - loading `Creating Warehouse...` / `Updating Warehouse...`
- Request: create `POST /api/warehouses`, edit `PUT /api/warehouses`. The body is the whole formData, `{ id, name, location }`. On create `id` is `0`, which the server ignores.
- On OK: modals close, refetch, snackbar `success` `Warehouse created successfully!` / `Warehouse updated successfully!`.
- On non-OK: `error` with the server message (fallback `Failed to save warehouse`). The confirm dialog closes and the form stays open.
- On throw: `Failed to create warehouse: …` / `Failed to update warehouse: …`.

### Activate / Deactivate
- Dialog:
  - title `Deactivate Warehouse?` / `Activate Warehouse?`
  - message `Are you sure you want to deactivate "{name}"?`
  - confirm `Deactivate Warehouse` / `Activate Warehouse`, cancel `Cancel` (ignored while loading)
- Request: `PATCH /api/warehouses/{id}/status`, body `{status:'Inactive'|'Active'}`.
- On OK: the dialog closes, refetch, snackbar `success` `Warehouse deactivated successfully!` / `Warehouse activated successfully!`.
- On non-OK: `error` with the server message (fallback `Failed to toggle warehouse status`). **The dialog stays open.**
- There is no delete button. The API has a soft-delete; see below.

### Server
**`/api/warehouses` (index.ts)**
- If `query.id` is present and the method is GET, PUT or DELETE, the request goes to the `?id=` legacy handlers:
  - `isNaN(id)` → 400 `Invalid warehouse ID`
  - GET → 404 `Warehouse not found` or 200 with the row (bare)
  - PUT → partial update. 400 `At least one field (name, location, or status) must be provided`, 400 `Another warehouse with this name already exists`, otherwise 200 `{status, message:'Warehouse updated successfully'}`. **No status validation and no 404 check.**
  - DELETE → 404 or a soft delete (`status:'Inactive'`), 200 `Warehouse deactivated successfully`
- **GET** (list):
  - page/limit parseInt, unchecked.
  - Sort whitelist `['id','name','location','status']`, else `name`. Order `desc` or `asc`.
  - search → `OR[name contains, location contains]`.
  - `includeInactive !== 'true'` → `where.status = query.status || 'Active'`.
  - `dropdown==='true'` → no skip/take.
  - 200 `{ warehouses: [full rows], pagination{page,limit,total,totalPages: ceil,hasMore} }`. Errors go through `fail()`: 500 `Failed to fetch warehouses`.
- **POST**:
  1. `!name || !location` → 400 `Name and location are required`
  2. `status` (default `'Active'`) must be `Active` or `Inactive` → 400 `Status must be 'Active' or 'Inactive'`
  3. `findFirst({where:{name}})` (**untrimmed**) → **400** `Warehouse with this name already exists`
  - Then `create({data:{name, location, status}})` (untrimmed) → **201** `{status:'success', message:'Warehouse created successfully', data: row}`. Catch → `fail` `Failed to create the warehouse`.
- **PUT** (body id):
  1. `!id` → 400 `ID is required`
  2. name is defined but not a non-blank string → 400 `Name cannot be empty`
  3. location → 400 `Location cannot be empty`
  4. bad status → 400 `Status must be 'Active' or 'Inactive'`
  5. none of the three given → 400 `At least one field (name, location or status) must be supplied`
  6. `findUnique` missing → 404 `Warehouse not found`
  7. name clash, `findFirst({where:{name: trimmed, id:{not:id}}})` → 400 `Another warehouse with this name already exists`
  - Then update only the given fields (trimmed) → 200 `{status:'success', message:'Warehouse updated successfully'}` (no data). Catch → 500 `{message:'Failed to update warehouse', error}`.
- Other methods: 405 `Method not allowed`, no Allow header.

**`/api/warehouses/[warehouseId]` (index.ts)**: not used by the page.
- `parseId` null → 400 `A valid warehouse ID is required`.
- GET → 404 or 200 with the row.
- PUT has the same rules as the collection PUT (without the id check) → 200 `{status, message:'Warehouse updated successfully', data:row}`.
- DELETE soft-deletes → 200 `{..., message:'Warehouse deactivated successfully', data}`.
- Other methods → 405 with `Allow: GET, PUT, DELETE`.

**`/api/warehouses/[warehouseId]/status`**: `makeStatusRoute({label:'Warehouse', idParam:'warehouseId'})`.
- Not PATCH/PUT → 405 `Allow: PATCH, PUT`.
- Bad id → 400 `A valid warehouse ID is required`.
- Bad status → 400 `status must be 'Active' or 'Inactive'`.
- Missing → 404 `Warehouse not found`.
- Same status → 200 `{status:'success', message:'Warehouse is already inactive.', data:{id,status}}`.
- Otherwise update → 200 `{..., message:'Warehouse deactivated.' | 'Warehouse activated.', data:{id,status}}`.
- Catch → 500 `Failed to change the warehouse status`.

**Prisma**: `warehouse { id, name, location, status ('Active'|'Inactive') }`. The page reads exactly these four fields.

### Bugs / inconsistencies
- **B15 (high).** POST neither trims nor rejects whitespace (`warehouses/index.ts:105, 119-121, 129-135`).
  - Failure 1: name `"   "` and location `"x"` pass `!name` → 201 creates a blank-named warehouse.
  - Failure 2: `"Main "` is accepted alongside `"Main"`, because the duplicate check is an exact untrimmed match. PUT, by contrast, trims.
  - Through the page, `required` blocks only empty strings, not spaces.
- **B16 (low, inconsistency).** A duplicate name returns **400** here (`index.ts:124`, `:211`) but **409** in FY and users.
- **B17 (medium).** A failed list load is silent (`warehouse.tsx:56-60`). There is no snackbar, so the table just shows stale or empty rows. This is the S-48 issue fixed on FY and users but not here.
- **B18 (medium).** The legacy `PUT /api/warehouses?id=` (`index.ts:282-333`) is missing two checks:
  - It does not validate `status`: `{status:'Banana'}` → 200 and stored, which is the S-24 issue, still open on this path.
  - It does not 404: a missing id gives Prisma P2025 inside a hand-rolled catch → 500 with `error` text.
- **B11** applies here too: raw `error.message` leaks at `index.ts:232-236, 273-277, 327-331, 358-362`.
- **B4**: `index.ts:83` gives `totalPages 0` on an empty result.

### Page-test checks
Seed warehouses: `{id:1, name:'Main', location:'Delhi', status:'Active'}`, `{id:2, name:'Annex', location:'Pune', status:'Inactive'}`.
1. **List.** In name-asc order, `Annex` comes first with `Inactive` and an `Activate` button; `Main` shows `Active` and a `Deactivate` button. The request includes `includeInactive=true`.
2. **Search** `pun`: after the debounce only `Annex` remains. Then clear it.
3. **Sort.** Click `Location`: `sortBy=location&sortOrder=asc`, Delhi before Pune. Click again: `desc`.
4. **Create.** `Add Warehouse`, Name `North`, Location `Agra`, `Save`. The dialog reads `Create Warehouse?` / `Are you sure you want to create this warehouse?`. Click `Create Warehouse`.
   - POST body `{id:0, name:'North', location:'Agra'}`.
   - Snackbar `success` `Warehouse created successfully!`, the row appears, and the store has `status:'Active'`.
5. **Edit.** `Edit` on Main. The heading is `Edit Warehouse` and `Warehouse ID` is `1`. Change Location to `Noida`, `Save`, then `Update Warehouse`.
   - PUT `/api/warehouses` body `{id:1, name:'Main', location:'Noida'}`.
   - Snackbar `Warehouse updated successfully!`. The store `status` is unchanged (`Active`).
6. **Deactivate** Main. The dialog reads `Deactivate Warehouse?` / `Are you sure you want to deactivate "Main"?`. Click `Deactivate Warehouse`.
   - PATCH `/api/warehouses/1/status` `{status:'Inactive'}`.
   - Snackbar `Warehouse deactivated successfully!`. The row shows `Inactive` and `Activate`.
7. **Server refusal.** `Add Warehouse` with Name `Main` → snackbar `error` `Warehouse with this name already exists`. The form modal stays open and the confirm dialog closes. On edit, renaming Annex to `Main` gives `Another warehouse with this name already exists`.
8. Cancel in the confirm dialog leaves the form open and sends no request.

---

## 4. `/settings/warehouse-racks`

Files: `pages/settings/warehouse-racks.tsx`, `pages/api/warehouses/[warehouseId]/racks.ts`, `pages/api/racks/index.ts`, `lib/api/list-query.ts`.

### List
- Requests:
  - On mount, `GET /api/warehouses?dropdown=true` → `data.warehouses`. This gives **Active warehouses only**, for the picker.
  - `GET /api/racks?page=1&limit=50&search=&sortBy=rack_number&sortOrder=asc&includeInactive=true` → `data.data || data.racks`, plus `data.pagination`.
- Columns: `S.N` | `ID` (sort `id`) | `Warehouse` (sort `warehouse_name`) | `Rack Number` (sort `rack_number`) | `Description` (sort `description`, **the server does not support it**, B19) | `Status` (sort `status`) | `Actions`.
  - Warehouse cell: `${warehouse_name} - ${warehouse_location}`, or just the name if there is no location. `Unknown Warehouse` if there is no name.
  - Description shows `-` when empty.
  - Actions: `Edit`, plus `Deactivate` (title `Deactivate Rack`) or `Activate` (title `Activate Rack`).
- Search: label `Search Warehouse Racks`, placeholder `Search racks...`, debounced, server-side on `rack_number`, `description`, `warehouse.name` or `warehouse.location` `contains`.
- PageSizeSelect. No status filter UI (inactive rows always included).
- Empty state: `No warehouse racks found` / `Create your first warehouse rack to get started with inventory tracking.`
- Export: current page only. Columns `ID, Warehouse (warehouse_name), Rack Number, Description, Status`, title `Warehouse Racks Report`, file `Warehouse_Racks`.
- Load error: snackbar `error` `Could not load warehouse racks`.

### Create / Edit (one modal + confirm)
- Heading `Add Warehouse Rack` / `Edit Warehouse Rack`.
- Fields:
  - `Warehouse *`: SearchableSelect. Options `{id:'', name:'Select Warehouse'}` plus `{id: String(w.id), name: '${name} - ${location}'}`, placeholder `Select Warehouse`. **Not validated** (B21).
  - `Rack Number *`: ClearableInput, `required`, placeholder `Enter rack number`.
  - `Description`: ClearableInput, placeholder `Optional description`.
  - Buttons `Cancel`, `Save`.
- Confirm dialog:
  - title `Create Warehouse Rack?` / `Update Warehouse Rack?`
  - message `Are you sure you want to create this warehouse rack?` / `...update this warehouse rack?`
  - confirm `Create Rack` / `Update Rack`, cancel `Cancel`
  - loading `Creating Rack...` / `Updating Rack...`
- Requests (the body is the whole formData, with string values `{ id, warehouse_id, rack_number, description }`):
  - create: `POST /api/warehouses/{formData.warehouse_id}/racks`, with `id:''`
  - edit: `PUT /api/warehouses/{editingRack.warehouse_id}/racks`. The URL names the current owner; the body's `warehouse_id` is the destination.
- On OK: modals close, refetch, snackbar `success` `Warehouse rack created successfully!` / `Warehouse rack updated successfully!`.
- On non-OK: `error` with the server message (fallback `Failed to save warehouse rack`). The confirm dialog closes and the form stays open.
- On throw: `Failed to create warehouse rack: …` / `Failed to update warehouse rack: …`.

### Activate / Deactivate
- Dialog:
  - title `Deactivate Warehouse Rack?` / `Activate Warehouse Rack?`
  - message `Are you sure you want to deactivate rack "{rack_number}"?`
  - confirm `Deactivate Rack` / `Activate Rack`, cancel `Cancel`
- Request: `PUT /api/warehouses/{rack.warehouse_id}/racks`, body `{id, status:'Inactive'|'Active'}`.
- On OK: the dialog closes, refetch, snackbar `success` `Warehouse rack deactivated successfully!` / `Warehouse rack activated successfully!`.
- On non-OK: `error` with the server message (fallback `Failed to toggle rack status`). The dialog stays open.
- There is no delete button. The API DELETE exists; see below.

### Server
**GET `/api/racks`**, via `parseListQuery`:
- sortFields `['id','rack_number','status','warehouse_id','warehouse_name']`, default `rack_number asc`. An unknown field silently falls back to the default.
- `limit` is clamped 1..500 (bad values → 50). `page` ≥ 1.
- `warehouseId` query filter, optional.
- `!includeInactive` → `status:'Active'`.
- search → `OR[rack_number, description, {warehouse:{name}}, {warehouse:{location}}]` with `contains`.
- `orderBy` is `{warehouse:{name:order}}` for `warehouse_name`, otherwise `{[field]:order}`.
- `findMany({where, include:{warehouse:{select:{name,location}}}, orderBy, skip/take unless dropdown})` plus `count`.
- Each row is returned as `{...rack, warehouse:{name,location}, warehouse_name, warehouse_location}`.
- 200 `{ data, pagination: buildPagination (totalPages ≥ 1), racks }`.
- Non-GET → 405 `Allow: GET`. Catch → `fail` `Failed to fetch racks`.

**`/api/warehouses/[warehouseId]/racks`**
- `warehouseId = parseInt(query.warehouseId)`, with **no NaN check**.
- **GET**: per-warehouse list. `where.warehouse_id`, search also covers `status contains`. Fixed order `rack_number asc`. Returns `{racks, pagination}`. Not used by the page.
- **POST**:
  1. `!rack_number || !rack_number.trim()` → 400 `Rack number is required`
  2. `warehouse.findUnique({id})` missing → 404 `Warehouse not found`
  3. `findFirst({where:{warehouse_id, rack_number: trimmed}})` → **400** `Rack number already exists in this warehouse`
  - Then `create({data:{warehouse_id, rack_number: trimmed, description: trim || null, status (default 'Active', **unvalidated**)}})` → 201 `{status:'success', message:'Rack created successfully', data: row}`. Catch → `fail` `Failed to create the rack`.
- **PUT**:
  1. `parseId(body.id)` null → 400 `A valid rack ID is required`
  2. `findFirst({where:{id, warehouse_id: urlWarehouseId}})` missing → 404 `Rack not found in this warehouse`
  3. If body `warehouse_id` differs from the URL id: `warehouse.findUnique` missing → 404 `Target warehouse not found`
  - Then build `updateData`:
    - `warehouse_id` if it differs from the existing one.
    - `rack_number` if defined: blank → 400 `Rack number is required`. A clash in the **target** warehouse, `findFirst({warehouse_id: target, rack_number, id:{not}})` → 400 `Rack number already exists in this warehouse`.
    - `description` if defined (trim or null).
    - `status` if defined (**unvalidated**).
    - Empty → 400 `At least one field must be updated`.
  - `update({where:{id}, data})` → 200 `{status:'success', message:'Rack updated successfully'}` (no data). Catch → 500 `{message:'Failed to update warehouse rack', error}`.
- **DELETE**: not used by the page.
  - id from `query.rackId ?? body.id`; null → 400 `A valid rack ID is required`
  - 404 `Rack not found in this warehouse`
  - `product.count({where:{rack_id}}) > 0` → 400 `Cannot delete rack. {n} product(s) are assigned to this rack.`
  - Otherwise a hard `delete` → 200 `Rack deleted successfully`. Catch → 500 with `error`.
- Other methods → 405, no Allow header.

**Prisma**:
- `warehouse_racks { id, warehouse_id, rack_number, description?, status, created_at, updated_at }` with the relation `warehouse` → `warehouse { id, name, location, status }`.
- `product.rack_id` (DELETE only).

### Bugs / inconsistencies
- **B19 (high).** The Description sort is a no-op.
  - The page toggles `sortBy=description` (`warehouse-racks.tsx:315`), but `/api/racks` does not whitelist it (`racks/index.ts:37`), so it silently sorts by `rack_number`.
  - Failure: clicking `Description` puts the arrow on Description while the rows stay in rack-number order.
  - The same kind of mismatch S-36 removed on inactive-products.
- **B20 (high, API).** Rack `status` is never validated.
  - POST stores any `status` (`racks.ts:118, 157`), and so does PUT (`racks.ts:259-261`).
  - Failure: `PUT {id:1, status:'Banana'}` → 200, and the rack disappears from `includeInactive=false` lists. This is S-24 again, fixed for warehouses but not here.
- **B21 (medium-high).** No warehouse is required on create.
  - `handleSubmit` does not check `warehouse_id` (`warehouse-racks.tsx:133-138`), so with none chosen the request goes to `POST /api/warehouses//racks` (`:160`).
  - The server does not reject a NaN `warehouseId` (`racks.ts:18`), so if routed, `warehouse.findUnique({id:NaN})` throws → 500 `Failed to create the rack`.
  - In real Next.js the double slash is likely a 404 or redirect. Either way the user gets no "please select a warehouse" message.
- **B22 (low-medium).** The picker loads only Active warehouses (`warehouse-racks.tsx:73`, without `includeInactive`).
  - When editing a rack that lives in an Inactive warehouse, the select has no option for its current `warehouse_id`, so it renders the placeholder.
  - Save still sends the old id, because formData keeps it.
- **B11**: raw `error` leaks at `racks.ts:280-284` and `336-340`.
- **B23 (low).** Export covers the current page only, because there is no `fetchAll` (`warehouse-racks.tsx:274`).

### Page-test checks
Seed:
- warehouses `{1,'Main','Delhi','Active'}`, `{2,'Annex','Pune','Active'}`
- racks:
  - `{id:1, warehouse_id:1, rack_number:'A-01', description:'Top shelf', status:'Active'}`
  - `{id:2, warehouse_id:2, rack_number:'B-01', description:null, status:'Inactive'}`
  - each with `created_at`/`updated_at` Date

Checks:
1. **List.** The rows read `Main - Delhi | A-01 | Top shelf | Active` and `Annex - Pune | B-01 | - | Inactive`. The request is `/api/racks?...&sortBy=rack_number&sortOrder=asc&includeInactive=true`. The summary reads `Showing 1 to 2 of 2 warehouse racks`.
2. **Sort.** `Warehouse` → `sortBy=warehouse_name` puts Annex first. `Description` → the request has `sortBy=description` but the order is unchanged (documents B19).
3. **Search** `annex` → only B-01 remains (matched through the relation).
4. **Create.** `Add Warehouse Rack`, pick `Main - Delhi`, Rack Number `A-02`, Description `  ` (spaces), `Save`. The dialog reads `Create Warehouse Rack?`. Click `Create Rack`.
   - POST `/api/warehouses/1/racks` body `{id:'', warehouse_id:'1', rack_number:'A-02', description:'  '}`.
   - Snackbar `Warehouse rack created successfully!`.
   - The store row has `description:null, status:'Active'`.
5. **Edit / move.** `Edit` on A-01. The fields are prefilled (warehouse `1`, `A-01`, `Top shelf`). Change the warehouse to `Annex - Pune`, then Save and `Update Rack`.
   - PUT goes to `/api/warehouses/1/racks` (the old owner), body `warehouse_id:'2'`.
   - Snackbar `Warehouse rack updated successfully!`. The store has `warehouse_id:2`.
6. **Toggle.** `Activate` on B-01. The dialog reads `Activate Warehouse Rack?` / `Are you sure you want to activate rack "B-01"?`. Click `Activate Rack`.
   - PUT `/api/warehouses/2/racks` body `{id:2, status:'Active'}`.
   - Snackbar `Warehouse rack activated successfully!`. The row shows `Active`.
7. **Server refusal.** Create `A-01` in `Main` → snackbar `error` `Rack number already exists in this warehouse`. The form stays open.
8. **Empty.** With no racks, `No warehouse racks found` is shown.
9. (Documents B21.) Submit with no warehouse selected and assert the URL `/api/warehouses//racks`. Have your harness decide 404 vs 500, and assert there is an `error` snackbar.

---

## 5. `/settings/inactive-products`

Files: `pages/settings/inactive-products.tsx`. **Its API is not in the folder**: `pages/api/products/index.ts` and `pages/api/products/[id]/status.ts` are absent. Everything below about the server is what the page sends and expects, not verified handler behaviour.

### List
- Request: `GET /api/products?page=1&limit=50&search=&sortBy=product_name&sortOrder=asc&isActive=false` (fixedParams `{isActive:'false'}`).
- Expects `{ products: Product[], pagination }`. A non-OK response gives snackbar `error` `Could not load inactive products`.
- Fields read per row: `id, product_name, part_no?, categoryName?, companyName?, stock?` (`subcategoryName` and `is_active` are typed but unused).
- Columns: `S.N` | `Product Name` (sort `product_name`) | `Part Number` (sort `part_no`, `N/A` if empty) | `Category` (no sort, `N/A`) | `Company` (no sort, `N/A`) | `Stock` (sort `stock`, shows `stock || 0`) | `Actions`.
- Search: label `Search Inactive Products`, placeholder `Search products...`, debounced. Which fields the server searches is unknown.
- Items per page: its own `<select>` with label `Items per page` and options 10/50/100 (same as PageSizeSelect, but inline).
- Empty state (outside the table): `No inactive products found` / `All products are currently active.`
- Export: current page only. Columns `Product Name, Part Number, Category, Company, Stock`, title `Inactive Products Report`, file `Inactive_Products`. Note that `ExportMenu` is imported from `components/common` here, not from `components/common/ExportMenu`.

### Reactivate (the only action; no create, edit or delete)
- The button `✅ Reactivate` (title `Reactivate Product`) opens the dialog:
  - title `Reactivate Product`
  - message `Are you sure you want to reactivate "{product_name}"?`
  - confirm `Reactivate`. No `cancelText` is passed, so the component's default applies (unknown).
- Request: `PATCH /api/products/{id}/status`, body `{status:'Active'}`.
- On OK: the dialog closes, refetch, snackbar `success` `Product reactivated successfully!`.
- On non-OK: `error` `Failed to reactivate product: {message || 'Unknown error'}`. The dialog stays open.
- On throw: `Failed to reactivate product: {err.message}`.

### Prisma / stubbing
- `product` has `is_active Boolean` (seen in `pages/api/dashboard/index.ts:89`). `categoryName` and `companyName` are presumably joined by the missing handler.
- To test this screen, pull `pages/api/products/index.ts` and `pages/api/products/[id]/status.ts` from the repo. The `status-route.ts` header says `products/[id]/status.ts` is the F-91 model, so it probably follows the `{status:'Active'|'Inactive'}` contract and maps it to `is_active`, but this is unverified. Without those files, stub the two endpoints.

### Bugs / inconsistencies
- Nothing confident is page-only. Whether the server honours `isActive=false` and sorts by `part_no`/`stock` cannot be checked.

### Page-test checks (needs the product handlers)
1. Seed one inactive product (`product_name:'Brake Pad', part_no:null, stock:null`) and one active product. Only Brake Pad is listed, with `N/A` part number and stock `0`. The request has `isActive=false`.
2. Click `✅ Reactivate`. The dialog reads `Are you sure you want to reactivate "Brake Pad"?`. Click `Reactivate`. Assert PATCH `/api/products/{id}/status` `{status:'Active'}`, the snackbar `Product reactivated successfully!`, the list is empty, and the empty state shows.
3. Refusal: reactivating a missing id gives 404 → snackbar `Failed to reactivate product: <server message>`, and the dialog stays open.
4. Sort `Stock` → `sortBy=stock&sortOrder=asc`. Category and Company headers are not clickable.

---

## 6. Cross-cutting findings and harness notes

- **B14 (high). Changing the sort column drops `sortBy` from the URL.**
  - `toggleSort` (`useListQuery.ts:105-106`) calls `setSortBy(field)` and then `setSortOrder('asc')`.
  - Both setters were created in the same render and spread the same stale `router.query` (`useUrlState.ts:56`). The second `router.replace` overwrites the first.
  - Result: the URL keeps the old (or no) `sortBy`. When the order equals the default (`asc` on warehouse and racks), the key is deleted too.
  - Failure: on `/settings/users`, click `ID` → the last replace has `{sortOrder:'asc'}` with no `sortBy`. A refresh then sorts by `created_at`, which defeats F-49.
  - In-session state is correct, so only the URL and refresh are wrong.
  - Test: `expect(router.replace).toHaveBeenLastCalledWith(expect.objectContaining({query: expect.objectContaining({sortBy:'id'})}), …)`. This fails today.
- **B11 (high).** Hand-rolled catch blocks leak `error.message` in users, warehouses and racks (lines listed above). FY, `[warehouseId]/index.ts`, status routes and `/api/racks` use `fail()` correctly.
- **No auth on any of these handlers.** None reads a session. Whether `withObservability` enforces auth is unknown, because the file is missing.

### Harness notes
- **fetch → handler router.** Map paths to handlers, putting dynamic segments into `req.query` and merging the URLSearchParams:
  - `/api/financial-years` → `pages/api/financial-years/index.ts`
  - `/api/financial-years/:id/current` → `[id]/current.ts` with `query.id`
  - `/api/users` and `/api/users/:id/status`
  - `/api/warehouses`, `/api/warehouses/:warehouseId`, `/:warehouseId/status`, `/:warehouseId/racks` (all keyed by `warehouseId`)
  - `/api/racks`
  - `/api/products` and `/api/products/:id/status` (missing)
- Request bodies: `JSON.parse(init.body)`. `res` needs `status()`, `json()`, `setHeader()`, `end()`. Return `new Response(JSON.stringify(body), {status})`.
- **Prisma stub must support:**
  - `findMany` with `where` containing `contains`, `not`, `lte`/`gte` on Dates, nested `AND`/`OR`, and relation filters `{warehouse:{name:{contains}}}`
  - `select`, `include:{warehouse:{select}}`, `orderBy {f:dir}` or `{warehouse:{name:dir}}`, `skip/take` (including `NaN` if you want B5)
  - `findFirst` (with `orderBy` for settings), `findUnique`, `count`, `create` (auto-increment id, `select`), `update` (throw `{code:'P2025'}` when missing), `delete`
  - Models: `financial_year`, `settings`, `user`, `warehouse`, `warehouse_racks`, `product` (`count({where:{rack_id}})`)
  - Decide `contains` case sensitivity: MySQL collation is case-insensitive, so match case-insensitively to mirror production.
- **bcryptjs**: `hashPassword` uses cost 12 (slow in pure JS). Mock `lib/password` `hashPassword` → `` `$2a$12$stub${pw}` `` or `jest.mock('bcryptjs')`. Keep `isAcceptablePassword` and `MIN_PASSWORD_LENGTH` real.
- **crypto.randomBytes**: real Node is fine under jest-environment-jsdom, since API modules import Node's `crypto`.
- **next-auth**: not used by any of these screens, so nothing to stub.
- **Time**: FY rules depend on `new Date()`.
  - Use `jest.useFakeTimers({ now: new Date(2026, 9, 3, 12) , doNotFake: ['queueMicrotask','nextTick'] })` and advance timers for the 300 ms debounce, or use `advanceTimers: true` with userEvent.
  - Pin `TZ`, because `toLocaleDateString()` appears in server messages. Match those with a regex or compute the expected string the same way.
- **HTML constraint validation (verify on your jsdom version).** jsdom runs `reportValidity()` when a submit button is clicked, so `required`, `type=email` and `pattern` block `userEvent.click(Save)` exactly as a browser would.
  - To reach server validation messages, use `fireEvent.submit(form)`.
  - This only applies if the `ClearableInput` stub actually forwards `required`/`pattern`.
- **Initial fetches**: with `router.isReady: true` and an empty query there is one list fetch on mount. If the test URL carries `search`/`sortBy`, expect a second fetch after hydration. `beginRequest` drops the first.
- **Dates in the stub.** Store real `Date` objects for `financial_year.start_date/end_date` and `warehouse_racks.created_at/updated_at`, so JSON serialisation matches production (ISO strings). See B1.

### Seed field names (exactly as the code reads them)
- `financial_year`: `id, fy, start_date, end_date`
- `settings`: `id, currentfy`
- `user`: `id, username, email, phone, status (10|0), created_at (unix s), updated_at (unix s), auth_key, password_hash, password_reset_token`
- `warehouse`: `id, name, location, status`
- `warehouse_racks`: `id, warehouse_id, rack_number, description, status, created_at, updated_at`, plus a resolvable `warehouse` relation
- `product` (inactive screen and rack DELETE): `id, product_name, part_no, stock, is_active, rack_id`, with `categoryName`/`companyName` as produced by the missing handler
