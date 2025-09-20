export default function StaffDetailsPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Staff Details</h1>
        <p className="text-slate-400">Manage employee information and staff records</p>
      </div>

      <div className="card">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">👷</div>
          <h2 className="text-2xl font-bold text-white mb-2">Staff Management</h2>
          <p className="text-slate-400 mb-6">
            Employee database with roles, departments, and contact information.
          </p>
          <div className="bg-slate-700/50 rounded-lg p-6 max-w-md mx-auto">
            <h3 className="text-lg font-semibold text-white mb-3">Planned Features:</h3>
            <ul className="text-sm text-slate-300 space-y-2 text-left">
              <li>• Employee profile management</li>
              <li>• Department assignments</li>
              <li>• Contact information</li>
              <li>• Performance tracking</li>
              <li>• Attendance management</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
