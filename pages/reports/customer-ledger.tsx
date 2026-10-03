import { PartyLedgerReport } from '../../components/reports/PartyLedgerReport';

/** The customer ledger (components/reports/PartyLedgerReport.tsx, shared with the vendor ledger). */
export default function CustomerLedgerPage() {
  return <PartyLedgerReport party="customer" />;
}
