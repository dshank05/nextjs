# Purchases — P4-15 edit sweep and Second Pass (code quality)

> Status: **assessment complete, nothing fixed yet.** Money-handling code is not changed
> without the owner's go-ahead. The point of this document is the decision the owner asked
> for: *where does a rewrite score a major win, so that the bugs inside the rewritten code
> do not need fixing one by one?*

## 0. Scope and method

Same method as `PRODUCTS_PASS2_AUDIT.md`: files read in full, findings tagged **[C]**
(confirmed in code) or **[V]** (needs a live check). Pass 1 (data flow, `JOURNEY_AUDIT.md`
§3/§4, P4-01…P4-32) already rebuilt the money path of **create**; this is the first time the
**edit**, **view**, **list** and **report** paths have been read end to end, so the §11 sweep
(P4-15) and the code-quality pass are done together.

### Coverage — 10,194 lines in the module

| Layer | File (lines) | Read |
|---|---|---|
| Rules | `lib/purchase.ts` (299) | full |
| API | `api/purchases/index.ts` (1,013), `[id].ts` (1,243), `last-invoice.ts` (55) | full |
| Handler | `lib/transaction-handler.ts` (1,721) | delete half (940–1721) in full; edit half by call site only |
| Hook | `hooks/usePurchases.ts` (484) | full |
| Pages | `purchases/create.tsx` (3,075), `view/[id].tsx` (811), `index.tsx` (172) | full |
| Components | `transactions/PurchaseTable.tsx` (885) | filters/props only — read in full in Block 4 |
| Reports | `bill-reference-purchase` (85), `vendor-ledger-accounting` (116), `vendor-outstanding` (189), `vendor-balance-logs` (137) | full |

Where the money now lives: create and update both compute every total and the GST split on
the server (`computePurchaseTotals`, P4-12) — the browser's totals are ignored. That is why
several client defects below are **display** defects, not stored-data defects.

## 1. Summary — the verdict

**Yes, there are major wins, and they line up with where the bugs are.** 34 defects; 25 of
them sit in four places that are worth rewriting rather than patching:

| Block | What gets rewritten | Size now → est. after | Defects it removes |
|---|---|---|---|
| **A. Line editor** (`create.tsx`) | One `PurchaseLines` component + one `lib/line-math.ts` (qty/rate/total/GST both ways, the rule the sale page already gets right). The tax/no-tax inline branches are two copies of the same 270 lines; the template row is a third | 3,075 → ~1,300 | PU-05, 06, 07, 08, 09, 10, 11, 12, 13 |
| **B. Edit API** (`[id].ts` PUT) | Replace the per-field diff with "compute lines via `computePurchaseTotals`, then reconcile stored lines by line id": update every column of a kept line, keep `fy`, keep stored values for absent fields | 1,243 → ~650 | PU-14, 15, 16, 17, 18, 19, 20, 21 |
| **C. List** (`index.tsx`, `PurchaseTable`, GET `/api/purchases`) | Onto `useListQuery` + `lib/api/list-query.ts`, exactly as settings and products were | ~2,070 → ~1,100 | PU-22, 23, 24, 25 |
| **D. Reports** (vendor ledger / outstanding / bill-ref / balance logs) | One shared date-range + pagination helper; outstanding = latest balance per vendor | 527 → ~350 | PU-26, 27, 28, 29 |

**Fix now, no rewrite** (small, and two are serious): PU-01 (delete ignores `fy` —
**Critical**), PU-02, PU-03, PU-04 (cache key), PU-30…34.

**The biggest win is bigger than purchases.** Vendor and customer sides are hand-kept copies:
`transaction-handler` 1,721 / `customer-transaction-handler` 1,670, `ledger-handler` 574 / 559,
`balance-handler` 612 / 595, `ledger-service` 335 / 696, three ~885-line tables, three
2,400–3,000-line create pages, three ~900–1,250-line `[id]` APIs. The copies have drifted —
purchase got the P4 money fixes, sale and salex did not (§4). One party-parameterised "bill"
module (vendor | customer) would delete roughly 6–8k lines. **Recommendation: do A–D on
purchase now, shaped so sale/salex can adopt them in Phase 5; decide the full merge after
the sale pass**, when both sides have been read.

