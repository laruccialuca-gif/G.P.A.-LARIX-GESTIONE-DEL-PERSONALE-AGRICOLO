import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import LicenseGate from '../components/LicenseGate';
import { getSoftwareBrandingLabel } from '../config/branding';
import { useYearContext } from '../context/YearContext';
import { useAuth } from '../context/AuthContext';
import { dispatchNavigationStart } from '../utils/navigationPerf';

function inferToastTone(message) {
  if (!message) return 'info';
  if (/errore|fallit|non valido|impossibile/i.test(message)) return 'error';
  if (/salvat|creat|aggiornat|attivat|ripristinat|backup/i.test(message)) return 'success';
  return 'info';
}

export default function AppLayout() {
  const { selectedYear, setSelectedYear, yearOptions } = useYearContext();
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationPerfRef = useRef({
    route: '',
    startedAt: 0,
    loggedRoutes: new Map(),
  });
  const [demoInfo, setDemoInfo] = useState(null);
  const [showDemoWelcome, setShowDemoWelcome] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastTimersRef = useRef(new Map());
  const [settingsInfo, setSettingsInfo] = useState(null);
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [activeOperations, setActiveOperations] = useState([]);

  const dismissToast = useCallback((toastId) => {
    const timerId = toastTimersRef.current.get(toastId);
    if (timerId) {
      clearTimeout(timerId);
      toastTimersRef.current.delete(toastId);
    }

    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const pushToast = useCallback((message, tone = inferToastTone(message)) => {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) return;

    const toastId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id: toastId, message: normalizedMessage, tone }].slice(-4));

    const timerId = setTimeout(() => {
      dismissToast(toastId);
    }, tone === 'error' ? 6500 : 4200);

    toastTimersRef.current.set(toastId, timerId);
  }, [dismissToast]);

  useEffect(() => {
    const logRoutePerf = (route, startedAt, readyAt) => {
      if (!route || !Number.isFinite(startedAt) || !Number.isFinite(readyAt)) return;
      const loadMs = Math.max(0, Math.round(readyAt - startedAt));
      const alreadyLoggedAt = navigationPerfRef.current.loggedRoutes.get(route);
      if (alreadyLoggedAt === startedAt) return;
      navigationPerfRef.current.loggedRoutes.set(route, startedAt);
      const logMsg = `[nav-perf] route=${route} loadMs=${loadMs}`;
      console.info(logMsg);
      window.api?.diagnostics?.logRendererEvent?.({
        type: 'nav-perf',
        route,
        loadMs,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    };

    const handleNavStart = (event) => {
      const route = String(event.detail?.route || '').trim() || '/';
      const startedAt = Number(event.detail?.startedAt);
      navigationPerfRef.current.route = route;
      navigationPerfRef.current.startedAt = Number.isFinite(startedAt) ? startedAt : performance.now();
    };

    const handleRouteReady = (event) => {
      const route = String(event.detail?.route || '').trim() || '/';
      const readyAt = Number(event.detail?.readyAt);
      if (route !== navigationPerfRef.current.route) {
        navigationPerfRef.current.route = route;
        navigationPerfRef.current.startedAt = performance.now();
      }
      logRoutePerf(
        route,
        navigationPerfRef.current.startedAt || performance.now(),
        Number.isFinite(readyAt) ? readyAt : performance.now(),
      );
    };

    window.addEventListener('app:nav-start', handleNavStart);
    window.addEventListener('app:route-ready', handleRouteReady);

    return () => {
      window.removeEventListener('app:nav-start', handleNavStart);
      window.removeEventListener('app:route-ready', handleRouteReady);
    };
  }, []);

  useEffect(() => {
    const currentRoute = location.pathname || '/';
    const previousRoute = navigationPerfRef.current.route;
    if (currentRoute !== previousRoute) {
      dispatchNavigationStart(currentRoute);
    }
  }, [location.pathname]);

  useEffect(() => {
    let isMounted = true;

    async function loadRuntimeInfo() {
      try {
        const info = await window.api.appRuntime.getInfo();
        if (!isMounted) return;
        setDemoInfo(info || null);
        setShowDemoWelcome(!!info?.is_demo && !info?.welcome_seen);
      } catch (error) {
        console.error(error);
      }
    }

    loadRuntimeInfo();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSettingsInfo() {
      try {
        const data = await window.api.settings.get();
        if (!cancelled) {
          setSettingsInfo(data || null);
        }
      } catch (error) {
        console.error(error);
      }
    }

    loadSettingsInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLicenseStatus() {
      try {
        const data = await window.api.license.getStatus();
        if (!cancelled) {
          setLicenseStatus(data || null);
        }
      } catch (error) {
        console.error(error);
      }
    }

    loadLicenseStatus();
    const timerId = setInterval(loadLicenseStatus, 60000);

    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    if (settingsInfo?.should_show_initial_setup && location.pathname !== '/setup') {
      navigate('/setup', { replace: true });
    }
  }, [settingsInfo, location.pathname, navigate]);

  useEffect(() => {
    let mounted = true;
    let clearCompletedTimer = null;

    async function loadOperations() {
      try {
        const jobs = await window.api.operations.getActiveJobs();
        if (mounted) {
          setActiveOperations(Array.isArray(jobs) ? jobs : []);
        }
      } catch (error) {
        console.error(error);
      }
    }

    const unsubscribe = window.api.operations.onProgress((payload) => {
      setActiveOperations((current) => {
        const others = current.filter((item) => item.type !== payload.type);
        if (payload.status === 'idle') {
          return others;
        }
        return [...others, payload];
      });

      if (payload.status === 'completed') {
        pushToast(payload.message || 'Operazione completata.', 'success');
      } else if (payload.status === 'error') {
        pushToast(payload.message || 'Operazione fallita.', 'error');
      }

      if (payload.status === 'completed' || payload.status === 'error') {
        if (clearCompletedTimer) {
          clearTimeout(clearCompletedTimer);
        }
        clearCompletedTimer = setTimeout(() => {
          setActiveOperations((current) =>
            current.filter((item) => item.type !== payload.type || item.job_id !== payload.job_id || item.status === 'running')
          );
        }, 3500);
      }
    });

    loadOperations();

    return () => {
      mounted = false;
      unsubscribe?.();
      if (clearCompletedTimer) {
        clearTimeout(clearCompletedTimer);
      }
    };
  }, [pushToast]);

  useEffect(() => {
    const previousAlert = window.alert;
    const handleToastEvent = (event) => {
      pushToast(event.detail?.message, event.detail?.tone);
    };

    window.alert = (message) => {
      pushToast(message);
    };

    window.addEventListener('app:toast', handleToastEvent);

    return () => {
      window.alert = previousAlert;
      window.removeEventListener('app:toast', handleToastEvent);
      toastTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      toastTimersRef.current.clear();
    };
  }, [pushToast]);

  async function handleCloseDemoWelcome() {
    try {
      const next = await window.api.demo.markWelcomeSeen();
      setDemoInfo(next || null);
    } catch (error) {
      console.error(error);
    } finally {
      setShowDemoWelcome(false);
    }
  }

  const runningOperations = activeOperations.filter((item) => item.status === 'running');

  return (
    <div className="app-shell">
      <div className="app-sidebar no-print">
        <Sidebar />
      </div>

      <main className="app-main">
        <div className="app-main-inner">
          {demoInfo?.is_demo ? (
            <div className="demo-banner no-print">
              <div>
                <div className="demo-banner-kicker">Modalita demo</div>
                <div className="demo-banner-title">Ambiente separato dai dati reali con archivio di esempio gia pronto.</div>
              </div>
              <div className="demo-banner-meta">
                Dati demo isolati
              </div>
            </div>
          ) : null}

          {currentUser?.role === 'super_admin' ? (
            <div
              className="demo-banner no-print"
              style={{
                background: 'linear-gradient(135deg, rgba(67, 56, 202, 0.96), rgba(99, 102, 241, 0.92))',
                color: '#eef2ff',
              }}
            >
              <div>
                <div className="demo-banner-kicker" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  Modalità sviluppatore
                </div>
                <div className="demo-banner-title" style={{ color: '#ffffff' }}>
                  Modalità amministratore sistema — accesso completo attivo
                </div>
              </div>
              <div className="demo-banner-meta" style={{ color: '#c7d2fe' }}>
                Tutte le azioni vengono registrate nel log
              </div>
            </div>
          ) : null}

          {!demoInfo?.is_demo && licenseStatus?.is_write_blocked ? (
            <div
              className="demo-banner no-print"
              style={{
                background: 'linear-gradient(135deg, rgba(127, 29, 29, 0.96), rgba(153, 27, 27, 0.92))',
                color: '#fff7ed',
              }}
            >
              <div>
                <div className="demo-banner-kicker" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  Modalita sola lettura
                </div>
                <div className="demo-banner-title" style={{ color: '#ffffff' }}>
                  {licenseStatus.message}
                </div>
              </div>
              <div className="demo-banner-meta" style={{ color: '#ffffff' }}>
                {licenseStatus.verification?.backend_configured && licenseStatus.verification?.offline_days_remaining > 0
                  ? `Tempo senza verifica: ${licenseStatus.verification.offline_days_remaining} giorni`
                  : 'Modifiche bloccate'}
              </div>
            </div>
          ) : null}

          {runningOperations.map((operation) => (
            <div
              key={`${operation.type}-${operation.job_id}`}
              className="demo-banner no-print"
              style={{
                background: operation.type === 'pdf-import'
                  ? 'linear-gradient(135deg, rgba(6, 95, 70, 0.96), rgba(15, 118, 110, 0.92))'
                  : 'linear-gradient(135deg, rgba(30, 64, 175, 0.96), rgba(29, 78, 216, 0.92))',
                color: '#eff6ff',
              }}
            >
              <div>
                <div className="demo-banner-kicker" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  {operation.type === 'pdf-import' ? 'Import PDF in corso' : 'Generazione report in corso'}
                </div>
                <div className="demo-banner-title" style={{ color: '#ffffff' }}>
                  {operation.message || 'Operazione in corso...'}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: 'rgba(255,255,255,0.88)' }}>
                  {operation.step || 'running'}
                </div>
              </div>
              <div style={{ minWidth: 180, textAlign: 'right' }}>
                <div className="demo-banner-meta" style={{ color: '#ffffff' }}>
                  {Math.max(0, Math.min(100, Number(operation.percent || 0)))}%
                </div>
                <div
                  style={{
                    marginTop: 10,
                    width: 180,
                    maxWidth: '100%',
                    height: 8,
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.22)',
                    overflow: 'hidden',
                    marginLeft: 'auto',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(4, Math.min(100, Number(operation.percent || 0)))}%`,
                      height: '100%',
                      background: '#ffffff',
                    }}
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="toolbar global-year-toolbar no-print">
            <div className="toolbar-group">
              <span className="soft-chip" style={{ background: 'rgba(22, 101, 52, 0.12)', color: '#166534' }}>
                Anno attivo globale
              </span>
              <strong style={{ color: '#1F2937' }}>Vista gestionale</strong>
            </div>

            <div className="toolbar-group">
              <label className="global-year-label" htmlFor="global-year-select">
                Anno
              </label>
              <select
                id="global-year-select"
                className="global-year-select"
                value={selectedYear}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            {currentUser ? (
              <div className="toolbar-group">
                {!demoInfo?.is_demo && licenseStatus?.is_developer_mode ? (
                  <span
                    className="soft-chip"
                    title={licenseStatus?.developer_mode_note || licenseStatus?.message || 'Bypass licenza locale attivo'}
                    style={{ background: 'rgba(30, 64, 175, 0.12)', color: '#1d4ed8' }}
                  >
                    {licenseStatus?.developer_mode_label || 'Developer Mode'}
                  </span>
                ) : null}
                <span className="soft-chip" style={{ background: 'rgba(22, 101, 52, 0.12)', color: '#166534' }}>
                  {currentUser.fullName}
                </span>
                <button
                  type="button"
                  className="button-secondary"
                  style={{ padding: '5px 10px', minHeight: 0, fontSize: 12 }}
                  onClick={async () => { await logout(); navigate('/login'); }}
                >
                  Esci
                </button>
              </div>
            ) : null}
          </div>

          <div className="app-content">
            <Outlet />
          </div>

          <footer className="app-footer no-print">
            {getSoftwareBrandingLabel()}
          </footer>
        </div>
      </main>

      <LicenseGate />

      {toasts.length ? (
        <div className="toast-stack no-print" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
              <div className="toast-body">
                <div className="toast-title">
                  {toast.tone === 'error' ? 'Attenzione' : toast.tone === 'success' ? 'Operazione completata' : 'Messaggio'}
                </div>
                <div className="toast-message">{toast.message}</div>
              </div>
              <button
                type="button"
                className="toast-close"
                aria-label="Chiudi notifica"
                onClick={() => dismissToast(toast.id)}
              >
                Chiudi
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {showDemoWelcome ? (
        <div className="demo-overlay no-print">
          <div className="demo-modal">
            <div className="page-kicker" style={{ marginBottom: 8 }}>GPA 1.0.1 Demo</div>
            <h2 className="demo-modal-title">Benvenuto nella modalita demo</h2>
            <div className="demo-modal-text">
              <p>Questa versione usa dati di esempio separati dal gestionale standard.</p>
              <p>Puoi esplorare funzioni, report e archivi senza impattare i dati reali.</p>
              <p>Buona prova.</p>
            </div>
            <div className="demo-modal-actions">
              <button type="button" className="button" onClick={handleCloseDemoWelcome}>
                Inizia
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
