import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Loader } from 'lucide-react';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useSnackbar } from '../../components/SnackbarProvider';
import SessionStorageService from '../../lib/sessionStorage';

interface Customer {
  id: string;
  billing_name: string;
  shipping_name?: string;
  billing_address?: string;
  billing_address_2?: string;
  billing_city?: string;
  billing_state?: number;
  billing_state_code?: number;
  shipping_address?: string;
  shipping_address_2?: string;
  shipping_city?: string;
  shipping_state?: number;
  shipping_state_code?: number;
  billing_gstin?: string;
  shipping_gstin?: string;
  contact_no?: string;
  email?: string;
}

interface InvoiceItem {
  id: string;
  product_id: number;
  product_name: string;
  car_model_ids: string[];
  car_model_names: string[];
  category_id: number;
  category_name: string;
  subcategory_id: number;
  subcategory_name: string;
  company_id: number;
  company_name: string;
  part_number: string;
  qty: number;
  rate: number;
  discount_percentage: number;
  discount_amount: number;
  total: number;
  hsn: string;
  mrp: number;
  margin: number;
}

interface ReturnReasons {
  id: number;
  reason_name: string;
  type: string;
}

interface InvoiceFormData {
  invoice_number: string;
  bill_reference: string;
  date: string;
  customer_name: string;
  contact_number: string;
  address: string;
  city: string;
  email_id: string;
  state: string;
  gst_number: string;
  notes: string;
  payment_status: number;
  payment_mode: number;
  subtotal: string;
  grand_total: string;
  descriptions: string;
}

// Return-specific interface
interface ReturnItem extends InvoiceItem {
  return_reason_id?: number;
  return_qty: number;
  return_notes?: string;
}

