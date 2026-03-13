import { useState, useEffect } from 'react';
import { X, Package } from 'lucide-react';
import { useSnackbar } from './SnackbarProvider';
import { SearchableSelect, ClearableInput } from './common';
import { ConfirmationModal } from './ConfirmationModal';

interface Product {
  id: number;
  product_name: string;
  part_no?: string;
  stock?: number;
}

interface DeadstockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingDeadstock?: {
    id: number;
    product_id: number;
    product_name: string;
    part_no: string;
    available_stock: number;
    quantity: number;
    reason: string;
    created_by: string;
  } | null;
}

export default function DeadstockModal({
  isOpen,
  onClose,
  onSuccess,
  editingDeadstock = null
}: DeadstockModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [availableStock, setAvailableStock] = useState(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Load products when modal opens
  useEffect(() => {
    if (isOpen) {
      loadProducts();
    }
  }, [isOpen]);

  // Populate form when editing
  useEffect(() => {
    if (editingDeadstock) {
      setSelectedProductId(editingDeadstock.product_id);
      setQuantity(editingDeadstock.quantity.toString());
      setReason(editingDeadstock.reason);
      setAvailableStock(editingDeadstock.available_stock);
    } else {
      // Reset form for new entry
      setSelectedProductId(null);
      setQuantity('');
      setReason('');
      setAvailableStock(0);
    }
  }, [editingDeadstock]);

  const loadProducts = async () => {
    try {
      const response = await fetch('/api/products?limit=1000&is_active=true');
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);

        // If editing, update available stock from loaded products
        if (editingDeadstock) {
          const product = data.products.find((p: any) => p.id === editingDeadstock.product_id);
          if (product) {
            setAvailableStock(product.stock || 0);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load products:', error);
    }
  };

  const handleProductChange = (productId: number) => {
    setSelectedProductId(productId);
    const product = products.find(p => p.id === productId);
    setAvailableStock(product?.stock || 0);
  };

  const hasChanges = () => {
    if (!editingDeadstock) return true; // New entries always have changes

    const qty = parseFloat(quantity);
    return (
      qty !== editingDeadstock.quantity ||
      reason.trim() !== editingDeadstock.reason.trim()
    );
  };

  const handleSubmit = () => {
    // Validation
    if (!selectedProductId) {
      showSnackbar('error', 'Please select a product');
      return;
    }

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      showSnackbar('error', 'Please enter a valid quantity greater than 0');
      return;
    }

    if (!reason.trim()) {
      showSnackbar('error', 'Please enter a reason');
      return;
    }

    // Check for changes when editing
    if (editingDeadstock && !hasChanges()) {
      showSnackbar('error', 'No changes detected. Please modify quantity or reason before updating.');
      return;
    }

    // Check stock availability for new entries
    if (!editingDeadstock && qty > availableStock) {
      showSnackbar('error', `Insufficient stock. Available: ${availableStock}, Requested: ${qty}`);
      return;
    }

    // Check stock availability for edits (calculate difference)
    if (editingDeadstock) {
      const quantityDifference = qty - editingDeadstock.quantity;
      if (quantityDifference > 0) {
        // For editing, available stock includes current deadstock quantity
        const totalAvailableStock = availableStock + editingDeadstock.quantity;
        if (totalAvailableStock < qty) {
          showSnackbar('error', `Insufficient stock for increase. Available: ${totalAvailableStock}, Requested: ${qty}`);
          return;
        }
      }
    }

    // Show confirmation modal
    setShowConfirmModal(true);
  };

  const confirmSubmit = async () => {
    setShowConfirmModal(false);
    setLoading(true);

    try {
      const payload = {
        product_id: selectedProductId,
        quantity: parseFloat(quantity),
        reason: reason.trim()
      };

      const url = editingDeadstock
        ? `/api/deadstock/${editingDeadstock.id}`
        : '/api/deadstock';

      const method = editingDeadstock ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        showSnackbar('success', data.message || `Deadstock ${editingDeadstock ? 'updated' : 'created'} successfully!`);
        onSuccess();
        onClose();
      } else {
        const error = await response.json();
        showSnackbar('error', error.message || `Failed to ${editingDeadstock ? 'update' : 'create'} deadstock`);
      }
    } catch (error) {
      console.error('Error saving deadstock:', error);
      showSnackbar('error', 'Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const selectedProduct = products.find(p => p.id === selectedProductId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 !mt-0">
      <div className="bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
            <Package className="w-5 h-5" />
            {editingDeadstock ? 'Edit Deadstock' : 'Add to Deadstock'}
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
          {/* Product Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Product *
            </label>
            <SearchableSelect
              options={[
                { id: '', name: 'Select a product...' },
                ...products.map((product) => ({
                  id: product.id.toString(),
                  name: `${product.product_name} ${product.part_no ? `(${product.part_no})` : ''} - Stock: ${product.stock || 0}`
                }))
              ]}
              selectedValue={selectedProductId?.toString() || ''}
              onSelectionChange={(value) => {
                const productId = value ? parseInt(value) : null;
                if (productId) {
                  handleProductChange(productId);
                } else {
                  setSelectedProductId(null);
                  setAvailableStock(0);
                }
              }}
              placeholder="Select a product..."
              disabled={loading || !!editingDeadstock}
            />

          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Quantity *
            </label>
            <ClearableInput
              type="number"
              step="0.01"
              min="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Enter quantity"
              disabled={loading}
            />

          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Reason *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="input w-full"
              placeholder="Enter reason for marking as deadstock..."
              disabled={loading}
              required
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
                {editingDeadstock ? 'Updating...' : 'Adding...'}
              </>
            ) : (
              editingDeadstock ? 'Update Deadstock' : 'Add to Deadstock'
            )}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmModal}
        title={editingDeadstock ? "Update Deadstock Entry" : "Add to Deadstock"}
        message={
          editingDeadstock
            ? `Stock Summary:\n• Original Stock: ${(availableStock + editingDeadstock.quantity)} units\n• Existing Deadstock: ${editingDeadstock.quantity} units\n• Current Available: ${availableStock} units\n• New Deadstock: ${quantity} units\n• Final Stock: ${(availableStock + editingDeadstock.quantity) - parseFloat(quantity)} units\n\nAre you sure you want to update this deadstock entry?`
            : `Stock Summary:\n• Original Stock: ${availableStock} units\n• Existing Deadstock: 0 units\n• Current Available: ${availableStock} units\n• New Deadstock: ${quantity} units\n• Final Stock: ${availableStock - parseFloat(quantity)} units\n\nAre you sure you want to add this deadstock entry?`
        }
        confirmText={editingDeadstock ? "Update Entry" : "Add to Deadstock"}
        cancelText="Cancel"
        showLoading={loading}
        loadingText={editingDeadstock ? "Updating..." : "Adding..."}
        onConfirm={confirmSubmit}
        onCancel={() => setShowConfirmModal(false)}
      />
    </div>
  );
}
