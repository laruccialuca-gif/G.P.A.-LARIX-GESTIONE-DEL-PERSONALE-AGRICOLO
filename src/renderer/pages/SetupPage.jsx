import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useYearContext } from '../context/YearContext';

const STEPS = [
  { key: 'company', title: 'Azienda' },
  { key: 'year', title: 'Anno di lavoro' },
  { key: 'employers', title: 'Datori' },
  { key: 'general', title: 'Impostazioni base' },
  { key: 'branding', title: 'Branding' },
];

function emptySetupDraft() {
  const currentYear = new Date().getFullYear();
  return {
    company: {
      name: '',
      document_header: '',
      email: '',
      logo_path: null,
      logo_file_name: null,
    },
    selectedYear: currentYear,
    employersMode: 'multiple',
    employersCount: 2,
    employerItems: [
      { key: 'employer_1', name: 'Laruccia Cosimo', short_name: 'LC' },
      { key: 'employer_2', name: 'Laruccia Giuseppe', short_name: 'LG' },
    ],
    standardDayHours: 7,
    overtimeEnabled: false,
    attendanceHoursFormat: 'decimal',
  };
}

function normalizeSetupEmployerItem(item, index) {
  const fallbackShort = index === 0 ? 'LC' : index === 1 ? 'LG' : `D${index + 1}`;
  return {
    key: item?.key || `employer_${index + 1}`,
    name: item?.name || '',
    short_name: String(item?.short_name || fallbackShort).toUpperCase(),
  };
}

function ensureEmployerItems(items, count) {
  const targetCount = Math.max(1, Number(count || 1));
  const normalized = Array.isArray(items) ? items.map(normalizeSetupEmployerItem) : [];

  while (normalized.length < targetCount) {
    normalized.push(normalizeSetupEmployerItem({}, normalized.length));
  }

  return normalized.slice(0, targetCount);
}

function resolveLogoSrc(value) {
  const path = String(value || '').trim();
  if (!path) return '';
  if (/^(https?:|data:|file:|blob:)/i.test(path)) return path;
  if (path.startsWith('/')) return `.${path}`;
  return path;
}

