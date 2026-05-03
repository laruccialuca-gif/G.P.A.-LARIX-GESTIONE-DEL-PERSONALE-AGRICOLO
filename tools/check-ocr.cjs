#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const cwd = process.cwd();
const userDataFallback = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'gestionale-presenze-offline',
  'tessdata'
);

const candidates = [
  {
    source: 'packaged',
    dir: process.resourcesPath ? path.join(process.resourcesPath, 'tessdata') : '',
  },
  {
    source: 'resources',
    dir: path.join(cwd, 'resources', 'tessdata'),
  },
  {
    source: 'dirname',
    dir: path.resolve(__dirname, '..', 'resources', 'tessdata'),
  },
  {
    source: 'userData',
    dir: userDataFallback,
  },
].filter((candidate) => candidate.dir);

const inspected = candidates.map((candidate) => {
  const files = listTessdataFiles(candidate.dir);
  return {
    ...candidate,
    exists: fs.existsSync(candidate.dir),
    files,
    languages: getLanguages(candidate.dir),
  };
});

const selected = inspected.find((candidate) => candidate.exists && candidate.languages.length)
  || inspected.find((candidate) => candidate.exists)
  || inspected[inspected.length - 1];

const output = {
  platform: process.platform,
  cwd,
  dirname: __dirname,
  process_resources_path: process.resourcesPath || '',
  selected_source: selected?.source || '',
  selected_tessdata_path: selected?.dir || '',
  resources_candidates: inspected,
  languages_found: selected?.languages || [],
  ocr_enabled: Boolean(selected?.languages?.length),
  reason_if_false: selected?.languages?.length ? '' : `missing_tessdata: ${selected?.dir || ''}`,
};

console.log(JSON.stringify(output, null, 2));

function languageFiles(language, dir) {
  return [
    path.join(dir, `${language}.traineddata.gz`),
    path.join(dir, `${language}.traineddata`),
  ];
}

function getLanguages(dir) {
  return ['ita', 'eng'].filter((language) =>
    languageFiles(language, dir).some((filePath) => fs.existsSync(filePath))
  );
}

function listTessdataFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((fileName) => /\.traineddata(?:\.gz)?$/i.test(fileName))
      .sort();
  } catch {
    return [];
  }
}
