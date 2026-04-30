import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

function slugifyMarkerValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
}

function normalizeSymbolSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function suggestMarkerSymbol(label) {
  const text = normalizeSymbolSearchText(label);
  if (!text) return '🏷️';

  const tokens = text.split(' ').filter(Boolean);
  const suggestions = [
    { keywords: ['agrume', 'agrumi', 'arancia', 'arance', 'limone', 'limoni', 'mandarino', 'mandarini', 'cedro', 'clementina', 'clementine'], symbol: '🍊' },
    { keywords: ['ciliegia', 'ciliegie', 'cherry'], symbol: '🍒' },
    { keywords: ['uva', 'grappolo', 'grape', 'grapes'], symbol: '🍇' },
    { keywords: ['mela', 'mele', 'apple', 'apples'], symbol: '🍎' },
    { keywords: ['pera', 'pere', 'pear'], symbol: '🍐' },
    { keywords: ['pesca', 'pesche', 'peach'], symbol: '🍑' },
    { keywords: ['fragola', 'fragole', 'strawberry', 'strawberries'], symbol: '🍓' },
    { keywords: ['banana', 'banane'], symbol: '🍌' },
    { keywords: ['kiwi', 'kiwis'], symbol: '🥝' },
    { keywords: ['oliva', 'olive'], symbol: '🫒' },
    { keywords: ['pomodoro', 'pomodori', 'tomato', 'tomatoes'], symbol: '🍅' },
    { keywords: ['melanzana', 'melanzane', 'eggplant'], symbol: '🍆' },
    { keywords: ['peperone', 'peperoni', 'pepper', 'peppers'], symbol: '🫑' },
    { keywords: ['mais', 'granoturco', 'corn'], symbol: '🌽' },
    { keywords: ['carota', 'carote', 'carrot', 'carrots'], symbol: '🥕' },
    { keywords: ['patata', 'patate', 'potato', 'potatoes'], symbol: '🥔' },
    { keywords: ['aglio', 'garlic'], symbol: '🧄' },
    { keywords: ['cipolla', 'cipolle', 'onion', 'onions'], symbol: '🧅' },
    { keywords: ['fungo', 'funghi', 'mushroom', 'mushrooms'], symbol: '🍄' },
    { keywords: ['insalata', 'lattuga', 'lattughe', 'radicchio', 'scarola', 'valeriana'], symbol: '🥬' },
    { keywords: ['prezzemolo', 'basilico', 'menta', 'salvia', 'rosmarino', 'erba', 'erbe', 'aromatiche', 'aromatica'], symbol: '🌿' },
    { keywords: ['pisello', 'piselli', 'fagiolo', 'fagioli', 'legume', 'legumi'], symbol: '🫛' },
    { keywords: ['foglia', 'foglie', 'verde', 'ortaggio', 'ortaggi', 'verdura', 'verdure', 'leaf'], symbol: '🌱' },
    { keywords: ['fiore', 'fiori', 'flower', 'flowers'], symbol: '🌸' },
    { keywords: ['albero', 'alberi', 'tree', 'trees'], symbol: '🌳' },
    { keywords: ['sole', 'sun', 'sereno'], symbol: '☀️' },
    { keywords: ['pioggia', 'rain', 'piovoso'], symbol: '🌧️' },
    { keywords: ['neve', 'snow'], symbol: '❄️' },
    { keywords: ['vento', 'wind'], symbol: '💨' },
    { keywords: ['lavoro', 'work', 'cantiere', 'raccolta', 'raccolto', 'attivita'], symbol: '🛠️' },
    { keywords: ['trattore', 'mezzo', 'macchina agricola'], symbol: '🚜' },
    { keywords: ['animale', 'animali', 'stalla'], symbol: '🐄' },
  ];

  let bestScore = 0;
  let bestSymbol = '🏷️';

  for (const entry of suggestions) {
    let score = 0;

    for (const keyword of entry.keywords) {
      if (text === keyword) {
        score += 10;
      } else if (text.includes(keyword)) {
        score += 6;
      } else if (tokens.includes(keyword)) {
        score += 5;
      } else if (tokens.some((token) => keyword.includes(token) || token.includes(keyword))) {
        score += 3;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestSymbol = entry.symbol;
    }
  }

  return bestSymbol;
}

function resolveMarkerImageSrc(imagePath) {
  const value = String(imagePath || '').trim();
  if (!value) return '';
  if (/^(https?:|data:|file:|blob:)/i.test(value)) return value;
  if (value.startsWith('/assets/')) return `.${value}`;
  if (/^[A-Za-z]:\\/.test(value)) {
    return encodeURI(`file:///${value.replace(/\\/g, '/')}`);
  }
  if (value.startsWith('/')) {
    return encodeURI(`file://${value}`);
  }
  return value;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function MarkerPreview({ marker }) {
  const imageSrc = resolveMarkerImageSrc(marker?.image);

  return (
    <span
      className="soft-chip"
      style={{
        color: marker?.color || '#27445f',
        background: marker?.background || 'rgba(20, 33, 61, 0.08)',
        borderColor: 'rgba(20, 33, 61, 0.08)',
      }}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={marker?.text || marker?.value || 'marker'}
          style={{ width: 16, height: 16, objectFit: 'contain', display: 'inline-block' }}
        />
      ) : (
        marker?.symbol || '•'
      )}
      {' '}
      {marker?.text || marker?.value}
    </span>
  );
}

