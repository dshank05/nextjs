import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import Snackbar, { SnackbarType } from './Snackbar';

interface SnackbarItem {
  id: string;
  type: SnackbarType;
  message: string;
  duration?: number;
}

interface SnackbarContextType {
  showSnackbar: (type: SnackbarType, message: string, duration?: number) => void;
}

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined);

interface SnackbarProviderProps {
  children: ReactNode;
}

export const SnackbarProvider: React.FC<SnackbarProviderProps> = ({ children }) => {
  const [snackbars, setSnackbars] = useState<SnackbarItem[]>([]);

  const showSnackbar = useCallback((type: SnackbarType, message: string, duration?: number) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newSnackbar: SnackbarItem = {
      id,
      type,
      message,
      duration
    };

    setSnackbars(prev => [...prev, newSnackbar]);
  }, []);

  const closeSnackbar = useCallback((id: string) => {
    setSnackbars(prev => prev.filter(snackbar => snackbar.id !== id));
  }, []);

  const contextValue: SnackbarContextType = {
    showSnackbar
  };

  return (
    <SnackbarContext.Provider value={contextValue}>
      {children}
      {/* Render all active snackbars */}
      {snackbars.map(snackbar => (
        <Snackbar
          key={snackbar.id}
          id={snackbar.id}
          type={snackbar.type}
          message={snackbar.message}
          onClose={closeSnackbar}
          duration={snackbar.duration}
        />
      ))}
    </SnackbarContext.Provider>
  );
};

export const useSnackbar = (): SnackbarContextType => {
  const context = useContext(SnackbarContext);
  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider');
  }
  return context;
};
