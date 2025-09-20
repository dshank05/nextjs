export default function StatesPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">States</h1>
        <p className="text-slate-400">Manage state and region configurations</p>
      </div>

      <div className="card">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🗺️</div>
          <h2 className="text-2xl font-bold text-white mb-2">State Management</h2>
          <p className="text-slate-400 mb-6">
            Configure states, regions, and geographical settings for GST calculations.
          </p>
          <div className="bg-slate-700/50 rounded-lg p-6 max-w-md mx-auto">
            <h3 className="text-lg font-semibold text-white mb-3">Planned Features:</h3>
            <ul className="text-sm text-slate-300 space-y-2 text-left">
              <li>• State and region setup</li>
              <li>• GST state codes</li>
              <li>• Interstate vs intrastate logic</li>
              <li>• Shipping zone configuration</li>
              <li>• Regional tax settings</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
