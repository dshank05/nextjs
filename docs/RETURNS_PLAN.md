# Returns rewrite — plan

Status: **done** (2026-10-03) — see Progress at the end; decisions in section 5. Step R of `docs/REWRITE_PLAN.md`, done the
same way as the transaction screens: every screen read in full first (below), one shared
implementation for the customer and vendor twins, behaviour kept unless a bug is named,
each step type-checked, built and tested before its commit.

Database: nothing to run. Purchase returns need P4-11 (`purchase_items.purchase_id`), which
is in; sale returns need nothing new. No data changes.

## 1. What the six screens do today

### Entry points

| | Sale return | Purchase return |
|---|---|---|
| Sidebar | ENTRY → SALE RETURN (`/entry/salereturn`) | ENTRY → PURCHASE RETURN (`/entry/purchasereturn-vendor`) |
| Lit on view / create (fixed today) | yes | yes |
| Linked from | customer report (credit notes), cash book, return register, outstanding, Pending-returns hint | purchase view (its returns), debit-notes report, vendor report, cash book, register, outstanding, hint |
| Deep links the form accepts | `?customer=` (unused), `?invoice=<sale id>` (nothing links to it; sale only, not Invoice C), `?id=&type=` edit | `?vendor=` (read, never used), `?id=` edit |

### List

| | Sale (`salereturn.tsx`, 535) | Purchase (`purchasereturn-vendor.tsx` 139 + `PurchaseReturnTable.tsx` 703) |
|---|---|---|
| Filters | Return No, Invoice No, Customer (text), Items Qty, Date, Payment Mode, Return Status (Complete / Pending), Clear | Return No, Invoice No, Vendor (dropdown), Items Qty, Date, Payment Mode, Return Status (Complete / Pending), P/F, Clear |
| Columns | S.N, Return No, Invoice No, Customer, **Type** (Sale / "Salex"), Items Qty, Total, Date, Payment Mode, Return Status, view / delete | S.N, Return No, Invoice No, Vendor, Items Qty, Total, Date, Payment Mode, Return Status, **P/F**, view / delete |
| Sortable | Return No, Invoice No, Customer, Items Qty, Total, Date | same + Payment Mode, Status, P/F |
| Export | Excel / PDF, 10 columns | Excel / PDF, 11 columns (+ P/F) |
| Filters kept | session (`sale-returns-page-filters`) | session (`purchase-returns-page-filters-v3`) |
| Delete | confirm → DELETE, list refreshes | confirm → raw fetch DELETE, then "re-apply filters" |

### View

| | Sale (`salereturn/[id].tsx`, 302) | Purchase (`purchasereturn-vendor/[id].tsx`, 479) |
|---|---|---|
| Banner | green, "Return #no • customer" | red, "Return #no • vendor" |
| Columns | Total, Items, Return #, Date, Status (Complete / Incomplete) · Customer, GSTIN, Address · Items Total, Tax, CGST / SGST / IGST (only when tax) · Notes | same, vendor · plus **Packing & Forwarding** (only shown when there is tax) |
| Actions | Edit (caches the detail as `sale-returns` / `<type>-<id>`) | Export Excel / PDF (layout export), Edit (caches `purchase-returns` / `<id>`) |
| Lines table | SN, Product (+ part), Invoice No, Qty, Rate, Tax % / Tax (when tax), Subtotal, Reason (+ notes), totals row | same + **Bill Ref** column |
| Other | — | Refund-history and quick-refund modals mounted, their buttons commented out |

### Create / edit

