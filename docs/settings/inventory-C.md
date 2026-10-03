# Inventory C: Business Details, Bank Details, Dashboard

Source read in full: `pages/settings/businessdetails.tsx`, `pages/api/business-details/index.ts`, `lib/gst.ts`, `lib/validators.ts`, `pages/settings/bankdetails.tsx`, `pages/api/bank-details/index.ts`, `lib/bank.ts`, `pages/index.tsx`, `pages/api/dashboard/index.ts`, `lib/api/respond.ts`, `lib/api/list-query.ts`, `types/settings.ts`, `components/common/ListPagination.tsx`, `hooks/useListQuery.ts`, `hooks/useUrlState.ts`, `lib/financial-year-rules.ts`.

**Imported but not in the bundle:** `lib/date-utils.ts` (`getLocalDateString`, `convertDateToTimestamp`), `lib/db.ts` (`prisma`), `lib/withObservability.ts`, `components/ConfirmationModal`, `components/SnackbarProvider` (`useSnackbar().showSnackbar(type, text)`), `components/common/index` (`ClearableInput`, `ExportMenu`), `components/common/ExportMenu`, `hooks/useDebounce`. Anything below that depends on them is inferred from the call site and marked as such. The harness has to supply real or mocked versions of them. In particular:
- `ConfirmationModal` props are `isOpen, title, message, confirmText, cancelText, showLoading, loadingText, onConfirm, onCancel`. I could not check how it renders, for example whether the confirm button text changes to `loadingText` while saving.
- `ClearableInput` has to pass `required`, `value`, `onChange` and `placeholder` through to a real `<input>`. If it does not, the native required-field checks on the bank form go away.
- `useListQuery` → `useUrlState` calls `useRouter()`. The bank page needs a `next/router` mock with `isReady: true`, `query: {}`, `pathname` and `replace: jest.fn()`. The business details page and the dashboard do not use the router.

**Raw SQL:** none of these three screens use `$queryRaw`/`$executeRaw`. Everything goes through the Prisma client, so the SQLite mirror is not needed here and none of this SQL is MySQL-specific. The dashboard does need two less common Prisma features from the stub (see §3).

---

## 1. `/settings/businessdetails`

### Layout
- Wrapper `.card`.
- **Loading** (initial `loading=true`): only a spinner `div.animate-spin` inside a `h-[600px]` box. No heading.
- **Loaded:** the heading `Company Information` (h2) and, on the right, either an **`Edit`** button (view mode) or **`Cancel`** + **`Save Changes`** (edit mode).
- **Important:** these buttons sit in the header `div`, **outside the `<form>`**. `Save Changes` calls `handleSubmit` from its `onClick`, so the browser's own checks (`required`, `pattern`, `type=email`) **never run** when you save with that button. Pressing Enter inside an input would submit the form natively. jsdom does not do implicit submission, so tests should click the button.
- Two-column grid. Labels in order: left column `Company Name`, `Tagline`, `Address Line 1`, `Address Line 2`, `Pin Code`; right column `GSTIN`, `Phone`, `Phone 2`, `Email`, `Landline`. Below them is `Terms & Conditions` (a textarea in edit mode).
- **View mode:** each field is a `<p>` showing `businessData.<field> || '-'`.
- **Edit mode:** inputs bound to `editedData`. Labels are not tied to inputs with `htmlFor`, so `getByLabelText` will not work. Query by placeholder or display value, or by position.

| Label | key | input | placeholder | attrs |
|---|---|---|---|---|
| Company Name | `name` | text | – | `required` (not enforced, see above) |
| Tagline | `tagline` | text | `Optional` | |
| Address Line 1 | `address_line_1` | text | – | `required` (not enforced) |
| Address Line 2 | `address_line_2` | text | `Optional` | |
| Pin Code | `pin_code` | text | `Optional` | no validation anywhere |
| GSTIN | `gstin` | text | `15 characters` | `required`, `maxLength=15` |
| Phone | `phone` | tel | `Exactly 10 digits` | `maxLength=10`, `pattern="[0-9]{10}"`; onChange strips `\D` and ignores the change if the result is longer than 10 |
| Phone 2 | `phone2` | tel | `Exactly 10 digits (optional)` | same digit stripping and 10-digit cap |
| Email | `email` | email | `Optional` | no client or server validation (`isValidEmail` exists but is not used here) |
| Landline | `fax` | tel | `Exactly 10 digits` | same digit stripping and 10-digit cap |
| Terms & Conditions | `terms` | textarea | `Optional` | |

- **Empty state:** `GET` returns `{}`, so the state becomes an all-empty object with `id: 0` and every view field shows `-`.
- **Load error:** a non-OK response or a thrown fetch shows the snackbar `('error', 'Failed to load business details')`. The page then renders in view mode with every field `-`.

### Create-once / edit
The record is a singleton edited in place. There is no create button. The first save sends `id: 0` and the server creates the row. Later saves send the real `id`. There is no delete.

### Client validation (`validatePhoneNumbers`, run on Save Changes, in this order; the first failure stops)
1. `phone` non-empty and not `isTenDigitPhone` → `Phone number must be exactly 10 digits`
2. `phone2` non-empty and not 10 digits → `Phone 2 number must be exactly 10 digits`
3. `fax` non-empty and not 10 digits → `Landline number must be exactly 10 digits`
4. `!isValidGstin(gstin)` → `GSTIN is not valid. Expected 15 characters, e.g. 09ABFPM3900M1ZI.`

