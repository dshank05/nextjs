import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  showLoading?: boolean;
  loadingText?: string;
  cancelLoadingText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = "OK",
  cancelText = "Cancel",
  showLoading = false,
  loadingText = "Saving...",
  cancelLoadingText = "Cancel",
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-800 p-8 rounded-lg w-md shadow-lg max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-white mb-4">{title}</h2>
          <p className="text-slate-300">
            {message}
          </p>
        </div>

        <div className="flex justify-center gap-4">
          <button
            onClick={onConfirm}
            disabled={showLoading}
            className="btn-primary px-6 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {showLoading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b border-white"></div>
            )}
            {showLoading ? loadingText : confirmText}
          </button>
          <button
            onClick={onCancel}
            disabled={showLoading}
            className="btn-secondary px-6 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {showLoading ? cancelLoadingText : cancelText}
          </button>
        </div>
      </div>
    </div>
  );
};