## 2. Defects

Sev = effect on stored data or what the user is told. **Disposition**: *Fix now* = small
standalone fix; *Block X* = removed by that rewrite, do not patch separately.

| ID | Sev | Conf | Finding | Evidence | Disposition |
|---|---|---|---|---|---|
| PU-01 | **Critical** | [C] | **Deleting a purchase deletes other years' purchases with the same number.** `executeStockRestore` and `executeDeleteRecord` find `purchaseitems` and `bill_to` by `invoice_no` only. Deleting #12 of 2026-27 also decrements stock for #12 of every other year, deletes those lines and their `bill_to`, and cascades into their purchase returns, return items and DEBIT_NOTE rows. The F-08/L-1 class; P4-10 fixed `[id].ts`, this path lives in the handler | `transaction-handler.ts:1284-1287, 1455-1494` | **Fix now** (add `fy`; ~6 lines) |
| PU-02 | High | [C] | **Deleting a partly returned purchase removes the returned stock twice.** The return already decremented the returned qty; delete decrements the full original qty, then deletes the return without adding its qty back | `transaction-handler.ts:1281-1326, 1455-1494` | **Fix now** (or refuse delete while returns exist — what salex does) |
| PU-03 | High | [V] | Returns removed by that cascade leave their refunds behind (`refund_allocations`, `vendor_refunds`, REFUND_RECEIVED rows, vendor refund counters). May instead be a 500 if an FK blocks it | `transaction-handler.ts:1455-1494` | **Fix now** with PU-02 (refusing delete with returns settles both) |
| PU-04 | Medium | [C] | **After saving an edit, the view can show the old bill.** `useUpdatePurchase` invalidates `['purchase', 5]` (number); the view reads `['purchase', '5']` (router string) — different cache entries. Within the 30 s `staleTime` the pre-edit data is shown | `usePurchases.ts:414` vs `view/[id].tsx:160` | **Fix now** (key on `String(id)`) — same bug in sale and salex |
| PU-05 | High | [C] | **Inline edit with tax on: typing a total charges GST twice.** Total → `rate = total/qty` ignores GST and rounds to the rupee; the server then adds GST on top of that tax-inclusive rate. Rate edits do not recompute the total and `parseInt` drops paise | `create.tsx:2313-2318, 2372-2389` | Block A |
| PU-06 | Medium | [C] | **Editing a taxed purchase opens with "Enable Tax" off.** Nothing sets it from the loaded bill, so the tax effect zeroes every line's tax in the form, the tax column and totals are hidden, and the confirm dialog asks to "update this purchase for ₹X" where X excludes tax. The stored bill keeps its tax (server recomputes from `gst_percentage`) — the user confirms a figure that is not what is saved. Sale already does this right (`sale/create.tsx:367`) | `create.tsx:111, 462-517, 3049` | Block A |
| PU-07 | Medium | [C] | Template row: a blank or 0 rate silently becomes the product's **selling price** as the purchase rate | `create.tsx:2032` | Block A |
| PU-08 | Medium | [C] | Inline save keeps the typed line total, so the row shows qty × rate + tax ≠ total; the server ignores it and stores its own — two different numbers for one line | `create.tsx:838` | Block A |
| PU-09 | Medium | [C] | On submit, every line's `model_id` is taken from the **template row's** current car-model pick when one is selected; a model chosen but not added re-models every line | `create.tsx:1071-1089` | Block A |
| PU-10 | Low | [C] | Inline without tax: total → `Math.round(total/qty)` rate, so qty × rate ≠ total | `create.tsx:2512-2518` | Block A |
| PU-11 | Low | [C] | Status select offers only Unpaid/Paid; a Partially Paid (2) bill opens blank | `create.tsx:2876` vs `view/[id].tsx:285` | Block A |
| PU-12 | Low | [C] | `hasChanges` compares fields `originalData` never stored → always "changed"; the disabled-when-unchanged button never disables | `create.tsx:703-720, 935-980` | Block A |
| PU-13 | Low | [C] | Loaded line with no `product_id` becomes `category_id` or product **1**; per-row `console.log` in render; 13 logs total | `create.tsx:670, 2163` | Block A |
| PU-14 | High | [C] | **Changing only a line's GST % is not saved.** `needsUpdate` checks qty/rate/subtotal/name/car_model; the header totals use the new GST, the line keeps the old one → header ≠ lines | `[id].ts:868-872` | Block B |
| PU-15 | High | [C] | **Category / subcategory / company / model / part edits on a kept line are never saved.** The inline car-model edit in the form is silently lost | `[id].ts:993-1005`; `create.tsx:2215-2244` | Block B |
| PU-16 | Medium | [C] | Changing the bill date does not update `purchase_items.invoice_date` on kept lines → latest-rate and product history disagree with the header | `[id].ts:993-1005` | Block B |
| PU-17 | Medium | [C] | Duplicate products in one payload collapse to the last line in `newItemsMap`, but totals include both → header total includes a line that is not stored and never reaches stock | `[id].ts:822-842` | Block B |
| PU-18 | Medium | [C] | GST split uses the **master vendor's** state, while the same request writes the edited `bill_to` state → the document can show one state and be taxed on the other. The form does the same (`vendorStateForTax` from master) | `[id].ts:606-630 vs 714`; `create.tsx:231` | Block B |
| PU-19 | Medium | [C] latent | Absent `payment_status` is read as **Unpaid**; every header field absent from the body is written as null/0; `bill_to` falls back to master values and `pin_code` to `''`. The form always sends everything, so not reachable from the UI today — reachable by any other caller | `[id].ts:503-505, 706-716, 736-760` | Block B |
| PU-20 | Low | [C] | Two payment-mode defaults: GET says Cash (0), PUT says Bank (1) | `[id].ts:398, 507` | Block B |
| PU-21 | Low | [C] | GET: 500 returns `error.message`; multi-bill return count ignores `fy`; `isFullyReturned` true with 0 items; N+1 per return; 9 `console.log` | `[id].ts:438, 251, 196, 240-249` | Block B |
| PU-22 | High | [C] | **Four list filters do nothing.** The hook sends `billRef`, `items`, `taxAmount`, `pf`; the API reads `billReference`, `itemCount`, `totalTax`, `packingForwardingTotal` | `usePurchases.ts:18-22` vs `api/purchases/index.ts:39-43` | Block C |
| PU-23 | Medium | [C] | Date-range filter ends at 00:00 UTC of the end date — that day's bills are excluded | `api/purchases/index.ts:80-90` | Block C |
| PU-24 | Medium | [C] | Search does not reset the page (page 3 of a 1-page result = empty); filters are saved to session storage and deleted on unmount, so back-from-view loses them | `purchases/index.tsx:53-85` | Block C |
| PU-25 | Low | [C] | Sorting by vendor or item count loads **every** purchase into memory; item-count filter applied after paging (counts and pages disagree) | `api/purchases/index.ts:147-188, 361-388` | Block C |
| PU-26 | High | [C] | **Vendor ledger balances are wrong from page 2 on, and on any date-filtered view** — the running balance restarts at 0 per page and ignores everything before `dateFrom` | `vendor-ledger-accounting.ts:63-69` | Block D |
| PU-27 | High | [C] | **Vendor Outstanding lists ledger rows, not vendors.** Every row with balance > 0 — a vendor with 40 bills can appear 40 times, a vendor now at 0 still appears; `search` ignored | `vendor-outstanding.ts:34-95` | Block D (defn. is F-47) |
| PU-28 | High | [C] | **Bill-reference report 500s on every search** — `mode: 'insensitive'` is not supported on MySQL. End date excluded (00:00 UTC) | `bill-reference-purchase.ts:26-35` | Block D |
| PU-29 | Low | [C] | Balance-logs end date excluded; three reports return raw error text on 500 | `vendor-balance-logs.ts:77-81, 134`; `vendor-ledger-accounting.ts:113`; `vendor-outstanding.ts:183` | Block D |
| PU-30 | Medium | [C] | Cross-tab refresh never fires — the view checks `msg.id`, senders put it in `msg.data.id` (sale/salex views do it right) | `view/[id].tsx:175` | Fix now |
| PU-31 | Low | [C] | View items footer puts `items_total` (pre-tax) under the tax-inclusive Total column | `view/[id].tsx:637` | Fix now |
| PU-32 | Low | [V] | Edit loads from a SessionStorage snapshot, removed only after a successful save → opening `?edit=N` later can show a stale bill | `create.tsx` load; `view/[id].tsx:186` | Fix now (always fetch; the cache saves one request) |
| PU-33 | Low | [C] | Create: stock increments by `Math.round(qty)` while the line stores the exact qty (fractional qty drifts) | `api/purchases/index.ts:771` | Fix now — **ask** (money) |
| PU-34 | Low | [C] | `lib/purchase.ts`: `num()` is `parseFloat` ("12abc" → 12); unreachable `qty<0` line; rounding still unapplied (F-34) | `lib/purchase.ts` | Fix now (num) / F-34 owner |

