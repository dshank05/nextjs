export default function WarehousePage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Warehouse Management</h1>
        <p className="text-slate-400">Configure warehouse locations and storage settings</p>
      </div>

      <div className="card">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🏭</div>
          <h2 className="text-2xl font-bold text-white mb-2">Warehouse Configuration</h2>
          <p className="text-slate-400 mb-6">
            Manage warehouse locations, zones, and storage configurations.
          </p>
          <div className="bg-slate-700/50 rounded-lg p-6 max-w-md mx-auto">
            <h3 className="text-lg font-semibold text-white mb-3">Planned Features:</h3>
            <ul className="text-sm text-slate-300 space-y-2 text-left">
              <li>• Warehouse location setup</li>
              <li>• Storage zone configuration</li>
              <li>• Inventory allocation</li>
              <li>• Warehouse mapping</li>
              <li>• Capacity management</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
