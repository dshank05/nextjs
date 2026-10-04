# Five-section review — results (2026-10-04)

**Fixed since:** every finding that needed no owner decision — see `docs/FIX_PLAN.md` (H1–H6, M1–M8,
M10–M17, the Lows and G-01–G-04). Open: the owner questions below, M9 (B-13), D-14, C-11, C-12.

Method: `docs/REVIEW_PLAN.md`. Section reports: `purchases.md` (A), `sales.md` (B),
`transactions.md` (C), `returns.md` (D), `parties-settings-reports.md` (E). No app code was
changed by the review.

## What was checked

Every screen action in the five sections was traced field by field (screen → request → server →
table → response → screen → cache → other screens and reports). The real screens were rendered in
the jsdom harness and their **exact requests captured as 81 fixtures** (`tests/backend/fixtures/`).
Backend tests replay them: create → read as the edit form reads it → save unchanged (nothing may
change) → edit one field → delete (everything rolled back), with A1–A14 and the 16 report checks
after every step, plus connectedness checks (ledger, outstanding, balance logs, cash book, GST,
stock, dashboard, lists, detail views).

**Connected:** the screens and the API agree on every field name, unit and shape in all five
sections; sale / Invoice C kind is carried on every write; unchanged saves write nothing (apart
from '' → null text columns); round trips and deletes leave every table as before.

## Tests

`npm run test:backend` — 38 files, **469 tests: 466 pass, 3 skipped**. 175 are new; **80 of them
are `test.failing`**, one per open finding below (each was also run as a plain test and fails for
the reason it names). When a finding is fixed its test turns red — make it a plain test then.

Merge notes: the in-memory store now keeps reviewer C's fix (no table swap inside `findUnique`,
which made parallel callers see one row) and B's (relation connect/disconnect on update sets the
foreign key; a column never set matches `null`, as in MySQL). Reviewer A's table diff treats a
never-set column as NULL accordingly.

## Findings — one list, de-duplicated, highest first

Each id points into its section report (evidence file:line, what happens, suggested fix).

