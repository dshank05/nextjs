import React from 'react';
import { X } from 'lucide-react';
import { FileUpload } from './FileUpload';

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl?: string;
  barcodeUrl?: string;
  productName?: string;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  barcodeUrl,
  productName
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 !mt-0">
      <div className="bg-slate-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">
            {productName ? `${productName} - Media` : 'Product Media'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Product Image */}
            <FileUpload
              label="PRODUCT IMAGE"
              existingUrl={imageUrl}
              viewOnly={true}
              icon="image"
            />

            {/* Barcode Image */}
            <FileUpload
              label="BARCODE IMAGE"
              existingUrl={barcodeUrl}
              viewOnly={true}
              icon="barcode"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
