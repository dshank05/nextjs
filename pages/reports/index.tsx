export default function Reports() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Reports & Analytics</h1>
        <button className="btn-primary">
          Generate Report
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Sales Reports */}
        <div className="card hover:bg-slate-700/50 transition-colors cursor-pointer">
          <div className="text-center">
            <span className="text-4xl mb-3 block">📈</span>
            <h3 className="text-lg font-semibold text-white mb-2">Sales Reports</h3>
            <p className="text-slate-400 text-sm mb-4">
              Monthly and yearly sales analysis
            </p>
            <button className="btn-primary w-full">View Sales Reports</button>
          </div>
        </div>

        {/* Purchase Reports */}
        <div className="card hover:bg-slate-700/50 transition-colors cursor-pointer">
          <div className="text-center">
            <span className="text-4xl mb-3 block">🛒</span>
            <h3 className="text-lg font-semibold text-white mb-2">Purchase Reports</h3>
            <p className="text-slate-400 text-sm mb-4">
              Purchase analysis and vendor performance
            </p>
            <button className="btn-primary w-full">View Purchase Reports</button>
          </div>
        </div>

        {/* Inventory Reports */}
        <div className="card hover:bg-slate-700/50 transition-colors cursor-pointer">
          <div className="text-center">
            <span className="text-4xl mb-3 block">📊</span>
            <h3 className="text-lg font-semibold text-white mb-2">Inventory Reports</h3>
            <p className="text-slate-400 text-sm mb-4">
              Stock levels and movement analysis
            </p>
            <button className="btn-primary w-full">View Inventory Reports</button>
          </div>
        </div>

        {/* Financial Reports */}
        <div className="card hover:bg-slate-700/50 transition-colors cursor-pointer">
          <div className="text-center">
            <span className="text-4xl mb-3 block">💰</span>
            <h3 className="text-lg font-semibold text-white mb-2">Financial Reports</h3>
            <p className="text-slate-400 text-sm mb-4">
              Profit, loss, and GST analysis
            </p>
            <button className="btn-primary w-full">View Financial Reports</button>
          </div>
        </div>

        {/* Customer Reports */}
        <div className="card hover:bg-slate-700/50 transition-colors cursor-pointer">
          <div className="text-center">
            <span className="text-4xl mb-3 block">👥</span>
            <h3 className="text-lg font-semibold text-white mb-2">Customer Reports</h3>
            <p className="text-slate-400 text-sm mb-4">
              Customer analysis and purchase patterns
            </p>
            <button className="btn-primary w-full">View Customer Reports</button>
          </div>
        </div>

        {/* Product Performance */}
        <div className="card hover:bg-slate-700/50 transition-colors cursor-pointer">
          <div className="text-center">
            <span className="text-4xl mb-3 block">🎯</span>
            <h3 className="text-lg font-semibold text-white mb-2">Product Performance</h3>
            <p className="text-slate-400 text-sm mb-4">
              Best selling products and trends
            </p>
            <button className="btn-primary w-full">View Performance Reports</button>
          </div>
        </div>
      </div>

      {/* Quick Report Actions */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">Quick Reports</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button className="flex items-center p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-left">
            <span className="text-2xl mr-4">📋</span>
            <div>
              <h4 className="font-medium text-white">Low Stock Report</h4>
              <p className="text-slate-400 text-sm">Export current low stock items</p>
            </div>
          </button>
          
          <button className="flex items-center p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-left">
            <span className="text-2xl mr-4">📄</span>
            <div>
              <h4 className="font-medium text-white">Monthly Sales</h4>
              <p className="text-slate-400 text-sm">Current month sales summary</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
