// In components/products/ProductFilters.tsx

import { useState } from 'react';

// Define the types for the props this component will receive
interface FilterOptions {
  categories: { id: string; name: string }[];
  subcategories: { id: string; name: string }[];
  companies: { id: string; name: string }[];
}

interface ProductFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  subcategoryFilter: string;
  setSubcategoryFilter: (value: string) => void;
  companyFilter: string;
  setCompanyFilter: (value: string) => void;
  stockFilter: string;
  setStockFilter: (value: string) => void;
  limit: number;
  handleLimitChange: (value: number) => void;
  clearFilters: () => void;
  filterOptions: FilterOptions;
}

export const ProductFilters = ({
  searchTerm, setSearchTerm,
  categoryFilter, setCategoryFilter,
  subcategoryFilter, setSubcategoryFilter,
  companyFilter, setCompanyFilter,
  stockFilter, setStockFilter,
  limit, handleLimitChange,
  clearFilters, filterOptions
}: ProductFiltersProps) => {
  // State for typeaheads and dropdowns is encapsulated here
  const [categorySearch, setCategorySearch] = useState('');
  const [subcategorySearch, setSubcategorySearch] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showSubcategoryDropdown, setShowSubcategoryDropdown] = useState(false);
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);

  // Filter options based on local search state
  const filteredCategories = filterOptions.categories.filter(cat => cat.name.toLowerCase().includes(categorySearch.toLowerCase()));
  const filteredSubcategories = filterOptions.subcategories.filter(sub => sub.name.toLowerCase().includes(subcategorySearch.toLowerCase()));
  const filteredCompanies = filterOptions.companies.filter(comp => comp.name.toLowerCase().includes(companySearch.toLowerCase()));

  const handleCategorySelect = (category: { id: string; name: string }) => {
    setCategoryFilter(category.id);
    setCategorySearch(category.name);
    setShowCategoryDropdown(false);
  };

  const handleSubcategorySelect = (subcategory: { id: string; name: string }) => {
    setSubcategoryFilter(subcategory.id);
    setSubcategorySearch(subcategory.name);
    setShowSubcategoryDropdown(false);
  };

  const handleCompanySelect = (company: { id: string; name: string }) => {
    setCompanyFilter(company.id);
    setCompanySearch(company.name);
    setShowCompanyDropdown(false);
  };

  const handleClear = () => {
    clearFilters(); // Calls the parent's state-clearing function
    setCategorySearch('');
    setSubcategorySearch('');
    setCompanySearch('');
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-white mb-4">Search & Filter Products</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
        {/* Search */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Search Product/Part No</label>
          <input type="text" placeholder="Search products..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input w-full" />
        </div>

        {/* Category Filter */}
        <div className="relative">
          <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
          <input type="text" placeholder="Search categories..." value={categorySearch} onChange={(e) => { setCategorySearch(e.target.value); setShowCategoryDropdown(true); if (e.target.value === '') setCategoryFilter(''); }} onFocus={() => setShowCategoryDropdown(true)} onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)} className="input w-full" />
          {showCategoryDropdown && (
            <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              <div className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleCategorySelect({ id: '', name: '' })}>All Categories</div>
              {filteredCategories.map((cat) => <div key={cat.id} className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleCategorySelect(cat)}>{cat.name}</div>)}
            </div>
          )}
        </div>

        {/* Subcategory (Car Model) Filter */}
        <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-2">Car Model</label>
            <input type="text" placeholder="Search car models..." value={subcategorySearch} onChange={(e) => { setSubcategorySearch(e.target.value); setShowSubcategoryDropdown(true); if (e.target.value === '') setSubcategoryFilter(''); }} onFocus={() => setShowSubcategoryDropdown(true)} onBlur={() => setTimeout(() => setShowSubcategoryDropdown(false), 200)} className="input w-full"/>
            {showSubcategoryDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    <div className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleSubcategorySelect({id: '', name: ''})}>All Car Models</div>
                    {filteredSubcategories.map((sub) => <div key={sub.id} className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleSubcategorySelect(sub)}>{sub.name}</div>)}
                </div>
            )}
        </div>

        {/* Company Filter */}
        <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-2">Company</label>
            <input type="text" placeholder="Search companies..." value={companySearch} onChange={(e) => { setCompanySearch(e.target.value); setShowCompanyDropdown(true); if (e.target.value === '') setCompanyFilter(''); }} onFocus={() => setShowCompanyDropdown(true)} onBlur={() => setTimeout(() => setShowCompanyDropdown(false), 200)} className="input w-full"/>
            {showCompanyDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    <div className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleCompanySelect({id: '', name: ''})}>All Companies</div>
                    {filteredCompanies.map((comp) => <div key={comp.id} className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleCompanySelect(comp)}>{comp.name}</div>)}
                </div>
            )}
        </div>

        {/* Stock Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Stock Status</label>
          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} className="select w-full">
            <option value="all">All Products</option>
            <option value="in-stock">In Stock</option>
            <option value="low-stock">Low Stock</option>
          </select>
        </div>

        {/* Items Per Page */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Items Per Page</label>
          <select value={limit} onChange={(e) => handleLimitChange(parseInt(e.target.value))} className="select w-full">
            <option value="10">10</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        {/* Clear Filters */}
        <div className="flex items-end">
          <button onClick={handleClear} className="btn-secondary w-full">Clear Filters</button>
        </div>
      </div>
    </div>
  );
};