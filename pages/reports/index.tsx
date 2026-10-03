import Link from 'next/link'

/**
 * Reports home. It was a grid of cards whose buttons went nowhere; it now
 * lists every report, grouped.
 */
const GROUPS: { title: string; items: [string, string, string][] }[] = [
  { title: 'Sales & purchases', items: [
    ['Sale', '/reports/sale', 'Bills, GST, returns and net, top customers and products'],
    ['Invoice C', '/reports/salex', 'The same for Invoice C bills'],
    ['Purchase', '/reports/purchase', 'Bills, GST, returns, top vendors and products'],
    ['Return Register', '/reports/returns', 'Sale, Invoice C and purchase returns'],
    ['Profit by Period', '/reports/profit', 'Gross profit by month and product']
  ] },
  { title: 'Money & tax', items: [
    ['Cash / Bank Book', '/reports/cash-book', 'Receipts and payments with a running balance'],
    ['GST Summary', '/reports/gst', 'Output vs input tax, credit / debit notes, HSN summary'],
    ['Customer Reports', '/reports/customer-reports', 'Customer balances and credit notes'],
    ['Vendor Reports', '/reports/vendor-reports', 'Vendor balances and debit notes'],
    ['Debit Notes', '/reports/debit-notes', 'Purchase return notes']
  ] },
  { title: 'Ledgers', items: [
    ['Customer Ledger', '/reports/customer-ledger', 'One customer, with opening balance'],
    ['Vendor Ledger', '/reports/vendor-ledger', 'One vendor, with opening balance'],
    ['Customer Balance Logs', '/reports/customer-balance-logs', 'Every change to a customer’s counters'],
    ['Vendor Balance Logs', '/reports/vendor-balance-logs', 'Every change to a vendor’s counters']
  ] },
  { title: 'Stock', items: [
    ['Opening / Closing Stock', '/reports/openingclosing', 'Quantity and value for a period'],
    ['Minimum Stock', '/reports/minimumstock', 'Products below their minimum'],
    ['Dead Stock', '/entry/deadstock', 'Stock written off'],
    ['Inactive Products', '/settings/inactive-products', 'Products switched off']
  ] },
  { title: 'People & charges', items: [
    ['Mechanic Sale', '/reports/mechanic', 'Sales by mechanic'],
    ['Staff Sale', '/reports/staff', 'Sales by staff'],
    ['Commissions', '/reports/commissions', 'Commission on bills'],
    ['Transport Cost', '/reports/transport', 'Freight on bills'],
    ['Packing / Forwarding', '/reports/packing', 'P&F on bills'],
    ['Bill Reference Sale', '/reports/billreferencesale', 'Sales by bill reference'],
    ['Bill Reference Purchase', '/reports/billreferencepurchase', 'Purchases by bill reference'],
    ['Notes Mentioned', '/reports/notes', 'Bills whose notes mention a word']
  ] }
]

export default function Reports() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Reports</h1>
      {GROUPS.map(g => (
        <div key={g.title} className="card">
          <h2 className="text-lg font-semibold text-white mb-4">{g.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.items.map(([name, href, desc]) => (
              <Link key={href} href={href} className="block rounded border border-slate-700 p-3 hover:bg-slate-700/50 transition-colors">
                <div className="text-white font-medium">{name}</div>
                <div className="text-xs text-slate-400">{desc}</div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
