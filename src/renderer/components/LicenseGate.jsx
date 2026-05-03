import React, { useEffect, useState } from 'react';

function FieldLabel({ children }) {
  return <div className="communication-field-label" style={{ marginBottom: 6 }}>{children}</div>;
}

export default function LicenseGate() {
  const [status, setStatus] = useState(null);
  const [activationCode, setActivationCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    try {
      const data = await window.api.license.getStatus();
      setStatus(data);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleActivate() {
    setBusy(true);
    try {
      const next = await window.api.license.activate(activationCode);
      setStatus(next);
      setActivationCode('');
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore attivazione licenza');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setBusy(true);
    try {
      const next = await window.api.license.verify();
      setStatus(next);
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore verifica licenza');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  if (!status.is_blocking) {
    return null;
  }

  return (
    <div className="license-overlay">
      <div className="license-dialog">
        <div className="page-kicker">Controllo licenza</div>
        <h1 style={{ margin: '6px 0 10px', fontSize: 32 }}>Attivazione richiesta</h1>
        <p className="page-subtitle" style={{ marginTop: 0, maxWidth: 'none' }}>
          {status.message}
        </p>

        <div className="settings-grid" style={{ marginTop: 8 }}>
          <div className="communication-card">
            <FieldLabel>Stato licenza</FieldLabel>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{status.label}</div>

            <FieldLabel style={{ marginTop: 16 }}>Codice installazione</FieldLabel>
            <textarea
              rows={3}
              value={status.install_context?.install_id || ''}
              readOnly
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />

            <FieldLabel>Codice dispositivo</FieldLabel>
            <textarea
              rows={3}
              value={status.install_context?.machine_fingerprint || ''}
              readOnly
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />
          </div>

          <div className="communication-card">
            <FieldLabel>Richiesta attivazione</FieldLabel>
            <textarea
              rows={6}
              value={status.activation_request?.request_code || ''}
              readOnly
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />

            <FieldLabel>Codice attivazione / licenza</FieldLabel>
            <textarea
              rows={6}
              value={activationCode}
              onChange={(e) => setActivationCode(e.target.value)}
              placeholder="Incolla qui il codice di attivazione firmato"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />

            <div className="settings-actions-row">
              <button className="button" onClick={handleActivate} disabled={busy || !activationCode.trim()}>
                {busy ? 'Attivazione...' : 'Attiva software'}
              </button>
              <button className="button-secondary" onClick={handleVerify} disabled={busy}>
                Verifica licenza
              </button>
              <button className="button-secondary" onClick={loadStatus} disabled={busy}>
                Ricarica stato
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