export default function SalexReturnCreatePage() {
  const router = useRouter();
  const { invoice: invoiceIdParam } = router.query;
  const { showSnackbar } = useSnackbar();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<ReturnItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [invoiceNumberLoading, setInvoiceNumberLoading] = useState(true);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [editInvoiceId, setEditInvoiceId] = useState<number>(0);
  const [rawInvoiceItems, setRawInvoiceItems] = useState<any[]>([]);

  // Return-specific state
  const [returnReasons, setReturnReasons] = useState<ReturnReasons[]>([]);
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [returnStatus, setReturnStatus] = useState<string>('Pending');
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [formData, setFormData] = useState<InvoiceFormData>({
    invoice_number: '',
    bill_reference: '',
    date: new Date().toISOString().split('T')[0],
    customer_name: '',
    contact_number: '',
    address: '',
    city: '',
    email_id: '',
    state: '',
    gst_number: '',
    notes: '',
    payment_status: 1,
    payment_mode: 1,
    subtotal: '',
    grand_total: '',
    descriptions: ''
  });

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Load original invoice data
  useEffect(() => {
    const loadInvoiceData = async () => {
      if (!invoiceIdParam) return;

      const invoiceId = parseInt(invoiceIdParam as string);
      setEditInvoiceId(invoiceId);
      setInvoiceNumberLoading(true);

      try {
        await fetchInvoiceForEdit(invoiceId);
        console.log('✅ Invoice data loaded from API');
      } catch (error) {
        console.error('❌ Failed to load invoice from API:', error);
        const cachedData = SessionStorageService.get('salex', invoiceId.toString());
        if (cachedData) {
          console.log('🔄 Fallback: Using cached invoice data from sessionStorage');
          populateFormWithInvoiceData(cachedData);
        } else {
          showSnackbar('error', 'Failed to load invoice data. Please check if the invoice exists and try again.');
        }
      } finally {
        loadReturnReasons();
        if (invoiceNumberLoading) {
          setInvoiceNumberLoading(false);
        }
      }
    };

    loadInvoiceData();
  }, [invoiceIdParam, showSnackbar]);

  useEffect(() => {
    fetchCustomers();
  }, []);

  // Convert raw invoice items when they're loaded
  useEffect(() => {
    if (rawInvoiceItems.length > 0) {
      console.log('🔄 Converting raw invoice items to formatted items');
      const convertedItems: ReturnItem[] = rawInvoiceItems.map((item: any, index: number) => {
        const itemObj: ReturnItem = {
          id: item.id?.toString() || (index + 1).toString(),
          product_id: item.product_id || item.name_of_product || 1,
          product_name: item.name_of_product,
          car_model_ids: item.model_id ? [item.model_id.toString()] : [],
          car_model_names: [],
          category_id: item.category_id || 0,
          category_name: '',
          subcategory_id: item.subcategory_id || 0,
          subcategory_name: '',
          company_id: item.company_id || 0,
          company_name: '',
          part_number: item.part || '',
          qty: item.qty || 1,
          rate: item.rate || 0,
          discount_percentage: item.discountrate || 0,
          discount_amount: item.discount || 0,
          total: item.subtotal || 0,
          hsn: item.hsn || '',
          mrp: 0,
          margin: 0,
          return_reason_id: 1,
          return_qty: 0,
          return_notes: ''
        };
        return itemObj;
      });

      console.log('✅ Setting converted invoice items:', convertedItems);
      setSelectedProducts(convertedItems);
      setRawInvoiceItems([]);
    }
  }, [rawInvoiceItems]);

  function populateFormWithInvoiceData(cachedData: any) {
    const { invoice: invoiceData } = cachedData;

    setFormData({
      invoice_number: invoiceData.invoice_no?.toString() || '',
      bill_reference: invoiceData.bill_reference || '',
      date: new Date(invoiceData.invoice_date * 1000).toISOString().split('T')[0],
      customer_name: invoiceData.customer_name || '',
      contact_number: invoiceData.contact_number || '',
      address: invoiceData.address || '',
      city: invoiceData.city || '',
      email_id: invoiceData.email_id || '',
      state: invoiceData.state || '',
      gst_number: invoiceData.gst_number || '',
      notes: invoiceData.notes || '',
      payment_status: invoiceData.status || 1,
      payment_mode: invoiceData.payment_mode || 1,
      subtotal: invoiceData.subtotal ? invoiceData.subtotal.toString() : '',
      grand_total: invoiceData.total ? invoiceData.total.toString() : '',
      descriptions: invoiceData.descriptions || ''
    });

    if (cachedData.invoiceItems && cachedData.invoiceItems.length > 0) {
      console.log('Storing cached raw invoice items for conversion:', cachedData.invoiceItems);
      setRawInvoiceItems(cachedData.invoiceItems);
    }

    setInvoiceNumberLoading(false);
  }

  const loadReturnReasons = () => {
    setReturnReasons([
      { id: 1, reason_name: 'Damaged Product', type: 'salex' },
      { id: 2, reason_name: 'Wrong Item Received', type: 'salex' },
      { id: 3, reason_name: 'Poor Quality', type: 'salex' },
      { id: 4, reason_name: 'Customer Dissatisfaction', type: 'salex' },
      { id: 5, reason_name: 'Size/Color Issue', type: 'salex' }
    ]);
  };

  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
      } else {
        setCustomers([]);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
      setCustomers([]);
    }
  };

  const fetchInvoiceForEdit = async (invoiceId: number) => {
    try {
      console.log('🔍 FETCHING INVOICE FOR EDIT FROM API:', invoiceId);
      const response = await fetch(`/api/invoices/x/${invoiceId}`);
      if (response.ok) {
        const data = await response.json();
        const invoice = data.invoicex || data;

        const formatDateForInput = (dateValue: number | string) => {
          if (typeof dateValue === 'string') {
            if (/^\d+$/.test(dateValue)) {
              const timestamp = parseInt(dateValue);
              if (timestamp > 1000000000) {
                return new Date(timestamp * 1000).toISOString().split('T')[0];
              }
            }
            return new Date(dateValue).toISOString().split('T')[0];
          }
          return new Date(dateValue * 1000).toISOString().split('T')[0];
        };

        const invoiceNo = invoice.invoice_no ? invoice.invoice_no.toString() : '';

        if (typeof invoiceId === 'number') {
          SessionStorageService.set('salex', invoiceId.toString(), {
            invoice: invoice,
            invoiceItems: data.invoiceItems
          });
        }

        const formDataToSet = {
          invoice_number: invoiceNo,
          bill_reference: invoice.bill_reference || '',
          date: formatDateForInput(invoice.invoice_date),
          customer_name: invoice.customer_name || '',
          contact_number: invoice.contact_number || '',
          address: invoice.address || '',
          city: invoice.city || '',
          email_id: invoice.email_id || '',
          state: invoice.state || '',
          gst_number: invoice.gst_number || '',
          notes: invoice.notes || '',
          payment_status: invoice.status || 1,
          payment_mode: invoice.payment_mode || 1,
          subtotal: invoice.subtotal ? invoice.subtotal.toString() : '',
          grand_total: invoice.total ? invoice.total.toString() : '',
          descriptions: invoice.descriptions || ''
        };

        console.log('📝 SETTING FORM DATA:', formDataToSet);
        setFormData(formDataToSet);

        if (data.invoiceItems && data.invoiceItems.length > 0) {
          console.log('Storing raw invoice items for conversion:', data.invoiceItems);
          setRawInvoiceItems(data.invoiceItems);
        }
      }
    } catch (error) {
      console.error('Error fetching invoice for edit:', error);
    } finally {
      setInvoiceNumberLoading(false);
    }
  };

  const updateReturnQuantity = (id: string, quantity: number) => {
    setSelectedProducts(prev =>
      prev.map(item =>
        item.id === id ? {
          ...item,
          return_qty: Math.min(Math.max(quantity, 0), item.qty),
          total: (item.rate * Math.min(Math.max(quantity, 0), item.qty))
        } : item
      )
    );
  };

  const updateReturnReason = (id: string, reasonId: number) => {
    setSelectedProducts(prev =>
      prev.map(item =>
        item.id === id ? { ...item, return_reason_id: reasonId } : item
      )
    );
  };

  const itemsBeingReturned = useMemo(() => {
    return selectedProducts.filter(item => item.return_qty > 0);
  }, [selectedProducts]);

  const totalReturnAmount = useMemo(() => {
    return itemsBeingReturned.reduce((sum, item) => sum + item.total, 0);
  }, [itemsBeingReturned]);

  const totalReturnQuantity = useMemo(() => {
    return itemsBeingReturned.reduce((sum, item) => sum + item.return_qty, 0);
  }, [itemsBeingReturned]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (itemsBeingReturned.length === 0) {
      setErrors({ noReturns: 'Please specify return quantities for at least one item' });
      return;
    }

    const invalidItems = itemsBeingReturned.filter(item => item.return_qty <= 0 || item.return_qty > item.qty);
    if (invalidItems.length > 0) {
      setErrors({ invalidQty: 'Some return quantities are invalid' });
      return;
    }

    setErrors({});
    setShowConfirmationModal(true);
  };

  const handleConfirmSubmit = async () => {
    setLoading(true);

    try {
      const submitData = {
        invoicex_id: editInvoiceId,
        return_date: Math.floor(new Date(returnDate).getTime() / 1000),
        total_amount: totalReturnAmount,
        status: returnStatus,
        notes: returnNotes,
        fy: new Date().getFullYear(),

        returnItems: itemsBeingReturned.map(item => ({
          invoice_itemx_id: parseInt(item.id),
          return_qty: item.return_qty,
          return_reason_id: item.return_reason_id || 1,
          unit_price: item.rate,
          notes: item.return_notes || ''
        }))
      };

      const response = await fetch('/api/salex-returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      });

      if (response.ok) {
        setShowConfirmationModal(false);
        router.push('/entry/salereturn');
        showSnackbar('success', 'Salex return created successfully!');
      } else {
        const error = await response.json();
        setErrors({ submit: error.message || 'Failed to create return' });
        showSnackbar('error', error.message || 'Failed to create return');
      }
    } catch (error) {
      console.error('Error creating return:', error);
      setErrors({ submit: 'Network error occurred' });
      showSnackbar('error', 'Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubmit = () => {
    setShowConfirmationModal(false);
  };

  if (invoiceNumberLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-0">
        <div className="card">
          <div className="p-6">
            <h2 className="text-xl font-semibold text-slate-200 mb-6">Original Invoice Details</h2>

            {/* Invoice Information */}
            <div className="mb-5">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Invoice Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">INVOICE NUMBER</label>
                  <input
                    type="text"
                    value={formData.invoice_number}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">BILL REFERENCE</label>
                  <input
                    type="text"
                    value={formData.bill_reference}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">DATE</label>
                  <input
                    type="text"
                    value={formData.date}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">RETURN DATE *</label>
                  <input
                    type="date"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="input w-full"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Customer Information */}
            <div className="border-t border-slate-600 pt-4">
              <h3 className="text-lg font-medium text-slate-200 mb-3">Customer Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CUSTOMER NAME</label>
                  <input
                    type="text"
                    value={formData.customer_name}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">CONTACT NUMBER</label>
                  <input
                    type="text"
                    value={formData.contact_number}
                    className="input w-full bg-slate-700"
                    disabled
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">EMAIL ID</label>
                  <input
                    type="email"
                    value={formData.email_id}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">INVOICE TOTAL</label>
                  <input
                    type="text"
                    value={formData.grand_total}
                    className="input w-full bg-slate-700"
                    disabled
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <h2 className="text-xl font-semibold text-slate-200 mb-6">Return Item Selection</h2>

            {/* Items Table */}
            <div className="border border-slate-600 rounded mb-6">
              <table className="w-full">
                <thead className="bg-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-300">Product</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Invoice Qty</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Return Qty</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Unit Price</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Return Reason</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-300">Return Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProducts.map((item) => (
                    <tr key={item.id} className="border-t border-slate-600">
                      <td className="px-4 py-3 text-sm text-white">{item.product_name}</td>
                      <td className="px-4 py-3 text-center text-sm text-slate-300">{item.qty}</td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="number"
                          min="0"
                          max={item.qty}
                          value={item.return_qty}
                          onChange={(e) => updateReturnQuantity(item.id, parseInt(e.target.value) || 0)}
                          className="w-20 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-center text-sm"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-slate-300">₹{item.rate.toFixed(2)}</td>
                      <td className="px-4 py-3 text-center">
                        <select
                          value={item.return_reason_id || 1}
                          onChange={(e) => updateReturnReason(item.id, parseInt(e.target.value))}
                          className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm"
                        >
                          {returnReasons.map((reason) => (
                            <option key={reason.id} value={reason.id}>
                              {reason.reason_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-green-400">
                        ₹{item.return_qty > 0 ? item.total.toFixed(2) : '0.00'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-700">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-right text-sm font-medium text-slate-300">
                      TOTAL RETURN AMOUNT
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                      {totalReturnQuantity} items
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-semibold text-green-400">
                      ₹{totalReturnAmount.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {errors.noReturns && <p className="text-red-400 text-sm mt-2">{errors.noReturns}</p>}
            {errors.invalidQty && <p className="text-red-400 text-sm mt-2">{errors.invalidQty}</p>}

            {/* Return Summary */}
            {itemsBeingReturned.length > 0 && (
              <div className="border-t border-slate-600 pt-6">
                <h3 className="text-lg font-medium text-slate-200 mb-3">Return Summary</h3>
                <div className="bg-slate-700 rounded p-4 mb-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-slate-300 text-sm">Items Being Returned</p>
                      <p className="text-white font-semibold">{itemsBeingReturned.length}</p>
                    </div>
                    <div>
                      <p className="text-slate-300 text-sm">Total Return Quantity</p>
                      <p className="text-white font-semibold">{totalReturnQuantity}</p>
                    </div>
                    <div>
                      <p className="text-slate-300 text-sm">Return Amount</p>
                      <p className="text-green-400 font-semibold text-lg">₹{totalReturnAmount.toFixed(2)}</p>
                    </div>
                  </div>
                </div>

                {/* Return Notes */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">RETURN NOTES</label>
                  <textarea
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    rows={3}
                    className="input w-full"
                    placeholder="Additional notes for the return"
                  />
                </div>
              </div>
            )}
          </div>

          {errors.submit && (
            <div className="bg-red-900 border border-red-700 rounded p-3 mx-6">
              <p className="text-red-200 text-sm">{errors.submit}</p>
            </div>
          )}

          <div className="p-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => router.push('/entry/salereturn')}
              className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 rounded hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating Return...' : 'Create Return'}
            </button>
          </div>
        </div>
      </form>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        title="Create Salex Return"
        message={`Are you sure you want to create a return for ${itemsBeingReturned.length} items totaling ₹${totalReturnAmount.toFixed(2)}? This will credit the customer account.`}
        confirmText="Create Return"
        cancelText="Cancel"
        showLoading={loading}
        loadingText="Creating Return..."
        onConfirm={handleConfirmSubmit}
        onCancel={handleCancelSubmit}
      />
    </div>
  );
}
