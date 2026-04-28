import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import LicenseGate from '../components/LicenseGate';
import { getSoftwareBrandingLabel } from '../config/branding';
import { useYearContext } from '../context/YearContext';

function inferToastTone(message) {
  if (!message) return 'info';
  if (/errore|fallit|non valido|impossibile/i.test(message)) return 'error';
  if (/salvat|creat|aggiornat|attivat|ripristinat|backup/i.test(message)) return 'success';
  return 'info';
}

export default function AppLayout() {
  const { selectedYear, setSelectedYear, yearOptions } = useYearContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [demoInfo, setDemoInfo] = useState(null);
  const [showDemoWelcome, setShowDemoWelcome] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastTimersRef = useRef(new Map());
  const [settingsInfo, setSettingsInfo] = useState(null);

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
    if (settingsInfo?.should_show_initial_setup && location.pathname !== '/setup') {
      navigate('/setup', { replace: true });
    }
  }, [settingsInfo, location.pathname, navigate]);

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

  return (
    <div className="app-shell">
      <div className="app-sidebar no-print">
        <Sidebar />
      </div>

      <main className="app-main">
        <div className="container app-main-inner">
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
            <div className="page-kicker" style={{ marginBottom: 8 }}>Gestionale Demo</div>
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
