# Purchase, Sale and Invoice C bills — plan

Status: **plan, waiting on the owner's answers in section 4** (2026-10-03).
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
4. P&F total is not rounded to paise on purchase (qty 3, total ₹100 is stored as
   100.00000000000001); sale rounds it (`packingAmount`).
5. Changing the vendor on a new purchase wipes every line; sale keeps them.
6. Staff dropdown shows "Name - null" for staff without a phone (sale fixed this).
7. View recomputes each line's tax and total in the browser from qty × rate × GST instead of
   showing the stored, rounded figures — can be paise off the bill's own totals. Sale shows
   what is stored.
8. View offers Mark as Paid on an "Other" purchase; the payment API then refuses it with
   "Missing required fields". Sale hides the button for "Other".
9. View money shows without paise ("₹1,180.5"); sale formats ₹1,180.50.
10. List export: the Vendor column reads `customer_vendor_name`, which does not exist — the
    exported vendor column is blank.
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

| # | Question | Today | Recommended |
|---|---|---|---|
| Q1 | Purchase freight in the bill total? | Stored, not in total | Ask — depends on whether freight is paid to the vendor or to the transporter |
| Q2 | Purchase number | Prefilled, editable | Server-assigned and read-only like sale (fixes bug 1) |
| Q3 | Lowering / deleting a purchase whose units are already sold | Allowed, stock goes negative | Refuse with "only N in stock", like sale |
| Q4 | Purchase list default order | Number, oldest first | Date, newest first, like sale |

Smaller defaults I will take unless overruled: vendor change keeps lines (5); P&F rounded like
sale (4); "Other" option in the purchase vendor filter (11); after a save or delete every
screen refreshes (15); return links on both views say "View Return" (18).

## 5. Order and checks

B1 server: `lib/purchase-create.ts` + `lib/purchase-delete.ts` + thin purchase routes, the
Q1–Q3 rules → B2 `hooks/useBills.ts` → B3 `BillList` → B4 `BillView` + `BillPaymentModal` →
B5 `BillForm` → B6 thin pages, delete the old files → B7 checks: tsc, next build, every server
suite, page tests 3–10 plus a new test11 (all three kinds: list, view, create, edit, pay,
delete), `audit-assert` on seeded data → docs, line counts, commit per step.
