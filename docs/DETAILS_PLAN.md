# Customer / vendor details and dead stock — plan

Status: **done** (2026-10-03). Owner away ("do dead stock and details screen");
where the twins differ I chose, and every choice is in section 4 to overrule. Every screen
below was read in full first, with its API routes and hooks.

Database: nothing to run, no data changes.

## 1. What the screens do today

### Entry points

| | Customer details | Vendor details | Dead stock |
|---|---|---|---|
| Sidebar | ENTRY → CUSTOMER DETAILS (`/entry/customerdetails`) | ENTRY → VENDOR DETAILS (`/entry/vendordetails`) | ENTRY → DEAD STOCK and REPORTS → DEAD STOCK (`/entry/deadstock`) |
| Other links in | Sale / Invoice C form "+ Add New Customer" (`/customers/create?from=sale\|salex`, new tab) | Purchase form "+ Add New Vendor" (`/vendors/create?from=purchase`, new tab) | — |
| Screens | list, `/customers/view/[id]`, `/customers/create` (`?id=` edits) | list, `/vendors/view/[id]`, `/vendors/create` (`?id=` edits) | list + add / edit modal |

### List (`customerdetails.tsx` 186 + `CustomerTable` 242; `vendordetails.tsx` 166 + `VendorTable` 226)
Search (name, phone, email, city, GSTIN), items per page (10/25/50/100), export (8 / 7
columns), "Add" opens the create screen in a new tab; table S.No, UID, name (sortable),
contact (tel: link), email (mailto:), GSTIN / GST ID, city, State (customer only), status,
view. Refreshes when another tab creates or edits (broadcast).

### View (`customers/view` 261 via `useCustomer`; `vendors/view` 497 with raw fetch)
Overview (icon, name, phone) · GSTIN, State, Status, all contacts, Email · Activate /
Deactivate (confirm) and Edit · Billing section (customer) or Vendor Information · Shipping
section (customer, when set, each field falling back to billing). Vendor view carries ~300
lines of commented-out "recent purchases / payments / account summary" placeholders.

### Create / edit (`customers/create` 804; `vendors/create` 480)
Customer: Billing (name*, address 1*, address 2, city, pin, state*, GSTIN), Shipping with
"Copy from Billing" (same fields, required unless copied), Contact (number*, phone 2, phone
3, email). Vendor: one card — name*, address, address 2, city, pin, number*, phone 2,
phone 3, email, GST No, state*. Both: phone 10 digits starting 6–9, pin 6 digits, GSTIN 15,
email shape; confirm modal; after save: edit → view, create → list, or close the tab when
it was opened from a bill form. Cancel: customer back to the sale form it came from, else
the list.

### Dead stock (`deadstock.tsx` 78 + `DeadstockTable` 298 + `DeadstockModal` 324 + `useDeadstock` 42)
Search (product, reason, created by); table S.N, product (+ part), quantity, reason,
created date, edit / delete; Add modal: product (all products with stock), quantity,
reason; stock summary in the confirm; delete returns the units to stock.

## 2. Bugs found while reading

**Customer / vendor**
1. Creating a customer drops Phone 2, Phone 3 and status — the route never saves them.
2. Editing a vendor makes an inactive vendor active again: the form has no status and the
   route writes `status: body.status || 'Active'`.
3. The form's error snackbar reads the errors from before the check, so the first failed
   save says nothing.
4. Create / Update is never disabled while saving (`loading` is never set).
5. Customer form: a server refusal leaves the confirm modal open over the error.
6. Activate / Deactivate failures are only logged; the screen shows nothing.
7. List S.No restarts at 1 on every page; sorting by name sorts only the current page.
8. The server checks only required fields — phone, pin, GSTIN and email rules live only in
   the forms.
9. `DELETE /api/customers/[id]` and `/api/vendors/[id]` delete a party with bills, payments
   and ledger rows behind it (nothing in the app calls them).
10. Vendor list has no State column; customer list has one.
11. `customers/[id]` route is not wrapped in withObservability (vendors is).

**Dead stock**
12. Editing to a larger quantity checks `stock + old quantity ≥ increase` — stock can go
    negative (stock 2, old 5, new 9 is allowed and leaves −2). The modal checks it right.
13. The stock check on add runs outside the transaction.
14. Sort headers do nothing (`console.log`); items-per-page is passed but never shown.
15. Quantities accept fractions (step 0.01); every other movement is whole units (PU-33).
16. After add / edit / delete only the list refetches; product stock screens stay stale.

## 3. The rewrite

```
lib/party-details.ts           list, get (+ outstanding), create, update, status, delete — both parties
lib/deadstock.ts               list, create, update, delete — checks inside the transaction
hooks/useParties.ts            hooks/useDeadstock.ts (rewritten)
components/parties/PartyList.tsx  PartyView.tsx  PartyForm.tsx
components/deadstock/DeadstockList.tsx  DeadstockForm.tsx
```
Routes become thin; response shapes stay (`{customers|vendors, pagination}`, string ids,
`{message, customer|vendor}` on PUT). Pages become one-liners; URLs stay.

## 4. Decisions taken while the owner was away (overrule any)

1. Server validates what the forms validate (phone, pin, GSTIN, email) — the forms keep
   their checks for instant feedback.
2. Deleting a customer / vendor with any bill, payment, return or ledger row is refused
   (409) instead of deleting; without history it still deletes.
3. Status is kept on edit unless the form sends one.
4. Dead stock quantities are whole units, like purchases and sales.
5. The view shows the party's outstanding (ledger sum, F-47) with links to its ledger and
   transactions — in place of the commented-out placeholders.
6. Vendor list gets the State column; both lists sort on the server (name, city, state,
   status) so sorting covers every page.

## 5. Order and checks

D1 server (lib + routes) → D2 hooks → D3 list / view / form for parties → D4 dead stock →
D5 tests: server suite `out-party`, page suite test10, `audit-assert` A11 (dead stock
sanity) → docs, line counts, commit per step.

## 6. Progress

| Step | Commit | Lines |
|---|---|---|
| D1 server: `lib/party-details.ts`, `lib/deadstock.ts`, thin routes | 5da3df1 | +531 −1,324 |
| D2–D3 customer / vendor: `hooks/useParties.ts`, `components/parties/*`, six thin pages | 65a2c7a | +721 −2,895 |
| D4 dead stock: `hooks/useDeadstock.ts`, `components/deadstock/*`, thin page | 02a794c | +363 −763 |
| D5 `audit-assert` A11, this note | (this commit) | |

Customer / vendor details and dead stock together: 4,982 lines removed, 1,615 added.

Bugs 1–16 above are all fixed. Checks run:
- `tsc --noEmit` clean; `next build` passes.
- Server suite `out-party` (22 checks) and every earlier server suite pass.
- Page test test10 (58 checks): customer and vendor lists (server sort, S.No across pages,
  State column), views (outstanding, Ledger / Transactions links, status change shown),
  create / edit (first failed save lists its errors, Phone 2 saved, copy-from-billing,
  inactive vendor stays inactive on edit, server refusal closes the confirm), dead stock
  (fraction refused, stock checks, summary, add / edit / delete move stock).
  Page tests 3–9 still pass (3 and 5 need `TZ=Asia/Kolkata`, as before).
- `audit-assert` A11 (read-only): dead stock entries are positive whole units of an
  existing product with a reason; customer / vendor status is Active or Inactive; no bill,
  return, payment, refund or ledger row points at a missing customer or vendor. Checked
  against seeded good and broken data. Dead stock entered as a fraction before the
  whole-unit rule will be listed by A11 — those are for a look, nothing is changed.
