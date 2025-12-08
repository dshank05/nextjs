import { useState } from 'react';
import { X, DollarSign } from 'lucide-react';
import { useSnackbar } from './SnackbarProvider';

interface QuickPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  purchaseId: number;
  vendorId: number;
  vendorName: string;
  outstandingAmount: number;
}

export default function QuickPaymentModal({
  isOpen,
  onClose,
  onSuccess,
  purchaseId,
  vendorId,
  vendorName,
  outstandingAmount
}: QuickPaymentModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(outstandingAmount.toString());
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMode, setPaymentMode] = useState<number>(1); // 0=Cash, 1=Bank
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const amount = parseFloat(paymentAmount);
    
    if (isNaN(amount) || amount <= 0) {
      showSnackbar('error', 'Please enter a valid payment amount');
      return;
    }

    if (amount > outstandingAmount) {
      showSnackbar('error', 'Payment amount cannot exceed outstanding amount');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/vendor-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: vendorId,
          payment_date: Math.floor(new Date(paymentDate).getTime() / 1000),
          payment_amount: amount,
          payment_mode: paymentMode,
          notes: notes || `Payment for purchase #${purchaseId}`,
          allocations: [{
            purchase_id: purchaseId,
            allocated_amount: amount,
            notes: notes || null
          }]
        })
      });

      if (response.ok) {
        showSnackbar('success', `Payment of ₹${amount.toLocaleString()} recorded successfully!`);
        onSuccess();
        onClose();
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || 'Failed to record payment');
      }
    } catch (error) {
      console.error('Error recording payment:', error);
      showSnackbar('error', 'Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Record Payment
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
            disabled={loading}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <p className="text-sm text-slate-400">Vendor</p>
            <p className="text-white font-medium">{vendorName}</p>
          </div>

          <div>
            <p className="text-sm text-slate-400">Outstanding Amount</p>
            <p className="text-orange-400 font-semibold text-lg">
              ₹{outstandingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Payment Amount *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={outstandingAmount}
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className="input w-full"
              placeholder="Enter amount"
              disabled={loading}
            />
            <p className="text-xs text-slate-400 mt-1">
              Enter full amount for complete payment, or partial amount
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Payment Date *
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="input w-full"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Payment Mode *
            </label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(parseInt(e.target.value))}
              className="input w-full"
              disabled={loading}
            >
              <option value={0}>Cash</option>
              <option value={1}>Bank</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="input w-full"
              placeholder="Add any notes about this payment..."
              disabled={loading}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-2"
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Recording...
              </>
            ) : (
              'Record Payment'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
