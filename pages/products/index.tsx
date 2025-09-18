import { useState, useEffect } from 'react'

interface Product {
  [x: string]: ReactNode
  id: number
  product_name: string
  product_category?: string
  company?: string
  stock?: number
  min_stock?: number
  rate?: number
  part_no?: string
  categoryName?: string
  companyName?: string
  subcategoryNames?: string
  latestPurchaseRate?: number
}

interface ProductResponse {
  products: Product[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasMore: boolean
  }
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
    hasMore: false
  })
  const [loading, setLoading] = useState(true)

  // Filter states
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [subcategoryFilter, setSubcategoryFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('all')

  // Filter options from database
  const [filterOptions, setFilterOptions] = useState<{
    categories: { id: string; name: string }[]
    subcategories: { id: string; name: string }[]
    companies: { id: string; name: string }[]
  }>({ categories: [], subcategories: [], companies: [] })

  // Typeahead states
  const [categorySearch, setCategorySearch] = useState('')
  const [subcategorySearch, setSubcategorySearch] = useState('')
  const [companySearch, setCompanySearch] = useState('')
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const [showSubcategoryDropdown, setShowSubcategoryDropdown] = useState(false)
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false)

  useEffect(() => {
    fetchProducts()
    fetchFilterOptions()
  }, [pagination.page, pagination.limit])

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/products/filters')
      if (response.ok) {
        const data = await response.json()
        setFilterOptions(data)
      }
    } catch (error) {
      console.error('Error fetching filter options:', error)
    }
  }

  useEffect(() => {
    // Reset to page 1 when filters change
    if (pagination.page !== 1) {
      setPagination(prev => ({ ...prev, page: 1 }))
    } else {
      fetchProducts()
    }
  }, [searchTerm, categoryFilter, subcategoryFilter, companyFilter, stockFilter])

  const fetchProducts = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search: searchTerm,
        category: categoryFilter,
        subcategory: subcategoryFilter,
        company: companyFilter,
        lowStock: stockFilter === 'low-stock' ? 'true' : 'false'
      })

      const response = await fetch(`/api/products/optimized?${params}`)
      if (response.ok) {
        const data: ProductResponse = await response.json()
        // Add index to each product based on current page and limit
        const startIndex = (pagination.page - 1) * pagination.limit
        const productsWithIndex = (data.products || []).map((product, idx) => ({
          ...product,
          index: startIndex + idx + 1
        }))
        setProducts(productsWithIndex)
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Error fetching products:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }))
  }

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }))
  }

  const clearFilters = () => {
    setSearchTerm('')
    setCategoryFilter('')
    setSubcategoryFilter('')
    setCompanyFilter('')
    setStockFilter('all')
    setCategorySearch('')
    setSubcategorySearch('')
    setCompanySearch('')
    setShowCategoryDropdown(false)
    setShowSubcategoryDropdown(false)
    setShowCompanyDropdown(false)
  }

  // Filter options based on search
  const filteredCategories = filterOptions.categories.filter(cat =>
    cat.name.toLowerCase().includes(categorySearch.toLowerCase())
  )

  const filteredSubcategories = filterOptions.subcategories.filter(sub =>
    sub.name.toLowerCase().includes(subcategorySearch.toLowerCase())
  )

  const filteredCompanies = filterOptions.companies.filter(comp =>
    comp.name.toLowerCase().includes(companySearch.toLowerCase())
  )

  const handleCategorySelect = (category: { id: string; name: string }) => {
    setCategoryFilter(category.id)
    setCategorySearch(category.name)
    setShowCategoryDropdown(false)
  }

  const handleSubcategorySelect = (subcategory: { id: string; name: string }) => {
    setSubcategoryFilter(subcategory.id)
    setSubcategorySearch(subcategory.name)
    setShowSubcategoryDropdown(false)
  }

  const handleCompanySelect = (company: { id: string; name: string }) => {
    setCompanyFilter(company.id)
    setCompanySearch(company.name)
    setShowCompanyDropdown(false)
  }

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = []
    const start = Math.max(1, pagination.page - 2)
    const end = Math.min(pagination.totalPages, pagination.page + 2)

    for (let i = start; i <= end; i++) {
      pages.push(i)
    }
    return pages
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button className="btn-primary">
          Add Product
        </button>
      </div>

      {/* Search and Filter Controls */}
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">Search & Filter Products</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Search Product/Part No</label>
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input w-full"
            />
          </div>

          {/* Category Filter with Typeahead */}
          <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
            <input
              type="text"
              placeholder="Type to search categories..."
              value={categorySearch}
              onChange={(e) => {
                setCategorySearch(e.target.value)
                setShowCategoryDropdown(true)
                if (e.target.value === '') {
                  setCategoryFilter('')
                }
              }}
              onFocus={() => setShowCategoryDropdown(true)}
              onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)}
              className="input w-full"
            />
            {showCategoryDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                <div
                  className="px-3 py-2 hover:bg-slate-600 cursor-pointer text-slate-300 sticky top-0 bg-slate-700 border-b border-slate-600"
                  onClick={() => {
                    setCategoryFilter('')
                    setCategorySearch('')
                    setShowCategoryDropdown(false)
                  }}
                >
                  All Categories
                </div>
                {filteredCategories.map((category) => (
                  <div
                    key={category.id}
                    className="px-3 py-2 hover:bg-slate-600 cursor-pointer text-slate-300"
                    onClick={() => handleCategorySelect(category)}
                  >
                    {category.name}
                  </div>
                ))}
                {filteredCategories.length === 0 && categorySearch && (
                  <div className="px-3 py-2 text-slate-500 text-sm">
                    No categories found matching "{categorySearch}"
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Car Model (Subcategory) Filter with Typeahead */}
          <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-2">Car Model</label>
            <input
              type="text"
              placeholder="Type to search car models..."
              value={subcategorySearch}
              onChange={(e) => {
                setSubcategorySearch(e.target.value)
                setShowSubcategoryDropdown(true)
                if (e.target.value === '') {
                  setSubcategoryFilter('')
                }
              }}
              onFocus={() => setShowSubcategoryDropdown(true)}
              onBlur={() => setTimeout(() => setShowSubcategoryDropdown(false), 200)}
              className="input w-full"
            />
            {showSubcategoryDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                <div
                  className="px-3 py-2 hover:bg-slate-600 cursor-pointer text-slate-300 sticky top-0 bg-slate-700 border-b border-slate-600"
                  onClick={() => {
                    setSubcategoryFilter('')
                    setSubcategorySearch('')
                    setShowSubcategoryDropdown(false)
                  }}
                >
                  All Car Models
                </div>
                {filteredSubcategories.map((subcategory) => (
                  <div
                    key={subcategory.id}
                    className="px-3 py-2 hover:bg-slate-600 cursor-pointer text-slate-300"
                    onClick={() => handleSubcategorySelect(subcategory)}
                  >
                    {subcategory.name}
                  </div>
                ))}
                {filteredSubcategories.length === 0 && subcategorySearch && (
                  <div className="px-3 py-2 text-slate-500 text-sm">
                    No car models found matching "{subcategorySearch}"
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Company Filter with Typeahead */}
          <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-2">Company</label>
            <input
              type="text"
              placeholder="Type to search companies..."
              value={companySearch}
              onChange={(e) => {
                setCompanySearch(e.target.value)
                setShowCompanyDropdown(true)
                if (e.target.value === '') {
                  setCompanyFilter('')
                }
              }}
              onFocus={() => setShowCompanyDropdown(true)}
              onBlur={() => setTimeout(() => setShowCompanyDropdown(false), 200)}
              className="input w-full"
            />
            {showCompanyDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                <div
                  className="px-3 py-2 hover:bg-slate-600 cursor-pointer text-slate-300 sticky top-0 bg-slate-700 border-b border-slate-600"
                  onClick={() => {
                    setCompanyFilter('')
                    setCompanySearch('')
                    setShowCompanyDropdown(false)
                  }}
                >
                  All Companies
                </div>
                {filteredCompanies.map((company) => (
                  <div
                    key={company.id}
                    className="px-3 py-2 hover:bg-slate-600 cursor-pointer text-slate-300"
                    onClick={() => handleCompanySelect(company)}
                  >
                    {company.name}
                  </div>
                ))}
                {filteredCompanies.length === 0 && companySearch && (
                  <div className="px-3 py-2 text-slate-500 text-sm">
                    No companies found matching "{companySearch}"
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Stock Filter */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Stock Status</label>
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              className="select w-full"
            >
              <option value="all">All Products</option>
              <option value="in-stock">In Stock</option>
              <option value="low-stock">Low Stock</option>
            </select>
          </div>

          {/* Items Per Page */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Items Per Page</label>
            <select
              value={pagination.limit}
              onChange={(e) => handleLimitChange(parseInt(e.target.value))}
              className="select w-full"
            >
              <option value="10">10 per page</option>
              <option value="50">50 per page</option>
              <option value="100">100 per page</option>
            </select>
          </div>

          {/* Clear Filters */}
          <div className="flex items-end">
            <button
              onClick={clearFilters}
              className="btn-secondary w-full"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* Results Info */}
        <div className="mt-4 flex justify-between items-center text-sm text-slate-400">
          <div>
            Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} products
          </div>
          <div>
            Page {pagination.page} of {pagination.totalPages}
          </div>
        </div>
      </div>

      {/* Products Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>S.N</th>
                <th>UID</th>
                <th>Product Name</th>

                <th>Category</th>
                <th>Car Model</th>
                <th>Company</th>
                <th>Part Number</th>
                <th>Stock</th>
                {/* <th>Min Stock</th> */}
                <th>Rate</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.index}</td>
                  <td className="text-slate-400 text-sm">{product.id}</td>
                  <td className="font-medium text-white">{product.product_name}</td>

                  <td className="text-slate-300">{product.categoryName || '-'}</td>
                  <td className="text-slate-300 min-w-48">
                    {product.subcategoryNames ? (
                      <div className="flex flex-wrap gap-1">
                        {product.subcategoryNames.split(', ').map((model, index) => (
                          <span
                            key={index}
                            className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded-full border border-blue-500/30"
                          >
                            {model.trim()}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                  <td className="text-slate-300">{product.companyName || '-'}</td>
                  <td className="text-slate-300">{product.part_no || '-'}</td>
                  <td className="text-slate-300">{product.stock || 0}</td>
                  {/* <td className="text-slate-300">{product.min_stock || 0}</td> */}
                  <td className="text-slate-300">₹{product.latestPurchaseRate || product.rate || 0}</td>
                  <td>
                    {(product.stock || 0) === 0 ? (
                      <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full font-semibold">
                        🚨 Out of Stock
                      </span>
                    ) : (product.stock || 0) < 2 || (product.stock || 0) < (product.min_stock || 0) ? (
                      <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">
                        ⚠️ Low Stock
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">
                        ✅ In Stock
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {products.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              {searchTerm ? `No products found matching "${searchTerm}"` : 'No products found'}
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-700">
            {/* Previous Button */}
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page === 1}
              className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            {/* Page Numbers */}
            <div className="flex space-x-2">
              {pagination.page > 3 && (
                <>
                  <button
                    onClick={() => handlePageChange(1)}
                    className="px-3 py-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded"
                  >
                    1
                  </button>
                  <span className="px-2 text-slate-500">...</span>
                </>
              )}

              {getPageNumbers().map((pageNum) => (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  className={`px-3 py-1 rounded ${pageNum === pagination.page
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700'
                    }`}
                >
                  {pageNum}
                </button>
              ))}

              {pagination.page < pagination.totalPages - 2 && (
                <>
                  <span className="px-2 text-slate-500">...</span>
                  <button
                    onClick={() => handlePageChange(pagination.totalPages)}
                    className="px-3 py-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded"
                  >
                    {pagination.totalPages}
                  </button>
                </>
              )}
            </div>

            {/* Next Button */}
            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
              className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
