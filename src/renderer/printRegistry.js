export const PRINT_CATEGORIES = [
  {
    id: 'attendance',
    label: 'Presenze',
    types: [
      {
        id: 'attendance-month-selected',
        label: 'Presenze mensili per dipendenti selezionati',
        status: 'ready',
        filters: ['year', 'month'],
        employeeSelection: 'multiple',
      },
      {
        id: 'attendance-day',
        label: 'Presenze giornaliere',
        status: 'ready',
        filters: ['date'],
        employeeSelection: 'multiple_optional',
      },
      {
        id: 'attendance-team',
        label: 'Presenze per squadra',
        status: 'ready',
        filters: ['year', 'month', 'teamId'],
        employeeSelection: 'none',
      },
      {
        id: 'attendance-all-month',
        label: 'Presenze di tutti',
        status: 'disabled',
        filters: ['year', 'month'],
        employeeSelection: 'none',
      },
    ],
  },
  {
    id: 'report',
    label: 'Report',
    types: [
      {
        id: 'report-employee-month',
        label: 'Report mensile dipendente',
        status: 'ready',
        filters: ['year', 'month'],
        employeeSelection: 'single',
      },
      {
        id: 'report-employees-month',
        label: 'Report mensile dipendenti selezionati',
        status: 'ready',
        filters: ['year', 'month'],
        employeeSelection: 'multiple',
      },
      {
        id: 'report-team-month',
        label: 'Report mensile squadra',
        status: 'ready',
        filters: ['year', 'month', 'teamId'],
        employeeSelection: 'none',
      },
      {
        id: 'report-all-month',
        label: 'Report di tutti',
        status: 'disabled',
        filters: ['year', 'month'],
        employeeSelection: 'none',
      },
    ],
  },
  {
    id: 'history',
    label: 'Storico',
    types: [
      {
        id: 'report-history-month',
        label: 'Storico report per mese',
        status: 'ready',
        filters: ['year', 'month', 'balanceStatus'],
        employeeSelection: 'single_optional',
      },
    ],
  },
  {
    id: 'payroll',
    label: 'Buste paga',
    types: [
      {
        id: 'payroll-list-month',
        label: 'Elenco buste paga per mese',
        status: 'ready',
        filters: ['year', 'month'],
        employeeSelection: 'none',
      },
      {
        id: 'payroll-single-employee',
        label: 'Busta paga di un dipendente',
        status: 'disabled',
        filters: ['year', 'month'],
        employeeSelection: 'single',
      },
      {
        id: 'payroll-status-month',
        label: 'Stato buste pagate/non pagate',
        status: 'ready',
        filters: ['year', 'month', 'payrollPaymentStatus'],
        employeeSelection: 'none',
      },
    ],
  },
  {
    id: 'communications',
    label: 'Comunicazioni',
    types: [
      {
        id: 'communications-month',
        label: 'Comunicazioni del mese',
        status: 'disabled',
        filters: ['year', 'month'],
        employeeSelection: 'none',
      },
      {
        id: 'communications-employee',
        label: 'Comunicazioni per dipendente',
        status: 'disabled',
        filters: [],
        employeeSelection: 'single',
      },
      {
        id: 'communications-period',
        label: 'Comunicazioni per periodo',
        status: 'disabled',
        filters: ['dateFrom', 'dateTo'],
        employeeSelection: 'none',
      },
    ],
  },
  {
    id: 'employees',
    label: 'Dipendenti',
    types: [
      {
        id: 'employees-active',
        label: 'Elenco dipendenti attivi',
        status: 'ready',
        filters: [],
        employeeSelection: 'none',
      },
      {
        id: 'employees-inactive',
        label: 'Elenco dipendenti inattivi',
        status: 'ready',
        filters: [],
        employeeSelection: 'none',
      },
      {
        id: 'teams-list',
        label: 'Elenco squadre',
        status: 'ready',
        filters: [],
        employeeSelection: 'none',
      },
      {
        id: 'team-members',
        label: 'Elenco dipendenti per squadra',
        status: 'ready',
        filters: ['teamId'],
        employeeSelection: 'none',
      },
    ],
  },
  {
    id: 'dpi',
    label: 'DPI',
    types: [
      {
        id: 'dpi-inventory',
        label: 'Magazzino DPI',
        status: 'ready',
        filters: [],
        employeeSelection: 'none',
      },
      {
        id: 'dpi-assignments',
        label: 'Assegnazioni DPI',
        status: 'ready',
        filters: [],
        employeeSelection: 'none',
      },
      {
        id: 'dpi-employee',
        label: 'DPI per dipendente',
        status: 'ready',
        filters: [],
        employeeSelection: 'single',
      },
    ],
  },
];

export function getAllPrintTypes() {
  return PRINT_CATEGORIES.flatMap((category) =>
    category.types.map((type) => ({
      ...type,
      categoryId: category.id,
      categoryLabel: category.label,
    }))
  );
}

export function getCategoryById(categoryId) {
  return PRINT_CATEGORIES.find((category) => category.id === categoryId) || null;
}

export function getPrintTypeById(typeId) {
  return getAllPrintTypes().find((type) => type.id === typeId) || null;
}