| | Sale (`salereturn-create.tsx`, 1,194) | Purchase (`purchasereturn-vendor-create.tsx`, 947) |
|---|---|---|
| Header | "Create / Edit Sale Return from <customer> \| Return ID" | same, Purchase / vendor |
| Party picker | customers "name (state)" | vendors "name (state)" |
| Fields | Return Date; Payment Status "Unpaid (Pending Refund) / Paid (Refunded)"; Mode and **Payment Date** (disabled while unpaid) | Return Date; Return Status "Incomplete (Unpaid) / Complete (Paid)" (sets payment date to today); Mode (always on); **no payment date field** |
| Bill search | server, invoice no / bill ref | server, invoice no / bill ref |
| Item search | client side | server and client side |
| Date range | default **3 months**, **Load More Bills** (3 months earlier), Prev / Next pages | default **1 month**, first 50 bills only ("pagination not implemented yet") |
| Focus View | yes | yes |
| Bill row | Bill #no · ref · date · total · Tax badge · x/y items available · Outstanding | same, no Outstanding |
| Line | Product (+ part), Available, Return Qty (≤ available), Price (≤ the line's net price), Reason, Total | same + "Fully Returned" badge, "Already returned x / y", qty disabled when fully returned; Tax % column when any bill has tax |
| Summary | Items, Quantity, Value (tax hidden: `enableTax = false`) | Items, Quantity, Subtotal, Tax (when tax), **P&F input**, Total; tax breakdown |
| Checks before confirm | at least one line | at least one line; return qty ≤ current stock per product; no negatives |
| Confirm | "Process return for n items totaling ₹x?" | same + "(including P&F: ₹y)" |
| After save | snackbar, **to the list** | snackbar, **to the view** |
| Payload | `{customer_id, return_type:'custom', return_date, return_notes, payment_status, payment_mode, payment_date, items:[{invoice_item_id, invoice_type, return_qty, return_reason_id, unit_price, notes}]}` | `{vendor_id, return_date, return_notes, payment_status, payment_mode, payment_date, packing_forwarding_amount, items:[{purchase_item_id, return_qty, return_reason_id, unit_price, tax_rate, notes}]}` |
| APIs | `/api/customers?dropdown=true`, `/api/sale-returns/reasons`, `/api/sale-returns/customer-items`, `/api/sales/:id` (invoice mode), `/api/sale-returns/:id?type=`, POST `customer-return`, PUT `:id` | `/api/vendors?dropdown=true`, reasons, `/api/purchase-returns/vendor-items`, `/api/purchase-returns/:id`, POST `vendor-return`, PUT `:id` |

## 2. Bugs found while reading (screens, then hooks and types)

Each gets a test that fails before the fix.

**Sale return list**
1. Return Status filter checks `sale_returns.status`, a text column that new returns leave at
   "Pending" forever. "Complete" finds nothing and "Pending" finds everything. The column next
   to it shows the payment status. Fix: filter on `payment_status`, as purchase does.
2. Typing a customer name sends it as the search too, and the server searches only the
   return id and notes, so a customer search finds nothing unless the name is in the notes.
3. Invoice No filter is sent as that same search and matched against the **return** id.
4. Items Qty and Payment Mode filters are never sent.
5. Sorting by Return No, Invoice No or Items Qty silently sorts by date.
6. Type badge says "Salex"; everywhere else it is "Invoice C".

**Purchase return list**
7. After a delete the table does not refresh: re-applying the same filters does not change
   the query key. (Purchase list also sends `search` twice.)

**Views (both)**
8. CGST / SGST / IGST always show ₹0: the lines are rebuilt without those fields and
   `sum + x || 0` adds nothing.
9. Purchase view: **Bill Ref** shows the bill number again, not the bill reference.
10. Purchase view: Packing & Forwarding is hidden on a return without tax.
11. Money shown unformatted (₹1234.5 next to ₹1,234.50).

**Purchase create / edit**
12. Edit cannot keep a line's quantity: "available" counts this return's own units as
    already returned, so the box clamps to what is left after it; and the bill list hides a
    bill this return fully returned (`return_status ≠ 2`), so its lines disappear from the
    screen while still being sent. (Sale edit uses the return's own bills and does this right.)
13. Only the first 50 bills of the range can ever be picked (no paging).
14. Tax preview splits CGST / SGST on the vendor's state *name* equalling "Uttar Pradesh"
    (sale side the same on customer state). The server decides; the screen can show the
    server's split instead of guessing.

**Dead code**
15. `POST /api/purchase-returns/:id/payment` changes a return's payment status without any
    ledger entry; nothing in the app calls it except the commented-out quick-refund button.
    `QuickRefundModal` posts a refund against a return, which the server now refuses
    (REFUND_VIA_RETURN). Both modals and the route go.
16. `?customer=` / `?vendor=` deep links are read but do nothing; `?invoice=` works for a
    sale bill but nothing links to it.

**Hooks and types** (`hooks/useSales.ts` return half, `hooks/usePurchases.ts` return half,
`types/sales.ts` and `types/purchases.ts` return types — read after the screens, 2026-10-03)
17. Saving or deleting a return refreshes only the returns list. The bill it came from
    (return status, payment status), product stock, the party's balance and transactions,
    and the ledgers stay stale until they refetch on their own. A deleted sale return's
    view stays cached too.
18. Editing a return wipes every line's note: both forms send `notes: item.return_notes || ''`,
    and nothing fills `return_notes` — the note the view shows is never loaded into the form.
19. Purchase list hook: `status` is computed as `ret.status === 'Completed'` on a numeric
    column (always 0), and `refund_amount` falls back to `total + tax`. Neither is shown,
    but both are wrong if used.
20. Purchase hooks throw "Failed to fetch purchase return" and drop the server's message;
    the sale hooks show it.
21. `useCreatePurchaseReturn` puts the create response into the view's cache under a numeric
    id; the view reads a string id with a different response shape, so it never matches —
    and would break the view if it did.
22. Unused: `useCustomerBills` (the sale form fetches bills itself); the purchase view caches
    the return for edit under `purchase-returns`, which the purchase form never reads;
    filter fields in `SaleReturnFilters` that are never sent.

The new `hooks/useReturns.ts` replaces both return halves and the return types; its save and
delete refresh the bills, products, party, transactions, ledgers and reports for that party.

## 3. The rewrite

Same shape as transactions: config per party, one component each, pages become one-liners.

```
hooks/useReturns.ts                     list, detail, bills-for-return, reasons, save, delete
components/returns/ReturnList.tsx       filters, table, export, delete
components/returns/ReturnView.tsx       banner, summary, lines, edit, export
components/returns/ReturnForm.tsx       party, dates, status, bill picker, lines, summary, confirm
components/returns/BillPicker.tsx       the expandable bill / line table (the biggest shared piece)
```

Per-party config: labels and colours, endpoints, payload builder, id key (`sale` needs
`type`), extras (`Type` column and Invoice C for customers; P/F field, column and stock
check for vendors; Bill Ref column for vendors; Export on the vendor view).

Server, so both sides answer the same questions:
- `pages/api/sale-returns/index.ts`: filters on payment status, invoice number, customer
  (id or name), items qty, payment mode, return no (SR- / SXR- / number); sorts on every
  column the screen offers. Reuses the purchase list's merge-then-page approach.
- Purchase routes onto `lib/purchase-return.ts` like `lib/sale-return.ts` (create, update,
  delete, detail with `available_qty` apart from this return). `[id].ts` 761 and
  `vendor-return.ts` 354 lines become thin. Vendor ledger conventions unchanged.
- `vendor-items`: an `exclude_return` parameter for edit, paging honoured.
- Remove `purchase-returns/[id]/payment.ts`, `QuickRefundModal`, `RefundHistoryModal`.

## 4. Order

| Step | What | Checked by |
|---|---|---|
| R0 | Server: sale list filters / sorts, purchase edit availability, vendor-items paging, dead route removed | new server suite `out-rlist` + existing `out-ret`, `out-vret` |
| R1 | `hooks/useReturns.ts` | type-check |
| R2 | `ReturnList` + both list pages | page suite test9 (filters, sort, delete refresh, export columns) |
| R3 | `ReturnView` + both view pages | test9 (tax split, Bill Ref, P&F, edit cache) |
| R4 | `BillPicker` + `ReturnForm` + both create pages | test9 (create, edit keeps quantities, price ceiling, stock check, P&F, confirm text, redirect) |
| R5 | Purchase return routes onto `lib/purchase-return.ts` | `out-vret`, `out-ret`, reports e2e test7, test9 |
| R6 | Inventory and plan docs, line counts, commit | — |

Every step: tsc, `next build`, all server suites, test3–test9. One commit per step.

Size today: screens 4,299 lines (six pages + `PurchaseReturnTable`), purchase-return routes
2,141. Expected after: screens ~1,600, purchase routes ~500 plus ~400 in the lib.

## 5. Owner decisions (2026-10-03)

1. **After saving a return** → the return's view, both sides.
2. **Bills on the create screen** → 3 months, "Load More" and paging, both sides.
3. **Payment date** → the field on both, enabled when the return is marked refunded
   (suggested; owner did not object).
4. **Status words** → "Pending refund" / "Refunded" on every list, view and form.
5. **Tax on the create screen** → the tax column and the server's CGST / SGST / IGST split on
   both when the bill has tax (suggested; owner can still say keep it hidden on sale).
6. **"Create return" button** on the Sale, Invoice C and Purchase views, opening the return
   screen with that bill expanded (`?invoice=<id>&type=` / `?purchase=<id>`).

## Progress

| Step | Commit | Lines | Checked by |
|---|---|---|---|
| R0 + R5 server: one list for both kinds, purchase routes onto the lib | 427262e | routes 1,963 removed, 801 added (lib/return-list.ts, lib/purchase-return.ts) | new `out-rlist` (26), `out-ret`, `out-vret`, all suites |
| R1–R4 hooks, list, view, form, bill picker; Create return buttons | (this commit) | 6 pages + PurchaseReturnTable + 2 modals + return hooks / types: 5,632 → 1,953 (pages are 5–6 lines) | tsc, `next build`, 17 server suites, test3–8, new test9 (49 checks: both sides, list / view / create / create-from-bill / edit / delete, real API handlers) |

Notes on what changed on screen (all named above): one set of status words; sale save
goes to the new return (several bills → the list); payment date on both sides; tax column
and preview on both; Invoice C bills shown as C-n with a badge; party locked while editing;
an edit shows only the return's own bills; a refunded sale return's Edit is disabled (the
server refuses it); line notes carried through edits; every cache refreshed after a save
or delete. The form shows tax as a total, not the CGST / SGST / IGST split — the view shows
the stored split.
