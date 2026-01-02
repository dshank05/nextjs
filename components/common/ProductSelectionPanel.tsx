import React, { useRef, useEffect, useState } from 'react';
import { Search, Filter, Loader } from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';

export interface Product {
    id: number;
    product_name: string;
    display_name?: string;
    hsn?: string;
    product_category?: string;
    product_subcategory?: string;
    product_category_id?: number;
    product_subcategory_id?: number;
    car_model_ids?: string;
    company?: string; // Keep for backward compatibility
    company_id?: number; // New field for company ID
    pic?: string;
    part_no?: string;
    min_stock?: number;
    stock?: number;
    rate?: number;
    notes?: string;
    category_name?: string;
    subcategory_name?: string;
    gst_rate?: number;
    selling_price?: number;
    latest_selling_price?: number;
    gst_rate_percentage?: number;
    latest_purchase_rate?: number; // Latest purchase rate from database
    opening_rate?: number; // Opening rate from database
}

export interface FilterOptions {
    categories: any[];
    subcategories: any[];
    companies: any[];
    models: any[];
}

export interface ProductSelectionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    showCarModelFilter: boolean;
    filterOptions?: FilterOptions; // Now optional - will fetch if not provided
    selectedCarModel: string;
    onCarModelSelection: (value: string) => void;
    selectedCategory?: string;
    onCategorySelection?: (value: string) => void;
    selectedSubcategory?: string;
    onSubcategorySelection?: (value: string) => void;
    selectedCompany?: string;
    onCompanySelection?: (value: string) => void;
    searchedProducts: Product[];
    productSearchTerm: string;
    onSearchTermChange: (value: string) => void;
    onProductSelect: (product: Product) => void;
    isLoading?: boolean; // New prop for loading state
}

