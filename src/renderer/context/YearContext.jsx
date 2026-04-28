import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const YearContext = createContext(null);

export function YearProvider({ children }) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [yearOptions, setYearOptions] = useState([currentYear]);
  const hasManualSelectionRef = useRef(false);

  const handleSetSelectedYear = useCallback((value) => {
    hasManualSelectionRef.current = true;
    setSelectedYear((current) => {
      const nextValue = typeof value === 'function' ? value(current) : value;
      const normalized = Number(nextValue);
      return Number.isInteger(normalized) ? normalized : current;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAvailableYears() {
      try {
        const settings = await window.api.settings.get();
        const preferredYear = Number(settings?.setup?.initial_year || currentYear) || currentYear;
        const years = await window.api.appRuntime.getAvailableYears();
        if (cancelled) return;

        const normalized = Array.isArray(years)
          ? years
            .map((year) => Number(year))
            .filter((year) => Number.isInteger(year) && year > 1900)
          : [];

        const nextYears = normalized.length
          ? Array.from(new Set([...normalized, currentYear])).sort((a, b) => b - a)
          : [currentYear];

        setYearOptions(nextYears);
        setSelectedYear((current) => {
          if (!hasManualSelectionRef.current && nextYears.includes(preferredYear)) {
            return preferredYear;
          }
          if (nextYears.includes(current)) return current;
          if (nextYears.includes(preferredYear)) return preferredYear;
          return nextYears[0];
        });
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setYearOptions([currentYear]);
        }
      }
    }

    loadAvailableYears();
    return () => {
      cancelled = true;
    };
  }, [currentYear]);

  const value = useMemo(() => ({
    selectedYear,
    setSelectedYear: handleSetSelectedYear,
    yearOptions,
    getTargetYear: () => selectedYear,
  }), [handleSetSelectedYear, selectedYear, yearOptions]);

  return (
    <YearContext.Provider value={value}>
      {children}
    </YearContext.Provider>
  );
}

export function useYearContext() {
  const context = useContext(YearContext);
  if (!context) {
    throw new Error('useYearContext deve essere usato dentro YearProvider.');
  }
  return context;
}
