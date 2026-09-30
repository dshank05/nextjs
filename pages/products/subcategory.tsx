import { LookupTablePage } from '../../components/products/LookupTablePage';

export default function Page() {
  return (
    <LookupTablePage
      config={{
        resource: 'subcategories',
        singular: 'Subcategory',
        plural: 'subcategories',
        nameField: 'subcategory_name',
        report: { title: 'Product Subcategories Report', fileName: 'Product_Subcategories' },
        parent: {
          label: 'Category',
          idField: 'category_id',
          nameField: 'category_name',
          sortKey: 'category_name',
          searchParam: 'category_search',
          optionsUrl: '/api/products/categories?dropdown=true',
          relation: 'category'
        }
      }}
    />
  );
}
