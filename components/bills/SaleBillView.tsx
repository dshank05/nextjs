import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Edit, Eye, DollarSign } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeBroadcast } from '../../lib/broadcast';
import { ExportMenu } from '../common/ExportMenu';
import PaymentHistoryModal from '../PaymentHistoryModal';
import QuickCustomerPaymentModal from '../QuickCustomerPaymentModal';
import { getLocalDateString } from '../../lib/date-utils';
import { money } from '../../lib/line-math';
import { useSaleBill, billKey } from '../../hooks/useSaleBills';
import type { SaleKind } from '../../types/sales';

/**
 * One sale or Invoice C - the view both kinds share (lib/sale-read.ts shape).
 *
 * Lines show what the server stored: rate, discount, taxable value, GST and tax.
 * The sale view used to recompute tax in the browser from qty × rate, ignoring
 * the discount, and put the pre-tax items total under the tax-inclusive column
 * (SA-30); "Mark as Paid" sent the printed number as the bill id (SA-05).
 */

const KIND = {
  sale: { title: 'Sales Invoice', short: 'Sale', resource: 'sales', edit: '/sale/create', banner: 'bg-green-900/20 border-green-700/50', text: 'text-green-100' },
  salex: { title: 'Invoice C', short: 'Invoice C', resource: 'salex', edit: '/salex/create', banner: 'bg-blue-900/20 border-blue-700/50', text: 'text-blue-100' }
} as const;

const statusBadge = (s?: number | null) =>
  s === 1 ? <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">Paid</span>
    : s === 2 ? <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partially Paid</span>
      : s === 0 ? <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded-full">Unpaid</span>
        : <span className="text-slate-400">N/A</span>;
const modeText = (m?: number | null) => (m === 0 ? 'Cash' : m === 1 ? 'Bank' : 'N/A');
const rupees = (n?: number | null) => `₹${money(Number(n) || 0)}`;
const day = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleDateString('en-IN') : '-');

