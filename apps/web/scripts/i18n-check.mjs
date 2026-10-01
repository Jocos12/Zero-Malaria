/**
 * npm run i18n:check
 * (a) every key exists in rw and en (locales source of truth)
 * (b) fail on hard-coded English user strings in JSX/TSX (heuristic)
 * (c) fail on TODO_REVIEW_RW or empty values
 * (d) report draft keys from locales/rw/_review.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, '../src');
const localesRoot = path.join(srcRoot, 'locales');

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function loadLang(lang) {
  const dir = path.join(localesRoot, lang);
  const merged = {};
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    const top = name.replace(/\.json$/, '');
    merged[top] = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  return flatten(merged);
}

const en = loadLang('en');
const rw = loadLang('rw');
let failed = false;

for (const [label, flat] of [
  ['en', en],
  ['rw', rw],
]) {
  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== 'string') {
      console.error(`FAIL ${label}: ${key} is not a string`);
      failed = true;
      continue;
    }
    if (value.includes('\u2014') || value.includes('\u2013')) {
      console.error(`FAIL ${label}: ${key} contains em/en dash; use words instead`);
      failed = true;
    }
    // Lone "-" used as empty UI placeholder (not part of a sentence)
    if (value.trim() === '-') {
      console.error(`FAIL ${label}: ${key} is a lone dash placeholder; use a translated label`);
      failed = true;
    }
    if (value.includes('TODO_REVIEW_RW')) {
      console.error(`FAIL ${label}: ${key} contains TODO_REVIEW_RW`);
      failed = true;
    }
    if (value.trim() === '') {
      console.error(`FAIL ${label}: ${key} is empty`);
      failed = true;
    }
  }
}

const enKeys = new Set(Object.keys(en));
const rwKeys = new Set(Object.keys(rw));
for (const k of enKeys) {
  if (!rwKeys.has(k)) {
    console.error(`FAIL missing in rw: ${k}`);
    failed = true;
  }
}
for (const k of rwKeys) {
  if (!enKeys.has(k)) {
    console.error(`FAIL missing in en: ${k}`);
    failed = true;
  }
}

// Sync merged bundles for any legacy readers
for (const lang of ['rw', 'en']) {
  const dir = path.join(localesRoot, lang);
  const merged = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    merged[name.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  fs.writeFileSync(path.join(srcRoot, 'i18n', `${lang}.json`), `${JSON.stringify(merged, null, 2)}\n`);
}

// Hard-coded English scan in components/pages (allow tests, identifiers, brands)
const SCAN_DIRS = ['components', 'pages', 'voice', 'events', 'auth', 'sync'].map((d) => path.join(srcRoot, d));
const ALLOW_SUBSTRINGS = [
  'ZeroMalaria',
  'TDR',
  'RDT',
  'RBC',
  'CHW',
  'ACT',
  'SMS',
  'QR',
  'UUID',
  'ML',
  'AI',
  'SSE',
  'PWA',
  'Ctrl',
  'TODO',
  'http',
  'https',
  'className',
  'localhost',
];
const ALLOW_FILES = [/\.test\./, /\.spec\./, /hardcoded/, /DevTranslations/, /TranslationReview/];
// Visible JSX text / string literals that look like English UI sentences
const EN_UI =
  />\s*([A-Z][a-z]+(?:\s+[a-z]+){1,6})\s*</g;
const EN_STRING_PROP =
  /(?:aria-label|title|placeholder|alt)=\{?["']([A-Z][a-zA-Z]+(?:\s+[a-zA-Z]+){0,6})["']\}?/g;

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (/\.(tsx|jsx)$/.test(name)) files.push(p);
  }
  return files;
}

const hits = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    if (ALLOW_FILES.some((re) => re.test(file.replace(/\\/g, '/')))) continue;
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(srcRoot, file).replace(/\\/g, '/');
    for (const re of [EN_UI, EN_STRING_PROP]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const text = m[1].trim();
        if (ALLOW_SUBSTRINGS.some((a) => text.includes(a))) continue;
        // Skip pure code-like tokens
        if (/^[A-Z][a-z]+$/.test(text) && text.length < 4) continue;
        hits.push({ file: rel, text });
      }
    }
  }
}

if (hits.length) {
  console.error(`FAIL hard-coded English UI strings (${hits.length}):`);
  for (const h of hits.slice(0, 40)) {
    console.error(`  ${h.file}: "${h.text}"`);
  }
  if (hits.length > 40) console.error(`  … and ${hits.length - 40} more`);
  failed = true;
}

const reviewPath = path.join(localesRoot, 'rw', '_review.json');
let draftCount = 0;
if (fs.existsSync(reviewPath)) {
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  draftCount = Object.values(review).filter((v) => v && v.status === 'draft').length;
}

console.log(`Keys: ${rwKeys.size} (rw/en parity)`);
console.log(`Draft keys needing native review: ${draftCount}`);
if (failed) {
  process.exit(1);
}
console.log('i18n:check OK');
