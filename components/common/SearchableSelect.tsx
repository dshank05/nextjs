import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

interface Option {
  id: string;
  name: string;
}

interface SearchableSelectProps {
  options: Option[];
  selectedValue: string | null;
  onSelectionChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  options,
  selectedValue,
  onSelectionChange,
  placeholder = "Select option...",
  className = "",
  disabled = false
}: SearchableSelectProps) {
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

  const handleOptionSelect = (optionId: string) => {
    const newValue = selectedValue === optionId ? null : optionId;
    onSelectionChange(newValue);
    setIsDropdownOpen(false);
  };

  const handleClearSelection = () => {
    onSelectionChange(null);
  };

  const getSelectedOptionName = () => {
    if (!selectedValue) return null;
    const option = options.find(opt => opt.id === selectedValue);
    return option?.name || null;
  };

  const selectedOptionName = getSelectedOptionName();

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Selected value display */}
      <div
        className={`select w-full min-h-8 flex items-center justify-between px-3 py-2 ${
          disabled
            ? 'bg-slate-700 bg-opacity-75 text-slate-400 border-slate-600 cursor-not-allowed'
            : 'cursor-pointer'
        }`}
        onClick={() => !disabled && setIsDropdownOpen(!isDropdownOpen)}
      >
        <div className="flex-1">
          {selectedOptionName ? (
            <span className={`text-sm ${disabled ? 'text-slate-400' : 'text-white'}`}>{selectedOptionName}</span>
          ) : (
            <span className="text-slate-400 text-sm">{placeholder}</span>
          )}
        </div>
        <ChevronDown className={`w-5 h-5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''} ml-2 flex-shrink-0 ${
          disabled ? 'text-slate-500' : 'text-slate-400'
        }`} />
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
              const isSelected = selectedValue === option.id;
              return (
                <div
                  key={option.id}
                  className="flex items-center px-3 py-2 hover:bg-slate-700 cursor-pointer transition-colors"
                  onClick={() => handleOptionSelect(option.id)}
                >
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

          {/* Clear selection option */}
          {selectedValue && (
            <div className="px-3 py-2 border-t border-slate-700 bg-slate-750">
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-red-400 hover:text-red-300 underline text-xs"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