All are `showSnackbar('error', …)`. Because the inputs strip non-digits and cap at 10, rules 1–3 can only fire for 1–9 digits, such as `12345`, or for a value loaded from the DB that was never edited. Name and address are **not** checked on the client.

`isTenDigitPhone(v)` is `/^[0-9]{10}$/` on `(v||'').trim()`.

`isValidGstin(g)`:
- falsy → false
- otherwise `trim().toUpperCase()` must match `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`
- and `parseInt(first 2)` must be in 1..38
- The check character is not verified.
- Valid: `09ABFPM3900M1ZI`, `27AAPFU0939F1ZV`. Invalid: `00ABFPM3900M1ZI` (state 00), `39ABFPM3900M1ZI` (state 39), `09ABFPM3900M0ZI` (entity 0), `09ABFPM3900M1XI` (no Z).

### Confirm dialog
- title `Update Business Details?`
- message `Are you sure you want to update the business details?`
- confirmText `Update Details`, cancelText `Cancel`
- loadingText `Updating Business Details...`

The same texts are used for the first-time create. Cancel closes the dialog and sends no request.

### Request
`PUT /api/business-details` with `Content-Type: application/json`. The body is the **whole `editedData` object**: `id, gstin, name, tagline, address_line_1, address_line_2, pin_code, phone, phone2, email, fax, terms`, plus any other columns the GET returned. The server ignores the extra keys.

### Responses and snackbars
- **2xx:** the confirm closes, `businessData`/`editedData` are set to `result.data`, the page leaves edit mode, and the snackbar shows `('success', result.message || 'Business details saved successfully!')`. In practice that is the server text:
  - `Business details created successfully` (first save)
  - `Business details updated successfully`
- **Non-2xx:** snackbar `('error', error.message || 'Failed to save business details')`. The confirm closes and the page **stays in edit mode** with the user's input intact.
- **Fetch throws:** `('error', 'Failed to save business details: <err.message>')`.

