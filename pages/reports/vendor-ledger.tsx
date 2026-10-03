import { PartyLedgerReport } from '../../components/reports/PartyLedgerReport';

/** The vendor ledger (components/reports/PartyLedgerReport.tsx, shared with the customer ledger). */
export default function VendorLedgerPage() {
  return <PartyLedgerReport party="vendor" />;
}
