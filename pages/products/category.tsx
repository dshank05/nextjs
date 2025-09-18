// In pages/products/category.tsx

import Link from 'next/link';

const ProductCategoryPage = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Product Category Page</h1>
      <p className="text-slate-400 mt-2">
        This page will eventually be used to manage product categories.
      </p>

      <div className="mt-8">
        <Link 
          href="/products/subcategory" 
          className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Test Navigation: Go to Product Sub Category
        </Link>
      </div>
    </div>
  );
};

export default ProductCategoryPage;