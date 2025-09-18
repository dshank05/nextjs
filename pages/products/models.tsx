// In pages/products/models.tsx

import Link from 'next/link';

const CarModelsPage = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Car Models Page</h1>
      <p className="text-slate-400 mt-2">
        This page will be used to manage car models.
      </p>

      <div className="mt-8">
        <Link 
          href="/products/category" 
          className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Test Navigation: Go to Product Category
        </Link>
      </div>
    </div>
  );
};

export default CarModelsPage;