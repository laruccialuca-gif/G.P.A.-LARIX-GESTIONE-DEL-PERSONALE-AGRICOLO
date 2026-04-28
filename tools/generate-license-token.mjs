import fs from 'fs';
import crypto from 'crypto';

function usage() {
  console.error('Uso: node tools/generate-license-token.mjs <payload.json>');
  process.exit(1);
}

const payloadPath = process.argv[2];
if (!payloadPath) usage();

const privateKeyPem = process.env.GESTIONALE_LICENSE_PRIVATE_KEY;
if (!privateKeyPem || !privateKeyPem.includes('BEGIN PRIVATE KEY')) {
  console.error('Imposta GESTIONALE_LICENSE_PRIVATE_KEY con una chiave privata PEM Ed25519.');
  process.exit(1);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }

  return value;
}

const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const canonical = JSON.stringify(canonicalize(payload));
const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem).toString('base64');

const envelope = {
  schema_version: 1,
  algorithm: 'ed25519',
  payload,
  signature,
};

console.log(JSON.stringify(envelope, null, 2));
console.log('\nCodice attivazione base64url:\n');
console.log(Buffer.from(JSON.stringify(envelope)).toString('base64url'));
