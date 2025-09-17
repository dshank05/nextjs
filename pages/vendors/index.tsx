export default function Vendors() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Vendors</h1>
        <button className="btn-primary">
          Add Vendor
        </button>
      </div>

      <div className="card">
        <div className="text-center py-12">
          <span className="text-6xl mb-4 block">🏢</span>
          <h3 className="text-xl font-semibold text-white mb-2">Vendor Management</h3>
          <p className="text-slate-400 mb-6">
            Vendor management features coming soon. Your vendor data from the legacy system will be integrated here.
          </p>
        </div>
      </div>
    </div>
  )
}
