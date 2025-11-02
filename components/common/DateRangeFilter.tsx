import React, { useState, useRef, useEffect } from 'react';
import DatePicker from 'react-datepicker';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { Calendar, ChevronDown } from 'lucide-react';
import 'react-datepicker/dist/react-datepicker.css';

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onDateChange: (startDate: string, endDate: string) => void;
  placeholder?: string;
  className?: string;
}

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  startDate,
  endDate,
  onDateChange,
  placeholder = "Select date range...",
  className = ""
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [startDateState, setStartDateState] = useState<Date | null>(
    startDate ? new Date(startDate) : null
  );
  const [endDateState, setEndDateState] = useState<Date | null>(
    endDate ? new Date(endDate) : null
  );

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Update dates when props change - ensure local timezone
  useEffect(() => {
    if (startDate) {
      const [year, month, day] = startDate.split('-').map(Number);
      setStartDateState(new Date(year, month - 1, day)); // month is 0-based
    } else {
      setStartDateState(null);
    }

    if (endDate) {
      const [year, month, day] = endDate.split('-').map(Number);
      setEndDateState(new Date(year, month - 1, day)); // month is 0-based
    } else {
      setEndDateState(null);
    }
  }, [startDate, endDate]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDateChange = (dates: [Date | null, Date | null]) => {
    const [start, end] = dates;
    setStartDateState(start);
    setEndDateState(end);

    if (start && end) {
      // Use native Date methods to avoid timezone issues
      const formatLocalDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      onDateChange(
        formatLocalDate(start),
        formatLocalDate(end)
      );
    }
  };

  const getDisplayText = () => {
    if (!startDateState || !endDateState) {
      return placeholder;
    }

    // Use native Date methods to avoid timezone issues
    const formatLocalDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (formatLocalDate(startDateState) === formatLocalDate(endDateState)) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = monthNames[startDateState.getMonth()];
      const day = startDateState.getDate();
      const year = startDateState.getFullYear();
      return `${month} ${day.toString().padStart(2, '0')}, ${year}`;
    }

    const startMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const endMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const startMonth = startMonthNames[startDateState.getMonth()];
    const startDay = startDateState.getDate();
    const endMonth = endMonthNames[endDateState.getMonth()];
    const endDay = endDateState.getDate();
    const endYear = endDateState.getFullYear();

    return `${startMonth} ${startDay.toString().padStart(2, '0')} - ${endMonth} ${endDay.toString().padStart(2, '0')}, ${endYear}`;
  };

  const clearSelection = () => {
    setStartDateState(null);
    setEndDateState(null);
    onDateChange('', '');
    setIsOpen(false);
  };

  const applyQuickOption = (start: Date, end: Date) => {
    setStartDateState(start);
    setEndDateState(end);

    // Use native Date methods to avoid timezone issues
    const formatLocalDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    onDateChange(
      formatLocalDate(start),
      formatLocalDate(end)
    );
    setIsOpen(false);
  };

  const quickOptions = [
    {
      label: 'Today',
      action: () => {
        const today = new Date();
        applyQuickOption(startOfDay(today), endOfDay(today));
      }
    },
    {
      label: 'Yesterday',
      action: () => {
        const yesterday = subDays(new Date(), 1);
        applyQuickOption(startOfDay(yesterday), endOfDay(yesterday));
      }
    },
    {
      label: 'Last 7 days',
      action: () => {
        const end = new Date();
        const start = subDays(end, 6);
        applyQuickOption(startOfDay(start), endOfDay(end));
      }
    },
    {
      label: 'Last 30 days',
      action: () => {
        const end = new Date();
        const start = subDays(end, 29);
        applyQuickOption(startOfDay(start), endOfDay(end));
      }
    },
    {
      label: 'This month',
      action: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        applyQuickOption(startOfDay(start), endOfDay(end));
      }
    },
    {
      label: 'Last month',
      action: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        applyQuickOption(startOfDay(start), endOfDay(end));
      }
    }
  ];

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <div
        className="input cursor-pointer flex items-center justify-between"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
          fontFamily: 'Inter, sans-serif'
        }}
      >
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          <span style={{ color: startDateState && endDateState ? 'var(--text)' : 'var(--text-secondary)' }}>
            {getDisplayText()}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-secondary)' }}
        />
      </div>

      {/* Date Picker */}
      {isOpen && (
        <div
          className="absolute top-full right-0 z-50 mt-1 rounded-lg shadow-xl"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            borderWidth: '1px',
            borderStyle: 'solid',
            padding: '1rem',
            minWidth: '450px',
            maxWidth: '90vw'
          }}
        >
          {/* Main Content Area */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            {/* Calendar */}
            <div>
              <DatePicker
                selected={startDateState}
                onChange={handleDateChange}
                startDate={startDateState}
                endDate={endDateState}
                selectsRange
                inline
                className="custom-datepicker"
              />
            </div>

            {/* Vertical Divider */}
            <div
              style={{
                width: '1px',
                backgroundColor: 'var(--border)',
                margin: '0 0.5rem'
              }}
            />

            {/* Quick Options */}
            <div style={{ minWidth: '120px' }}>
              <div
                style={{
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  marginBottom: '0.75rem',
                  fontFamily: 'Inter, sans-serif'
                }}
              >
                Quick Select
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.375rem'
                }}
              >
                {quickOptions.map((option, index) => (
                  <button
                    key={index}
                    onClick={option.action}
                    style={{
                      padding: '0.5rem 0.75rem',
                      fontSize: '0.875rem',
                      backgroundColor: 'var(--card)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                      fontFamily: 'Inter, sans-serif',
                      textAlign: 'left',
                      transition: 'all 0.2s',
                      width: '100%'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--border)';
                      e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--card)';
                      e.currentTarget.style.borderColor = 'var(--border)';
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Buttons - Compact layout */}
          <div
            style={{
              marginTop: '1rem',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.5rem'
            }}
          >
            <button
              onClick={clearSelection}
              style={{
                padding: '0.25rem 0.75rem',
                fontSize: '0.875rem',
                color: 'var(--error)',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                borderRadius: '0.25rem'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#fca5a5'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--error)'}
            >
              Clear
            </button>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                backgroundColor: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--accent-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--accent)'}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Custom Styles for React DatePicker */}
      <style jsx global>{`
        .custom-datepicker .react-datepicker {
          background-color: var(--surface) !important;
          color: var(--text) !important;
          border: none !important;
          border-radius: 8px !important;
          box-shadow: none !important;
          font-family: 'Inter', sans-serif !important;
        }

        .custom-datepicker .react-datepicker__header {
          background-color: var(--surface) !important;
          border-bottom: 1px solid var(--border) !important;
          border-radius: 8px 8px 0 0 !important;
          padding: 8px 0 !important;
        }

        .custom-datepicker .react-datepicker__current-month,
        .custom-datepicker .react-datepicker-time__header {
          color: var(--text) !important;
          font-weight: 600 !important;
          font-size: 16px !important;
          font-family: 'Inter', sans-serif !important;
        }

        .custom-datepicker .react-datepicker__day-names,
        .custom-datepicker .react-datepicker__week {
          display: flex !important;
          justify-content: space-around !important;
        }

        .custom-datepicker .react-datepicker__day-name,
        .custom-datepicker .react-datepicker__day {
          color: var(--text) !important;
          font-size: 14px !important;
          font-family: 'Inter', sans-serif !important;
          width: 32px !important;
          height: 32px !important;
          line-height: 32px !important;
          text-align: center !important;
          margin: 1px !important;
          border-radius: 4px !important;
          cursor: pointer !important;
        }

        .custom-datepicker .react-datepicker__day-name {
          color: var(--text-secondary) !important;
          font-weight: 500 !important;
          cursor: default !important;
        }

        .custom-datepicker .react-datepicker__day:hover {
          background-color: var(--card) !important;
          color: var(--text) !important;
        }

        .custom-datepicker .react-datepicker__day--selected,
        .custom-datepicker .react-datepicker__day--in-selecting-range,
        .custom-datepicker .react-datepicker__day--in-range {
          background-color: var(--accent) !important;
          color: white !important;
        }

        .custom-datepicker .react-datepicker__day--range-start,
        .custom-datepicker .react-datepicker__day--range-end {
          background-color: var(--accent-hover) !important;
          color: white !important;
        }

        .custom-datepicker .react-datepicker__day--today {
          color: var(--accent) !important;
          font-weight: 600 !important;
        }

        .custom-datepicker .react-datepicker__day--disabled {
          color: #64748b !important;
          cursor: not-allowed !important;
        }

        .custom-datepicker .react-datepicker__day--disabled:hover {
          background-color: transparent !important;
        }

        .custom-datepicker .react-datepicker__navigation {
          background: none !important;
          border: none !important;
          cursor: pointer !important;
          outline: none !important;
          top: 8px !important;
          width: 24px !important;
          height: 24px !important;
          border-radius: 4px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }

        .custom-datepicker .react-datepicker__navigation:hover {
          background-color: var(--card) !important;
        }

        .custom-datepicker .react-datepicker__navigation-icon::before {
          border-color: var(--text) !important;
          border-width: 2px 2px 0 0 !important;
          width: 6px !important;
          height: 6px !important;
        }

        .custom-datepicker .react-datepicker__navigation--previous {
          left: 8px !important;
        }

        .custom-datepicker .react-datepicker__navigation--next {
          right: 8px !important;
        }

        .custom-datepicker .react-datepicker__navigation--previous .react-datepicker__navigation-icon::before {
          transform: rotate(-135deg) !important;
        }

        .custom-datepicker .react-datepicker__navigation--next .react-datepicker__navigation-icon::before {
          transform: rotate(45deg) !important;
        }

        .custom-datepicker .react-datepicker__month-dropdown,
        .custom-datepicker .react-datepicker__year-dropdown {
          background-color: var(--card) !important;
          border: 1px solid var(--border) !important;
          border-radius: 4px !important;
          color: var(--text) !important;
          font-family: 'Inter', sans-serif !important;
        }

        .custom-datepicker .react-datepicker__month-option,
        .custom-datepicker .react-datepicker__year-option {
          color: var(--text) !important;
          padding: 4px 8px !important;
          cursor: pointer !important;
        }

        .custom-datepicker .react-datepicker__month-option:hover,
        .custom-datepicker .react-datepicker__year-option:hover {
          background-color: var(--border) !important;
        }

        .custom-datepicker .react-datepicker__month-option--selected,
        .custom-datepicker .react-datepicker__year-option--selected {
          background-color: var(--accent) !important;
          color: white !important;
        }
      `}</style>
    </div>
  );
};
