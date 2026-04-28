#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const args = new Set(process.argv.slice(2));
const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
const buildConfig = packageJson.build ?? {};
const outputDir = path.resolve(process.cwd(), buildConfig.directories?.output ?? 'release-demo');
const artifactName = buildConfig.artifactName ?? 'Gestionale-Demo-${version}-Setup.${ext}';

if (args.has('--clean')) {
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    console.log(`[demo-build] cartella output pulita: ${outputDir}`);
  } else {
    console.log(`[demo-build] cartella output gia assente: ${outputDir}`);
  }
  process.exit(0);
}

if (args.has('--stage=before')) {
  console.log(`[demo-build] versione: ${version}`);
  console.log(`[demo-build] cartella output: ${outputDir}`);
  console.log(
    `[demo-build] installer atteso: ${artifactName
      .replace('${version}', version)
      .replace('${ext}', 'exe')}`,
  );
  process.exit(0);
}

if (args.has('--stage=after')) {
  if (!fs.existsSync(outputDir)) {
    console.log(`[demo-build] cartella output non trovata: ${outputDir}`);
    process.exit(0);
  }

  const entries = fs.readdirSync(outputDir, { withFileTypes: true });
  const installers = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => entry.name)
    .sort();

  const latestYml = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase() === 'latest.yml')
    .map((entry) => entry.name);

  if (installers.length === 0) {
    console.log('[demo-build] nessun installer .exe trovato nella cartella di output');
  } else {
    for (const installer of installers) {
      console.log(`[demo-build] installer generato: ${path.join(outputDir, installer)}`);
    }
  }

  if (latestYml.length > 0) {
    console.log(`[demo-build] file metadata: ${path.join(outputDir, latestYml[0])}`);
  }

  console.log(`[demo-build] output finale: ${outputDir}`);
}
