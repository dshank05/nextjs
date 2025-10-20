import React from 'react';
import { Search, Filter } from 'lucide-react';
import { SearchableMultiSelect } from './SearchableMultiSelect';

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
    gst_rate_percentage?: number;
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
    filterOptions: FilterOptions;
    selectedCarModels: string[];
    onCarModelSelection: (values: string[]) => void;
    searchedProducts: Product[];
    productSearchTerm: string;
    onSearchTermChange: (value: string) => void;
    onProductSelect: (product: Product) => void;
}

export const ProductSelectionPanel: React.FC<ProductSelectionPanelProps> = ({
    isOpen,
    onClose,
    title,
    showCarModelFilter,
    filterOptions,
    selectedCarModels,
    onCarModelSelection,
    searchedProducts,
    productSearchTerm,
    onSearchTermChange,
    onProductSelect,
}) => {
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

          {/* Combined Search and Filter Row */}
          <div className="flex gap-3 mb-4">
            {/* Search Input - Fixed Width */}
            <div className="flex flex-shrink-0 w-36items-center bg-slate-800 border border-slate-600 rounded">
              {/* <Search className="w-4 h-4 text-slate-400 ml-3" /> */}
              <input
                type="text"
                placeholder="Search products..."
                value={productSearchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
                className="flex-1 pl-3 pr-4 py-2 bg-transparent text-white text-sm focus:outline-none placeholder-slate-400"
              />
            </div>

            {/* Car Model Filter (only shown if enabled) */}
            {showCarModelFilter && (
              <div className="flex-1 min-w-0">
                <SearchableMultiSelect
                  options={filterOptions.models.map(model => ({ id: model.id.toString(), name: model.name }))}
                  selectedValues={selectedCarModels}
                  onSelectionChange={onCarModelSelection}
                  placeholder="Filter by car models..."
                  closeOnSelect={false}
                />
              </div>
            )}
          </div>
                </div>

                {/* Product List */}
                <div className="flex-1 overflow-y-auto">
                    {searchedProducts.length > 0 ? (
                        <div className="p-4 space-y-2">
                            {searchedProducts.map((product) => (
                                <div
                                    key={product.id}
                                    className="p-3 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 cursor-pointer transition-colors"
                                    onClick={() => onProductSelect(product)}
                                >
                                    <div className="flex flex-col">
                                        {/* First row: UID-Product Name | Stock */}
                                        <div className="flex justify-between items-center mb-2">
                                            <h4 className="text-slate-200 font-bold text-sm flex-1">
                                                {product.id} - {product.product_name}
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
                                {productSearchTerm ? 'No products found' : 'Loading products...'}
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
