// In components/products/ProductFilters.tsx

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';

// Import ConfirmationModal component
import { ConfirmationModal } from '../ConfirmationModal';

// Define the types for the props this component will receive
interface FilterOptions {
  categories: { id: string; name: string }[];
  subcategories: { id: string; name: string }[]; // Now actual subcategories
  companies: { id: string; name: string }[];
  models: { id: string; name: string }[]; // Car models separated
}

interface ProductFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  subcategoryFilter: string;
  setSubcategoryFilter: (value: string) => void;
  modelFilter: string[];  // CHANGED: now an array for multi-select
  setModelFilter: (value: string[]) => void;  // CHANGED: setter for array
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
  modelFilter, setModelFilter, // UPDATED: now array
  companyFilter, setCompanyFilter,
  stockFilter, setStockFilter,
  limit, handleLimitChange,
  clearFilters, filterOptions
}: ProductFiltersProps) => {
  // State for typeaheads and dropdowns is encapsulated here
  const [categorySearch, setCategorySearch] = useState('');
  const [subcategorySearch, setSubcategorySearch] = useState('');
  const [modelSearchQuery, setModelSearchQuery] = useState(''); // Multi-select search
  const [companySearch, setCompanySearch] = useState('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showSubcategoryDropdown, setShowSubcategoryDropdown] = useState(false);
  const [isModelsDropdownOpen, setIsModelsDropdownOpen] = useState(false); // Multi-select dropdown
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);



  // Refs for click outside handling
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const subcategoryDropdownRef = useRef<HTMLDivElement>(null);
  const modelsDropdownRef = useRef<HTMLDivElement>(null);
  const companyDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setShowCategoryDropdown(false);
      }
      if (subcategoryDropdownRef.current && !subcategoryDropdownRef.current.contains(event.target as Node)) {
        setShowSubcategoryDropdown(false);
      }
      if (modelsDropdownRef.current && !modelsDropdownRef.current.contains(event.target as Node)) {
        setIsModelsDropdownOpen(false);
        setModelSearchQuery('');
      }
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(event.target as Node)) {
        setShowCompanyDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter options based on local search state
  const filteredCategories = filterOptions.categories.filter(cat => cat.name.toLowerCase().includes(categorySearch.toLowerCase()));
  const filteredSubcategories = filterOptions.subcategories.filter(sub => sub.name.toLowerCase().includes(subcategorySearch.toLowerCase()));
  const filteredModels = filterOptions.models.filter(model => model.name.toLowerCase().includes(modelSearchQuery.toLowerCase())); // NEW: car models filtering
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
    setModelSearchQuery(''); // FIXED: use correct variable name
    setCompanySearch('');
  };

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-white mb-4">Search & Filter Products</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-8 gap-4">
        {/* Search */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Search Product/Part No</label>
          <input type="text" placeholder="Search products..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input w-full" />
        </div>

        {/* Category Filter */}
        <div className="relative">
          <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
          <input
            type="text"
            placeholder="Search categories..."
            value={categorySearch || (categoryFilter && filterOptions.categories.find(c => c.id === categoryFilter)?.name) || ''}
            onChange={(e) => {
              setCategorySearch(e.target.value);
              setShowCategoryDropdown(true);
              if (e.target.value === '') {
                setCategoryFilter('');
                setCategorySearch('');
              }
            }}
            onFocus={() => setShowCategoryDropdown(true)}
            onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)}
            className="input w-full"
          />
          {showCategoryDropdown && (
            <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              <div className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleCategorySelect({ id: '', name: 'All Categories' })}>All Categories</div>
              {filteredCategories.map((cat) => <div key={cat.id} className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleCategorySelect(cat)}>{cat.name}</div>)}
            </div>
          )}
        </div>

        {/* NEW: Subcategory Filter (actual subcategories like "Motor Valve") */}
        <div className="relative">
          <label className="block text-sm font-medium text-slate-300 mb-2">Subcategory</label>
          <input
            type="text"
            placeholder="Search subcategories..."
            value={subcategorySearch || (subcategoryFilter && filterOptions.subcategories.find(s => s.id === subcategoryFilter)?.name) || ''}
            onChange={(e) => {
              setSubcategorySearch(e.target.value);
              setShowSubcategoryDropdown(true);
              if (e.target.value === '') {
                setSubcategoryFilter('');
                setSubcategorySearch('');
              }
            }}
            onFocus={() => setShowSubcategoryDropdown(true)}
            onBlur={() => setTimeout(() => setShowSubcategoryDropdown(false), 200)}
            className="input w-full"
          />
          {showSubcategoryDropdown && (
            <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              <div className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleSubcategorySelect({id: '', name: 'All Subcategories'})}>All Subcategories</div>
              {filteredSubcategories.map((sub) => <div key={sub.id} className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleSubcategorySelect(sub)}>{sub.name}</div>)}
            </div>
          )}
        </div>

        {/* NEW: Car Models Multi-Select Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Car Models</label>
          <div className="relative" ref={modelsDropdownRef}>
            {/* Selected items display */}
            <div
              className="select w-full h-10 cursor-pointer flex items-center justify-between px-3 py-2"
              onClick={() => setIsModelsDropdownOpen(!isModelsDropdownOpen)}
            >
              <div className="flex flex-wrap gap-1 flex-1">
                {modelFilter.length > 0 ? (
                  modelFilter.slice(0, 3).map((modelId) => {
                    const model = filterOptions.models.find(m => m.id.toString() === modelId);
                    return (
                      <span
                        key={modelId}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 text-white text-xs rounded-sm"
                      >
                        {model?.name}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const newSelection = modelFilter.filter(id => id !== modelId);
                            setModelFilter(newSelection);
                          }}
                          className="hover:bg-blue-700 rounded-sm p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })
                ) : (
                  <span className="text-slate-400 text-sm">Select car models...</span>
                )}
                {modelFilter.length > 3 && (
                  <span className="text-slate-400 text-sm">+{modelFilter.length - 3} more</span>
                )}
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isModelsDropdownOpen ? 'rotate-180' : ''}`} />
            </div>

            {/* Multi-select dropdown menu */}
            {isModelsDropdownOpen && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-64 overflow-hidden">
                {/* Search input */}
                <div className="p-2 border-b border-slate-700">
                  <input
                    type="text"
                    placeholder="Search models..."
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Options list */}
                <div className="max-h-48 overflow-y-auto">
                  {filterOptions.models
                    .filter(model =>
                      model.name.toLowerCase().includes(modelSearchQuery.toLowerCase())
                    )
                    .map((model) => {
                      const isSelected = modelFilter.includes(model.id.toString());
                      return (
                        <div
                          key={model.id}
                          className="flex items-center px-3 py-2 hover:bg-slate-700 cursor-pointer transition-colors"
                          onClick={() => {
                            const newSelection = isSelected
                              ? modelFilter.filter(id => id !== model.id.toString())
                              : [...modelFilter, model.id.toString()];
                            setModelFilter(newSelection);
                          }}
                        >
                          <div className="flex items-center justify-center w-4 h-4 mr-3">
                            {isSelected && <Check className="w-3 h-3 text-blue-400" />}
                          </div>
                          <span className={`text-sm ${isSelected ? 'text-blue-300 font-medium' : 'text-slate-300'}`}>
                            {model.name}
                          </span>
                        </div>
                      );
                    })}
                  {filterOptions.models.filter(model =>
                    model.name.toLowerCase().includes(modelSearchQuery.toLowerCase())
                  ).length === 0 && (
                    <div className="px-3 py-2 text-slate-500 text-sm">No models found</div>
                  )}
                </div>

                {/* Footer with selected count */}
                {modelFilter.length > 0 && (
                  <div className="px-3 py-2 border-t border-slate-700 bg-slate-750">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{modelFilter.length} selected</span>
                      <div>
                        <button
                          type="button"
                          onClick={() => setModelFilter([])}
                          className="text-red-400 hover:text-red-300 underline"
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Company Filter */}
        <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-2">Company</label>
            <input
              type="text"
              placeholder="Search companies..."
              value={companySearch || (companyFilter && filterOptions.companies.find(c => c.id === companyFilter)?.name) || ''}
              onChange={(e) => {
                setCompanySearch(e.target.value);
                setShowCompanyDropdown(true);
                if (e.target.value === '') {
                  setCompanyFilter('');
                  setCompanySearch('');
                }
              }}
              onFocus={() => setShowCompanyDropdown(true)}
              onBlur={() => setTimeout(() => setShowCompanyDropdown(false), 200)}
              className="input w-full"
            />
            {showCompanyDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    <div className="px-3 py-2 hover:bg-slate-600 cursor-pointer" onClick={() => handleCompanySelect({id: '', name: 'All Companies'})}>All Companies</div>
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
