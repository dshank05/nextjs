# Reports audit (Phase 7)

Owner request 2026-10-03: "the reports section built" — audit every report, build the
missing ones (Purchase, Opening / Closing Stock), and add return registers, a GST summary,
a cash / bank book and profit by period.

## Inventory (before)

| Sidebar entry | State before | After |
|---|---|---|
| Customer Ledger / Vendor Ledger | working (Phase 5 Block D: one route, opening balance, F-03 fixed) | unchanged |
| Vendor Balance Logs | working (Block D) | unchanged |
| Customer Balance Logs, Customer Reports | working, **not in the sidebar** | in the sidebar |
| Vendor Reports (outstanding + debit notes) | outstanding from the stored balance of the latest row; debit-note vendor filter broken | R-01, R-03 |
| Sale | **showed nothing**: page and API had different contracts | rebuilt (R-04) |
| Sale X | lines matched by printed number | rebuilt as Invoice C (R-05) |
| Purchase | **404** — no page | built (R-06) |
| Debit Notes | vendor filter, dates, debug query | R-03 |
| Minimum Stock | fixed in Phase 3 | unchanged |
| Mechanic / Staff Sale, Commissions, Transport Cost, Packing / Forwarding | **any date range returned nothing** | R-07 |
| Bill Reference Sale / Purchase | fixed in Block D | unchanged |
| Notes Mentioned | **every search a 500** | R-08 |
| Opening / Closing Stock | "under works" stub | to build (R3) |
| Dead Stock, Inactive Products | entry / settings pages linked here | unchanged |

## Findings fixed (R1)

| ID | Sev | Report | Finding |
|---|---|---|---|
| R-01 | Critical | Customer / vendor outstanding | **F-47 settled**: balance = `SUM(debit) - SUM(credit)` of the party's ledger up to the end of the range (`lib/party-outstanding.ts`), the same rows the ledger report shows. The customer report used the payment counters, which never include a bill's total — an unpaid bill did not appear and an advance showed as a debt. The vendor report used the stored running balance of the latest row. Negative balances (advances, unrefunded returns) are shown; totals owed / credit over all matching parties |
| R-02 | Medium | Customer outstanding | Last-transaction links used transaction types that are never written (`SALEX`, `PAYMENT`, `RETURN`): no link ever appeared |
| R-03 | High | Debit notes | The vendor dropdown sends an id, matched against the vendor NAME: picking a vendor found nothing. A debug query of the whole table ran on every request. Dates needed both ends. Totals added |
| R-04 | Critical | Sale | Page sent `dateFrom/dateTo/sale|salex|both` and read `summary`; the API read `startDate/endDate/summary|customer|product|detailed` and answered `data`: the report was always empty. The API's product query used PostgreSQL syntax and a non-existent join; its customer query interpolated SQL as a bound value; end dates excluded the last day |
| R-05 | High | Invoice C | Lines were fetched by the printed number (`invoice_no IN bill.invoice_no`) instead of the bill id: other years' and other bills' lines. UTC dates |
| R-06 | High | Purchase | The sidebar link was a 404 |
| R-07 | Critical | Mechanic, Staff, Commissions, Transport, Packing | The date picker sends `YYYY-MM-DD`; the APIs did `parseInt()` on it (2026), so any date range matched nothing |
| R-08 | Critical | Notes Mentioned | `mode: 'insensitive'` is PostgreSQL-only: every search was a 500. UTC dates |
| R-09 | Medium | Credit notes | Sort on an unknown field (`balance`, sent by the page) and a comparator that never returned 0: random order. UTC dates. Totals added |

Sale, Invoice C and Purchase now share `lib/bill-report.ts` and
`components/reports/BillReport.tsx`: bills, total, taxable value, GST (CGST / SGST / IGST),
returns dated in the period and the net, cash / bank by bill mode, paid / partial / unpaid,
top customers or vendors, top products, day-by-day in India days.

## Checked

`rptcheck` (SQL run against an in-memory SQLite copy of the fixtures): 16/16 — month
boundaries, GST split, returns and net, Invoice C lines by id, sale + Invoice C merge, purchase,
ledger-sum outstanding against a deliberately wrong stored balance, advances negative.

## R3 — Opening / Closing Stock (built)

`lib/stock-report.ts`, `/api/reports/opening-closing`, `pages/reports/openingclosing.tsx`.
Per product for a range: opening quantity, purchased, purchase returns, sold (sale + Invoice C),
sale returns, dead stock, closing quantity; opening and closing value at the last purchase
rate on or before each date (fallback: the product's latest purchase rate, then opening rate).

Built from the documents, not from `product.stock` (stock is set only at creation and then
moves only with documents, F-75). A product whose stored stock does not equal what its
documents add up to is flagged with the difference — older data or a direct database change.
A product created inside the range brings its opening stock in as "new products", not as
opening.

Checked: `stockcheck` 10/10.

## R4–R7 — new reports

| Report | Page / API | What it shows |
|---|---|---|
| Return Register | `/reports/returns`, `lib/return-register.ts` | Sale, Invoice C and purchase returns in a period: note no, party, bill, items, taxable, GST, P&F / freight, refund, status; totals per kind, settled vs waiting |
| GST Summary | `/reports/gst`, `lib/gst-report.ts` | Output tax (bill heads, B2B by the bill's GSTIN / B2C), less credit notes; input tax less debit notes; net per head (payable or credit carried); sales and purchases by rate; HSN summary (export); Invoice C as non-GST supplies; line-vs-head rounding shown |
| Cash / Bank Book | `/reports/cash-book`, `lib/cash-book.ts` | Every recorded receipt / payment (customer and vendor payments and refunds, returns marked complete) by day, cash, bank or both, running balance, brought forward from earlier records. Carried-advance bookkeeping rows are left out |
| Profit by Period | `/reports/profit`, `lib/profit-report.ts` | Net sales (ex-GST, after discount, less returns) minus cost at the last purchase rate on or before each sale; by month; most profitable and below-cost products |

All four are in the sidebar under REPORTS. Checked: `rpt2check` 18/18.

Limits stated on the pages: no opening cash entry exists (brought forward = earlier records);
profit excludes freight, packing and expenses; GST rate / HSN tables add up lines and can
differ from the heads by the F-34 rounding.
