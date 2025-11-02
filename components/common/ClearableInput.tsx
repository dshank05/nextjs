import { useState, forwardRef } from 'react';
import { X } from 'lucide-react';

interface ClearableInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  showClearButton?: boolean;
}

export const ClearableInput = forwardRef<HTMLInputElement, ClearableInputProps>(
  ({ className = '', showClearButton = true, value, onChange, ...props }, ref) => {
    const [internalValue, setInternalValue] = useState(value || '');

    const currentValue = value !== undefined ? value : internalValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      if (value === undefined) {
        setInternalValue(newValue);
      }
      onChange?.(e);
    };

    const handleClear = () => {
      const emptyValue = '';
      if (value === undefined) {
        setInternalValue(emptyValue);
      }
      // Create a synthetic event for onChange
      const syntheticEvent = {
        target: { value: emptyValue, name: props.name }
      } as React.ChangeEvent<HTMLInputElement>;
      onChange?.(syntheticEvent);
    };

    return (
      <div className="relative">
        <input
          ref={ref}
          value={currentValue}
          onChange={handleChange}
          className={`input w-full pr-8 ${className}`}
          {...props}
        />
        {showClearButton && currentValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-red-400 transition-colors p-1 rounded hover:bg-slate-700"
            title="Clear input"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }
);

ClearableInput.displayName = 'ClearableInput';
