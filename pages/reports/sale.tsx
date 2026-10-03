import { BillReport } from '../../components/reports/BillReport';

/** components/reports/BillReport.tsx, shared by the Sale, Invoice C and Purchase reports. */
export default function Report() {
  return <BillReport mode="sale" />;
}
