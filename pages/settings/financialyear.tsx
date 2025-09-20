export default function FinancialYearPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Financial Year</h1>
        <p className="text-slate-400">Configure financial year settings and periods</p>
      </div>

      <div className="card">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📅</div>
          <h2 className="text-2xl font-bold text-white mb-2">Financial Year Management</h2>
          <p className="text-slate-400 mb-6">
            Set up financial year periods and accounting cycles.
          </p>
          <div className="bg-slate-700/50 rounded-lg p-6 max-w-md mx-auto">
            <h3 className="text-lg font-semibold text-white mb-3">Planned Features:</h3>
            <ul className="text-sm text-slate-300 space-y-2 text-left">
              <li>• Financial year configuration</li>
              <li>• Period management</li>
              <li>• Accounting cycle setup</li>
              <li>• Tax year alignment</li>
              <li>• Reporting periods</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
