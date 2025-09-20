export default function MinimumStockPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Minimum Stock Report</h1>
        <p className="text-slate-400">Monitor products below minimum stock levels</p>
      </div>

      <div className="card">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📉</div>
          <h2 className="text-2xl font-bold text-white mb-2">Low Stock Alerts</h2>
          <p className="text-slate-400 mb-6">
            Track products that need replenishment and generate reorder reports.
          </p>
          <div className="bg-slate-700/50 rounded-lg p-6 max-w-md mx-auto">
            <h3 className="text-lg font-semibold text-white mb-3">Planned Features:</h3>
            <ul className="text-sm text-slate-300 space-y-2 text-left">
              <li>• Low stock product listing</li>
              <li>• Reorder point alerts</li>
              <li>• Supplier contact information</li>
              <li>• Automated reorder suggestions</li>
              <li>• Stock level trend analysis</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
