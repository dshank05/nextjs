# Purchase, Sale and Invoice C bills — plan

Status: **B1–B6 done** (2026-10-03); page test test11 next. Owner answers in section 4.
Every screen below was read in full first, with its API routes, hooks, modals and the
libs behind them. Database: nothing to run, no data changes.

Sale and Invoice C already share one form, view and list (`components/bills/*`, Phase 5).
Purchase is the odd one out: it shares the line editor (`BillLines`) and the money maths
(`lib/line-math`) but has its own form, view, list, hooks and payment modal, and its create
route still holds ~600 lines of logic. This plan puts all three bills on one set of screens
and checks the sale side for every purchase bug found on the way.

## 1. What the screens do today

### Entry points (sidebar `components/Layout.tsx`)

| | Purchase | Sale (INVOICE) | Invoice C |
|---|---|---|---|
| Sidebar | PURCHASE → `/purchases` | INVOICE → `/sale` | INVOICE C → `/salex` |
| Create / edit | `/purchases/create` (`?edit=id`) | `/sale/create` (`?edit=id`) | `/salex/create` (`?edit=id`) |
| View | `/purchases/view/[id]` | `/sale/view/[id]` | `/salex/view/[id]` |
| Other links in | return screens ("Edit Return" → bill), reports | same | same |
| Out | "+ Add New Vendor" (new tab), Create Return, Mark as Paid | "+ Add New Customer" (new tab), Create Return, Mark as Paid | same as sale |

### Size today

| Piece | Purchase | Sale + Invoice C (shared) |
|---|---|---|
| List page + table | `purchases/index` 86 + `PurchaseTable` 305 | `SaleBillsPage` 84 + `SaleBillTable` 327 |
| View | `purchases/view/[id]` 817 | `SaleBillView` 344 |
| Form | `purchases/create` 639 | `SaleForm` 645 |
| Hooks / types | `usePurchases` 224, `types/purchases` 78 | `useSaleBills` 135 |
| Mark-as-Paid modal | `QuickPaymentModal` 263 | `QuickCustomerPaymentModal` 280 |
| Create route | `api/purchases/index.ts` 631 (logic inline) | 5-line route → `lib/sale-create.ts` |
| **UI total** | **2,412** | **1,815** |

### List
Filters (number, bill reference, party, item count, total, date range, mode, status, P/F;
sale adds tax, Invoice C adds notes), saved per tab with the page; sortable columns; export of
the page or every match; delete (refused while the bill has returns). Purchase sorts by number,
oldest first; sale by date, newest first.

### View
Banner (number, party, return badges), four columns (money / party / totals / transport and
notes), Export (Excel / PDF layouts), Mark as Paid, Create Return, Edit (disabled when fully
returned), lines table, returns on this bill, payment history modal.

### Form
Number, bill reference (+ reference date on purchase), staff, date; party block (registered or
"Other" with manual name / phone / address / state); transport (purchase: name, box quantity,
transport cost; sale: vehicle, transport, freight, mechanic, commission); Enable Tax (and
Discount on sale); lines (`BillLines`); descriptions / notes; P&F qty and total; tax preview;
payment status and mode; grand total; confirm. Edit loads from the server, keeps a part-paid
status unless changed, refuses a party change, blocks a fully returned bill and stops a line
going below what was returned.

## 2. Bugs found while reading

