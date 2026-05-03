const path = require('path');
let electronApp = null;

try {
  ({ app: electronApp } = require('electron'));
} catch {
  electronApp = null;
}

const packageJson = require(path.join(__dirname, '../../package.json'));

function getRawAppVariant() {
  return String(
    process.env.APP_VARIANT ||
      process.env.GESTIONALE_APP_VARIANT ||
      packageJson.appVariant ||
      'standard'
  )
    .trim()
    .toLowerCase();
}

function getAppVariant() {
  const variant = getRawAppVariant();

  return variant === 'demo' ? 'demo' : 'standard';
}

function getRuntimeContext() {
  const rawVariant = getRawAppVariant();
  const packaged = Boolean(electronApp?.isPackaged);
  const devVariant = rawVariant === 'dev';
  const demoVariant = rawVariant === 'demo';
  // APP_VARIANT=production forces production mode even when not packaged (dev:production script)
  const productionVariant = rawVariant === 'production';
  const isDev = !productionVariant && (!packaged || devVariant);
  const isDemo = demoVariant;
  const isProduction = !isDev && !isDemo;

  return {
    appVariant: rawVariant,
    packaged,
    isPackaged: packaged,
    isDev,
    isDemo,
    isProduction,
  };
}

function isDemoVariant() {
  return getRuntimeContext().isDemo;
}

function isDevelopmentVariant() {
  return getRuntimeContext().isDev;
}

function getVariantConfig() {
  if (isDemoVariant()) {
    return {
      variant: 'demo',
      packageName: 'gestionale-demo',
      appDataDirName: 'GestionaleDemo',
      legacyAppDataDirName: 'Gestionale Dipendenti Offline Demo',
      productName: 'GPA versione 1 demo',
      installerBaseName: 'GPA-Demo',
      legacyPackageUserDataDirName: packageJson.name,
    };
  }

  return {
    variant: 'standard',
    packageName: 'gestionale',
    appDataDirName: 'Gestionale',
    legacyAppDataDirName: 'Gestionale Dipendenti Offline',
    productName: 'Gestionale',
    installerBaseName: 'Gestionale',
    legacyPackageUserDataDirName: packageJson.name,
  };
}

module.exports = {
  getAppVariant,
  getRuntimeContext,
  getRawAppVariant,
  getVariantConfig,
  isDevelopmentVariant,
  isDemoVariant,
};