## 3. Code quality — what each block replaces

**Block A — `create.tsx` (3,075 lines).** One component holding header, vendor, line editor,
P&F, totals, two modals and the product panel glue. Measured: ~250 lines of commented-out code
(an auto-select effect, three table columns, barcode test UI, P&F rate input); the inline
editor exists twice (with-tax / without-tax branches differ only in one column); the line
maths (qty ⇄ rate ⇄ total, GST) is written out in about a dozen places with four different rounding rules; two
effects rewrite `selectedProducts` from itself; the hard-coded `'Uttar Pradesh'` appears
three times although the server decides the split from the business GSTIN. Target: a
`PurchaseLines` component fed by `lib/line-math.ts` (one function per direction, GST-aware,
paise kept) — which sale and salex can use unchanged — and the page reduced to form state +
payload. The client should send **only** what the user typed (ids, qty, rate, GST %); the
cgst/sgst/igst/tax/total it sends today are ignored by the server anyway.

**Block B — `[id].ts` (1,243 lines).** GET (~440 lines) builds the view model inline with an
N+1 per return; PUT (~700 lines) re-implements line diffing by `product_id` and decides
column by column what to update. Target: `lib/purchase-read.ts` (one loader, used by GET and
the export layout) and `lib/purchase-edit.ts`: validate → `computePurchaseTotals` → reconcile
lines **by stored line id** (kept lines get every column, removed lines restore stock, new
lines take stock) → hand status/total changes to the transaction handler as today. Absent
fields keep stored values. `route()`/`respond` from the shared contract.