**Purchase**
1. The form always sends the invoice number it prefilled, so the server's "lost the race for
   this number, take the next" retry never runs — two people saving at once get a duplicate
   error. The number is also freely editable (sale's is server-assigned, read-only). *(Q2)*
2. Freight (transport cost) is not in the purchase total; on sale it is. Open since
   SALE_AUDIT. The form calls it "Transport cost", the view "Freight". *(Q1)*
3. Lowering a line, removing a line or deleting a purchase takes the units back out of stock
   with no check, so stock goes negative when they were already sold (sale checks stock before
   it takes any out). Likely how product 211 reached −1 on the test DB. *(Q3)*
4. ~~P&F total is not rounded to paise on purchase.~~ **Wrong** — `computeBill` already rounded
   the stored total; only the rule differed from sale's in form. Purchase now uses
   `packingAmount` too.
5. Changing the vendor on a new purchase wipes every line; sale keeps them.
6. Staff dropdown shows "Name - null" for staff without a phone (sale fixed this).
7. View recomputes each line's tax and total in the browser from qty × rate × GST instead of
   showing the stored, rounded figures — can be paise off the bill's own totals. Sale shows
   what is stored.
8. View offers Mark as Paid on an "Other" purchase; the payment API then refuses it with
   "Missing required fields". Sale hides the button for "Other".
9. View money shows without paise ("₹1,180.5"); sale formats ₹1,180.50.
10. ~~List export: the Vendor column is blank.~~ **Wrong** — `usePurchases` added
    `customer_vendor_name` to every row. (Found when reading the hooks for B2.)
11. List: the vendor filter has no "Other" option (sale's customer filter has).
12. Create route: a missing product is a 500 "Failed to create purchase" instead of a 400 that
    names the problem; 600 lines of logic live in the route (sale's are in a lib).

**Both sides (found on purchase, same on sale / Invoice C)**
13. Mark-as-Paid modal keeps the amount from when the page first opened: after a part payment
    the second opening offers the old outstanding, which the server then refuses.
14. Payment notes name the bill's database id, not its printed number ("Payment for purchase
    #812" for bill 45).
15. After saving or deleting a bill only that bill list refetches; stock, ledgers, outstanding
    and payment screens stay stale until reload (transactions and returns already refresh all).
16. Returns on the bill view use the bill's words (Unpaid / Paid) instead of "Pending refund" /
    "Refunded" agreed for returns.
17. "+ Add New Customer / Vendor" opens with `noopener`, so the new tab can't close itself after
    saving and the user lands on the party list in a second tab.
18. Sale view: a return on the bill has no link to it; purchase has one (labelled "Edit
    Return" though it opens the view).

## 3. The rewrite

One set of screens, configured per kind (`'purchase' | 'sale' | 'salex'`), the pattern used
for transactions, returns and party details:

```
hooks/useBills.ts                      list, one bill, next number, save, delete — all three kinds
components/bills/BillList.tsx          list page + table (replaces SaleBillsPage, SaleBillTable,
                                       purchases/index, PurchaseTable)
components/bills/BillView.tsx          (replaces SaleBillView and purchases/view)
components/bills/BillForm.tsx          (replaces SaleForm and purchases/create)
components/bills/BillPaymentModal.tsx  (replaces QuickPaymentModal and QuickCustomerPaymentModal)
components/bills/BillLines.tsx         unchanged (already shared)
lib/purchase-create.ts, lib/purchase-delete.ts, lib/api/purchase-routes.ts
                                       purchase create / delete out of the routes, as sale
```

What differs per kind lives in one config: party (customer / vendor, master fields, "Add New"
link), number (server-assigned or not — Q2), extra header fields (reference date; mechanic /
commission), discount (sale and Invoice C), tax (off for Invoice C), freight in total (Q1),
default line rate (selling vs last purchase), stock check direction, labels and URLs.

Kept exactly: every URL, every API request and response shape, the per-party ledger
conventions (purchases by "Other" still post to the vendor ledger as vendor 0, as today;
sales by "Other" do not), list filters remembered per tab, export layouts.

Expected size: UI 4,227 → about 1,900 lines (form ~700, view ~400, list ~430, hooks ~170,
modal ~200); purchase create route 631 → a thin route plus ~300 in `lib/purchase-create.ts`.

## 4. Decisions for the owner

| # | Question | Today | Owner answer (2026-10-03) |
|---|---|---|---|
| Q1 | Purchase freight in the bill total? | Stored, not in total | **Include in total**, as sale. Existing purchases keep their stored total (no data change); a purchase edited from now on is recomputed with its freight, and its ledger entry follows |
| Q2 | Purchase number | Prefilled, editable | **Server-assigned, read-only**, as sale |
| Q3 | Lowering / deleting a purchase whose units are already sold | Allowed, stock goes negative | **Refuse** ("only N in stock"), as sale |
| Q4 | Purchase list default order | Number, oldest first | **Date, newest first**, as sale |

Smaller defaults I will take unless overruled: vendor change keeps lines (5); P&F rounded like
sale (4); "Other" option in the purchase vendor filter (11); after a save or delete every
screen refreshes (15); return links on both views say "View Return" (18).

## 5. Order and checks

B1 server: `lib/purchase-create.ts` + `lib/purchase-delete.ts` + thin purchase routes, the
Q1–Q3 rules → B2 `hooks/useBills.ts` → B3 `BillList` → B4 `BillView` + `BillPaymentModal` →
B5 `BillForm` → B6 thin pages, delete the old files → B7 checks: tsc, next build, every server
suite, page tests 3–10 plus a new test11 (all three kinds: list, view, create, edit, pay,
delete), `audit-assert` on seeded data → docs, line counts, commit per step.

## 6. Handlers and hooks (checked 2026-10-03, after the owner asked)

### Server handlers — the money core, all twins

| Customer side | Vendor side | Lines | Differ (names aside) | Used by |
|---|---|---|---|---|
| `customer-balance-handler` | `balance-handler` | 595 + 612 | ~100 lines | bill create, payments, refunds, returns, adjustments |
| `customer-balance-log-service` | `balance-log-service` | 66 + 64 | few | the balance handlers |
| `customer-ledger-handler` | `ledger-handler` | 577 + 574 | ~265 lines | the transaction handlers |
| `customer-ledger-service` | `ledger-service` | 167 + 341 | — | everything that writes a ledger row |
| `customer-transaction-handler` | `transaction-handler` | 1,542 + 1,677 | ~930 lines | bill edit / delete, return edit / delete, payment and refund edit / delete |
| payment / refund / adjustment routes (10 files) | | 4,296 | — | the transaction screens (logic still inline; T1–T4 rewrote only the screens and the list) |

All in use. Dead: `ledger-service` getVendorLedger / getVendorOutstanding / getAllOutstanding,
`customer-ledger-service` getEntries. 24 `console.log`s in the two transaction handlers (whole
parameter sets dumped as JSON on every edit), 42 more in the payment / refund `[id]` routes.

What the bills rewrite touches: purchase delete and edit go through
`transactionHandler.handlePurchaseDelete / handlePurchaseEdit`, so Q3 (no negative stock) is
added there and in `lib/purchase-edit.ts`, mirroring sale's `assertStock`. Nothing else in the
handlers changes in this plan.

Proposed as its own phase after the bills (H), because it is the code every money figure goes
through — each step guarded by `audit-assert` A2–A4, A7, A8, A10 on seeded data and the server
suites, commit per step:
- H1 one balance handler + one balance-log service for both parties (~1,340 → ~700)
- H2 one ledger handler (~1,150 → ~650); ledger services keep their per-party ordering rule,
  dead methods go
- H3 transaction handlers: shared executors (allocations, ledger reversal, status recalculation,
  stock) in one place, per-party edit / delete rules kept apart (~3,200 → ~1,800)
- H4 payment / refund / adjustment routes onto libs, as `lib/api/sale-routes` (4,296 → thin
  routes + ~1,500 in libs); logs out

### Hooks (`hooks/`, 18 files, 1,902 lines)

| Finding | Action |
|---|---|
| `useExport` (19) — nothing imports it. (`useUrlState` is used by `useListQuery` through a relative import the first check missed.) | deleted in B6 |
| `readJson` written three times (`useParties`, `usePartyTransactions`, `useReturns`) | one copy |
| Customer / vendor dropdown fetched by four hooks under the same key (`useCustomers`, `useVendors`, `usePartyOptions`, `useReturnParties`) | one `usePartyOptions(kind)`; the others become one-line aliases |
| `useCurrentFY` falls back to fy **2024** (a year, where an fy *id* is expected) and the transaction form sends it; the server ignores the field and uses Settings | drop the hook and the field |
| `PartyForm` cached `/api/states` under `['states']` in a different shape from `useStates` — coming from a bill form, the customer form showed blank state names (my bug, today) | **fixed** in b7dbeeb |
| `usePurchases` + `useSaleBills` | become `useBills` (B2) |
| `useProducts`: the product query key is `['product', id]` with the router's string id, but update invalidates with the numeric id, so an edited product's view can stay stale | products phase |

## 7. Progress

| Step | Commit | Lines |
|---|---|---|
| B1 server: `lib/purchase-create.ts`, `lib/purchase-delete.ts`, `lib/api/purchase-routes.ts`, freight in total, no negative stock | 4900405 | +530 −749 |
| B2 `hooks/useBills.ts` | e5f9f6c | +383 |
| B3 `BillList` (three list pages thin) | 31873f6 | +299 −805 |
| B4 `BillView` + `BillPaymentModal` | 7a1f095 | +290 −1,513 |
| B5 `BillForm`; `usePurchases`, `useSaleBills`, `types/purchases`, `types/sales` removed | f1c9c38 | +675 −1,779 |
| B6 hooks: one `readJson`, one dropdown fetch, `useCurrentFY` gone, four unused files | 1ef2f1c | +57 −453 |

Bills and hooks together: 5,305 lines removed, 2,237 added (net −3,068).

Checks run: `tsc` clean and `next build` passes after every step; new server suite `out-bill`
(17: freight in the total, counter numbering, refused duplicate, missing product 400, "Other"
purchase on vendor 0, edit / delete refused when stock would go negative and allowed when it
would not); every earlier server suite passes (`out-edit` expectation 228 → 258: that bill
carries ₹30 freight); page tests 3–10 pass. The harness's `findFirst` now honours `orderBy`
(it returned the first row, so the invoice counter repeated a number in the harness only).

Not yet covered by a page test: the three bill screens themselves — test11 (list, view,
create, edit, Mark as Paid, delete, for all three kinds) is the next step.
