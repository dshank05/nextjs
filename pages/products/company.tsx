import { LookupTablePage } from '../../components/products/LookupTablePage';

export default function Page() {
  return (
    <LookupTablePage
      config={{
        resource: 'companies',
        singular: 'Company',
        plural: 'companies',
        nameField: 'company_name',
        report: { title: 'Companies Report', fileName: 'Companies' }
      }}
    />
  );
}
