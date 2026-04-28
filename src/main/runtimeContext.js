const path = require('path');

const packageJson = require(path.join(__dirname, '../../package.json'));

function getAppVariant() {
  const variant = String(
    process.env.APP_VARIANT ||
      process.env.GESTIONALE_APP_VARIANT ||
      packageJson.appVariant ||
      'standard'
  )
    .trim()
    .toLowerCase();

  return variant === 'demo' ? 'demo' : 'standard';
}

function isDemoVariant() {
  return getAppVariant() === 'demo';
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
  getVariantConfig,
  isDemoVariant,
};
