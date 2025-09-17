export default function Categories() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Product Categories</h1>
        <button className="btn-primary">
          Add Category
        </button>
      </div>

      <div className="card">
        <div className="text-center py-12">
          <span className="text-6xl mb-4 block">📂</span>
          <h3 className="text-xl font-semibold text-white mb-2">Category Management</h3>
          <p className="text-slate-400 mb-6">
            Product category management features coming soon. Your category data is available through Prisma Studio.
          </p>
        </div>
      </div>
    </div>
  )
}
