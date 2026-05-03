const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET_EXTENSIONS = new Set(['.js', '.jsx', '.cjs', '.mjs', '.json', '.html', '.css']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'release', 'release-demo', '.git']);
const SMART_QUOTES_PATTERN = /[\u2018\u2019\u201C\u201D]/;

function walk(dirPath, results = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TARGET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    results.push(fullPath);
  }
  return results;
}

const files = walk(ROOT);
const matches = [];

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (SMART_QUOTES_PATTERN.test(line)) {
      matches.push(`${path.relative(ROOT, filePath)}:${index + 1}:${line}`);
    }
  });
}

if (matches.length) {
  console.error('Trovate virgolette tipografiche nel codice:');
  console.error(matches.join('\n'));
  process.exit(1);
}

console.log('Nessuna virgoletta tipografica trovata nei file di codice.');
