import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';

import DashboardPage from './pages/DashboardPage';
import EmployeesPage from './pages/EmployeesPage';
import AttendancePage from './pages/AttendancePage';
import ReportPage from './pages/ReportPage';
import StoricoOperaioPage from './pages/StoricoOperaioPage';
import OperaiAssuntiPage from './pages/OperaiAssuntiPage';
import CommunicationPage from './pages/CommunicationPage';
import SettingsPage from './pages/SettingsPage';
import BustePagaPage from './pages/BustePagaPage';
import SetupPage from './pages/SetupPage';
import { YearProvider } from './context/YearContext';

import './styles.css';

function reportRendererFailure(type, errorLike) {
  const payload = errorLike instanceof Error
    ? errorLike
    : new Error(typeof errorLike === 'string' ? errorLike : JSON.stringify(errorLike));
  console.error(`[renderer:${type}]`, payload);
}

window.addEventListener('error', (event) => {
  reportRendererFailure('error', event.error || event.message || 'Errore renderer sconosciuto');
});

window.addEventListener('unhandledrejection', (event) => {
  reportRendererFailure('unhandledrejection', event.reason || 'Promise rejection senza dettaglio');
});

class RendererErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[renderer:error-boundary]', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="renderer-fallback-shell">
          <div className="renderer-fallback-card">
            <div className="page-kicker">Avvio renderer</div>
            <h1 className="renderer-fallback-title">Si e verificato un errore durante il caricamento della demo.</h1>
            <p className="renderer-fallback-text">
              Chiudi e riapri l&apos;app. Se il problema continua, controlla `main-process.log` nella cartella
              `AppData\Roaming\GestionaleDemo`.
            </p>
            <pre className="renderer-fallback-error">{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const router = createHashRouter([
  {
    path: '/setup',
    element: <SetupPage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
  { index: true, element: <DashboardPage /> },
  { path: 'dipendenti', element: <EmployeesPage /> },
  { path: 'presenze', element: <AttendancePage /> },
  { path: 'report', element: <ReportPage /> },
  { path: 'buste-paga', element: <BustePagaPage /> },
  { path: 'comunicazione', element: <CommunicationPage /> },
  { path: 'impostazioni', element: <SettingsPage /> },
  { path: 'storico-operaio', element: <StoricoOperaioPage /> },
  { path: 'operai-assunti', element: <OperaiAssuntiPage /> },
],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <YearProvider>
        <RouterProvider router={router} />
      </YearProvider>
    </RendererErrorBoundary>
  </React.StrictMode>
);