### Server (`pages/api/business-details/index.ts`)
- **`GET`:** `prisma.business_details.findFirst({ orderBy: { id: 'asc' } })` → 200 with the row, or 200 `{}` if there is none. On error, `fail()` → 500 `{message:'Failed to fetch business details'}` (or a mapped Prisma code).
- **`PUT`** validation, in order:
  1. `!gstin || !name || !address_line_1` → 400 `GSTIN, name, and address line 1 are required`
  2. `!isValidGstin(gstin)` → 400 `GSTIN is not valid. Expected 15 characters, e.g. 09ABFPM3900M1ZI, starting with a state code of 01-38.` (this text differs from the client's)
  3. `phone` → 400 `Phone number must be exactly 10 digits`. `phone2` → 400 `Phone 2 number must be exactly 10 digits`. `fax` → 400 `Landline number must be exactly 10 digits`.
- **Data written:**
  - `gstin`, `name` and `address_line_1` are always written, `.trim()`ed. **GSTIN is not uppercased.**
  - The optional fields `tagline, address_line_2, pin_code, phone, phone2, email, fax, terms` are written only if the key is present (`!== undefined`). A string is stored as `trim() || null`; any non-string, `null` included, is stored as `null`.
- **`!id || id === 0`** (id-less): `findFirst({orderBy:{id:'asc'}})`.
  - If a row exists: `update({where:{id: existing.id}, data})` → 200 `{status:'success', message:'Business details updated successfully', data}`.
  - Otherwise: `create({data})` → **200** (not 201) `{status:'success', message:'Business details created successfully', data}`.
- **Otherwise:**
  - `parseId(id)` null (`'abc'`, `-1`, `'0'`) → 400 `A valid business details ID is required`
  - `findUnique({where:{id}})` missing → 404 `Business details not found`
  - Otherwise `update` → 200 `{status:'success', message:'Business details updated successfully', data}`
- **Errors:** caught by `fail(res, e, 'update business details')`: P2025→404 `Record not found`, P2002→409 `That value is already in use`, P2003→400, P2000→400 `A value is too long for its column`, else 500 `Failed to update business details`.
- **Other methods:** 405 `{message:'Method not allowed'}`, with **no** `Allow` header.

**Prisma model `business_details`:** `id, gstin, name, tagline, address_line_1, address_line_2, pin_code, phone, phone2, email, fax, terms`. Stub operations used: `findFirst` (orderBy), `findUnique`, `create`, `update`.

**GSTIN → state code:** this screen does not derive or store a state code. `business_details` has no state column. `getBusinessStateCode(gstin)` (lib/gst.ts:79) is how other screens read it, from the first two characters.

---

## 2. `/settings/bankdetails`

### Layout
Toolbar:
- label `Search Bank Accounts` with a `ClearableInput` (placeholder `Search bank accounts...`)
- `PageSizeSelect`: label `Items per page`, options `10`/`50`/`100`, default 50
- `ExportMenu`: columns ID / Account Name / Account Number / **Bank Name (=bank_address)** / IFSC Code; title `Bank Accounts Report`, file `Bank_Accounts`
- button **`Add Bank Account`**

Body:
- **Loading:** spinner (`h-[600px]`). The toolbar stays visible.
- **Loaded:**
  - `ListSummary`: `Showing {from} to {to} of {total} bank accounts` and `Page {page} of {totalPages}`.
  - Table headers: `S.N`, `ID`, `Account Name`(bank_name), `Account Number`, `Bank Name`(bank_address), `IFSC`, `Actions`. All except S.N and Actions toggle the sort; the current sort column shows an ArrowUp/ArrowDown svg.
  - Rows: `serialNumber(index)`, id, bank_name, account_number (mono), `bank_address || '-'`, `ifsc || '-'`, and an **`Edit`** button.
  - `ListPagination` renders nothing if `totalPages <= 1`. Otherwise it shows `Previous`, page numbers (±2, with `1 …` / `… N`) and `Next`.
- **Empty state:** no "no rows" message, just an empty tbody plus `Showing 0 to 0 of 0 bank accounts` and **`Page 1 of 0`** (bug B1).
- **Load error:** non-OK → `('error','Failed to load bank accounts')`. A thrown fetch → `('error','Network error while loading bank accounts')`. Loading then clears and the table is empty.
- **Multiple accounts:** yes. There is **no delete**, no default account and no status column.

### Form modal (rendered only when `showModal`)
- h2: `Add Bank Account` or `Edit Bank Account`.
- In edit mode only, first comes `Account ID`, a readOnly text input showing `formData.id`.
- Fields (labels again have no `htmlFor`):

| Label | key | required | placeholder |
|---|---|---|---|
| Account Name | `bank_name` | `required` (native, enforced: Save is `type=submit` inside the form) | – |
| Account Number | `account_number` | `required` | – |
| Bank Name | `bank_address` | – | `Optional` |
| IFSC Code | `ifsc` | – | `Optional` |

- Buttons: `Cancel` (type=button, closes the modal without resetting the form) and `Save` (submit).
- **Client validation:** `formData.ifsc && !isValidIfsc(formData.ifsc)` → `('error','IFSC is not valid. Expected 11 characters, e.g. HDFC0001234.')`.
  - `isValidIfsc` checks `trim().toUpperCase()` against `^[A-Z]{4}0[A-Z0-9]{6}$`.
  - So lowercase `hdfc0001234` passes. `HDFC1001234` (5th char not 0), `HDF00001234` (digit in the bank code) and `HDFC000123` (10 chars) fail. `'   '` fails.
- **Confirm dialog:**
  - Create: title `Create Bank Account?`, message `Are you sure you want to create this bank account?`, confirm `Create Bank Account`, loading `Creating Bank Account...`
  - Edit: title `Update Bank Account?`, message `Are you sure you want to update this bank account?`, confirm `Update Bank Account`, loading `Updating Bank Account...`
  - cancelText `Cancel` in both. Cancel on the confirm keeps the form modal open and sends nothing.
- **Request:** `POST` (add) or `PUT` (edit) to `/api/bank-details`. Body is `formData`: `{id, bank_name, account_number, bank_address, ifsc}`, with `id: 0` on add. The POST handler ignores `id`.
- **Success (any 2xx):**
  - Both modals close and the form resets.
  - The list is refetched.
  - Snackbar `('success', 'Bank account created successfully!')` or `('success', 'Bank account updated successfully!')`. This is client text, not the server message.
- **Failure:** snackbar `('error', error.message || 'Failed to save bank account')`. Only the confirm closes; **the form modal stays open** with the input intact.
- **Fetch throws:** `Failed to create bank account: <msg>` or `Failed to update bank account: <msg>`.

### Server (`pages/api/bank-details/index.ts`)
- **`GET`:**
  - Query parameters: `page=1, limit=50, search='', sortBy='bank_name', sortOrder='asc'`, each run through `parseInt` with no bounds.
  - `where` for a non-empty search: `{OR:[{bank_name:{contains}},{account_number:{contains}},{bank_address:{contains}},{ifsc:{contains}}]}`. MySQL collation makes this case-insensitive; a JS stub is probably case-sensitive.
  - Sort whitelist: `id, bank_name, account_number, bank_address, ifsc`. Anything else silently becomes bank_name. `sortOrder` is `'desc'` or `'asc'`.
  - Calls `count({where})`, then `findMany({where, select:{id,bank_name,account_number,bank_address,ifsc}, orderBy:{[field]:dir}, skip:(page-1)*limit, take:limit})`.
  - 200 `{ bankAccounts:[…], pagination:{page, limit, total, totalPages: ceil(total/limit), hasMore: page<totalPages} }`. There is no `data` key and it does not use `listResponse`/`buildPagination`.
- **`POST`**, in order:
  1. `bank_name` missing, not a string, or blank after trim → 400 `Bank name is required and must be a non-empty string`
  2. `account_number` the same → 400 `Account number is required and must be a non-empty string`
  3. `ifsc` given but invalid → 400 `IFSC is not valid. Expected 11 characters, e.g. HDFC0001234.`
  4. `findFirst({where:{OR:[{bank_name: trimmedName},{account_number: trimmedAccount}]}})`. If a row is found → 409:
     - `Account number already exists` if `found.account_number === trimmedAccount`
     - otherwise `Bank with this name already exists`
  5. `create({data:{bank_name: trimmed, account_number: trimmed, bank_address: bank_address?.trim() || null, ifsc: normaliseIfsc(ifsc)}, select:{id,bank_name,account_number,bank_address,ifsc}})` → **201** `{status:'success', message:'Bank account created successfully', data}`
- **`PUT`**, in order:
  1. `parseId(id)` null → 400 `A valid bank account ID is required`
  2. The same name, number and IFSC checks with the same messages as POST
  3. `findUnique({where:{id}})` missing → 404 `Bank account not found`
  4. Duplicate check: `findFirst({where:{AND:[{id:{not:id}},{OR:[{bank_name},{account_number}]}]}})` → 409, same two messages
  5. Update: `update({where:{id}, data})` with `bank_name` and `account_number` always written; `bank_address` only if the key is present (`trim()||null`); `ifsc` only if present (`normaliseIfsc`, which uppercases and turns `''` into `null`). No `select`, so the full row comes back. → 200 `{status:'success', message:'Bank account updated successfully', data}`.
- **Errors:** `fail()` with the context `fetch bank details`, `create the bank account` or `update the bank account` (500 text is `Failed to <context>`).
- **Other methods (e.g. DELETE):** 405 `{message:'Method not allowed'}` with no Allow header.

**Prisma model `bank_details`:** `id, bank_name, account_number, bank_address, ifsc`. Stub operations used:
- `count({where})` and `findMany` with `OR`/`contains`, `select`, `orderBy`, `skip`, `take`
- `findFirst` with `OR` and with `AND`+`{id:{not}}`
- `findUnique`, `create` with `select`, and `update`

---

## 3. Dashboard `/`

### Layout (`pages/index.tsx`)
- **First load** (`loading && !data`): only a spinner (`h-32 w-32`) is rendered.
- **Header:** h1 `Dashboard`, plus today in date-fns `PPPP` (e.g. `Saturday, October 3rd, 2026`).
- **Error banner** (when `error` is set):
  - The title `Could not load the dashboard`, then the error text: the server's `message` (500 → `Failed to load the dashboard`), or `Request failed (<status>)` if the body has no message.
  - A **`Retry`** button that calls `load(salesDate, purchasesDate)` again.
  - If the first load fails, everything below still renders with 0s and "No … found".
- **Six stat cards** (`dt` label / `dd` value):

| Label | Value | Format |
|---|---|---|
| `Total Products` | `totals.products` | `toLocaleString()` (default locale, e.g. `1,234`) |
| `Low Stock` | `totals.lowStock` | toLocaleString |
| `Total Sales` | `totals.sales` (a **count** of invoices, not an amount) | toLocaleString |
| `Total Purchases` | `totals.purchases` (count) | toLocaleString |
| `Today's Sales` | `today.sales` | `money()` = `₹` + `toLocaleString('en-IN')` → `₹1,23,456`, `₹4,000`, `₹0` |
| `Today's Purchases` | `today.purchases` | money |

- **Two day panels**, `Daily Sales` and `Daily Purchases` (h3), each in a `.card`:
  - Five buttons each: `Today`, `Yesterday`, then `MMM d` for 2–4 days ago. They are computed once at mount; the selected one gets `bg-emerald-600` (sales) or `bg-blue-600` (purchases).
  - Body: `money(total)` plus `Sales for <label>` or `Purchases for <label>`.
  - While **re-loading** (data already present), the panel bodies show a small spinner and the cards keep their old values.
  - Both panels have identical button labels, so **scope with `within(heading.closest('.card'))`**.
- **`Last Sale` / `Last Purchase` cards:**
  - `money(amount)`, `Invoice #<invoiceNo>`, and `formatStamp(date)`: unix seconds × 1000 in date-fns `PPP`, e.g. `October 3rd, 2026`. A string that does not parse is shown as-is.
  - Empty state: `No sales found` or `No purchases found`.
- **Request:** one `GET /api/dashboard?today=YYYY-MM-DD&salesDate=YYYY-MM-DD&purchasesDate=YYYY-MM-DD` on mount and again each time either day is selected. Dates come from `getLocalDateString()` in the browser's timezone.

### API (`pages/api/dashboard/index.ts`)
- `route()` takes GET only. Anything else → 405 `{message:'Method not allowed'}` with `Allow: GET`.
- **Date parsing:** `readDate` accepts only `^\d{4}-\d{2}-\d{2}$`. Otherwise it falls back to `today`, whose own fallback is the server's `getLocalDateString()`.
- **Day window:** `dayRange(d) = { gte: convertDateToTimestamp(d), lte: start + 86399 }`. These are unix **seconds** compared with `invoice_date`, so `invoice_date` is an Int column of unix seconds. `convertDateToTimestamp` is in the missing `lib/date-utils`, so tests must import it to build seed timestamps exactly as the server does.
- **Financial year:** **no scoping**. Counts are all-time (deliberate, per the comment at lines 92–94). Day sums use only the explicit day windows. `settings.currentfy` and `financial_year` are not read.
- All ten queries run in `Promise.all`:

| # | Figure | Prisma call |
|---|---|---|
| 1 | `totals.products` | `prisma.product.count({ where: { is_active: true } })` |
| 2 | `totals.lowStock` | `prisma.product.count({ where: { stock: { lt: prisma.product.fields.min_stock }, min_stock: { not: null, gt: 0 } } })`, a **field-to-field** comparison. Note: **no `is_active` filter**. |
| 3 | `totals.sales` | `prisma.invoice.count()` |
| 4 | `totals.purchases` | `prisma.purchase.count()` |
| 5 | `today.sales` | `prisma.invoice.aggregate({ where: { invoice_date: todayRange }, _sum: { total: true } })` |
| 6 | `today.purchases` | `prisma.purchase.aggregate({ where: { invoice_date: todayRange }, _sum: { total: true } })` |
| 7 | `salesDay.total` | `prisma.invoice.aggregate({ where: { invoice_date: salesRange }, _sum: { total: true } })` |
| 8 | `purchasesDay.total` | `prisma.purchase.aggregate({ where: { invoice_date: purchasesRange }, _sum: { total: true } })` |
| 9 | `lastSale` | `prisma.invoice.findFirst({ orderBy: { invoice_date: 'desc' }, select: { total, invoice_date, invoice_no } })` |
| 10 | `lastPurchase` | `prisma.purchase.findFirst({ orderBy: { invoice_date: 'desc' }, select: { total, invoice_date, invoice_no } })` |

- Sums are `Number(_sum.total ?? 0)`, which also handles Decimal.
- Response 200:
  ```
  { totals:{products,lowStock,sales,purchases},
    today:{date,sales,purchases},
    salesDay:{date,total},
    purchasesDay:{date,total},
    lastSale:{amount,date,invoiceNo}|null,
    lastPurchase:{amount,date,invoiceNo}|null }
  ```
- Errors: `fail(res,e,'load the dashboard')` → 500 `Failed to load the dashboard`.
- **No data:** all counts 0, sums 0 (the stub must return `_sum.total: null` for zero rows, as Prisma does), and `lastSale`/`lastPurchase` are `null`. The UI then shows `0` ×4, `₹0` ×4 and `No sales found` / `No purchases found`.

**Stub requirements specific to this route:**
- `prisma.product.fields.min_stock` is read **when the module is imported** (`LOW_STOCK_WHERE` is a top-level const). The stub has to expose `product.fields.min_stock` as a field-reference object before the handler is imported, and its `lt` evaluator has to resolve that reference against the same row.
- The stub also needs `{ not: null, gt: 0 }` combined on one field, `aggregate` with `_sum`, and `findFirst` with `orderBy` + `select`.

### Seeding every figure to a known non-zero number
Set `process.env.TZ` (e.g. `Asia/Kolkata`) before anything imports date code. Let `T = getLocalDateString()`, `Y` = yesterday's string, `ts = convertDateToTimestamp` (from lib/date-utils), `D0 = ts(T)`, `D1 = ts(Y)`.

**`product`** (fields read: `is_active`, `stock`, `min_stock`):
- p1 `{is_active:true, stock:10, min_stock:5}`: not low
- p2 `{is_active:true, stock:2, min_stock:5}`: low
- p3 `{is_active:true, stock:-1, min_stock:0}`: not low (min 0)
- p4 `{is_active:true, stock:0, min_stock:null}`: not low
- p5 `{is_active:false, stock:1, min_stock:3}`: inactive, but **counted as low**

Result: **Total Products 4, Low Stock 2**. Leave out p5 to get 1 and avoid the inconsistency.

**`invoice`** (fields read: `invoice_date` Int unix seconds, `total`, `invoice_no`):
- i1 `{invoice_date: D0+3600, total:1500, invoice_no:101}`
- i2 `{invoice_date: D0+7200, total:2500, invoice_no:102}`
- i3 `{invoice_date: D1+100, total:700, invoice_no:100}`
- i4 `{invoice_date: D0+86400, total:9999, invoice_no:103}` (tomorrow's 00:00, outside today's window)

Result: **Total Sales 4**. **Today's Sales `₹4,000`**. **Daily Sales: Today `₹4,000`, Yesterday `₹700`**. **Last Sale** comes from i4: `₹9,999` and `Invoice #103`. To make Last Sale fall on today instead, leave out i4 → `₹2,500`, `Invoice #102`.

Window boundaries: a row at `D0+86399` counts for today; `D0-1` counts for yesterday.

**`purchase`** (same fields):
- u1 `{invoice_date: D0+60, total:12345, invoice_no:501}`
- u2 `{invoice_date: D1+60, total:800, invoice_no:500}`

Result: **Total Purchases 2**, **Today's Purchases `₹12,345`**, **Daily Purchases Yesterday `₹800`**, **Last Purchase `₹12,345` / `Invoice #501`**.

Pick amounts at or above 1,00,000 (e.g. 123456 → `₹1,23,456`) to check the Indian digit grouping.

---

## 4. Bugs / inconsistencies

| # | Where | Finding | Failure scenario | Confidence |
|---|---|---|---|---|
| B1 | pages/api/bank-details/index.ts:65 | `totalPages = Math.ceil(total/limitNum)` is 0 when there are no rows. Unlike `buildPagination`, there is no `Math.max(1, …)`. | Empty `bank_details` → the page shows `Page 1 of 0`. | High |
| B2 | pages/api/business-details/index.ts:109 (+ :70) | The GSTIN is validated case-insensitively (`isValidGstin` uppercases) but stored as `gstin.trim()`, not uppercased. Compare IFSC, which is normalised. | Save `09abfpm3900m1zi` → 200, and the DB and view mode show lowercase `09abfpm3900m1zi`. | High |
| B3 | pages/api/business-details/index.ts:61 + :110–111; businessdetails.tsx:212–217 | The required check is truthiness, before trimming. The client never checks name/address because Save Changes is outside the `<form>`, so `required` is never enforced. | Company Name `"   "` with a valid GSTIN → 200 `updated`, and `name` is stored as `""` (view shows `-`). | High |
| B4 | businessdetails.tsx:212, :222 | The `required`/`pattern`/`type=email` attributes do nothing: the save button is outside the form and calls the handler directly. Email is unvalidated on both client and server, although `isValidEmail` exists in lib/validators.ts:22 and staff/mechanics use it (per its comment). | Email `not-an-email` saves successfully. | High |
| B5 | pages/api/dashboard/index.ts:47–50 vs :89 | Low Stock has no `is_active` filter, but Total Products counts only active products. The comment says inactive products are "not stock on hand". | One inactive product with `stock 1, min_stock 3` → Low Stock 1 while Total Products excludes it. | High (code fact); Medium that it is unintended |
| B6 | bankdetails.tsx:172, :200, :206, :255, :273 vs api messages | The labels are swapped relative to the columns. "Account Name" is `bank_name`, "Bank Name" is `bank_address`. Server errors say `Bank name is required…` / `Bank with this name already exists` about the field labelled **Account Name**. | Blank Account Name (whitespace) → the snackbar talks about "Bank name". The user's actual Bank Name field is optional. | High (UX inconsistency) |
| B7 | pages/api/business-details/index.ts:157 | The create path returns **200**. respond.ts:32–41 says creates return 201 via `created()`, and bank-details does. | A client that checks `status===201` after a first save misses it. | High (inconsistency, harmless to this page) |
| B8 | pages/api/bank-details/index.ts:27–28, :61–62 | `page`/`limit` are not bounded (list-query.ts:421–424 lists this endpoint). | `?page=0` → `skip:-50` → Prisma throws → 500 `Failed to fetch bank details`. `?limit=0` → `take:0`, `totalPages` NaN or Infinity. Not reachable from the UI. | High (API only) |
| B9 | pages/index.tsx:62–87 | No stale-response guard. Overlapping loads, e.g. clicking a sales day and then a purchases day quickly, both call `setData`, and the last one to arrive wins. | A slow first response overwrites the newer one, so the Purchases panel shows the previously selected day's total under the new day's label. | Medium |
| B10 | pages/api/dashboard/index.ts:104–111 | Last Sale/Purchase is ordered by `invoice_date` only, with no tiebreak. If invoice dates are day-precision (which `convertDateToTimestamp` suggests), several same-day invoices tie and "last" is arbitrary. | Two invoices on the same day at the same `invoice_date` → Last Sale may show the earlier invoice number. | Medium (depends on how invoices are stamped, which is not in the bundle) |
| B11 | pages/api/bank-details/index.ts:126 | The duplicate message is chosen by an exact JS `===` while the DB match is case-insensitive under MySQL. | Existing account `ab12`, new account `AB12` with a different name → MySQL matches the account, JS compare fails → wrong message `Bank with this name already exists`. | Medium (MySQL only, not reproducible on a case-sensitive stub) |
| B12 | pages/api/business-details/index.ts:126 | An optional field sent as a non-string, e.g. number `pin_code: 400001`, is silently stored as `null`, not rejected. | An API caller sending a numeric pin_code wipes it. If the column is Int and the GET returns a number, the UI's round-trip would wipe it too (column type unknown). | Medium-Low |
| B13 | bankdetails.tsx:93 | A whitespace-only IFSC is treated as "given" and rejected, rather than as empty (the server also rejects it). | Typing a space in IFSC → `IFSC is not valid…`. | Low (consistent client and server, just a minor UX issue) |

Not counted as bugs:
- The client and server GSTIN error texts differ (the server adds `starting with a state code of 01-38.`).
- The comments at businessdetails.tsx:158 and bankdetails.tsx:129 say "keep modals open" but the code closes the confirm. Only the bank form modal stays open, which is what the code intends.
- Dashboard API D-09: the date string comes from the client, but `convertDateToTimestamp` runs in the server's TZ. I can't verify this without date-utils.

---

## 5. Page-test checks (jsdom + @testing-library, fetch → real handlers → in-memory Prisma)

### Business details
1. **Empty DB:** wait for `Company Information`. All eleven view `<p>`s show `-`. An `Edit` button is visible.
2. **Seeded row** (`{id:1, gstin:'09ABFPM3900M1ZI', name:'Baijnath Sons', address_line_1:'MG Road', phone:'9876543210', tagline:null,…}`): the values are displayed. Null fields show `-`.
3. **Edit / Cancel:** click `Edit`, change the name, click `Cancel` → the original name is shown and no PUT is sent.
4. **Digit filter:**
   - Type `98a76-5` into the `Exactly 10 digits` (Phone) input → value `98765`.
   - Type 12 digits → value capped at 10. A keystroke that would make it 11 is ignored.
5. **Short phone:** phone `12345` → `Save Changes` → snackbar `Phone number must be exactly 10 digits`. No confirm, no fetch.
   - Same for Phone 2 (`Phone 2 number must be exactly 10 digits`) and Landline (`Landline number must be exactly 10 digits`).
   - Order check: a short phone plus a bad GSTIN → the phone message wins.
6. **Bad GSTIN:** `00ABFPM3900M1ZI` → `GSTIN is not valid. Expected 15 characters, e.g. 09ABFPM3900M1ZI.` No confirm.
7. **Create on empty DB:**
   - Fill Company Name, Address Line 1 and GSTIN `09ABFPM3900M1ZI`, then `Save Changes`.
   - The dialog shows `Update Business Details?`, `Are you sure you want to update the business details?` and `Update Details`.
   - Click confirm. Assert the PUT body `id === 0` and has all 12 keys.
   - Snackbar `('success','Business details created successfully')`. View mode shows the values. The store has exactly 1 row.
8. **Second save:**
   - Edit Tagline, then confirm. The body `id` equals the created id.
   - Snackbar `Business details updated successfully`. Still 1 row.
9. **Clear optional:** blank Tagline, then save → store `tagline === null`, and the view shows `-`.
10. **Confirm cancel:** after Save Changes, click the dialog's `Cancel` → no fetch. The page stays in edit mode with the input intact.
11. **Server required:** with a valid GSTIN and an empty Company Name → the confirm opens (the client doesn't check). Confirm → snackbar `GSTIN, name, and address line 1 are required`. Still in edit mode, store unchanged.
12. **B3:** Company Name `"   "` → saves. Store `name === ''`.
13. **B2:** GSTIN `09abfpm3900m1zi` → saves. Store `gstin === '09abfpm3900m1zi'`.
14. **B4:** Email `nope` saves.
15. **Load failure:** make the stub's `findFirst` throw → snackbar `('error','Failed to load business details')`.
16. **API-direct checks:**

    | Request | Expected |
    |---|---|
    | PUT `{id:'abc',…valid}` | 400 `A valid business details ID is required` |
    | PUT `{id:999,…}` | 404 `Business details not found` |
    | PUT id-less with an existing row | that row is updated, no second row |
    | PUT `phone:'abcdefghij'` | 400 phone message |
    | PUT GSTIN `39ABFPM3900M1ZI` | 400 server GSTIN text |
    | PUT omitting `terms` | `terms` unchanged |
    | DELETE | 405 `Method not allowed` |

### Bank details
Mock `next/router` (`isReady:true, query:{}, pathname:'/settings/bankdetails', replace:jest.fn()`).

1. **Empty:** `Showing 0 to 0 of 0 bank accounts`, `Page 1 of 0` (B1). No `<tbody>` rows, no `Previous`/`Next`.
2. **Seeded list** (`{1,'SBI Current','111','State Bank',null}`, `{2,'HDFC OD','222',null,'HDFC0001234'}`):
   - The first request is `GET /api/bank-details?page=1&limit=50&search=&sortBy=bank_name&sortOrder=asc`.
   - Rows are in bank_name asc order (`HDFC OD`, then `SBI Current`) with S.N 1, 2. Null cells show `-`.
   - `Showing 1 to 2 of 2 bank accounts`.
3. **Add happy path:**
   - Click `Add Bank Account` → h2 `Add Bank Account`. There is no `Account ID` field.
   - Fill Account Name `ICICI Main`, Account Number `333`, Bank Name `ICICI Bank`, IFSC `icic0000123`, then `Save`.
   - The dialog shows `Create Bank Account?`, `Are you sure you want to create this bank account?` and `Create Bank Account`. Click confirm.
   - POST body is `{id:0, bank_name:'ICICI Main', account_number:'333', bank_address:'ICICI Bank', ifsc:'icic0000123'}`. The response is 201.
   - Snackbar `('success','Bank account created successfully!')`. The modal is gone, the list is refetched and the row shows IFSC `ICIC0000123` (uppercased).
4. **Bad IFSC:** `HDFC1001234` → snackbar `IFSC is not valid. Expected 11 characters, e.g. HDFC0001234.` No confirm, no fetch. Repeat with `HDFC000123`.
5. **Native required:** submit with Account Name empty → no confirm, no fetch. This needs `ClearableInput` to pass `required` through and jsdom's requestSubmit validity check.
6. **Whitespace name:** Account Name `"   "`, Account Number `444` → confirm → snackbar `Bank name is required and must be a non-empty string`. The form modal is still open and the confirm is closed.
7. **Duplicate number:** add Account Number `111` → snackbar `Account number already exists`. The form stays open.
8. **Duplicate name:** add Account Name `SBI Current` with a new number → `Bank with this name already exists`.
9. **Edit:**
   - Click the row's `Edit` → h2 `Edit Bank Account`. `Account ID` is readonly with the id, and the fields are prefilled (null shows as `''`).
   - Clear IFSC, `Save` → `Update Bank Account?` → confirm. The PUT body has `id` and `ifsc:''`.
   - Snackbar `('success','Bank account updated successfully!')`. The store has `ifsc === null` and the row shows `-`.
10. **Edit into a duplicate:** change row 2's number to `111` → `Account number already exists`.
11. **Confirm cancel:** `Save` → dialog `Cancel` → no fetch, and the form modal is still visible. Form `Cancel` closes the modal.
12. **Sort:**
    - Click the `Account Number` header → the next GET has `sortBy=account_number&sortOrder=asc`, and an svg appears in that header.
    - Click again → `sortOrder=desc` and the order of rows flips.
13. **Search:** type `HDFC` in `Search bank accounts...`. Advance or wait past the 300 ms debounce. The GET has `search=HDFC` and only that row is shown. `router.replace` is called with `query.search='HDFC'`.
14. **Page size:**
    - Seed 11 rows and select `10` → `limit=10`. The summary reads `Showing 1 to 10 of 11 bank accounts` / `Page 1 of 2`.
    - Click `Next` → `page=2`, one row with S.N `11`.
15. **Load failure:** make the stub's `count` throw → snackbar `('error','Failed to load bank accounts')`.
16. **API-direct checks:**

    | Request | Expected |
    |---|---|
    | PUT `{id:'x'}` | 400 `A valid bank account ID is required` |
    | PUT `{id:999, bank_name:'A', account_number:'9'}` | 404 `Bank account not found` |
    | PUT omitting `bank_address` | it stays unchanged |
    | DELETE | 405 |
    | GET `?page=0` | 500 (B8; only with a stub that rejects a negative skip) |

### Dashboard
Fix the TZ and seed as in §3.

1. **Empty DB:**
   - The spinner shows first, then `Dashboard`.
   - The values under `Total Products`, `Low Stock`, `Total Sales` and `Total Purchases` are `0`. `Today's Sales` and `Today's Purchases` are `₹0`.
   - Both day panels show `₹0`, with `Sales for Today` / `Purchases for Today`.
   - `No sales found` and `No purchases found` are shown.
2. **Seeded:**
   - Card values: Total Products `4`, Low Stock `2` (or `1` without p5), Total Sales `4`, Total Purchases `2`, Today's Sales `₹4,000`, Today's Purchases `₹12,345`.
   - Last Sale `₹9,999`, `Invoice #103` and the `PPP` date of `D0+86400`. Last Purchase `₹12,345`, `Invoice #501`.
3. **The request:** one fetch to `/api/dashboard?today=T&salesDate=T&purchasesDate=T`.
4. **Day switch (sales):**
   - Within the `Daily Sales` card, click `Yesterday`. A fetch goes out with `salesDate=Y&purchasesDate=T`.
   - The panel shows `₹700` and `Sales for Yesterday`, and that button has class `bg-emerald-600`.
   - The `Daily Purchases` panel still shows `Purchases for Today`, `₹12,345`.
5. **Day switch (purchases):**
   - Within `Daily Purchases`, click `Yesterday` → `₹800`, `Purchases for Yesterday`, class `bg-blue-600`.
   - Each panel has 5 buttons: `Today`, `Yesterday` and three `MMM d` labels.
6. **Reload spinner:** after a day click and before the response arrives, the cards still show their values and the panel bodies show the small spinner, `.animate-spin.h-8`.
7. **Boundaries:** a row at `D0+86399` is included in today, and a row at `D0-1` falls into yesterday.
8. **Error banner:**
   - Make `invoice.count` throw → `Could not load the dashboard` and `Failed to load the dashboard`, with 0 values.
   - Clear the fault and click `Retry` → the banner goes away and the values appear.
9. **Indian grouping:** an invoice today with total `123456` → `Today's Sales` is `₹1,23,456`.
10. **B5:** with p5 seeded, Low Stock is `2` while Total Products is `4` (p5 is excluded from the products count).
11. **API-direct checks:**

    | Request | Expected |
    |---|---|
    | `?today=garbage` | falls back to the server date (status 200) |
    | POST | 405 with `Allow: GET` |

---

## 6. Models and fields a test store must seed (names exactly as the code reads them)

| Model (prisma delegate) | Fields | Used by |
|---|---|---|
| `business_details` | `id, gstin, name, tagline, address_line_1, address_line_2, pin_code, phone, phone2, email, fax, terms` | business-details GET/PUT |
| `bank_details` | `id, bank_name, account_number, bank_address, ifsc` | bank-details GET/POST/PUT |
| `product` | `is_active` (bool), `stock` (int), `min_stock` (int or null) + `prisma.product.fields.min_stock` field ref | dashboard |
| `invoice` | `invoice_date` (Int unix seconds), `total` (number/Decimal), `invoice_no` | dashboard |
| `purchase` | `invoice_date`, `total`, `invoice_no` | dashboard |

Stub operations needed:
- `findFirst`, `findUnique`, `findMany`, `count`, `create` (with `select`), `update`, `aggregate({_sum})`
- Where operators: `contains`, `OR`, `AND`, `not` (both `{not: value}` and `{not: null}`), `gt`, `lt` (with a field ref), `gte`/`lte`
- `orderBy` by any column asc/desc, `skip`, `take`
- `aggregate` must return `_sum.total = null` for zero matching rows
