import React, { useRef, useState, useCallback } from 'react';
import { Upload, X, Image as ImageIcon, FileImage } from 'lucide-react';

interface FileUploadProps {
  label: string;
  accept?: string;
  maxSize?: number; // in MB
  value?: File | null;
  previewUrl?: string;
  existingUrl?: string; // For existing files from server
  onChange?: (file: File | null, isNew: boolean) => void; // Optional for view-only mode
  onError?: (error: string) => void;
  className?: string;
  placeholder?: string;
  icon?: 'image' | 'barcode';
  viewOnly?: boolean; // New prop for view-only mode
}

export const FileUpload: React.FC<FileUploadProps> = ({
  label,
  accept = "image/*",
  maxSize = 5, // 5MB default
  value,
  previewUrl,
  existingUrl,
  onChange,
  onError,
  className = "",
  placeholder = "Drop file here or click to browse",
  icon = 'image',
  viewOnly = false
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string>('');

  const validateFile = useCallback((file: File): boolean => {
    // Check file size
    const sizeInMB = file.size / (1024 * 1024);
    if (sizeInMB > maxSize) {
      const errorMsg = `File size must be less than ${maxSize}MB. Current size: ${sizeInMB.toFixed(2)}MB`;
      setError(errorMsg);
      onError?.(errorMsg);
      return false;
    }

    // Check file type
    if (accept !== "*" && !file.type.match(accept.replace('*', '.*'))) {
      const errorMsg = `File type not allowed. Please select ${accept} files.`;
      setError(errorMsg);
      onError?.(errorMsg);
      return false;
    }

    setError('');
    return true;
  }, [maxSize, accept, onError]);

  const handleFileSelect = useCallback((file: File | null) => {
    if (file && validateFile(file)) {
      onChange(file, true); // New file
    } else if (!file) {
      onChange(null, false); // No file
      setError('');
    }
  }, [validateFile, onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    handleFileSelect(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0] || null;
    handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null, false);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getIcon = () => {
    if (icon === 'barcode') return <FileImage className="w-8 h-8 text-slate-400" />;
    return <ImageIcon className="w-8 h-8 text-slate-400" />;
  };

  const getPreviewUrl = () => {
    if (previewUrl) return previewUrl;
    if (existingUrl) return existingUrl; // Check existing URL first for view mode
    if (value) return URL.createObjectURL(value);
    return null;
  };

  const preview = getPreviewUrl();

  // View-only mode: just show the image without upload functionality
  if (viewOnly) {
    return (
      <div className={`space-y-2 ${className}`}>
        {label && (
          <label className="block text-sm font-medium text-slate-300">
            {label}
          </label>
        )}

        <div className="relative border border-slate-600 rounded-lg p-6 text-center min-h-[200px] flex flex-col justify-center bg-slate-800/50">
          {preview ? (
            <div className="space-y-3">
              <div className="relative inline-block">
                <img
                  src={preview}
                  alt="Preview"
                  className="w-48 h-48 mx-auto rounded border border-slate-600 object-cover cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => window.open(preview, '_blank')}
                  title="Click to view full size"
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm text-slate-300">
                  {icon === 'barcode' ? 'Barcode Image' : 'Product Image'}
                </p>
                <p className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer" onClick={() => window.open(preview, '_blank')}>
                  Click image to view full size
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-center">
                {getIcon()}
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 font-medium">No {icon === 'barcode' ? 'barcode' : 'image'} available</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Edit mode: full upload functionality
  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-slate-300">
          {label}
        </label>
      )}

      <div
        className={`
          relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
          transition-colors duration-200 ease-in-out min-h-[200px] flex flex-col justify-center
          ${isDragOver
            ? 'border-blue-400 bg-blue-400/10'
            : 'border-slate-400 hover:border-slate-300'
          }
          ${error ? 'border-red-400' : ''}
        `}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="hidden"
        />

        {preview ? (
          // Show image preview
          <div className="space-y-3">
            <div className="relative inline-block">
              <img
                src={preview}
                alt="Preview"
                className="w-32 h-32 mx-auto rounded border border-slate-600 object-cover"
              />
              <button
                type="button"
                onClick={handleRemove}
                className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-700 text-white rounded-full p-1 shadow-lg"
                title="Remove image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-slate-300">
                {value?.name || 'Image selected'}
              </p>
              {value && (
                <p className="text-xs text-slate-500">
                  {(value.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              )}
              <p className="text-xs text-blue-400 hover:text-blue-300">
                Click to change {icon === 'barcode' ? 'barcode' : 'image'}
              </p>
            </div>
          </div>
        ) : (
          // Show upload prompt
          <div className="space-y-3">
            <div className="flex justify-center">
              {getIcon()}
            </div>
            <div className="space-y-1">
              <p className="text-slate-300 font-medium">{placeholder}</p>
              <p className="text-xs text-slate-500">
                {accept.replace('image/', '').toUpperCase()} files up to {maxSize}MB
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-red-400 text-xs">{error}</p>
      )}
    </div>
  );
};
