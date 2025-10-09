import React, { useEffect, useState } from 'react';

export type SnackbarType = 'success' | 'error' | 'warning' | 'info';

interface SnackbarProps {
  id: string;
  type: SnackbarType;
  message: string;
  onClose: (id: string) => void;
  duration?: number; // in milliseconds
}

const Snackbar: React.FC<SnackbarProps> = ({
  id,
  type,
  message,
  onClose,
  duration = 4000
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    setIsVisible(true);

    // Auto-dismiss after duration
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(() => {
      onClose(id);
    }, 300); // Wait for exit animation
  };

  // Type-specific styling
  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'bg-slate-800',
          text: 'text-emerald-100',
          border: 'border-l-4 border-l-emerald-500',
          icon: '✅',
          iconBg: 'bg-emerald-500'
        };
      case 'error':
        return {
          bg: 'bg-slate-800',
          text: 'text-red-100',
          border: 'border-l-4 border-l-red-500',
          icon: '❌',
          iconBg: 'bg-red-500'
        };
      case 'warning':
        return {
          bg: 'bg-slate-800',
          text: 'text-amber-100',
          border: 'border-l-4 border-l-amber-500',
          icon: '⚠️',
          iconBg: 'bg-amber-500'
        };
      case 'info':
        return {
          bg: 'bg-slate-800',
          text: 'text-blue-100',
          border: 'border-l-4 border-l-blue-500',
          icon: 'ℹ️',
          iconBg: 'bg-blue-500'
        };
      default:
        return {
          bg: 'bg-slate-800',
          text: 'text-slate-100',
          border: 'border-l-4 border-l-slate-500',
          icon: '📢',
          iconBg: 'bg-slate-500'
        };
    }
  };

  const styles = getTypeStyles();

  return (
    <div
      className={`
        fixed bottom-4 right-4 z-50 min-w-96 max-w-md
        transform transition-all duration-300 ease-in-out
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-95'}
        ${isLeaving ? 'translate-x-full opacity-0 scale-95' : ''}
      `}
    >
      <div className={`${styles.bg} ${styles.border} border rounded-lg shadow-lg p-4 flex items-start space-x-3`}>
        {/* Icon */}
        <div className={`${styles.iconBg} rounded-full p-1 flex-shrink-0 mt-0.5`}>
          <span className="text-sm">{styles.icon}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`${styles.text} text-sm font-medium break-words`}>
            {message}
          </p>
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className={`${styles.text} hover:bg-black/10 rounded-full p-1 transition-colors duration-200 flex-shrink-0`}
          aria-label="Close snackbar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default Snackbar;
