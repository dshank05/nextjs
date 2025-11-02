import { useState, forwardRef } from 'react';
import { X } from 'lucide-react';

interface ClearableTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
  showClearButton?: boolean;
}

export const ClearableTextarea = forwardRef<HTMLTextAreaElement, ClearableTextareaProps>(
  ({ className = '', showClearButton = true, value, onChange, ...props }, ref) => {
    const [internalValue, setInternalValue] = useState(value || '');

    const currentValue = value !== undefined ? value : internalValue;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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
      } as React.ChangeEvent<HTMLTextAreaElement>;
      onChange?.(syntheticEvent);
    };

    return (
      <div className="relative">
        <textarea
          ref={ref}
          value={currentValue}
          onChange={handleChange}
          className={`input w-full pr-8 resize-vertical ${className}`}
          {...props}
        />
        {showClearButton && currentValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-2 text-slate-400 hover:text-red-400 transition-colors p-1 rounded hover:bg-slate-700"
            title="Clear textarea"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }
);

ClearableTextarea.displayName = 'ClearableTextarea';
