import { X } from 'lucide-react';
import PaymentHistory from './PaymentHistory';

interface PaymentHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: {
    total_bill: number;
    total_paid: number;
    remaining_amount: number;
    payment_count: number;
    is_fully_paid: boolean;
    is_partially_paid: boolean;
  };
  history: Array<{
    allocation_id: number;
    payment_id: number;
    allocated_amount: number;
    allocation_date: number;
    allocation_notes: string | null;
    payment_date: number;
    payment_amount: number;
    payment_mode: number;
    payment_mode_text: string;
    payment_type: string;
    payment_notes: string | null;
    created_at: string;
  }>;
}

export default function PaymentHistoryModal({
  isOpen,
  onClose,
  summary,
  history
}: PaymentHistoryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 !mt-0">
      <div className="bg-slate-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold text-slate-200">Payment History</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <PaymentHistory summary={summary} history={history} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end p-6 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
