import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
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
import LoginPage from './pages/LoginPage';
import SetupAdminPage from './pages/SetupAdminPage';
import UsersPage from './pages/UsersPage';
import { YearProvider } from './context/YearContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RouteErrorFallback, ScreenErrorBoundary } from './components/ErrorBoundary';

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
    window.api?.diagnostics?.logRendererError?.({
      message: error?.message || String(error),
      stack: error?.stack || '',
      componentStack: errorInfo?.componentStack || '',
      route: String(window.location.hash || '').replace(/^#/, '') || '/',
      boundary: 'global-renderer-boundary',
      mode: 'global',
      timestamp: new Date().toISOString(),
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="renderer-fallback-shell">
          <div className="renderer-fallback-card">
            <div className="page-kicker">Errore globale</div>
            <h1 className="renderer-fallback-title">Si è verificato un errore nella schermata</h1>
            <p className="renderer-fallback-text">
              Route corrente: <strong>{String(window.location.hash || '').replace(/^#/, '') || '/'}</strong>
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
              <button type="button" className="button" onClick={() => { window.location.hash = '#/'; }}>
                Torna alla dashboard
              </button>
              <button type="button" className="button-secondary" onClick={() => window.location.reload()}>
                Ricarica schermata
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={async () => {
                  try {
                    const result = await window.api?.diagnostics?.generateReport?.();
                    window.alert(`Report generato sul Desktop\n${result?.filePath || ''}`);
                  } catch (error) {
                    window.alert(`Errore generazione report diagnostico: ${error?.message || error}`);
                  }
                }}
              >
                Genera report diagnostico
              </button>
            </div>
            <pre className="renderer-fallback-error">{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function withScreenBoundary(element, boundaryName) {
  return (
    <ScreenErrorBoundary boundaryName={boundaryName}>
      {element}
    </ScreenErrorBoundary>
  );
}

function AuthGuard({ children }) {
  const { currentUser, hasUsers, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    if (loading) return;
    console.info('[auth-route] protected', {
      route: location.pathname,
      hasUsers,
      currentUserPresent: Boolean(currentUser),
    });
    if (hasUsers === false) {
      navigate('/setup-admin', { replace: true });
    } else if (!currentUser) {
      navigate('/login', { replace: true });
    }
  }, [loading, hasUsers, currentUser, navigate, location.pathname]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6b7280', fontSize: 16 }}>
      Caricamento...
    </div>
  );
  if (!currentUser || hasUsers === false) return null;
  return children;
}

function LoginRouteGuard({ children }) {
  const { currentUser, hasUsers, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    if (loading) return;
    console.info('[auth-route] login', {
      route: location.pathname,
      hasUsers,
      currentUserPresent: Boolean(currentUser),
    });
    if (currentUser) {
      navigate('/', { replace: true });
      return;
    }
    if (hasUsers === false) {
      navigate('/setup-admin', { replace: true });
    }
  }, [loading, hasUsers, currentUser, navigate, location.pathname]);

  if (loading) return null;
  if (currentUser || hasUsers === false) return null;
  return children;
}

function SetupAdminRouteGuard({ children }) {
  const { currentUser, hasUsers, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    if (loading) return;
    console.info('[auth-route] setup-admin', {
      route: location.pathname,
      hasUsers,
      currentUserPresent: Boolean(currentUser),
    });
    if (currentUser) {
      navigate('/', { replace: true });
      return;
    }
    if (hasUsers === true) {
      navigate('/login', { replace: true });
    }
  }, [loading, hasUsers, currentUser, navigate, location.pathname]);

  if (loading) return null;
  if (currentUser || hasUsers === true) return null;
  return children;
}

const router = createHashRouter([
  {
    path: '/setup',
    element: withScreenBoundary(<SetupPage />, 'setup-page'),
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/login',
    element: withScreenBoundary(<LoginRouteGuard><LoginPage /></LoginRouteGuard>, 'login-page'),
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/setup-admin',
    element: withScreenBoundary(<SetupAdminRouteGuard><SetupAdminPage /></SetupAdminRouteGuard>, 'setup-admin-page'),
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/',
    element: withScreenBoundary(<AuthGuard><AppLayout /></AuthGuard>, 'app-layout'),
    errorElement: <RouteErrorFallback />,
    children: [
      { index: true, element: withScreenBoundary(<DashboardPage />, 'dashboard-page'), errorElement: <RouteErrorFallback /> },
      { path: 'dipendenti', element: withScreenBoundary(<EmployeesPage />, 'employees-page'), errorElement: <RouteErrorFallback /> },
      { path: 'presenze', element: withScreenBoundary(<AttendancePage />, 'attendance-page'), errorElement: <RouteErrorFallback /> },
      { path: 'report', element: withScreenBoundary(<ReportPage />, 'report-page'), errorElement: <RouteErrorFallback /> },
      { path: 'buste-paga', element: withScreenBoundary(<BustePagaPage />, 'payroll-page'), errorElement: <RouteErrorFallback /> },
      { path: 'comunicazione', element: withScreenBoundary(<CommunicationPage />, 'communication-page'), errorElement: <RouteErrorFallback /> },
      { path: 'impostazioni', element: withScreenBoundary(<SettingsPage />, 'settings-page'), errorElement: <RouteErrorFallback /> },
      { path: 'storico-operaio', element: withScreenBoundary(<StoricoOperaioPage />, 'history-page'), errorElement: <RouteErrorFallback /> },
      { path: 'operai-assunti', element: withScreenBoundary(<OperaiAssuntiPage />, 'hired-workers-page'), errorElement: <RouteErrorFallback /> },
      { path: 'utenti', element: withScreenBoundary(<UsersPage />, 'users-page'), errorElement: <RouteErrorFallback /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <AuthProvider>
        <YearProvider>
          <RouterProvider router={router} />
        </YearProvider>
      </AuthProvider>
    </RendererErrorBoundary>
  </React.StrictMode>
);