export default function SetupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const forceMode = searchParams.get('force') === '1';
  const { setSelectedYear } = useYearContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(emptySetupDraft());

  useEffect(() => {
    let cancelled = false;

    async function loadSetupContext() {
      setLoading(true);
      try {
        const settingsData = await window.api.settings.get();
        if (cancelled) return;

        if (settingsData?.setup?.completed && !forceMode) {
          navigate('/', { replace: true });
          return;
        }

        const employers = Array.isArray(settingsData?.employers?.items) ? settingsData.employers.items : [];
        setSettings(settingsData || null);
        const normalizedEmployerItems = ensureEmployerItems(
          employers.length
            ? employers
            : [
                { key: 'employer_1', name: 'Laruccia Cosimo', short_name: 'LC' },
                { key: 'employer_2', name: 'Laruccia Giuseppe', short_name: 'LG' },
              ],
          Math.max(employers.length || 0, 2)
        );

        setDraft({
          company: {
            name: settingsData?.company?.name || '',
            document_header: settingsData?.company?.document_header || settingsData?.company?.name || '',
            email: settingsData?.company?.email || '',
            logo_path: settingsData?.company?.logo_path || null,
            logo_file_name: settingsData?.company?.logo_file_name || null,
          },
          selectedYear: Number(settingsData?.setup?.initial_year || new Date().getFullYear()) || new Date().getFullYear(),
          employersMode: employers.length <= 1 ? 'one' : 'multiple',
          employersCount: employers.length <= 1 ? 1 : normalizedEmployerItems.length,
          employerItems: employers.length <= 1
            ? ensureEmployerItems(
                employers.length ? employers : [{ key: 'employer_1', name: 'Laruccia Cosimo', short_name: 'LC' }],
                1
              )
            : normalizedEmployerItems,
          standardDayHours: Number(settingsData?.general?.standard_day_hours || 7) || 7,
          overtimeEnabled: !!settingsData?.general?.overtime_enabled,
          attendanceHoursFormat: settingsData?.general?.attendance_hours_format === 'hours_minutes' ? 'hours_minutes' : 'decimal',
        });
      } catch (error) {
        console.error(error);
        alert('Errore caricamento configurazione iniziale');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSetupContext();
    return () => {
      cancelled = true;
    };
  }, [forceMode, navigate]);

  const progressValue = useMemo(
    () => `${currentStep + 1}/${STEPS.length}`,
    [currentStep]
  );

  function updateDraft(path, value) {
    setDraft((current) => {
      if (path.startsWith('company.')) {
        const key = path.replace('company.', '');
        return {
          ...current,
          company: {
            ...current.company,
            [key]: value,
          },
        };
      }

      if (path.startsWith('employerItems.')) {
        const [, indexRaw, key] = path.split('.');
        const index = Number(indexRaw);
        return {
          ...current,
          employerItems: current.employerItems.map((item, itemIndex) =>
            itemIndex === index
              ? {
                  ...item,
                  [key]: value,
                }
              : item
          ),
        };
      }

      if (path === 'employersMode') {
        const nextCount = value === 'one' ? 1 : Math.max(Number(current.employersCount || 2), 2);
        return {
          ...current,
          employersMode: value,
          employersCount: nextCount,
          employerItems: ensureEmployerItems(current.employerItems, nextCount),
        };
      }

      if (path === 'employersCount') {
        const nextCount = Math.max(2, Number(value || 2));
        return {
          ...current,
          employersCount: nextCount,
          employerItems: ensureEmployerItems(current.employerItems, nextCount),
        };
      }

      return {
        ...current,
        [path]: value,
      };
    });
  }

  function validateStep(stepIndex) {
    if (stepIndex === 0 && !String(draft.company.name || '').trim()) {
      alert('Inserisci almeno il nome azienda per continuare.');
      return false;
    }
    return true;
  }

  function goNext() {
    if (!validateStep(currentStep)) return;
    setCurrentStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function goBack() {
    setCurrentStep((current) => Math.max(current - 1, 0));
  }

  async function handleChooseLogo() {
    try {
      const result = await window.api.settings.chooseLogoFile();
      if (!result?.canceled) {
        updateDraft('company.logo_path', result.logo_path || null);
        updateDraft('company.logo_file_name', result.logo_file_name || null);
      }
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Errore caricamento logo');
    }
  }

  async function handleComplete() {
    if (!validateStep(currentStep)) return;

    const employers = ensureEmployerItems(
      draft.employerItems,
      draft.employersMode === 'one' ? 1 : Math.max(Number(draft.employersCount || 2), 2)
    ).map((item, index) => ({
      key: item.key || `employer_${index + 1}`,
      name: String(item.name || '').trim() || `Datore ${index + 1}`,
      short_name: String(item.short_name || `D${index + 1}`).trim().toUpperCase() || `D${index + 1}`,
    }));

    setSaving(true);
    try {
      await window.api.settings.save({
        setup: {
          completed: true,
          completed_at: new Date().toISOString(),
          initial_year: Number(draft.selectedYear) || new Date().getFullYear(),
        },
        company: {
          ...(settings?.company || {}),
          name: String(draft.company.name || '').trim(),
          document_header: String(draft.company.document_header || draft.company.name || '').trim(),
          email: String(draft.company.email || '').trim(),
          logo_path: draft.company.logo_path || null,
          logo_file_name: draft.company.logo_file_name || null,
        },
        employers: {
          mode: draft.employersMode === 'one' ? 'one' : 'two',
          items: employers,
        },
        general: {
          ...(settings?.general || {}),
          standard_day_hours: Number(draft.standardDayHours || 7) || 7,
          overtime_enabled: !!draft.overtimeEnabled,
          attendance_hours_format: draft.attendanceHoursFormat === 'hours_minutes' ? 'hours_minutes' : 'decimal',
        },
      });

      setSelectedYear(Number(draft.selectedYear) || new Date().getFullYear());
      navigate('/', { replace: true });
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Errore completamento configurazione iniziale');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="page"><div className="panel empty-state">Caricamento configurazione iniziale...</div></div>;
  }

  return (
    <div className="page">
      <section className="panel panel-section" style={{ maxWidth: 880, margin: '32px auto', padding: 28 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div className="page-kicker" style={{ marginBottom: 8 }}>Primo avvio</div>
              <h1 className="page-title" style={{ marginBottom: 8 }}>Configurazione iniziale</h1>
              <p className="page-subtitle" style={{ maxWidth: 620 }}>
                Impostiamo i dati essenziali del gestionale in pochi passaggi, mantenendo tutto coerente con il brand Larix.
              </p>
            </div>
            <span className="soft-chip" style={{ background: 'rgba(22, 101, 52, 0.12)', color: '#166534' }}>
              Step {progressValue}
            </span>
          </div>

          <div style={{ height: 8, borderRadius: 999, background: 'rgba(20, 33, 61, 0.08)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${((currentStep + 1) / STEPS.length) * 100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #166534, #16A34A)',
              }}
            />
          </div>

          {currentStep === 0 ? (
            <div className="settings-form-grid">
              <label>
                <span className="communication-field-label">Nome azienda</span>
                <input
                  value={draft.company.name}
                  onChange={(e) => updateDraft('company.name', e.target.value)}
                  placeholder="Larix Agricola"
                />
              </label>
              <label>
                <span className="communication-field-label">Intestazione documenti</span>
                <input
                  value={draft.company.document_header}
                  onChange={(e) => updateDraft('company.document_header', e.target.value)}
                  placeholder="Larix · Gestione del personale agricolo"
                />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <span className="communication-field-label">Email aziendale (opzionale)</span>
                <input
                  type="email"
                  value={draft.company.email}
                  onChange={(e) => updateDraft('company.email', e.target.value)}
                  placeholder="info@azienda.it"
                />
              </label>
            </div>
          ) : null}

          {currentStep === 1 ? (
            <div className="settings-form-grid">
              <label>
                <span className="communication-field-label">Anno iniziale di lavoro</span>
                <select
                  value={draft.selectedYear}
                  onChange={(e) => updateDraft('selectedYear', Number(e.target.value))}
                >
                  {Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - 5 + index)
                    .sort((a, b) => b - a)
                    .map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                </select>
              </label>
              <div className="muted-box" style={{ alignSelf: 'end' }}>
                Questo valore inizializza l’anno attivo globale del gestionale al termine del setup.
              </div>
            </div>
          ) : null}

          {currentStep === 2 ? (
            <div style={{ display: 'grid', gap: 18 }}>
              <div className="settings-switch-list">
                <label className="communication-checkbox">
                  <input type="radio" name="employers-mode" checked={draft.employersMode === 'one'} onChange={() => updateDraft('employersMode', 'one')} />
                  1 datore di lavoro
                </label>
                <label className="communication-checkbox">
                  <input type="radio" name="employers-mode" checked={draft.employersMode === 'multiple'} onChange={() => updateDraft('employersMode', 'multiple')} />
                  2 o piu datori di lavoro
                </label>
              </div>

              {draft.employersMode === 'multiple' ? (
                <div className="settings-form-grid">
                  <label>
                    <span className="communication-field-label">Numero datori di lavoro</span>
                    <select
                      value={draft.employersCount}
                      onChange={(e) => updateDraft('employersCount', Number(e.target.value))}
                    >
                      {Array.from({ length: 9 }, (_, index) => index + 2).map((count) => (
                        <option key={count} value={count}>
                          {count} datori
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="muted-box" style={{ alignSelf: 'end' }}>
                    Se scegli piu di 2 datori, il setup crea automaticamente i campi aggiuntivi.
                  </div>
                </div>
              ) : null}

              <div className="settings-employers-list">
                {ensureEmployerItems(
                  draft.employerItems,
                  draft.employersMode === 'one' ? 1 : Math.max(Number(draft.employersCount || 2), 2)
                ).map((item, index) => {
                  const isSingleEmployer = draft.employersMode === 'one';
                  const label = isSingleEmployer ? 'Datore' : `Datore ${index + 1}`;
                  const siglaLabel = isSingleEmployer ? 'Sigla' : `Sigla ${index + 1}`;

                  return (
                    <div key={item.key} className="settings-employer-card">
                      <div style={{ fontWeight: 800, marginBottom: 10 }}>{label}</div>
                      <div className="settings-inline-grid">
                        <input
                          value={item.name}
                          onChange={(e) => updateDraft(`employerItems.${index}.name`, e.target.value)}
                          placeholder={label}
                        />
                        <input
                          value={item.short_name}
                          onChange={(e) => updateDraft(`employerItems.${index}.short_name`, e.target.value.toUpperCase())}
                          placeholder={siglaLabel}
                          maxLength={4}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {currentStep === 3 ? (
            <div className="settings-form-grid">
              <label>
                <span className="communication-field-label">Ore giornaliere standard</span>
                <input type="number" min="1" step="0.5" value={draft.standardDayHours} onChange={(e) => updateDraft('standardDayHours', e.target.value)} />
              </label>
              <label>
                <span className="communication-field-label">Formato ore</span>
                <select value={draft.attendanceHoursFormat} onChange={(e) => updateDraft('attendanceHoursFormat', e.target.value)}>
                  <option value="decimal">Decimale</option>
                  <option value="hours_minutes">Ore / minuti</option>
                </select>
              </label>
              <label className="communication-checkbox" style={{ minHeight: 46 }}>
                <input type="checkbox" checked={draft.overtimeEnabled} onChange={(e) => updateDraft('overtimeEnabled', e.target.checked)} />
                Attiva gestione straordinari
              </label>
            </div>
          ) : null}

          {currentStep === 4 ? (
            <div style={{ display: 'grid', gap: 18 }}>
              <div className="settings-actions-row">
                <button type="button" className="button-secondary" onClick={handleChooseLogo}>
                  Carica logo azienda
                </button>
                {draft.company.logo_file_name ? (
                  <span className="soft-chip">{draft.company.logo_file_name}</span>
                ) : (
                  <span className="soft-chip">Nessun logo selezionato</span>
                )}
              </div>
              <div className="panel" style={{ padding: 20, display: 'flex', justifyContent: 'center', minHeight: 120, alignItems: 'center' }}>
                {draft.company.logo_path ? (
                  <img
                    src={resolveLogoSrc(draft.company.logo_path)}
                    alt="Logo azienda"
                    style={{ maxHeight: 72, objectFit: 'contain' }}
                  />
                ) : (
                  <div style={{ color: '#667085' }}>Anteprima logo non disponibile</div>
                )}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="button-secondary" onClick={goBack} disabled={currentStep === 0 || saving}>
              Indietro
            </button>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {currentStep < STEPS.length - 1 ? (
                <button type="button" className="button" onClick={goNext} disabled={saving}>
                  Avanti
                </button>
              ) : (
                <button type="button" className="button" onClick={handleComplete} disabled={saving}>
                  {saving ? 'Completamento...' : 'Completa'}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