export function SaleBillView({ kind }: { kind: SaleKind }) {
  const K = KIND[kind];
  const taxFree = kind === 'salex';
  const router = useRouter();
  const { id } = router.query;
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const { data: bill, isLoading, refetch } = useSaleBill(kind, typeof id === 'string' ? id : undefined);

  useEffect(() => subscribeBroadcast((msg) => {
    if (msg.resource === K.resource && msg.type === 'updated' && String(msg.data?.id) === String(id)) {
      queryClient.invalidateQueries({ queryKey: [billKey(kind), String(id)] });
    }
  }), [id, queryClient, kind, K.resource]);

  const exportAs = async (type: 'excel' | 'pdf') => {
    try {
      const utils = await import('../../lib/export-utils-enhanced');
      const { saleViewExportLayout, prepareSaleDataForExport } = await import('../../lib/export-layouts/sale-view-layout');
      const businessResponse = await fetch('/api/business-details');
      const business = businessResponse.ok ? await businessResponse.json() : null;
      const layout = {
        ...saleViewExportLayout,
        sections: saleViewExportLayout.sections.map((s: any) =>
          s.type === 'banner' ? { ...s, template: `${K.title} #{{invoice_no}} • {{customer.billing_name}}` } : s)
      };
      const options = { title: `${K.title} Details`, fileName: `${K.short.replace(' ', '_')}_${bill.invoice_no}`, layout };
      if (type === 'excel') await utils.exportToExcelWithLayout(prepareSaleDataForExport(bill), options, business);
      else await utils.exportToPDFWithLayout(prepareSaleDataForExport(bill), options, business);
    } catch (error) {
      console.error('export:', error);
      alert('Export failed. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="animate-spin rounded-full h-24 w-24 border-b-2 border-green-500"></div>
      </div>
    );
  }
  if (!bill) {
    return <div className="card"><p className="text-center text-slate-400">Bill not found</p></div>;
  }

  const items: any[] = bill.items || [];
  const rs = bill.return_status || {};
  const pay = bill.payment_summary;
  const sum = (f: string) => items.reduce((s, i) => s + (Number(i[f]) || 0), 0);
  const row = (labelText: string, value: React.ReactNode, strong = false) => (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <span className="text-slate-400">{labelText}:</span>
      <span className={`text-white ${strong ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="card">
        <div className={`${K.banner} border rounded p-4 mb-6`}>
          <div className="text-center space-y-2">
            <h1 className={`text-xl font-bold ${K.text}`}>{K.title} #{bill.invoice_no} • {bill.customer_name}</h1>
            <div className="flex justify-center gap-2">
              {taxFree && <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded-full">Tax-Free</span>}
              {rs.has_returns && (
                <>
                  {rs.status === 'PARTIAL_RETURN' && <span className="px-2 py-1 bg-orange-600 text-white text-xs rounded-full">Partial Return</span>}
                  {rs.status === 'FULLY_RETURNED' && <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">Fully Returned</span>}
                  <span className="text-xs text-slate-200 bg-slate-800/50 px-2 py-1 rounded-full">{rs.fully_returned_items}/{rs.total_items} items returned</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-6 pt-0">
          <div className="space-y-3">
            {row('Total', <span className="text-lg">{rupees(bill.total)}</span>, true)}
            {row('Items', items.length)}
            {row('Invoice', bill.invoice_no)}
            {row('Date', day(bill.invoice_date))}
            {row('Status', statusBadge(bill.payment_status))}
            {pay && pay.payment_count > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Payment History:</span>
                <span className="text-blue-400 font-medium flex items-center gap-2">
                  {pay.payment_count} payment{pay.payment_count !== 1 ? 's' : ''}
                  <button type="button" onClick={() => setShowHistory(true)} title="Show payments"><Eye className="w-4 h-4" /></button>
                </span>
              </div>
            )}
            {row('Payment Mode', modeText(bill.payment_mode))}
            {row('Bill Reference', bill.bill_reference || 'N/A')}
          </div>

          <div className="space-y-3">
            {row('Customer', bill.customer_name || 'N/A')}
            {row('Contact', bill.contact_number || 'N/A')}
            {row('Email', bill.email_id || 'N/A')}
            {row('GSTIN', bill.gst_number || 'N/A')}
            {row('Address', [bill.address, bill.address_2, bill.city, bill.state].filter(Boolean).join(', ') || 'N/A')}
            {row('Staff', bill.staff?.name || bill.staff_details || 'N/A')}
            {row('Mechanic', bill.mechanic?.name || 'N/A')}
            {row('Commission', rupees(bill.commission))}
          </div>

          <div className="space-y-3">
            {row('Items (after discount)', rupees(bill.items_total))}
            {row('Discount', rupees(bill.discount))}
            {row('P&F', rupees(bill.packing_forwarding_total))}
            {row('Freight', rupees(bill.freight))}
            {!taxFree && row('CGST', rupees(bill.total_cgst))}
            {!taxFree && row('SGST', rupees(bill.total_sgst))}
            {!taxFree && row('IGST', rupees(bill.total_igst))}
            {!taxFree && row('Total Tax', rupees(bill.total_tax))}
            {row('Grand Total', rupees(bill.total), true)}
            {pay && row('Paid / Outstanding', `${rupees(pay.total_paid)} / ${rupees(pay.remaining_amount)}`)}
          </div>

          <div className="space-y-3">
            {row('Transport', bill.transport_name || 'N/A')}
            {row('Vehicle', bill.vehicle_number || 'N/A')}
            {row('P&F Qty', bill.packing_forwarding_qty || 0)}
            {row('P&F Rate', rupees(bill.packing_forwarding_rate))}
            <div className="space-y-2">
              <div className="text-sm text-slate-400">Notes:</div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">{bill.notes || 'No notes available'}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-slate-400">Descriptions:</div>
              <div className="bg-slate-700 rounded p-2 text-white text-sm min-h-12">{bill.descriptions || 'No descriptions available'}</div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-700 mt-6 pt-4 px-6">
          <div className="flex justify-end items-center gap-3">
            <ExportMenu
              data={[bill]}
              columns={[
                { key: 'invoice_no', label: 'Invoice Number', enabled: true },
                { key: 'customer_name', label: 'Customer Name', enabled: true },
                { key: 'formattedDate', label: 'Date', enabled: true },
                { key: 'total', label: 'Total Amount', enabled: true },
                { key: 'payment_status', label: 'Payment Status', enabled: true },
                { key: 'payment_mode', label: 'Payment Mode', enabled: true },
                { key: 'bill_reference', label: 'Bill Reference', enabled: true }
              ]}
              config={{ title: `${K.title} Details`, fileName: `${K.short.replace(' ', '_')}_${bill.invoice_no}_${getLocalDateString()}` }}
              onExport={(type) => { if (type === 'excel' || type === 'pdf') exportAs(type); }}
            />
            {/* "Other" has no account to post a payment to. */}
            {pay && pay.remaining_amount > 0 && bill.customer_id > 0 && (
              <button onClick={() => setShowPay(true)} className="btn-secondary flex items-center gap-2" title="Record a payment against this bill">
                <DollarSign className="w-4 h-4" /> Mark as Paid
              </button>
            )}
            {rs.is_fully_returned ? (
              <button disabled className="btn-secondary flex items-center gap-2 opacity-50 cursor-not-allowed" title="Fully returned bills cannot be edited">
                <Edit className="w-4 h-4" /> Edit Disabled (Fully Returned)
              </button>
            ) : (
              <Link href={`${K.edit}?edit=${bill.id}`} className="btn-primary flex items-center gap-2" title="Edit">
                <Edit className="w-4 h-4" /> Edit {K.short}
              </Link>
            )}
          </div>
        </div>

        <div className="border-t border-slate-700 mt-6 pt-6">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">SN</th>
                  <th>Product Name</th>
                  <th>Part No</th>
                  <th>HSN</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Discount</th>
                  <th>Taxable Value</th>
                  {!taxFree && <th>Tax %</th>}
                  {!taxFree && <th>Tax</th>}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id} className={item.is_fully_returned ? 'bg-red-900/10' : ''}>
                    <td>{index + 1}</td>
                    <td className="font-medium text-white">
                      {item.display_name || item.name_of_product}
                      {item.returned_qty > 0 && (
                        <div className="text-xs text-orange-400 mt-1">Returned: {item.returned_qty}/{item.original_qty}</div>
                      )}
                    </td>
                    <td className="text-slate-300">{item.part || 'N/A'}</td>
                    <td className="text-slate-300">{item.hsn || 'N/A'}</td>
                    <td className="text-slate-300 font-medium">{item.qty}</td>
                    <td className="text-slate-300">{rupees(item.rate)}</td>
                    <td className="text-slate-300">{item.discount ? rupees(item.discount) : '-'}</td>
                    <td className="text-slate-300">{rupees(item.subtotal)}</td>
                    {!taxFree && <td className="text-slate-300">{item.gst_percentage || 0}%</td>}
                    {!taxFree && <td className="text-slate-300">{rupees(item.tax)}</td>}
                    <td className="text-slate-300 font-semibold">{rupees(item.total)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={taxFree ? 9 : 11} className="text-center text-slate-400 py-4">No items on this bill</td></tr>
                )}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-700 bg-slate-800/30">
                    <td colSpan={4} />
                    <td className="text-white font-bold">{sum('qty')}</td>
                    <td />
                    <td className="text-white font-bold">{rupees(sum('discount'))}</td>
                    <td className="text-white font-bold">{rupees(sum('subtotal'))}</td>
                    {!taxFree && <td />}
                    {!taxFree && <td className="text-white font-bold" title="Per line, before the bill's rounding">{rupees(sum('tax'))}</td>}
                    <td className="text-white font-bold">{rupees(sum('total'))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {(bill.returns || []).length > 0 && (
          <div className="border-t border-slate-700 mt-6 pt-6">
            <h3 className="text-lg font-semibold text-white mb-4">📦 Returns</h3>
            <div className="space-y-6">
              {bill.returns.map((ret: any) => (
                <div key={ret.id} className="bg-slate-800 border border-slate-700 rounded p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    <div><span className="text-slate-400 text-sm">Return Number:</span><div className="text-white font-medium">{ret.return_no}</div></div>
                    <div><span className="text-slate-400 text-sm">Date:</span><div className="text-white font-medium">{day(ret.return_date)}</div></div>
                    <div><span className="text-slate-400 text-sm">Total Amount:</span><div className="text-white font-medium">{rupees(ret.total_amount)}</div></div>
                    <div><span className="text-slate-400 text-sm">Refund Amount:</span><div className="text-white font-medium">{rupees(ret.refund_amount)}</div></div>
                    <div><span className="text-slate-400 text-sm">Payment Status:</span><div>{statusBadge(ret.payment_status)}</div></div>
                    <div><span className="text-slate-400 text-sm">Payment Mode:</span><div className="text-white font-medium">{modeText(ret.payment_mode)}</div></div>
                    {ret.notes && <div className="col-span-full"><span className="text-slate-400 text-sm">Notes:</span><div className="text-white">{ret.notes}</div></div>}
                  </div>
                  {(ret.items || []).length > 0 && (
                    <div className="overflow-x-auto mt-4">
                      <table className="table text-sm">
                        <thead>
                          <tr><th>Product</th><th>Qty</th><th>Unit Price</th>{!taxFree && <th>Tax</th>}<th>Total</th></tr>
                        </thead>
                        <tbody>
                          {ret.items.map((it: any) => (
                            <tr key={it.id}>
                              <td className="text-white">{it.product_name}</td>
                              <td className="text-slate-300">{it.return_qty}</td>
                              <td className="text-slate-300">{rupees(it.unit_price)}</td>
                              {!taxFree && <td className="text-slate-300">{rupees(it.tax_amount)}</td>}
                              <td className="text-white font-medium">{rupees(it.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {pay && (
        <>
          <PaymentHistoryModal isOpen={showHistory} onClose={() => setShowHistory(false)} summary={pay} history={bill.payment_history || []} />
          <QuickCustomerPaymentModal
            isOpen={showPay}
            onClose={() => setShowPay(false)}
            onSuccess={() => { refetch(); setShowPay(false); }}
            // The bill's id - never its printed number (SA-05).
            invoiceId={bill.id}
            invoicexId={taxFree ? bill.id : undefined}
            invoiceType={taxFree ? 'invoicex' : 'invoice'}
            customerId={bill.customer_id || 0}
            customerName={bill.customer_name || ''}
            outstandingAmount={pay.remaining_amount}
            totalBill={pay.total_bill}
            totalPaid={pay.total_paid}
            paymentHistory={bill.payment_history || []}
            fy={bill.fy}
          />
        </>
      )}
    </div>
  );
}