function SettingsBox({ title, subtitle, children }) {
  return (
    <div className="panel panel-section">
      <div style={{ marginBottom: 14 }}>
        <h2 className="settings-section-title" style={{ marginBottom: subtitle ? 6 : 0 }}>{title}</h2>
        {subtitle ? (
          <div style={{ color: '#667085', fontSize: 13, lineHeight: 1.5 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function MacroAreaCard({ title, subtitle, onClick }) {
  return (
    <button
      type="button"
      className="panel panel-section"
      onClick={onClick}
      style={{
        display: 'grid',
        gap: 10,
        textAlign: 'left',
        padding: 20,
        borderRadius: 22,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(244,248,243,0.94))',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, color: '#1F2937' }}>{title}</div>
      <div style={{ color: '#64748b', lineHeight: 1.55 }}>{subtitle}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#166534', fontWeight: 800, fontSize: 13 }}>
        Apri sezione
        <span aria-hidden="true">›</span>
      </div>
    </button>
  );
}

function emptySettings() {
  return {
    setup: {
      completed: true,
      completed_at: '',
      initial_year: new Date().getFullYear(),
    },
    company: {
      name: '',
      logo_path: null,
      logo_file_name: null,
      document_header: '',
      email: '',
      contacts: '',
    },
    employers: {
      mode: 'two',
      items: [
        { key: 'employer_1', name: '', short_name: '' },
        { key: 'employer_2', name: '', short_name: '' },
      ],
    },
    general: {
      standard_day_hours: 7,
      attendance_entry_mode: 'hours_and_symbol',
      attendance_hours_format: 'decimal',
      overtime_enabled: false,
      overtime_hourly_rate: 0,
      overtime_display_mode: 'included',
      overtime_show_hourly_rate: true,
      attendance_quick_symbol: 'X',
      attendance_auto_symbolize_base_hours: false,
      attendance_markers: [
        {
          value: 'P',
          text: 'Piselli',
          symbol: '🌱',
          image: '',
          color: '#166534',
          background: 'rgba(34, 197, 94, 0.16)',
          active: true,
        },
        {
          value: 'C',
          text: 'Ciliegie',
          symbol: '🍒',
          image: '',
          color: '#b91c1c',
          background: 'rgba(239, 68, 68, 0.16)',
          active: true,
        },
      ],
      legend_colors: {},
      custom_labels: {},
      print_options: {
        show_transport: true,
        show_advances: true,
        show_compensation: true,
      },
    },
    security: {
      current_role: 'standard',
      admin_pin: '',
    },
    backup: {
      directory: '',
      automatic_mode: 'none',
      backup_on_exit: false,
      last_auto_backup_at: null,
    },
    cloud: {
      enabled: false,
      provider: 'future',
      bucket_name: '',
      folder: '',
      encrypt_archives: false,
      compression_enabled: true,
      sync_mode: 'backup_only',
      versioning_strategy: 'timestamped',
      conflict_strategy: 'manual_review',
    },
    software: {
      updates: {
        channel: 'stable',
        auto_check_enabled: false,
        allow_prerelease: false,
        feed_url: '',
        last_check_at: '',
        last_result: 'never_checked',
        pending_version: '',
        downloaded_version: '',
        install_mode: 'manual',
      },
    },
    licensing: {
      install_id: '',
      license_key: '',
      activation_status: 'local_only',
    },
    runtime_info: {
      app_name: '',
      app_version: '',
      app_variant: 'standard',
      is_demo: false,
      packaged: false,
      program_path: '',
      install_strategy: '',
    },
    storage_paths: {
      user_data_root: '',
      data_dir: '',
      config_dir: '',
      documents_dir: '',
      backups_dir: '',
      updates_dir: '',
      database_file: '',
      settings_file: '',
      license_file: '',
    },
    database_runtime: {
      schema_version: '',
      migration_count: 0,
      last_migration_id: '',
      last_migration_at: '',
      last_migration_app_version: '',
      database_path: '',
      journal_mode: '',
    },
    update_runtime: {
      updater_ready: false,
      app_version: '',
      packaged: false,
      supports_future_auto_updates: true,
      preserves_user_data: true,
      preserves_license_state: true,
      strategy: '',
    },
    employer_options: [],
    is_admin: false,
    backup_directory_effective: '',
    cloud_ready: false,
  };
}

function normalizeSettingsPayload(input = {}) {
  const defaults = emptySettings();
  return {
    ...defaults,
    ...input,
    general: {
      ...defaults.general,
      ...(input.general || {}),
      attendance_entry_mode: input.general?.attendance_entry_mode === 'hours_only'
        ? 'hours_only'
        : 'hours_and_symbol',
      attendance_hours_format: 'decimal',
      overtime_enabled: !!input.general?.overtime_enabled,
      overtime_hourly_rate: Number(input.general?.overtime_hourly_rate || 0) || 0,
      overtime_display_mode: input.general?.overtime_display_mode === 'separate'
        ? 'separate'
        : 'included',
      overtime_show_hourly_rate: input.general?.overtime_show_hourly_rate !== false,
      attendance_quick_symbol: String(input.general?.attendance_quick_symbol || defaults.general.attendance_quick_symbol)
        .toUpperCase(),
      attendance_auto_symbolize_base_hours: !!input.general?.attendance_auto_symbolize_base_hours,
      attendance_markers: Array.isArray(input.general?.attendance_markers) && input.general.attendance_markers.length
        ? input.general.attendance_markers.map((marker, index) => ({
            value: String(marker?.value || slugifyMarkerValue(marker?.text) || `MARKER_${index + 1}`).toUpperCase(),
            text: String(marker?.text || `Marker ${index + 1}`),
            symbol: String(marker?.symbol || '•'),
            image: String(marker?.image || ''),
            color: String(marker?.color || '#27445f'),
            background: String(marker?.background || 'rgba(20, 33, 61, 0.08)'),
            active: marker?.active !== false,
          }))
        : defaults.general.attendance_markers,
    },
  };
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(emptySettings());
  const [backups, setBackups] = useState([]);
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [licenseActivationCode, setLicenseActivationCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unlockPin, setUnlockPin] = useState('');
  const [newMarkerLabel, setNewMarkerLabel] = useState('');
  const [selectedMacroArea, setSelectedMacroArea] = useState(null);

  async function loadData() {
    setLoading(true);
    try {
      const [settingsData, backupData, licenseData] = await Promise.all([
        window.api.settings.get(),
        window.api.backups.list(),
        window.api.license.getStatus(),
      ]);

      setSettings(normalizeSettingsPayload(settingsData || {}));
      setBackups(backupData || []);
      setLicenseStatus(licenseData || null);
    } catch (err) {
      console.error(err);
      alert('Errore caricamento impostazioni');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const employerItems = useMemo(() => {
    const mode = settings.employers.mode === 'one' ? 1 : 2;
    const items = Array.isArray(settings.employers.items) ? settings.employers.items : [];
    const normalized = [...items];
    while (normalized.length < mode) {
      normalized.push({ key: `employer_${normalized.length + 1}`, name: '', short_name: '' });
    }
    return normalized.slice(0, mode);
  }, [settings.employers]);

  const isAdmin = !!settings.is_admin;
  const isDevMode = settings.runtime_info?.packaged === false;
  const normalizedLicenseUi = useMemo(() => {
    const rawCode = String(licenseStatus?.code || settings.licensing.activation_status || '').trim().toLowerCase();
    const isActive = rawCode === 'active';
    const isExpired = rawCode === 'expired' || rawCode === 'license_expired';

    if (isActive) {
      return {
        statusLabel: 'ATTIVA',
        message: licenseStatus?.message || 'Licenza attiva.',
      };
    }

    if (isExpired) {
      return {
        statusLabel: 'SCADUTA',
        message: licenseStatus?.message || 'Licenza scaduta.',
      };
    }

    return {
      statusLabel: 'DEMO',
      message: licenseStatus?.message || 'Modalita demo attiva.',
    };
  }, [licenseStatus, settings.licensing.activation_status]);
  const markerSuggestionSymbol = useMemo(() => suggestMarkerSymbol(newMarkerLabel), [newMarkerLabel]);
  const macroAreas = [
    {
      key: 'generale',
      title: 'Generale',
      subtitle: 'Ore base giornata, struttura datori e configurazione iniziale del gestionale.',
    },
    {
      key: 'presenze',
      title: 'Presenze',
      subtitle: 'Metodo inserimento ore, formato e simbolo rapido del foglio presenze.',
    },
    {
      key: 'straordinario',
      title: 'Straordinario',
      subtitle: 'Tariffa separata, visibilità e modalità di calcolo dello straordinario.',
    },
    {
      key: 'report',
      title: 'Report / PDF',
      subtitle: 'Contenuti da mostrare nelle stampe e nei PDF del gestionale.',
    },
    {
      key: 'comunicazioni',
      title: 'Comunicazioni / Email',
      subtitle: 'Email aziendale e recapiti usati nei documenti e nelle comunicazioni.',
    },
    {
      key: 'branding',
      title: 'Branding Larix',
      subtitle: 'Nome azienda, intestazione documenti e gestione del logo.',
    },
    {
      key: 'backup',
      title: 'Backup / Dati',
      subtitle: 'Percorsi persistenti, aggiornamenti, backup, cloud e stato licenza/installazione.',
    },
  ];

  function updateSection(section, patch) {
    setSettings((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...patch,
      },
    }));
  }

  function updateEmployer(index, field, value) {
    setSettings((current) => ({
      ...current,
      employers: {
        ...current.employers,
        items: current.employers.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, [field]: value } : item
        ),
      },
    }));
  }

  function updateMarker(index, patch) {
    setSettings((current) => ({
      ...current,
      general: {
        ...current.general,
        attendance_markers: (current.general.attendance_markers || []).map((marker, markerIndex) =>
          markerIndex === index ? { ...marker, ...patch } : marker
        ),
      },
    }));
  }

  function addMarker() {
    setSettings((current) => {
      const existing = current.general.attendance_markers || [];
      const baseValue = `MARKER_${existing.length + 1}`;
      let nextValue = baseValue;
      let suffix = 2;
      const used = new Set(existing.map((marker) => String(marker.value || '').toUpperCase()));
      while (used.has(nextValue)) {
        nextValue = `${baseValue}_${suffix}`;
        suffix += 1;
      }

      return {
        ...current,
        general: {
          ...current.general,
          attendance_markers: [
            ...existing,
            {
              value: nextValue,
              text: '',
              symbol: '',
              image: '',
              color: '#27445f',
              background: 'rgba(20, 33, 61, 0.08)',
              active: true,
            },
          ],
        },
      };
    });
  }

  function handleCreateMarkerFromLabel() {
    const label = String(newMarkerLabel || '').trim();
    if (!label) return;

    setSettings((current) => {
      const existing = current.general.attendance_markers || [];
      const baseValue = slugifyMarkerValue(label) || `MARKER_${existing.length + 1}`;
      let nextValue = baseValue;
      let suffix = 2;
      const used = new Set(existing.map((marker) => String(marker.value || '').toUpperCase()));
      while (used.has(nextValue)) {
        nextValue = `${baseValue}_${suffix}`;
        suffix += 1;
      }

      return {
        ...current,
        general: {
          ...current.general,
          attendance_markers: [
            ...existing,
            {
              value: nextValue,
              text: label,
              symbol: suggestMarkerSymbol(label),
              image: '',
              color: '#27445f',
              background: 'rgba(20, 33, 61, 0.08)',
              active: true,
            },
          ],
        },
      };
    });

    setNewMarkerLabel('');
  }

  function removeMarker(index) {
    const marker = settings.general.attendance_markers?.[index];
    const confirmed = window.confirm(`Confermi l'eliminazione del marker "${marker?.text || marker?.value || 'senza nome'}"?`);
    if (!confirmed) return;

    setSettings((current) => ({
      ...current,
      general: {
        ...current.general,
        attendance_markers: (current.general.attendance_markers || []).filter((_, markerIndex) => markerIndex !== index),
      },
    }));
  }

  async function handleSaveSettings() {
    setSaving(true);
    try {
      const saved = await window.api.settings.save({
        company: settings.company,
        employers: {
          mode: settings.employers.mode,
          items: employerItems,
        },
        general: {
          ...settings.general,
          attendance_hours_format: 'decimal',
        },
        backup: settings.backup,
        cloud: settings.cloud,
        software: settings.software,
        licensing: settings.licensing,
      });
      const freshSettings = await window.api.settings.get();
      setSettings(normalizeSettingsPayload(freshSettings || saved || {}));
      setLicenseStatus(await window.api.license.getStatus());
      alert('Impostazioni salvate.');
      setBackups(await window.api.backups.list());
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore salvataggio impostazioni');
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlockAdmin() {
    try {
      const result = await window.api.settings.unlockAdmin(unlockPin);
      setSettings(result);
      setLicenseStatus(await window.api.license.getStatus());
      setUnlockPin('');
    } catch (err) {
      console.error(err);
      alert(err?.message || 'PIN non valido');
    }
  }

  async function handleSwitchToStandard() {
    try {
      setSettings(await window.api.settings.setRole('standard'));
      setLicenseStatus(await window.api.license.getStatus());
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore cambio ruolo');
    }
  }

  async function handleChooseBackupDirectory() {
    try {
      const result = await window.api.settings.chooseBackupDirectory();
      if (!result?.canceled && result.settings) {
        setSettings(result.settings);
        setBackups(await window.api.backups.list());
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore selezione cartella backup');
    }
  }

  async function handleUploadLogo() {
    try {
      const result = await window.api.settings.uploadLogo();
      if (!result?.canceled && result.settings) {
        setSettings(result.settings);
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore caricamento logo');
    }
  }

  async function handleUploadMarkerImage(index) {
    try {
      if (typeof window.api?.settings?.uploadMarkerAsset !== 'function') {
        throw new Error('Funzione di upload marker non disponibile. Riavvia completamente l’app per aggiornare il processo Electron.');
      }

      const result = await window.api.settings.uploadMarkerAsset();
      if (!result?.canceled && result?.imagePath) {
        updateMarker(index, { image: result.imagePath });
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore caricamento immagine marker');
    }
  }

  async function handleRemoveLogo() {
    try {
      setSettings(await window.api.settings.removeLogo());
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore rimozione logo');
    }
  }

  async function handleCreateBackup() {
    try {
      await window.api.backups.create('manual');
      setBackups(await window.api.backups.list());
      const freshSettings = await window.api.settings.get();
      setSettings(freshSettings);
      alert('Backup creato correttamente.');
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore creazione backup');
    }
  }

  async function handleRestoreBackup() {
    try {
      const picked = await window.api.backups.chooseRestore();
      if (!picked || picked.canceled) return;

      if (!picked.validation?.valid) {
        alert(picked.validation?.message || 'Backup non valido.');
        return;
      }

      const confirmed = window.confirm(
        `Confermi il ripristino completo del backup "${picked.backupDir}"?\n\nL'app verra chiusa al termine. In produzione si riavvia automaticamente; in modalita sviluppo dovrai riavviarla manualmente.`
      );
      if (!confirmed) return;

      await window.api.backups.restore(picked.backupDir);
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore ripristino backup');
    }
  }

  async function handleOpenBackupFolder() {
    const result = await window.api.settings.chooseBackupDirectory();
    if (!result?.canceled && result.settings) {
      setSettings(result.settings);
      setBackups(await window.api.backups.list());
    }
  }

  async function handleDeactivateLicense() {
    const confirmed = window.confirm('Confermi la disattivazione locale della licenza su questa installazione?');
    if (!confirmed) return;

    try {
      const next = await window.api.license.deactivate();
      setLicenseStatus(next);
      setSettings(await window.api.settings.get());
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore disattivazione licenza');
    }
  }

  async function handleActivateLicense() {
    try {
      const next = await window.api.license.activate(licenseActivationCode);
      setLicenseStatus(next);
      setSettings(await window.api.settings.get());
      setLicenseActivationCode('');
      alert(next?.message || 'Licenza attivata.');
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore attivazione licenza');
    }
  }

  async function handleResetDemo() {
    const confirmed = window.confirm(
      'Questa operazione cancellerà tutti i dati inseriti nella demo e ripristinerà i dati iniziali di esempio.\n\nL\'operazione è irreversibile e l\'app verrà riavviata al termine.\n\nVuoi continuare?'
    );
    if (!confirmed) return;

    try {
      const result = await window.api.demo.reset();
      if (result?.success) {
        alert('Demo ripristinata correttamente');
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore ripristino dati demo');
    }
  }

  if (loading) {
    return <div className="page"><div className="panel empty-state">Caricamento impostazioni...</div></div>;
  }

  return (
    <div className="page">
      <div className="page-sticky-stack">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Configurazione locale</span>
            <h1 className="page-title">Impostazioni</h1>
            <p className="page-subtitle">
              Configura azienda, datori di lavoro, backup e predisposizione cloud mantenendo sempre il software operativo in locale.
            </p>
          </div>

          <div className="page-actions">
            {settings.runtime_info.is_demo ? (
              <span className="soft-chip" style={{ background: 'rgba(15, 118, 110, 0.12)', color: '#0f766e' }}>
                Modalita demo
              </span>
            ) : null}
            <span className="soft-chip" style={isAdmin ? adminChipStyle : standardChipStyle}>
              {isAdmin ? 'Ruolo: amministratore' : 'Ruolo: utente standard'}
            </span>
            {selectedMacroArea && (
              <button className="button-secondary" onClick={() => setSelectedMacroArea(null)}>
                Indietro
              </button>
            )}
            <button
              className="button-secondary"
              onClick={() => navigate('/setup?force=1')}
            >
              Rifai configurazione iniziale
            </button>
            {isAdmin && selectedMacroArea ? (
              <button className="button-secondary" onClick={handleSwitchToStandard}>
                Passa a utente standard
              </button>
            ) : null}
            {selectedMacroArea ? (
              <button className="button" onClick={handleSaveSettings} disabled={!isAdmin || saving}>
                {saving ? 'Salvataggio...' : 'Salva impostazioni'}
              </button>
            ) : null}
          </div>
        </section>
      </div>

      {!isAdmin ? (
        <section className="panel panel-section">
          <h2 style={{ marginTop: 0 }}>Sblocco amministratore</h2>
          <div className="settings-inline-grid">
            <input
              type="password"
              placeholder="PIN amministratore"
              value={unlockPin}
              onChange={(e) => setUnlockPin(e.target.value)}
            />
            <button className="button-secondary" onClick={handleUnlockAdmin}>
              Sblocca
            </button>
          </div>
        </section>
      ) : null}

      {!selectedMacroArea ? (
        <section className="settings-grid">
          {macroAreas.map((area) => (
            <MacroAreaCard
              key={area.key}
              title={area.title}
              subtitle={area.subtitle}
              onClick={() => setSelectedMacroArea(area.key)}
            />
          ))}
        </section>
      ) : null}

      {selectedMacroArea === 'generale' ? (
        <section className="settings-grid">
          <SettingsBox
          title="Generale"
          subtitle="Configurazione di base del gestionale e dei datori di lavoro attivi."
        >
          <div className="settings-form-grid">
            <label>
              <span className="communication-field-label">Ore base giornata</span>
              <input
                type="number"
                min="1"
                step="0.5"
                value={settings.general.standard_day_hours}
                disabled={!isAdmin}
                onChange={(e) => updateSection('general', { standard_day_hours: e.target.value })}
              />
            </label>
            <label>
              <span className="communication-field-label">Modalita datori</span>
              <select
                value={settings.employers.mode}
                disabled={!isAdmin}
                onChange={(e) => updateSection('employers', { mode: e.target.value })}
              >
                <option value="one">Un solo datore</option>
                <option value="two">Due datori</option>
              </select>
            </label>
          </div>

          <div className="settings-employers-list">
            {employerItems.map((item, index) => (
              <div key={item.key} className="settings-employer-card">
                <div style={{ fontWeight: 800, marginBottom: 10 }}>Datore {index + 1}</div>
                <div className="settings-inline-grid">
                  <input
                    placeholder="Nome datore"
                    value={item.name}
                    disabled={!isAdmin}
                    onChange={(e) => updateEmployer(index, 'name', e.target.value)}
                  />
                  <input
                    placeholder="Sigla"
                    value={item.short_name}
                    disabled={!isAdmin}
                    onChange={(e) => updateEmployer(index, 'short_name', e.target.value.toUpperCase())}
                  />
                </div>
              </div>
            ))}
          </div>
        </SettingsBox>
        </section>
      ) : null}

      {selectedMacroArea === 'presenze' ? (
        <section className="settings-grid">
          <SettingsBox
          title="Presenze"
          subtitle="Regole di inserimento ore, comportamento del simbolo rapido e gestione completa dei marker del foglio presenze."
        >
          <div className="settings-form-grid">
            <label>
              <span className="communication-field-label">Metodo inserimento presenze</span>
              <select
                value={settings.general.attendance_entry_mode || 'hours_and_symbol'}
                disabled={!isAdmin}
                onChange={(e) => updateSection('general', { attendance_entry_mode: e.target.value })}
              >
                <option value="hours_only">Solo ore numeriche</option>
                <option value="hours_and_symbol">Simbolo rapido + ore manuali</option>
              </select>
            </label>
            <label>
              <span className="communication-field-label">Simbolo rapido giornata</span>
              <input
                maxLength="3"
                value={settings.general.attendance_quick_symbol || 'X'}
                disabled={!isAdmin || settings.general.attendance_entry_mode === 'hours_only'}
                onChange={(e) => updateSection('general', { attendance_quick_symbol: e.target.value.toUpperCase() })}
              />
            </label>
          </div>

          <div className="settings-switch-list">
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.general.attendance_auto_symbolize_base_hours}
                disabled={!isAdmin || settings.general.attendance_entry_mode === 'hours_only'}
                onChange={(e) => updateSection('general', { attendance_auto_symbolize_base_hours: e.target.checked })}
              />
              Trasforma automaticamente il valore giornata nel simbolo rapido
            </label>
          </div>

          <div className="muted-box">
            Il simbolo rapido usa sempre il valore di <strong>{settings.general.standard_day_hours || 7} ore</strong>.
            Esempio: se il simbolo e <strong>{settings.general.attendance_quick_symbol || 'X'}</strong> e la base giornata e 7,
            allora <strong>{settings.general.attendance_quick_symbol || 'X'} = 7 ore = 1 giornata</strong>.
            <br />
            Formato inserimento ore attivo: <strong>decimale</strong>.
          </div>

          <SettingsBox
            title="Marker"
            subtitle="Gestione completa dei marker del foglio presenze. Nella tendina compaiono solo quelli attivi."
          >
            <div className="settings-actions-row" style={{ alignItems: 'end', flexWrap: 'wrap', marginBottom: 14 }}>
              <label style={{ flex: '1 1 280px' }}>
                <span className="communication-field-label">Aggiunta rapida marker</span>
                <input
                  value={newMarkerLabel}
                  disabled={!isAdmin}
                  placeholder='Scrivi un nome, es. "agrume"'
                  onChange={(e) => setNewMarkerLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreateMarkerFromLabel();
                    }
                  }}
                />
              </label>
              <span
                className="soft-chip"
                style={{
                  color: '#27445f',
                  background: 'rgba(20, 33, 61, 0.08)',
                  borderColor: 'rgba(20, 33, 61, 0.08)',
                  minHeight: 40,
                  alignItems: 'center',
                  display: 'inline-flex',
                }}
              >
                Simbolo proposto: {markerSuggestionSymbol}
              </span>
              <button className="button-secondary" onClick={handleCreateMarkerFromLabel} disabled={!isAdmin || !newMarkerLabel.trim()}>
                Crea marker
              </button>
              <button className="button-secondary" onClick={addMarker} disabled={!isAdmin}>
                Nuovo vuoto
              </button>
            </div>

            <div className="settings-employers-list">
              {(settings.general.attendance_markers || []).map((marker, index) => (
                <div key={`${marker.value}-${index}`} className="settings-employer-card">
                  <div className="settings-form-grid">
                    <label>
                      <span className="communication-field-label">Value</span>
                      <input
                        value={marker.value}
                        disabled={!isAdmin}
                        onChange={(e) => updateMarker(index, { value: slugifyMarkerValue(e.target.value || marker.text || `MARKER_${index + 1}`) })}
                      />
                    </label>
                    <label>
                      <span className="communication-field-label">Nome / descrizione</span>
                      <input
                        value={marker.text}
                        disabled={!isAdmin}
                        onChange={(e) => updateMarker(index, { text: e.target.value })}
                      />
                    </label>
                    <label>
                      <span className="communication-field-label">Simbolo</span>
                      <input
                        value={marker.symbol}
                        disabled={!isAdmin}
                        onChange={(e) => updateMarker(index, { symbol: e.target.value })}
                      />
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      <span className="communication-field-label">Immagine locale PNG/SVG</span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center' }}>
                        <input
                          value={marker.image || ''}
                          disabled={!isAdmin}
                          placeholder="/assets/markers/agrume.svg oppure ./assets/markers/agrume.png"
                          onChange={(e) => updateMarker(index, { image: e.target.value })}
                        />
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={!isAdmin}
                          onClick={() => handleUploadMarkerImage(index)}
                        >
                          Carica file
                        </button>
                      </div>
                      {resolveMarkerImageSrc(marker.image) ? (
                        <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 10,
                              border: '1px solid rgba(15, 23, 42, 0.08)',
                              background: 'rgba(248, 250, 252, 0.95)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              overflow: 'hidden',
                            }}
                          >
                            <img
                              src={resolveMarkerImageSrc(marker.image)}
                              alt={marker.text || marker.value || 'marker'}
                              style={{ width: 22, height: 22, objectFit: 'contain' }}
                            />
                          </span>
                          <span style={{ color: '#64748b', fontSize: 12 }}>
                            Anteprima file marker
                          </span>
                        </div>
                      ) : null}
                    </label>
                    <label>
                      <span className="communication-field-label">Colore testo</span>
                      <input
                        value={marker.color}
                        disabled={!isAdmin}
                        onChange={(e) => updateMarker(index, { color: e.target.value })}
                      />
                    </label>
                    <label>
                      <span className="communication-field-label">Colore sfondo</span>
                      <input
                        value={marker.background}
                        disabled={!isAdmin}
                        onChange={(e) => updateMarker(index, { background: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className="settings-actions-row">
                    <label className="communication-checkbox">
                      <input
                        type="checkbox"
                        checked={marker.active !== false}
                        disabled={!isAdmin}
                        onChange={(e) => updateMarker(index, { active: e.target.checked })}
                      />
                      Mostra nella tendina presenze
                    </label>
                    <MarkerPreview marker={marker} />
                    <button className="button-danger" onClick={() => removeMarker(index)} disabled={!isAdmin}>
                      Elimina
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </SettingsBox>
        </SettingsBox>
        </section>
      ) : null}

      {selectedMacroArea === 'straordinario' ? (
        <section className="settings-grid">
          <SettingsBox
          title="Straordinario"
          subtitle="Attivazione, tariffa e modalita di visualizzazione dello straordinario."
        >
          <div className="settings-switch-list">
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.general.overtime_enabled}
                disabled={!isAdmin}
                onChange={(e) => updateSection('general', { overtime_enabled: e.target.checked })}
              />
              Attiva gestione straordinario con tariffa separata
            </label>
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.general.overtime_show_hourly_rate}
                disabled={!isAdmin || !settings.general.overtime_enabled}
                onChange={(e) => updateSection('general', { overtime_show_hourly_rate: e.target.checked })}
              />
              Mostra tariffa oraria straordinario
            </label>
          </div>

          <div className="settings-form-grid">
            <label>
              <span className="communication-field-label">Tariffa straordinario generale (€ / ora)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.general.overtime_hourly_rate ?? 0}
                disabled={!isAdmin || !settings.general.overtime_enabled}
                onChange={(e) => updateSection('general', { overtime_hourly_rate: e.target.value })}
              />
            </label>
            <label>
              <span className="communication-field-label">Visualizzazione straordinario</span>
              <select
                value={settings.general.overtime_display_mode || 'included'}
                disabled={!isAdmin || !settings.general.overtime_enabled}
                onChange={(e) => updateSection('general', { overtime_display_mode: e.target.value })}
              >
                <option value="included">Sommare lo straordinario al totale</option>
                <option value="separate">Mostrare lo straordinario separato</option>
              </select>
            </label>
          </div>

          <div className="muted-box">
            Straordinario: <strong>{settings.general.overtime_enabled ? `attivo a € ${Number(settings.general.overtime_hourly_rate || 0).toFixed(2)} / ora` : 'disattivato'}</strong>.
          </div>
        </SettingsBox>
        </section>
      ) : null}

      {selectedMacroArea === 'report' ? (
        <section className="settings-grid">
          <SettingsBox
          title="Report / PDF"
          subtitle="Controlla quali voci devono comparire nelle stampe e nei PDF."
        >
          <div className="settings-switch-list">
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.general.print_options.show_transport}
                disabled={!isAdmin}
                onChange={(e) => updateSection('general', { print_options: { ...settings.general.print_options, show_transport: e.target.checked } })}
              />
              Trasporto nelle stampe
            </label>
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.general.print_options.show_advances}
                disabled={!isAdmin}
                onChange={(e) => updateSection('general', { print_options: { ...settings.general.print_options, show_advances: e.target.checked } })}
              />
              Acconti nelle stampe
            </label>
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.general.print_options.show_compensation}
                disabled={!isAdmin}
                onChange={(e) => updateSection('general', { print_options: { ...settings.general.print_options, show_compensation: e.target.checked } })}
              />
              Compensi nelle stampe
            </label>
          </div>
        </SettingsBox>
        </section>
      ) : null}

      {selectedMacroArea === 'comunicazioni' ? (
        <section className="settings-grid">
          <SettingsBox
          title="Email / Comunicazioni"
          subtitle="Dati usati nelle comunicazioni e nei documenti inviabili via email."
        >
          <div className="settings-form-grid">
            <label>
              <span className="communication-field-label">Email aziendale</span>
              <input
                type="email"
                value={settings.company.email}
                disabled={!isAdmin}
                onChange={(e) => updateSection('company', { email: e.target.value })}
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Recapiti</span>
              <textarea
                rows={3}
                value={settings.company.contacts}
                disabled={!isAdmin}
                onChange={(e) => updateSection('company', { contacts: e.target.value })}
              />
            </label>
          </div>
        </SettingsBox>
        </section>
      ) : null}

      {selectedMacroArea === 'branding' ? (
        <section className="settings-grid">
          <SettingsBox
          title="Branding / Larix"
          subtitle="Identità visiva e intestazioni dei documenti del gestionale."
        >
          <div className="settings-form-grid">
            <label>
              <span className="communication-field-label">Nome azienda</span>
              <input
                value={settings.company.name}
                disabled={!isAdmin}
                onChange={(e) => updateSection('company', { name: e.target.value })}
              />
            </label>
            <label>
              <span className="communication-field-label">Intestazione documenti</span>
              <input
                value={settings.company.document_header}
                disabled={!isAdmin}
                onChange={(e) => updateSection('company', { document_header: e.target.value })}
              />
            </label>
          </div>

          <div className="settings-actions-row">
            <span className="soft-chip" style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762' }}>
              Logo attuale: {settings.company.logo_file_name || 'non impostato'}
            </span>
            <button className="button-secondary" onClick={handleUploadLogo} disabled={!isAdmin}>
              Carica logo
            </button>
            <button className="button-secondary" onClick={handleRemoveLogo} disabled={!isAdmin || !settings.company.logo_path}>
              Rimuovi logo
            </button>
          </div>
        </SettingsBox>
        </section>
      ) : null}

      {selectedMacroArea === 'backup' ? (
        <>
          <section className="settings-grid">
            <SettingsBox
          title="Sistema / Aggiornamenti"
          subtitle="Stato dell'app, schema database, canale aggiornamenti e percorsi persistenti."
        >
          <div className="settings-form-grid">
            <label>
              <span className="communication-field-label">Variante applicazione</span>
              <input value={settings.runtime_info.is_demo ? 'Demo' : 'Standard'} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Versione software</span>
              <input value={settings.runtime_info.app_version || '—'} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Schema database</span>
              <input value={settings.database_runtime.schema_version || '—'} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Canale aggiornamenti</span>
              <select
                value={settings.software.updates.channel}
                disabled={!isAdmin}
                onChange={(e) => updateSection('software', {
                  updates: {
                    ...settings.software.updates,
                    channel: e.target.value,
                  },
                })}
              >
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
                <option value="alpha">Alpha</option>
              </select>
            </label>
            <label>
              <span className="communication-field-label">Modalita installazione update</span>
              <input value={settings.software.updates.install_mode || 'manual'} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Ultima migrazione</span>
              <input value={settings.database_runtime.last_migration_id || '—'} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Ultimo check aggiornamenti</span>
              <input value={formatDateTime(settings.software.updates.last_check_at)} readOnly />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">URL feed aggiornamenti futuro</span>
              <input
                value={settings.software.updates.feed_url}
                disabled={!isAdmin}
                onChange={(e) => updateSection('software', {
                  updates: {
                    ...settings.software.updates,
                    feed_url: e.target.value,
                  },
                })}
                placeholder="https://..."
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Cartella dati utente</span>
              <input value={settings.storage_paths.user_data_root || '—'} readOnly />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Database locale</span>
              <input value={settings.storage_paths.database_file || settings.database_runtime.database_path || '—'} readOnly />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Impostazioni</span>
              <input value={settings.storage_paths.settings_file || '—'} readOnly />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Licenza</span>
              <input value={settings.storage_paths.license_file || '—'} readOnly />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Documenti generati</span>
              <input value={settings.storage_paths.documents_dir || '—'} readOnly />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Cache aggiornamenti futura</span>
              <input value={settings.storage_paths.updates_dir || '—'} readOnly />
            </label>
          </div>

          <div className="settings-switch-list">
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.software.updates.auto_check_enabled}
                disabled={!isAdmin}
                onChange={(e) => updateSection('software', {
                  updates: {
                    ...settings.software.updates,
                    auto_check_enabled: e.target.checked,
                  },
                })}
              />
              Predisposizione controllo aggiornamenti automatico
            </label>
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.software.updates.allow_prerelease}
                disabled={!isAdmin}
                onChange={(e) => updateSection('software', {
                  updates: {
                    ...settings.software.updates,
                    allow_prerelease: e.target.checked,
                  },
                })}
              />
              Consenti versioni prerelease
            </label>
          </div>

          <div className="muted-box">
            Strategia update: <strong>{settings.update_runtime.strategy || 'program-update-only'}</strong><br />
            I dati utente, la licenza e l’attivazione restano nella cartella persistente separata dal programma.
          </div>

          {settings.runtime_info.is_demo ? (
            <div className="muted-box" style={{ marginTop: 14 }}>
              Versione demo separata dai dati reali. Puoi ripristinare in qualsiasi momento il database di esempio iniziale.
              <div style={{ marginTop: 12 }}>
                <button className="button-warning" type="button" onClick={handleResetDemo}>
                  Ripristina dati demo
                </button>
              </div>
            </div>
          ) : null}
        </SettingsBox>

          <SettingsBox
          title="Backup locale"
          subtitle="Cartella backup, politiche automatiche e azioni di creazione o ripristino."
        >
          <div className="settings-form-grid">
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Cartella backup</span>
              <input value={settings.backup.directory || settings.backup_directory_effective} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Backup automatico</span>
              <select
                value={settings.backup.automatic_mode}
                disabled={!isAdmin}
                onChange={(e) => updateSection('backup', { automatic_mode: e.target.value })}
              >
                <option value="none">Disattivato</option>
                <option value="daily">Giornaliero</option>
                <option value="weekly">Settimanale</option>
              </select>
            </label>
            <label className="communication-checkbox" style={{ alignSelf: 'end' }}>
              <input
                type="checkbox"
                checked={!!settings.backup.backup_on_exit}
                disabled={!isAdmin}
                onChange={(e) => updateSection('backup', { backup_on_exit: e.target.checked })}
              />
              Backup automatico all'uscita
            </label>
          </div>

          <div className="settings-actions-row">
            <button className="button-secondary" onClick={handleChooseBackupDirectory} disabled={!isAdmin}>
              Scegli cartella backup
            </button>
            <button className="button-secondary" onClick={handleCreateBackup} disabled={!isAdmin}>
              Crea backup adesso
            </button>
            <button className="button-secondary" onClick={handleRestoreBackup} disabled={!isAdmin}>
              Ripristina backup
            </button>
          </div>

          <div className="muted-box">
            Ultimo backup automatico: <strong>{formatDateTime(settings.backup.last_auto_backup_at)}</strong>
          </div>
        </SettingsBox>

          <SettingsBox
          title="Cloud opzionale"
          subtitle="Predisposizione futura per backup esterni, senza cambiare l'operativita locale."
        >
          <div className="settings-switch-list">
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.cloud.enabled}
                disabled={!isAdmin}
                onChange={(e) => updateSection('cloud', { enabled: e.target.checked })}
              />
              Abilita backup cloud opzionale
            </label>
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.cloud.compression_enabled}
                disabled={!isAdmin}
                onChange={(e) => updateSection('cloud', { compression_enabled: e.target.checked })}
              />
              Compressione backup
            </label>
            <label className="communication-checkbox">
              <input
                type="checkbox"
                checked={!!settings.cloud.encrypt_archives}
                disabled={!isAdmin}
                onChange={(e) => updateSection('cloud', { encrypt_archives: e.target.checked })}
              />
              Predisposizione cifratura
            </label>
          </div>

          <div className="settings-form-grid">
            <label>
              <span className="communication-field-label">Provider</span>
              <input
                value={settings.cloud.provider}
                disabled={!isAdmin}
                onChange={(e) => updateSection('cloud', { provider: e.target.value })}
              />
            </label>
            <label>
              <span className="communication-field-label">Bucket / spazio</span>
              <input
                value={settings.cloud.bucket_name}
                disabled={!isAdmin}
                onChange={(e) => updateSection('cloud', { bucket_name: e.target.value })}
              />
            </label>
            <label>
              <span className="communication-field-label">Cartella cloud</span>
              <input
                value={settings.cloud.folder}
                disabled={!isAdmin}
                onChange={(e) => updateSection('cloud', { folder: e.target.value })}
              />
            </label>
            <label>
              <span className="communication-field-label">Strategia versioni</span>
              <input
                value={settings.cloud.versioning_strategy}
                disabled={!isAdmin}
                onChange={(e) => updateSection('cloud', { versioning_strategy: e.target.value })}
              />
            </label>
            <label>
              <span className="communication-field-label">Gestione conflitti</span>
              <input
                value={settings.cloud.conflict_strategy}
                disabled={!isAdmin}
                onChange={(e) => updateSection('cloud', { conflict_strategy: e.target.value })}
              />
            </label>
          </div>
        </SettingsBox>

          <SettingsBox
          title="Licenza e installazione"
          subtitle="Informazioni sul dispositivo attivato e stato licenza della postazione."
        >
          <div className="settings-form-grid">
            <label>
              <span className="communication-field-label">Install ID</span>
              <input value={licenseStatus?.install_context?.install_id || settings.licensing.install_id} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Stato licenza</span>
              <input value={normalizedLicenseUi.statusLabel} readOnly />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Codice dispositivo</span>
              <input value={licenseStatus?.install_context?.machine_fingerprint || ''} readOnly />
            </label>
            <label>
              <span className="communication-field-label">ID licenza</span>
              <input value={licenseStatus?.license?.license_id || settings.licensing.license_id || '—'} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Cliente / azienda</span>
              <input value={licenseStatus?.license?.company_name || settings.licensing.company_name || '—'} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Attivata il</span>
              <input value={licenseStatus?.license?.activation_date || settings.licensing.activated_at || '—'} readOnly />
            </label>
            <label>
              <span className="communication-field-label">Scadenza</span>
              <input value={licenseStatus?.license?.expires_at || settings.licensing.expires_at || '—'} readOnly />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Codice licenza</span>
              <input
                value={licenseActivationCode}
                onChange={(e) => setLicenseActivationCode(e.target.value)}
                placeholder="Inserisci il codice licenza, ad esempio GPA-TEST-2026"
                disabled={!isAdmin}
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="communication-field-label">Messaggio licenza</span>
              <textarea
                rows={3}
                value={normalizedLicenseUi.message || '—'}
                readOnly
                style={{ resize: 'vertical' }}
              />
            </label>
            {isDevMode ? (
              <label style={{ gridColumn: '1 / -1' }}>
                <span className="communication-field-label">Modalita sviluppo</span>
                <textarea
                  rows={2}
                  value="Modalita sviluppo attiva – controllo licenza disabilitato"
                  readOnly
                  style={{ resize: 'vertical' }}
                />
              </label>
            ) : null}
          </div>

          <div className="settings-actions-row">
            <button
              className="button"
              onClick={handleActivateLicense}
              disabled={!isAdmin || !licenseActivationCode.trim()}
            >
              Attiva licenza
            </button>
            <button className="button-secondary" onClick={loadData}>
              Aggiorna stato licenza
            </button>
            <button
              className="button-danger"
              onClick={handleDeactivateLicense}
              disabled={!isAdmin || !licenseStatus?.license || licenseStatus?.code === 'demo'}
            >
              Disattiva licenza locale
            </button>
          </div>
        </SettingsBox>
          </section>

          <section className="panel panel-section">
            <div className="communication-history-head">
              <div>
                <span className="page-kicker" style={{ marginBottom: 8 }}>Storico backup</span>
                <h2 style={{ margin: 0, fontSize: 24 }}>Backup disponibili</h2>
              </div>
              <button className="button-secondary" onClick={handleOpenBackupFolder} disabled={!isAdmin}>
                Cambia cartella / aggiorna elenco
              </button>
            </div>

            {!backups.length ? (
              <div className="empty-state">Nessun backup presente nella cartella configurata.</div>
            ) : (
              <div className="table-shell">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Ora</th>
                        <th>Nome file/cartella</th>
                        <th>Dimensione</th>
                        <th>Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backups.map((backup) => {
                        const created = backup.created_at ? new Date(backup.created_at) : null;
                        return (
                          <tr key={backup.backup_dir}>
                            <td>{created ? created.toLocaleDateString('it-IT') : '—'}</td>
                            <td>{created ? created.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                            <td>{backup.file_name}</td>
                            <td>{formatBytes(backup.size_bytes)}</td>
                            <td>{backup.type === 'automatic' ? 'Automatico' : 'Manuale'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

const adminChipStyle = {
  background: 'rgba(16, 185, 129, 0.14)',
  color: '#047857',
  borderColor: 'rgba(16, 185, 129, 0.18)',
};

const standardChipStyle = {
  background: 'rgba(20, 33, 61, 0.06)',
  color: '#314762',
  borderColor: 'rgba(20, 33, 61, 0.08)',
};
