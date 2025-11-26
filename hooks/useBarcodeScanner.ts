import { useEffect } from 'react';

interface UseBarcodeScannerOptions {
  context: 'purchase' | 'sale' | 'salex';
  vendorState?: string;
  onProductFound: (product: any) => void;
  onError?: (error: string) => void;
  enabled?: boolean;
  requireFocus?: boolean; // Only scan when no input is focused
}

export const useBarcodeScanner = ({
  context,
  vendorState,
  onProductFound,
  onError,
  enabled = true
}: UseBarcodeScannerOptions) => {

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyTime = 0;
    let isScanning = false;

    const handleKeyDown = async (e: KeyboardEvent) => {
      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTime;

      // Check if user is currently typing in an input field
      const isInInputField = e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' ||
         e.target.contentEditable === 'true' || e.target.closest('[contenteditable="true"]'));

      console.log('🔍 Key event detected:', {
        key: e.key,
        code: e.code,
        timeDiff,
        bufferLength: buffer.length,
        isScanning,
        target: e.target instanceof HTMLElement ? e.target.tagName : 'unknown',
        isInInputField,
        type: e.type
      });

      // Skip barcode scanning if user is actively typing in an input field
      if (isInInputField && !isScanning) {
        console.log('⏭️ Skipping barcode scan - user is typing in input field');
        return;
      }

      // Detect scanner input (very fast, or starts with numbers)
      const isScannerInput = timeDiff < 50 || buffer.length > 0 || /^\d/.test(e.key);

      if (isScannerInput && !isScanning) {
        isScanning = true;
        console.log('📱 Barcode scanning started...', { context, vendorState });
      }

      if (isScanning) {
        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Enter' || e.key === 'Return') {
          // End of barcode - lookup product
          console.log('📱 Barcode scan complete:', {
            buffer,
            length: buffer.length,
            context,
            vendorState
          });

          if (buffer.length >= 8) {
            console.log('🔄 Looking up product for barcode:', buffer);

            try {
              const params = new URLSearchParams({
                code: buffer,
                context,
                ...(vendorState && { vendorState })
              });

              console.log('🌐 API request:', `/api/barcode/lookup?${params}`);

              const response = await fetch(`/api/barcode/lookup?${params}`);
              const data = await response.json();

              console.log('📡 API response:', data);

              if (data.success && data.product) {
                console.log('✅ Product found:', data.product.product_name);
                onProductFound(data.product);
              } else {
                console.error('❌ Product lookup failed:', data.error);
                onError?.(data.error || 'Product not found');
              }
            } catch (error) {
              console.error('💥 Barcode lookup error:', error);
              onError?.('Barcode lookup failed');
            }
          } else {
            console.warn('⚠️ Barcode too short, ignoring:', buffer);
          }

          buffer = '';
          isScanning = false;
        } else if (e.key.length === 1) {
          buffer += e.key;
          lastKeyTime = currentTime;
          console.log('📝 Buffer updated:', buffer);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [context, vendorState, onProductFound, onError, enabled]);
};
