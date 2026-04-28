const { app } = require('electron');

function defaultUpdateSettings() {
  return {
    channel: 'stable',
    auto_check_enabled: false,
    allow_prerelease: false,
    feed_url: '',
    last_check_at: '',
    last_result: 'never_checked',
    pending_version: '',
    downloaded_version: '',
    install_mode: 'manual',
  };
}

function normalizeUpdateSettings(input = {}) {
  const base = defaultUpdateSettings();
  const channel = ['stable', 'beta', 'alpha'].includes(String(input.channel || '').trim())
    ? String(input.channel || '').trim()
    : base.channel;

  return {
    channel,
    auto_check_enabled: !!input.auto_check_enabled,
    allow_prerelease: !!input.allow_prerelease,
    feed_url: String(input.feed_url || '').trim(),
    last_check_at: String(input.last_check_at || '').trim(),
    last_result: String(input.last_result || base.last_result).trim() || base.last_result,
    pending_version: String(input.pending_version || '').trim(),
    downloaded_version: String(input.downloaded_version || '').trim(),
    install_mode: String(input.install_mode || base.install_mode).trim() || base.install_mode,
  };
}

function buildUpdateRuntimeSummary(settings = {}) {
  const normalized = normalizeUpdateSettings(settings);

  return {
    ...normalized,
    updater_ready: false,
    app_version: app.getVersion(),
    packaged: app.isPackaged,
    supports_future_auto_updates: true,
    preserves_user_data: true,
    preserves_license_state: true,
    strategy: 'program-update-only',
  };
}

module.exports = {
  buildUpdateRuntimeSummary,
  defaultUpdateSettings,
  normalizeUpdateSettings,
};
