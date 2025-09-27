import { useState, useEffect, useRef } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';

interface Option {
  id: string;
  name: string;
}

interface SearchableMultiSelectProps {
  options: Option[];
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function SearchableMultiSelect({
  options,
  selectedValues,
  onSelectionChange,
  placeholder = "Select options...",
  className = ""
}: SearchableMultiSelectProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const handleOptionToggle = (optionId: string) => {
    const isSelected = selectedValues.includes(optionId);
    const newSelection = isSelected
      ? selectedValues.filter(id => id !== optionId)
      : [...selectedValues, optionId];
    onSelectionChange(newSelection);
  };

  const handleClearAll = () => {
    onSelectionChange([]);
  };

  const getSelectedOptionNames = () => {
    return selectedValues.map(id => {
      const option = options.find(opt => opt.id === id);
      return option?.name || '';
    }).filter(Boolean);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Selected items display */}
      <div
        className="select w-full h-10 cursor-pointer flex items-center justify-between px-3 py-2"
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
      >
        <div className="flex flex-wrap gap-1 flex-1">
          {selectedValues.length > 0 ? (
            selectedValues.slice(0, 3).map((value) => {
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
                      handleOptionToggle(value);
                    }}
                    className="hover:bg-blue-700 rounded-sm p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })
          ) : (
            <span className="text-slate-400 text-sm">{placeholder}</span>
          )}
          {selectedValues.length > 3 && (
            <span className="text-slate-400 text-sm">+{selectedValues.length - 3} more</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
      </div>

      {/* Dropdown menu */}
      {isDropdownOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-64 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-slate-700">
            <input
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
                  onClick={() => handleOptionToggle(option.id)}
                >
                  <div className="flex items-center justify-center w-4 h-4 mr-3">
                    {isSelected && <Check className="w-3 h-3 text-blue-400" />}
                  </div>
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

          {/* Footer with selected count */}
          {selectedValues.length > 0 && (
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
