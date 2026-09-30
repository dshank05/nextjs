import { LookupTablePage } from '../../components/products/LookupTablePage';

export default function Page() {
  return (
    <LookupTablePage
      config={{
        resource: 'models',
        singular: 'Car Model',
        plural: 'car models',
        nameField: 'model_name',
        report: { title: 'Car Models Report', fileName: 'Car_Models' }
      }}
    />
  );
}
