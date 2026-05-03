import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const api = window.licenseAdminApi;
const today = new Date().toISOString().slice(0, 10);

function addMonths(dateText, months) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function emptyCustomerForm() {
  return {
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    notes: '',
  };
}

function emptyLicenseForm(customerId = '') {
  return {
    customer_id: customerId,
    license_id: '',
    plan: 'monthly',
    starts_at: today,
    expires_at: addMonths(today, 1),
    max_machines: 1,
    status: 'active',
    features: 'presenze, report, backup',
  };
}

function SignatureStatusPanel({ bootstrap }) {
  if (!bootstrap) return null;
  const { secret_configured, signature_algorithm, ed25519_compatible } = bootstrap;

  const modeLabel =
    signature_algorithm === 'ed25519'
      ? 'Ed25519 — compatibile con gestionale locale'
      : signature_algorithm === 'hmac-sha256'
        ? 'HMAC-SHA256 — solo backend futuro'
        : 'Non configurata';

  return (
    <div className="sig-status-panel">
      <div className="sig-item">
        <span className="sig-label">Stato chiave firma</span>
        <span className={`sig-value ${secret_configured ? 'ok' : 'err'}`}>
          {secret_configured ? 'Configurata' : 'Non configurata'}
        </span>
      </div>
      <div className="sig-item">
        <span className="sig-label">Tipo firma</span>
        <span
          className={`sig-value ${signature_algorithm === 'ed25519' ? 'ok' : signature_algorithm === 'hmac-sha256' ? 'warn' : 'err'}`}
        >
          {modeLabel}
        </span>
      </div>
      <div className="sig-item">
        <span className="sig-label">Compatibile con gestionale cliente</span>
        <span className={`sig-value ${ed25519_compatible ? 'ok' : 'err'}`}>
          {ed25519_compatible ? 'Sì' : 'No'}
        </span>
      </div>
    </div>
  );
}

function statusLabel(status) {
  if (status === 'active') return 'Attiva';
  if (status === 'suspended') return 'Sospesa';
  if (status === 'expired') return 'Scaduta';
  return status || 'Sconosciuta';
}

function formatDate(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}

