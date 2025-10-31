import { useState } from 'react';

export const useExport = () => {
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  const openColumnSelector = () => {
    setShowColumnSelector(true);
  };

  const closeColumnSelector = () => {
    setShowColumnSelector(false);
  };

  return {
    showColumnSelector,
    openColumnSelector,
    closeColumnSelector
  };
};
