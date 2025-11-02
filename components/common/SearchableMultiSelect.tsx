import { useState, useEffect, useRef } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';

interface Option {
  id: string;
  name: string;
}

interface BaseSearchableMultiSelectProps {
  options: Option[];
  placeholder?: string;
  className?: string;
  closeOnSelect?: boolean; // Optional prop to control dropdown behavior after selection
}

interface MultiSelectProps extends BaseSearchableMultiSelectProps {
  mode?: 'multi';
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
}

interface SingleSelectProps extends BaseSearchableMultiSelectProps {
  mode: 'single';
  selectedValue: string | null;
  onSelectionChange: (value: string | null) => void;
}

type SearchableMultiSelectProps = MultiSelectProps | SingleSelectProps;

export function SearchableMultiSelect(props: SearchableMultiSelectProps) {
  const {
    options,
    placeholder = "Select options...",
    className = "",
    closeOnSelect = true, // Default to closing on select (backward compatible)
    mode = 'multi'
  } = props;

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (isDropdownOpen && searchInputRef.current) {
      // Small delay to ensure the input is rendered
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
    }
  }, [isDropdownOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(option =>
    option.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle option selection based on mode
  const handleOptionSelect = (optionId: string) => {
    if (mode === 'single') {
      const singleProps = props as SingleSelectProps;
      const newValue = singleProps.selectedValue === optionId ? null : optionId;
      singleProps.onSelectionChange(newValue);
      setIsDropdownOpen(false); // Always close for single mode
    } else {
      const multiProps = props as MultiSelectProps;
      const isSelected = multiProps.selectedValues.includes(optionId);
      const newSelection = isSelected
        ? multiProps.selectedValues.filter(id => id !== optionId)
        : [...multiProps.selectedValues, optionId];
      multiProps.onSelectionChange(newSelection);
      if (closeOnSelect) {
        setIsDropdownOpen(false); // Only close if closeOnSelect is true
      }
    }
  };

  const handleClearAll = () => {
    if (mode === 'single') {
      const singleProps = props as SingleSelectProps;
      singleProps.onSelectionChange(null);
    } else {
      const multiProps = props as MultiSelectProps;
      multiProps.onSelectionChange([]);
    }
  };

  // Get selected values based on mode
  const getSelectedValues = (): string[] => {
    if (mode === 'single') {
      const singleProps = props as SingleSelectProps;
      return singleProps.selectedValue ? [singleProps.selectedValue] : [];
    } else {
      const multiProps = props as MultiSelectProps;
      return multiProps.selectedValues;
    }
  };

  const getSelectedOptionNames = () => {
    const selectedValues = getSelectedValues();
    return selectedValues.map(id => {
      const option = options.find(opt => opt.id === id);
      return option?.name || '';
    }).filter(Boolean);
  };

  const selectedValues = getSelectedValues();

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Selected items display */}
      <div
        className="select w-full min-h-8 cursor-pointer flex items-center justify-between px-3 py-2"
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
      >
        <div className="flex flex-wrap gap-1 flex-1">
          {selectedValues.length > 0 ? (
            mode === 'single' ? (
              // Single mode: display selected value as plain text
              <span className="text-white text-sm">
                {getSelectedOptionNames()[0]}
              </span>
            ) : (
              // Multi mode: display as tags with X buttons
              selectedValues.map((value) => {
                const option = options.find(opt => opt.id === value);
                return (
                  <span
                    key={value}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 text-white text-xs rounded-sm"
                  >
                    {option?.name}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOptionSelect(value);
                      }}
                      className="hover:bg-blue-700 rounded-sm p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })
            )
          ) : (
            <span className="text-slate-400 text-sm">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0">
          {selectedValues.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClearAll();
              }}
              className="text-slate-400 hover:text-red-400 transition-colors p-1 rounded hover:bg-slate-700"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Dropdown menu */}
      {isDropdownOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-64 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-slate-700">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search options..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Options list */}
          <div className="max-h-48 overflow-y-auto">
            {filteredOptions.map((option) => {
              const isSelected = selectedValues.includes(option.id);
              return (
                <div
                  key={option.id}
                  className="flex items-center px-3 py-2 hover:bg-slate-700 cursor-pointer transition-colors"
                  onClick={() => handleOptionSelect(option.id)}
                >
                  {mode === 'multi' && (
                    <div className="flex items-center justify-center w-4 h-4 mr-3">
                      {isSelected && <Check className="w-3 h-3 text-blue-400" />}
                    </div>
                  )}
                  <span className={`text-sm ${isSelected ? 'text-blue-300 font-medium' : 'text-slate-300'}`}>
                    {option.name}
                  </span>
                </div>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-2 text-slate-500 text-sm">No options found</div>
            )}
          </div>

          {/* Footer with selected count - only for multi mode */}
          {mode === 'multi' && selectedValues.length > 0 && (
            <div className="px-3 py-2 border-t border-slate-700 bg-slate-750">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{selectedValues.length} selected</span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-red-400 hover:text-red-300 underline"
                >
                  Clear all
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
