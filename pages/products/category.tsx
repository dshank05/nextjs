import { LookupTablePage } from '../../components/products/LookupTablePage';

export default function Page() {
  return (
    <LookupTablePage
      config={{
        resource: 'categories',
        singular: 'Category',
        plural: 'categories',
        nameField: 'category_name',
        report: { title: 'Product Categories Report', fileName: 'Product_Categories' }
      }}
    />
  );
}
