const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (process.platform === 'win32') {
    return;
  }

  const appOutDir = context?.appOutDir || '';
  if (!appOutDir) {
    return;
  }

  const targetPath = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'src', 'main', 'pdf-ocr');
  if (!fs.existsSync(targetPath)) {
    return;
  }

  try {
    fs.chmodSync(targetPath, 0o755);
    // eslint-disable-next-line no-console
    console.log(`[afterPack] pdf-ocr chmod 755: ${targetPath}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[afterPack] impossibile aggiornare i permessi di pdf-ocr: ${error?.message || error}`);
  }
};