**Block C — list.** `index.tsx` + `PurchaseTable` + GET `/api/purchases` reproduce what
`useListQuery` and `lib/api/list-query.ts` already do for the settings and product lists, with their own
parameter names (which is how PU-22 happened). Two near-identical `findMany` selects;
date formatting computed and discarded; commented-out response fields. Target: the settings
pattern — one parser, SQL sort for vendor name via join, item count via subquery.

**Block D — reports.** Each report re-parses page/limit/dates its own way; two use the
`parseDateRange` helper and two do not. Target: shared parser + `respond`; outstanding from
the latest ledger row per vendor (or the vendor counters — F-47 picks which).

**Not a block, but noted:** `lib/transaction-handler.ts` uses `Promise.all` over one
transaction in four places (F-21 class) and has 14 `console.log`s; its delete half is fixed
in place by PU-01/02. Its edit half is read in Block B.

## 4. Sale / Salex twins — Phase 5 carry list

Checked by targeted reads of the matching code (the full sale pass is Phase 5). **Sale never
got the P4 server-side money work**, so several purchase findings are worse there, and three
are new:

| Purchase ID | Sale | Salex |
|---|---|---|
| PU-01 delete key | **Worse — Critical.** Route passes the human `invoice_no` to the customer handler, but sale lines store the header **id**. Deleting a customer sale restores stock for, and deletes the lines, returns and CREDIT_NOTEs of, the sale whose *id* equals this sale's number; its own lines are orphaned and their stock never returns (`sales/[id].ts:855`, `customer-transaction-handler.ts:1247-1462`) | **Broken — Critical.** Handler reads `tx['invoicexitems']`, a model that does not exist (`invoice_itemsx`) → every customer-salex delete is a 500; also uses `invoice_item_id` (salex field is `invoice_itemx_id`) and the human number |
| PU-02 returned-bill delete | same (no returns guard) | guarded ✓ (refuses when returns exist) |
| — **new** | **Edit rewrites `fy` to the current year** (`sales/[id].ts:571, 679`) — editing last year's bill moves it into this year; `(invoice_no, fy)` may collide. Purchase keeps `fy` ✓ | same (`salex/[id].ts:592, 697`) |
| — **new** | **Totals and tax trusted from the client** (`total_tax`, `total_cgst`… stored as sent; no validation of qty/rate) — the pre-P4-12 state | same; and `total_tax`/P&F/freight sent as **0** fall back to the old values in the grand total (`\|\|`), so total ≠ its parts (`salex/[id].ts:544`) |
| — **new** | `billing_address2` on edit always comes from the customer master — inline edit lost (`sales/[id].ts:732`) | writes body ✓ |
| PU-14/15 line edits | **Worse:** a kept line saves qty/rate/subtotal only, and only when **qty** changed — a rate-only edit is lost (`sales/[id].ts:694-712`) | same (`salex/[id].ts:712-730`) |
| PU-16 date on lines | same | same |
| PU-17 duplicate lines | same | same |
| PU-19 absent fields | same (status → 0, header fields written) | preserved ✓ |
| — qty below returned | no guard on edit | [V] |
| PU-04 cache key | same (`useSales.ts:320`) | same (`useSalex.ts:172`) |
| PU-05/06 tax editor | sale does it right (sets Enable Tax from data; total → rate divides by 1+GST) — **Block A copies sale's rule** | n/a (no tax; discount-aware ✓) |
| PU-07 selling price | correct for a sale ✓ | ✓ |
| PU-11 status select | same | same |
| PU-21 500 text | GET/PUT/DELETE all return `error.message` | same |
| PU-28 bill-ref report | same file covers both (`bill-reference-sale.ts:27-37`) | — |
| PU-26 ledger balance | same (`customer-ledger-accounting.ts:65`) | — |
| PU-27 outstanding | already per customer (F-45); definition still F-47 | — |
| PU-30 broadcast | correct ✓ | ✓ |
| Delete leaves bill_to/shipto/transport | customer path orphans them | same |

**What this means for the next turn:** Blocks A and B, written for purchase against a
party-neutral line model, are the code sale and salex should move onto; the sale/salex
Criticals (delete key, salex delete crash, `fy` rewrite) are small standalone fixes and should
not wait for the rewrite.

## 5. Proposed order, and what needs the owner

1. **Fix now (needs approval — money):** PU-01, PU-02/03 (recommend: refuse delete while
   returns exist, as salex does), and the sale/salex delete keys + `fy` rewrite from §4.
2. **Fix now (no money):** PU-04, PU-30, PU-31, PU-32, PU-34 (`num`).
3. **Block B** (server first, so the client rewrite has a correct target), then **Block A**,
   then **C**, then **D**. Commit per block; `tsc` + `next build` after each, as before.
4. Owner: PU-33 (round stock or allow fractional qty?), F-34 (GST rounding), F-47 (which
   "outstanding" is right).
