export default function PurchaseReturnPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Purchase Return</h1>
        <p className="text-slate-400">Manage purchase returns and debit notes</p>
      </div>

      <div className="card">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🔄</div>
          <h2 className="text-2xl font-bold text-white mb-2">Purchase Return Management</h2>
          <p className="text-slate-400 mb-6">
            Handle vendor returns, debit notes, and supplier refund processing.
          </p>
          <div className="bg-slate-700/50 rounded-lg p-6 max-w-md mx-auto">
            <h3 className="text-lg font-semibold text-white mb-3">Planned Features:</h3>
            <ul className="text-sm text-slate-300 space-y-2 text-left">
              <li>• Return request processing</li>
              <li>• Debit note generation</li>
              <li>• Vendor communication</li>
              <li>• Refund tracking</li>
              <li>• Return analytics</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