### High
| | Finding | Where | Note |
|---|---|---|---|
| H1 | An on-account **refund is counted as advance** — a sign error (`+ (refunded − refund_allocated)`; the stored balance and A2/A7 use `−`). A bill created or marked Paid then "pays" with money already given back: no payment recorded, the cash book misses it, the ledger shows a Paid bill owed; a made-up "advance carried" payment row appears | A-04 = B-01 = C-02 (`purchase-create.ts:192`, `sale-create.ts:255`, `ledger-handler.ts:94`, `customer-ledger-handler.ts:111`, both transaction handlers) | Same in the Feb 2026 code |
| H2 | After a paid bill is **lowered** (tonight's rule: the extra stays as advance), **deleting or unmarking it deletes the payment's ledger row** (tagged to the bill on the vendor side) while the payment and total_paid stay — the vendor reads square instead of in credit | A-01 | Caused by 6f786fe; check the customer twin |
| H3 | Editing the **amount of a vendor payment that covers several bills** writes the new total on every per-bill ledger row (₹1,200 shows as ₹2,400); changing a payment's **allocations never moves its ledger rows** | C-01, C-03 (`transaction-handler.ts:253`) | |
| H4 | A **refunded purchase return** edited then deleted (or pending → refunded → deleted, or drawn from an on-account refund then lowered) leaves the vendor's refund counters wrong — the edit's balance-log rows carry no note number, and the delete reverses by note number | D-01, D-02, D-03 | Pre-dates tonight |
| H5 | **Settings → Users cannot add anyone on MySQL**: `auth_key` is 48 characters (`randomBytes(24)` hex) into VARCHAR(32) | E-03 (`api/users/index.ts:307`) | Introduced by the September audit (S-29); one-line fix |
| H6 | **Customer shipping address overwritten** by billing on any save when the shipping name equals the billing name | E-01 (`PartyForm.tsx:111`) | Data loss |

### Medium
| | Finding | Where |
|---|---|---|
| M1 | Changing the **payment mode** on a paid bill, a payment or a refund never reaches the payment row / ledger row / cash book | A-05, B-03, C-04 |
| M2 | **"Other" vendor** purchase paid on create skips the counters; deleting it drives them negative. Its bills can't be part-paid after saving (vendor 0 read as missing) | A-02, A-11 |
| M3 | A **rate-0 paid bill priced later** stays Paid with nothing allocated | A-03 |
| M4 | **P&F cleared** on a sale edit comes back (purchase handles it) | B-02 |
| M5 | Deleting / lowering a **sale or Invoice C return can push stock below zero** (sale create and purchase delete refuse) | D-07 |
| M6 | A sale return line left on the reason placeholder is saved with **purchase reason id 1** | D-04 |
| M7 | `vendor-items` counts returned qty through the return header's bill — multi-bill purchase returns show wrong availability, then OVER_RETURN | D-05 |
| M8 | Refunded sale return's REFUND ledger row is dated by the return date; the cash book by the payment date | D-08 |
| M9 | **Credit notes round each tax head per note**: two half-returns refund ₹344 GST against ₹342 charged | B-13 |
| M10 | Financial year dates from Settings stored as the day before (local midnight into DATE) — verify on MySQL | E-04 |
| M11 | Opening/Closing and Minimum Stock filters load from `/api/categories`, `/api/companies`, `/api/models` (404) | E-12 |
| M12 | Ledger / balance-log / party-report pickers list **active parties only**; report filter lists capped at 50 | E-05, E-10 |
| M13 | Settings saves don't refresh the shared caches (states, business GSTIN 30 min; mechanics, staff 5 min) | E-08 |
| M14 | 13 reports and the party lists **export only the visible page** | E-16 |
| M15 | Separate shipping address: blank fields filled from billing | E-02 |
| M16 | Auto Allocate float remainder stores a ₹0 allocation (and a ₹0 vendor ledger row) | C-06 |
| M17 | Party picker editable on payment edit; the change is silently dropped | C-07 |

### Low (in the section reports)
A-06, A-08, A-09, A-12, A-13 · B-04–B-07, B-09, B-10, B-12, B-14 · C-05, C-08–C-11 · D-06, D-09, D-10,
D-12–D-14, D-17, D-18 · E-02, E-06, E-09, E-11, E-13–E-15, E-17, E-18.

### Assertion gaps (A1–A14)
G-01 a payment's ledger rows vs its allocations · G-02 ledger row mode / date vs the document ·
G-03 total_allocated vs the sum of allocations · G-04 customer refund allocations (C).

## Questions for the owner
1. **Walk-in cash sales** are not in the cash book (no payment record) — the cash book will not match the drawer. Record a payment for walk-in Paid bills? (B)
2. **Dashboard leaves out Invoice C** in every card — intended? (B-08, E Q-1)
3. "Paid" chosen on the edit form dates the payment on the **bill date**; Mark as Paid uses today; moving a paid bill's date leaves its payment behind. Which date? (A-10, B-11)
4. **Unpaid bills store payment mode Cash** (form default) and count as Cash in lists/reports — store none? (A-15, B-04, D-11)
5. A **state's GST code** can change while parties use it — refuse, or carry to the parties? (E-07)
6. Party-report **date range**: show everyone owing as of the end date, or only those active in the range? (E Q-2)
7. **Phone rule**: parties need 6–9 first digit, settings masters accept any 10 digits — one rule? (E Q-4)
8. A payment chosen **Mixed but fully allocated** stays MIXED (rule says BILL_SPECIFIC) — decides the vendor ledger shape (C Q-01)
9. `POST /api/purchases` still honours a client `invoice_number` (rule: server-assigned) — remove? (A-14)
10. Notes columns are VARCHAR(255) with no limit on the screen — limit the box or widen the column? (A-16)
11. Purchase returns may span several bills, sale returns are split per bill — keep? (D-15) List "Total" is pre-tax — show the refund? (D-16)
