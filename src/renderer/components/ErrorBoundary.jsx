import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useRouteError } from 'react-router-dom';

function getCurrentRoute(locationPathname) {
  if (locationPathname) return locationPathname;
  const hash = String(window.location.hash || '').replace(/^#/, '');
  return hash || '/';
}

async function reportReactError(payload) {
  try {
    await window.api?.diagnostics?.logRendererError?.({
      ...payload,
      timestamp: payload.timestamp || new Date().toISOString(),
    });
  } catch (error) {
    console.error('[renderer:error-report-failed]', error);
  }
}

function notifyToast(message, tone = 'error') {
  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: {
      message,
      tone,
    },
  }));
}

function ErrorFallbackPanel({ route, onReload, onDashboard, onDiagnostics }) {
  const [generatingReport, setGeneratingReport] = useState(false);

  async function handleDiagnostics() {
    try {
      setGeneratingReport(true);
      const result = await onDiagnostics();
      notifyToast(`Report generato sul Desktop: ${result.filePath}`, 'success');
    } catch (error) {
      notifyToast(`Errore generazione report diagnostico: ${error.message}`, 'error');
    } finally {
      setGeneratingReport(false);
    }
  }

  return (
    <div className="renderer-fallback-shell">
      <div className="renderer-fallback-card">
        <div className="page-kicker">Errore schermata</div>
        <h1 className="renderer-fallback-title">Si è verificato un errore nella schermata</h1>
        <p className="renderer-fallback-text">
          Route corrente: <strong>{route || '/'}</strong>
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
          <button type="button" className="button" onClick={onDashboard}>
            Torna alla dashboard
          </button>
          <button type="button" className="button-secondary" onClick={onReload}>
            Ricarica schermata
          </button>
          <button type="button" className="button-secondary" onClick={handleDiagnostics} disabled={generatingReport}>
            {generatingReport ? 'Generazione report...' : 'Genera report diagnostico'}
          </button>
        </div>
      </div>
    </div>
  );
}

class BaseErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    const payload = {
      message: error?.message || String(error),
      stack: error?.stack || '',
      componentStack: errorInfo?.componentStack || '',
      route: this.props.route || getCurrentRoute(),
      boundary: this.props.boundaryName || 'unknown-boundary',
      mode: this.props.mode || 'screen',
    };
    console.error('[renderer:error-boundary]', payload, error);
    reportReactError(payload);

    if (this.props.mode === 'modal') {
      notifyToast('La finestra corrente è stata chiusa dopo un errore.', 'error');
      this.props.onModalError?.(error);
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.mode === 'modal') {
        return null;
      }
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}

function ScreenErrorBoundary({ children, boundaryName }) {
  const navigate = useNavigate();
  const location = useLocation();
  const route = getCurrentRoute(location.pathname);

  return (
    <BaseErrorBoundary
      route={route}
      boundaryName={boundaryName}
      mode="screen"
      fallback={(
        <ErrorFallbackPanel
          route={route}
          onDashboard={() => navigate('/')}
          onReload={() => window.location.reload()}
          onDiagnostics={() => window.api.diagnostics.generateReport()}
        />
      )}
    >
      {children}
    </BaseErrorBoundary>
  );
}

function ModalErrorBoundary({ children, boundaryName, onClose }) {
  const location = useLocation();
  const route = getCurrentRoute(location.pathname);

  return (
    <BaseErrorBoundary
      route={route}
      boundaryName={boundaryName}
      mode="modal"
      onModalError={() => onClose?.()}
    >
      {children}
    </BaseErrorBoundary>
  );
}

function RouteErrorFallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeError = useRouteError();
  const route = getCurrentRoute(location.pathname);

  useEffect(() => {
    reportReactError({
      message: routeError?.message || String(routeError || 'Unknown route error'),
      stack: routeError?.stack || '',
      componentStack: '',
      route,
      boundary: 'route-error-element',
      mode: 'route',
    });
  }, [routeError, route]);

  return (
    <ErrorFallbackPanel
      route={route}
      onDashboard={() => navigate('/')}
      onReload={() => window.location.reload()}
      onDiagnostics={() => window.api.diagnostics.generateReport()}
    />
  );
}

export {
  ModalErrorBoundary,
  RouteErrorFallback,
  ScreenErrorBoundary,
};