export const ProductSelectionPanel: React.FC<ProductSelectionPanelProps> = ({
    isOpen,
    onClose,
    title,
    showCarModelFilter,
    filterOptions: propFilterOptions,
    selectedCarModel,
    onCarModelSelection,
    selectedCategory = '',
    onCategorySelection,
    selectedSubcategory = '',
    onSubcategorySelection,
    selectedCompany = '',
    onCompanySelection,
    searchedProducts,
    productSearchTerm,
    onSearchTermChange,
    onProductSelect,
    isLoading = false, // Default to false
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    
    // Internal state for filter options - will fetch from API if not provided via props
    const [internalFilterOptions, setInternalFilterOptions] = useState<FilterOptions>({
        categories: [],
        subcategories: [],
        companies: [],
        models: []
    });
    const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);

    // Use prop filterOptions if provided, otherwise use internal state
    const filterOptions = propFilterOptions || internalFilterOptions;

    // Fetch filter options from API if not provided via props
    useEffect(() => {
        const fetchFilterOptions = async () => {
            // Only fetch if not provided via props
            if (propFilterOptions) return;

            setFilterOptionsLoading(true);
            try {
                const response = await fetch('/api/products/filters');
                if (response.ok) {
                    const data = await response.json();
                    setInternalFilterOptions(data);
                }
            } catch (error) {
                console.error('Error fetching filter options:', error);
            } finally {
                setFilterOptionsLoading(false);
            }
        };

        fetchFilterOptions();
    }, [propFilterOptions]);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="fixed top-0 right-0 w-1/2 h-full bg-slate-900 shadow-lg flex flex-col z-50">
                {/* Header */}
                <div className="p-4 border-b border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-medium text-slate-200">{title}</h3>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-slate-800 rounded"
                        >
                            <span className="text-slate-400 text-xl">×</span>
                        </button>
                    </div>

          {/* Search Input */}
          <div className="flex items-center bg-slate-800 border border-slate-600 rounded mb-3">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search products..."
              value={productSearchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              className="flex-1 pl-3 pr-4 py-2 bg-transparent text-white text-sm focus:outline-none placeholder-slate-400"
            />
          </div>

          {/* Filters Row */}
          {filterOptionsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader className="w-5 h-5 text-blue-500 animate-spin mr-2" />
              <span className="text-slate-400 text-sm">Loading filters...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {/* Category Filter */}
              {onCategorySelection && (
                <div>
                  <SearchableSelect
                    options={filterOptions.categories.map(cat => ({ 
                      id: cat.id.toString(), 
                      name: cat.category_name || cat.name 
                    }))}
                    selectedValue={selectedCategory}
                    onSelectionChange={(value) => onCategorySelection(value || '')}
                    placeholder="Filter by category..."
                  />
                </div>
              )}

              {/* Subcategory Filter */}
              {onSubcategorySelection && (
                <div>
                  <SearchableSelect
                    options={filterOptions.subcategories.map(sub => ({ 
                      id: sub.id.toString(), 
                      name: sub.subcategory_name || sub.name 
                    }))}
                    selectedValue={selectedSubcategory}
                    onSelectionChange={(value) => onSubcategorySelection(value || '')}
                    placeholder="Filter by subcategory..."
                  />
                </div>
              )}

              {/* Car Model Filter */}
              {showCarModelFilter && (
                <div>
                  <SearchableSelect
                    options={filterOptions.models.map(model => ({ 
                      id: model.id.toString(), 
                      name: model.name 
                    }))}
                    selectedValue={selectedCarModel}
                    onSelectionChange={(value) => onCarModelSelection(value || '')}
                    placeholder="Filter by car model..."
                  />
                </div>
              )}

              {/* Company Filter */}
              {onCompanySelection && (
                <div>
                  <SearchableSelect
                    options={filterOptions.companies.map(comp => ({ 
                      id: comp.id.toString(), 
                      name: comp.company_name || comp.name 
                    }))}
                    selectedValue={selectedCompany}
                    onSelectionChange={(value) => onCompanySelection(value || '')}
                    placeholder="Filter by company..."
                  />
                </div>
              )}
            </div>
          )}
                </div>

                {/* Product List */}
                <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                        <div className="p-8 flex flex-col items-center justify-center">
                            <Loader className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                            <p className="text-slate-400 text-sm">Loading products...</p>
                        </div>
                    ) : searchedProducts.length > 0 ? (
                        <div className="p-4 space-y-2">
                            {searchedProducts
                                .slice() // Create a copy to avoid mutating the original array
                                .sort((a, b) => {
                                    // Sort alphabetically by display_name or product_name (case-insensitive)
                                    const nameA = (a.display_name || a.product_name || '').toLowerCase();
                                    const nameB = (b.display_name || b.product_name || '').toLowerCase();
                                    return nameA.localeCompare(nameB);
                                })
                                .map((product) => (
                                <div
                                    key={product.id}
                                    className="p-3 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 cursor-pointer transition-colors"
                                    onClick={() => onProductSelect(product)}
                                >
                                    <div className="flex flex-col">
                                        {/* First row: UID-Display Name-Part No | Stock */}
                                        <div className="flex justify-between items-center mb-2">
                                            <h4 className="text-slate-200 font-bold text-sm flex-1">
                                                {product.display_name || product.product_name}  
                                            </h4>
                                            <div className="flex items-center ml-2 flex-shrink-0">
                                                <span className="text-green-400 font-semibold text-sm mr-1">Stock:</span>
                                                <span className="text-white font-bold text-sm">{product.stock || 0} units</span>
                                            </div>
                                        </div>

                                        {/* Second row: Car Model Badges */}
                                        <div className="flex flex-wrap gap-1">
                                            {product.car_model_ids && product.car_model_ids.trim() ? (
                                                product.car_model_ids.split(',').map((modelId, index) => {
                                                    const model = filterOptions.models.find(m => m.id.toString() === modelId.trim());
                                                    const modelName = model ? model.name : modelId.trim();
                                                    return (
                                                        <span
                                                            key={index}
                                                            className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded-full border border-blue-500/30"
                                                        >
                                                            {modelName}
                                                        </span>
                                                    );
                                                })
                                            ) : (
                                                <span className="text-slate-500 text-xs">No car models specified</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 text-center">
                            <p className="text-slate-400 text-sm">
                                {productSearchTerm ? 'No products found' : 'Start typing to search products...'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-700">
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </>
    );
};

export default ProductSelectionPanel;