function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedLicenseId, setSelectedLicenseId] = useState(null);
  const [search, setSearch] = useState('');
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm());
  const [licenseForm, setLicenseForm] = useState(emptyLicenseForm());
  const [renewDate, setRenewDate] = useState(addMonths(today, 12));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );
  const selectedLicense = useMemo(
    () => licenses.find((license) => license.id === selectedLicenseId) || null,
    [licenses, selectedLicenseId]
  );
  const visibleLicenses = useMemo(
    () =>
      selectedCustomerId
        ? licenses.filter((license) => license.customer_id === selectedCustomerId)
        : licenses,
    [licenses, selectedCustomerId]
  );

  async function run(action, successMessage = '') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (successMessage) setNotice(successMessage);
      return result;
    } catch (err) {
      setError(err?.message || String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function loadData(nextSearch = search) {
    const [nextBootstrap, nextCustomers, nextLicenses] = await Promise.all([
      api.bootstrap(),
      api.customers.list(nextSearch),
      api.licenses.list({ search: nextSearch }),
    ]);
    setBootstrap(nextBootstrap);
    setCustomers(nextCustomers);
    setLicenses(nextLicenses);

    if (!selectedCustomerId && nextCustomers[0]) {
      setSelectedCustomerId(nextCustomers[0].id);
      setLicenseForm((current) => ({ ...current, customer_id: nextCustomers[0].id }));
    }
    if (!selectedLicenseId && nextLicenses[0]) {
      setSelectedLicenseId(nextLicenses[0].id);
    }
  }

  useEffect(() => {
    loadData('');
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadData(search);
    }, 180);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (selectedCustomerId) {
      setLicenseForm((current) => ({ ...current, customer_id: selectedCustomerId }));
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    setVerifyResult(null);
  }, [selectedLicenseId]);

  async function createCustomer(event) {
    event.preventDefault();
    const created = await run(
      async () => api.customers.create(customerForm),
      'Cliente creato.'
    );
    if (created) {
      setCustomerForm(emptyCustomerForm());
      setSelectedCustomerId(created.id);
      await loadData(search);
    }
  }

  async function createLicense(event) {
    event.preventDefault();
    const created = await run(
      async () => api.licenses.create(licenseForm),
      'Licenza generata.'
    );
    if (created) {
      setSelectedLicenseId(created.id);
      setLicenseForm(emptyLicenseForm(selectedCustomerId || created.customer_id));
      await loadData(search);
    }
  }

  async function setLicenseStatus(status) {
    if (!selectedLicense) return;
    const updated = await run(
      async () => api.licenses.setStatus({ id: selectedLicense.id, status }),
      `Licenza ${statusLabel(status).toLowerCase()}.`
    );
    if (updated) {
      setSelectedLicenseId(updated.id);
      await loadData(search);
    }
  }

  async function renewLicense() {
    if (!selectedLicense) return;
    const updated = await run(
      async () => api.licenses.renew({ id: selectedLicense.id, expires_at: renewDate }),
      'Licenza rinnovata.'
    );
    if (updated) {
      setSelectedLicenseId(updated.id);
      await loadData(search);
    }
  }

  async function copyCode() {
    if (!selectedLicense) return;
    await run(async () => api.licenses.copyCode(selectedLicense.id), 'Codice licenza copiato.');
  }

  async function verifyCompatibility() {
    if (!selectedLicense?.license_code) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.licenses.verifyCompatibility(selectedLicense.license_code);
      setVerifyResult(result);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportCode() {
    if (!selectedLicense) return;
    const result = await run(async () => api.licenses.exportCode(selectedLicense.id));
    if (result && !result.canceled) setNotice(`Licenza esportata: ${result.file_path}`);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>GPA License Admin</h1>
          <p>Archivio locale separato per clienti, abbonamenti e codici licenza GPA.</p>
        </div>
        <button className="secondary" type="button" onClick={() => api.openDataDir()}>
          Apri dati admin
        </button>
      </header>

      {bootstrap && !bootstrap.secret_configured && (
        <div className="alert error">
          GESTIONALE_LICENSE_SECRET non configurata. Puoi consultare i dati, ma non generare,
          rinnovare o riemettere codici licenza firmati.
        </div>
      )}
      {bootstrap?.signature_algorithm === 'hmac-sha256' && (
        <div className="alert warning">
          <strong>Firma HMAC-SHA256 attiva.</strong> Questa licenza non è compatibile con la verifica locale
          Ed25519 del gestionale cliente. Per generare licenze valide per i clienti, configura una chiave
          privata Ed25519 PEM in GESTIONALE_LICENSE_SECRET.
        </div>
      )}
      {notice && <div className="alert success">{notice}</div>}
      {error && <div className="alert error">{error}</div>}

      <SignatureStatusPanel bootstrap={bootstrap} />

      <section className="toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cerca cliente, email, licenza, piano o stato"
        />
        <div className="meta">
          {customers.length} clienti · {licenses.length} licenze
        </div>
      </section>

      <section className="workspace">
        <aside className="panel customer-list">
          <div className="panel-head">
            <h2>Clienti</h2>
          </div>
          <div className="scroll-list">
            {customers.map((customer) => (
              <button
                key={customer.id}
                className={customer.id === selectedCustomerId ? 'row active' : 'row'}
                type="button"
                onClick={() => setSelectedCustomerId(customer.id)}
              >
                <strong>{customer.company_name}</strong>
                <span>{customer.email || customer.contact_name || 'Nessun contatto'}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel detail">
          <div className="panel-head">
            <h2>Dettaglio cliente</h2>
            {selectedCustomer && <span className="pill">{selectedCustomer.company_name}</span>}
          </div>

          {selectedCustomer ? (
            <div className="details-grid">
              <div>
                <label>Referente</label>
                <strong>{selectedCustomer.contact_name || '-'}</strong>
              </div>
              <div>
                <label>Email</label>
                <strong>{selectedCustomer.email || '-'}</strong>
              </div>
              <div>
                <label>Telefono</label>
                <strong>{selectedCustomer.phone || '-'}</strong>
              </div>
              <div>
                <label>Note</label>
                <strong>{selectedCustomer.notes || '-'}</strong>
              </div>
            </div>
          ) : (
            <p className="empty">Nessun cliente selezionato.</p>
          )}

          <form className="form compact" onSubmit={createCustomer}>
            <h3>Crea cliente</h3>
            <input
              required
              value={customerForm.company_name}
              onChange={(event) => setCustomerForm({ ...customerForm, company_name: event.target.value })}
              placeholder="Nome azienda"
            />
            <input
              value={customerForm.contact_name}
              onChange={(event) => setCustomerForm({ ...customerForm, contact_name: event.target.value })}
              placeholder="Referente"
            />
            <input
              value={customerForm.email}
              onChange={(event) => setCustomerForm({ ...customerForm, email: event.target.value })}
              placeholder="Email"
            />
            <input
              value={customerForm.phone}
              onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })}
              placeholder="Telefono"
            />
            <textarea
              value={customerForm.notes}
              onChange={(event) => setCustomerForm({ ...customerForm, notes: event.target.value })}
              placeholder="Note"
            />
            <button disabled={busy} type="submit">Salva cliente</button>
          </form>
        </section>

        <section className="panel licenses">
          <div className="panel-head">
            <h2>Licenze</h2>
          </div>
          <div className="license-list">
            {visibleLicenses.map((license) => (
              <button
                key={license.id}
                className={license.id === selectedLicenseId ? 'license-row active' : 'license-row'}
                type="button"
                onClick={() => {
                  setSelectedLicenseId(license.id);
                  setRenewDate(license.plan === 'annual' ? addMonths(formatDate(license.expires_at), 12) : addMonths(formatDate(license.expires_at), 1));
                }}
              >
                <span>
                  <strong>{license.license_id}</strong>
                  <small>{license.customer_name}</small>
                </span>
                <span className={`status ${license.status}`}>{statusLabel(license.status)}</span>
                <span>{formatDate(license.expires_at)}</span>
              </button>
            ))}
            {!visibleLicenses.length && <p className="empty">Nessuna licenza trovata.</p>}
          </div>

          {selectedLicense && (
            <div className="selected-license">
              <div className="details-grid">
                <div>
                  <label>Piano</label>
                  <strong>{selectedLicense.plan === 'annual' ? 'Annuale' : 'Mensile'}</strong>
                </div>
                <div>
                  <label>PC autorizzati</label>
                  <strong>{selectedLicense.max_machines}</strong>
                </div>
                <div>
                  <label>Scadenza</label>
                  <strong>{formatDate(selectedLicense.expires_at)}</strong>
                </div>
                <div>
                  <label>Features</label>
                  <strong>{selectedLicense.features.join(', ') || '-'}</strong>
                </div>
              </div>
              <textarea className="code" readOnly value={selectedLicense.license_code || ''} />
              <div className="actions">
                <button disabled={busy || !selectedLicense.license_code} type="button" onClick={copyCode}>
                  Copia codice
                </button>
                <button disabled={busy || !selectedLicense.license_code} type="button" onClick={exportCode}>
                  Esporta .txt
                </button>
                <button
                  className="secondary"
                  disabled={busy || !selectedLicense.license_code}
                  type="button"
                  onClick={verifyCompatibility}
                >
                  Verifica compatibilità licenza
                </button>
                <button disabled={busy} type="button" onClick={() => setLicenseStatus('suspended')}>
                  Sospendi
                </button>
                <button disabled={busy} type="button" onClick={() => setLicenseStatus('active')}>
                  Riattiva
                </button>
                <button disabled={busy} type="button" onClick={() => setLicenseStatus('expired')}>
                  Segna scaduta
                </button>
              </div>
              {verifyResult && (
                <div className={`verify-result ${verifyResult.compatible ? 'ok' : 'fail'}`}>
                  <strong>{verifyResult.compatible ? 'Compatibile' : 'Non compatibile'}</strong>
                  {' — '}
                  {verifyResult.reason}
                  <span className="verify-algo">Algoritmo: {verifyResult.algorithm}</span>
                </div>
              )}
              <div className="renew">
                <input type="date" value={renewDate} onChange={(event) => setRenewDate(event.target.value)} />
                <button disabled={busy} type="button" onClick={renewLicense}>Rinnova</button>
              </div>
            </div>
          )}
        </section>
      </section>

      <section className="panel create-license">
        <div className="panel-head">
          <h2>Genera licenza</h2>
          <span className={`pill ${bootstrap?.ed25519_compatible ? '' : 'pill-warn'}`}>
            Firma {bootstrap?.signature_algorithm || 'non configurata'}
          </span>
        </div>
        {bootstrap?.secret_configured && !bootstrap?.ed25519_compatible && (
          <div className="alert error generate-block">
            Generazione bloccata: la chiave attiva è HMAC-SHA256, non compatibile con il gestionale cliente.
            Configura una chiave privata Ed25519 PEM in GESTIONALE_LICENSE_SECRET prima di generare licenze.
          </div>
        )}
        <form className="form license-form" onSubmit={createLicense}>
          <select
            required
            value={licenseForm.customer_id || ''}
            onChange={(event) => setLicenseForm({ ...licenseForm, customer_id: Number(event.target.value) })}
          >
            <option value="">Seleziona cliente</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.company_name}</option>
            ))}
          </select>
          <input
            value={licenseForm.license_id}
            onChange={(event) => setLicenseForm({ ...licenseForm, license_id: event.target.value })}
            placeholder="License ID automatico se vuoto"
          />
          <select
            value={licenseForm.plan}
            onChange={(event) => {
              const plan = event.target.value;
              setLicenseForm({
                ...licenseForm,
                plan,
                expires_at: addMonths(licenseForm.starts_at || today, plan === 'annual' ? 12 : 1),
              });
            }}
          >
            <option value="monthly">Mensile</option>
            <option value="annual">Annuale</option>
          </select>
          <input
            type="date"
            value={licenseForm.starts_at}
            onChange={(event) => setLicenseForm({ ...licenseForm, starts_at: event.target.value })}
          />
          <input
            type="date"
            value={licenseForm.expires_at}
            onChange={(event) => setLicenseForm({ ...licenseForm, expires_at: event.target.value })}
          />
          <input
            type="number"
            min="1"
            value={licenseForm.max_machines}
            onChange={(event) => setLicenseForm({ ...licenseForm, max_machines: event.target.value })}
            placeholder="PC autorizzati"
          />
          <select
            value={licenseForm.status}
            onChange={(event) => setLicenseForm({ ...licenseForm, status: event.target.value })}
          >
            <option value="active">Attiva</option>
            <option value="suspended">Sospesa</option>
            <option value="expired">Scaduta</option>
          </select>
          <input
            value={licenseForm.features}
            onChange={(event) => setLicenseForm({ ...licenseForm, features: event.target.value })}
            placeholder="Features separate da virgola"
          />
          <button
            disabled={busy || !bootstrap?.secret_configured || !bootstrap?.ed25519_compatible}
            type="submit"
          >
            Genera licenza
          </button>
        </form>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
