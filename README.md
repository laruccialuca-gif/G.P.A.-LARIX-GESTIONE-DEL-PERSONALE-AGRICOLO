# Gestionale Presenze Offline

Base pronta per convertire il progetto Base44 in app desktop offline con Electron + React + SQLite.

## Cosa fa
- Anagrafica dipendenti offline
- Presenze offline
- Riepilogo mensile con paga stimata
- Database SQLite locale

## Avvio
1. Installa Node.js 20+
2. Da terminale:
   npm install
   npm run dev

## Dove salvare il tuo codice esistente
- `src/renderer/components/EmployeeForm.jsx` → qui puoi incollare il tuo form attuale
- `src/renderer/pages/EmployeesPage.jsx` → qui agganci il form e usi `window.api.employees.create/update`
- `src/renderer/pages/AttendancePage.jsx` → qui colleghi il form presenze

## Come sostituire Base44
Prima:
```js
import { base44 } from '@/lib/base44';
await base44.entities.Employee.create(form);
```

Dopo:
```js
await window.api.employees.create(form);
```

## IPC disponibili
- `window.api.employees.list()`
- `window.api.employees.create(payload)`
- `window.api.employees.update(id, payload)`
- `window.api.employees.delete(id)`
- `window.api.attendance.save(payload)`
- `window.api.attendance.listByMonth(year, month)`
- `window.api.attendance.monthlySummary(year, month)`
