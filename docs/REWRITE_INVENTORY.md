# Rewrite inventory — what each screen shows and calls today

Read in full before rewriting (owner request 2026-10-03: "did you read their html first,
they might show conditional data or load conditional APIs"). The rewrite must keep every
item below unless it is listed as a bug.

## Transactions — create / edit form

Files: `pages/customer-transactions/create.tsx` (1,087), `pages/entry/vendor-transaction.tsx` (926).

| | Customer | Vendor |
|---|---|---|
| URL / edit | `?edit=<id>&type=income\|expense` | same, on `/entry/vendor-transaction` |
| Party select | customers `/api/customers?dropdown=true` (`billing_name`) | vendors via `useVendors` (`vendor_name`) |
| Direction radios | RECEIPT (Receive from Customer) = INCOME; PAYMENT (Pay Customer) = EXPENSE | PAYMENT (Pay Vendor) = EXPENSE; RECEIPT (Receive Refund) = INCOME |
| Payment-type radios | only for the payment direction (INCOME): "Invoice Specific / Mixed / On Account" | only for EXPENSE: "Bill Specific / Mixed / On Account" |
| Refund direction | forced DIRECT on selection; on-account panel + `PendingReturnsHint` | same |
| Date / Amount / Mode / Notes | date input (session-stored), number, Bank(1)/Cash(0) select default Bank, textarea | same |
| Bills to allocate | `/api/sales` + `/api/salex` `?customer=&limit=1000&sortOrder=asc`, kept if `remaining_amount > 0` (all in edit) | `/api/purchases?vendor=&limit=1000&sortOrder=asc` (`useOutstandingBills`), `remaining_amount > 0` |
| Bill label | `SINV-n`, Invoice C as `C-n` + purple "Invoice C" badge | `n` |
| Returns table (legacy refunds with allocations, edit only) | `/api/sale-returns?customer=` | `/api/purchase-returns?vendor=` (`useOutstandingReturns`) |
| Allocation section shown when | party selected and direction chosen | same |
| — DIRECT | blue on-account panel, text per direction | same |
| — else | Auto Allocate / Clear All buttons; loading spinner; "No outstanding …"; yellow "enter Amount" note when amount empty; table: no, date, total, paid, outstanding, allocate input (max = outstanding, disabled without amount) | same |
| Summary (non-DIRECT with rows) | Allocated, Difference (green / red border; Unallocated / Over-allocated), Total | same |
| Edit load | full-screen "Loading Transaction Data" overlay; session cache `customer-payments` / `customer-refunds` keyed by id, else GET `/api/customer-payments/:id` or `/api/customer-refunds/:id`; allocated rows merged with fresh bills, outstanding = fresh + own share | GET via `useVendorTransaction`; same merge; no overlay |
| Edit-mode fields | type, amount, mode, date (from timestamp), notes, allocations | same |
| Validation | DIRECT: none; BILL_SPECIFIC: no row over outstanding, allocated = amount; MIXED: 0 < allocated ≤ amount; at least one allocation | same |
| Confirm modal | three message variants (DIRECT / MIXED / BILL_SPECIFIC) with counts | same, "bill(s)" |
| Submit payload | `customer_id, payment_* / refund_*, allocations [{invoice_id \| invoicex_id, allocated_amount, notes}], fy` | `vendor_id, …, allocations [{purchase_id, …}], fy` |
| After save | snackbar, go to `/customer-transactions/view/:id?type=` | `/vendor-transactions/view/:id?type=` |
| Session keys | `customer-transaction-customer`, `customer-transaction-date` (cleared on leave) | `vendor-transaction-vendor`, `vendor-transaction-date` |
| Other APIs | `/api/financial-years` (current FY) | same |
| Cancel | `router.back()` | same |

Rewrite notes (2026-10-03, `components/transactions/PartyTransactionForm.tsx`):
- Kept: every label, radio order, hint text, warning, the three confirm messages, the
  payloads, the session keys and the redirect. (The vendor Record button was already
  disabled while saving — the earlier note was wrong.)
- Edit, both parties: the overlay shows until the transaction is loaded (vendor had none);
  the cached detail from the view is used when present.
- Edit, payment side: only bills with money left plus this payment's own bills are listed
  (customer edit listed every bill, including fully paid ones the server would refuse).
- Edit, old refund put against returns: its rows can be kept or reduced (the server's rule);
  Auto Allocate no longer offers the return's whole total.
- Switching the direction clears the allocations, as before; the refund side is always
  On Account for new refunds.

## Transactions — view

Files: `pages/customer-transactions/view/[id].tsx` (334), `pages/vendor-transactions/view/[id].tsx` (279).

- `?type=income|expense` picks payment or refund endpoint (customer income = payment;
  vendor expense = payment).
- Banner "RECEIPT/PAYMENT Transaction #id • party" (customer: income green / expense blue;
  vendor: expense blue / income green).
- Four columns: total, id, date, mode (customer computes Cash/Bank; vendor uses
  `*_mode_text`), type badge, FY · party name, contact, email · allocated, count,
  difference ("Fully Allocated" / "Advance" / "On account") · notes.
- Edit button caches the detail in session storage and opens the form in edit mode.
- Allocation table: customer — invoice `INV-n` / `C-n` linked to the bill, or credit note
  linked to the return, kind label; vendor — `INV-n` + **Bill Reference column** (payments
  only), or debit note; date, total, allocated, status badge (Unpaid / Paid / Partially Paid);
  total row.
- Loading spinner; error text.
- Rewrite: vendor allocations now link to the bill / return like the customer's; the
  customer payment shows contact and email (the GET now returns them).

## Transactions — list

Files: `pages/customer-transactions/index.tsx` (610), `pages/vendor-transactions/index.tsx` (611).

- Party select required before anything shows (empty-state card).
- Filters after selection: date range (session-stored, default this month), mode, type
  (Bill Specific / Return Specific / Mixed / Direct), direction (order: customer income
  first, vendor expense first), Clear (back to this month).
- Totals strip (income / expense / net); "Showing x to y of z"; table: S.N, ID (sortable),
  bill / note numbers (first 3 + "+n more", "Direct" when none), date, party, amount, type
  badge, mode, payment type, view + delete; pagination with first / last.
- Export menu (customer and vendor); create button (customer `/customer-transactions/create`,
  vendor `/entry/vendor-transaction`).
- Delete confirmation; session keys `*-transactions-customer|vendor`, `-dateFrom`, `-dateTo`
  cleared on leave.

## Sidebar (all sections)

`components/Layout.tsx` + `Sidebar.tsx`. ENTRY holds Sale Return, Purchase Return,
Customer Transaction, Vendor Transaction, Dead Stock, Customer / Vendor Details. A sub-entry
was lit only on its exact list URL, and the menu opened by prefix. Now `subpageMatches`
lights the entry on its list, view and create / edit screens (`also` lists screens outside
the list's path), and a top-level entry (Purchase, Products, Invoice…) stays lit on its
`/view` and `/create` screens unless a menu entry claims the screen.
