// i18n. Aimed at the failures that still render: a key that exists in one locale only, a
// placeholder that survives translation as literal text, a key built at runtime that nobody
// wrote. Most keys here ARE built at runtime (`req.${id}.title`, `det.${...}`), so they are
// enumerated from the catalogue rather than found by grepping for literals.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULT_LANG, LANGS, LOCALES, extraKeys, missingKeys, placeholders, resolveLang, setLang, t } from '../src/i18n/index.js';
import { HIGH_VARIANTS, MEDIUM_PLUS_VARIANTS } from '../src/plan.js';
import { CHECK_IDS, OUTCOMES, VERDICTS } from '../src/evidence.js';
import { FOCI, LEVELS, REQUIREMENTS, STATUSES } from '../src/requirements.js';

const CODES = Object.keys(LOCALES);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the set is English and Spanish, decided for this project on 2026-09-29', () => {
  assert.deepEqual(CODES.sort(), ['en', 'es']);
  assert.deepEqual(LANGS.map((l) => l.label), ['English', 'Español']);
});

test('every locale carries every key, and no key English does not have', () => {
  for (const code of CODES) {
    assert.deepEqual(missingKeys(code), [], `${code} is missing keys`);
    assert.deepEqual(extraKeys(code), [], `${code} carries keys English does not`);
  }
});

test('no locale ships an empty string or an em dash', () => {
  for (const code of CODES)
    for (const [key, value] of Object.entries(LOCALES[code])) {
      assert.ok(String(value).trim().length > 0, `${code}.${key} is empty`);
      assert.equal(String(value).includes('\u2014'), false, `${code}.${key} has an em dash`);
    }
});

test('a translation carries exactly the placeholders the English does', () => {
  for (const code of CODES)
    for (const key of Object.keys(LOCALES.en))
      assert.deepEqual(placeholders(LOCALES[code][key]), placeholders(LOCALES.en[key]), `${code}.${key}`);
});

/** Every key the page builds from the catalogue at runtime. */
function runtimeKeys() {
  const keys = [];
  for (const l of LEVELS) keys.push(`level.${l}`, `level.${l}.desc`);
  for (const s of STATUSES) keys.push(`status.${s}`, `status.hint.${s}`);
  for (const f of FOCI) keys.push(`focus.${f}`);
  for (const v of VERDICTS) keys.push(`verdict.${v}`);
  for (const o of OUTCOMES) keys.push(`out.${o}`);
  for (const r of REQUIREMENTS) {
    keys.push(`req.${r.id}.title`, `req.${r.id}.q`);
    if (HIGH_VARIANTS.includes(r.id)) keys.push(`req.${r.id}.q.high`);
    if (MEDIUM_PLUS_VARIANTS.includes(r.id)) keys.push(`req.${r.id}.q.medium`);
    for (const f of r.fields) {
      keys.push(`field.${r.id}.${f.key}`, `val.${f.type}`);
      for (const o of f.options ?? []) keys.push(`opt.${r.id}.${f.key}.${o}`);
    }
    for (const id of CHECK_IDS[r.id]) keys.push(`chk.${id}`);
  }
  return keys;
}

test('every key built from the catalogue exists', () => {
  const keys = runtimeKeys();
  assert.ok(keys.length > 150, 'the enumeration found suspiciously few keys');
  for (const k of keys) assert.ok(k in LOCALES.en, `no string for ${k}`);
});

test('every det./val./err. code the modules can emit exists', () => {
  const found = new Set();
  for (const f of ['src/evidence.js', 'src/plan.js', 'src/github.js', 'src/app.js', 'bin/smp-check.mjs'])
    for (const m of read(`../${f}`).matchAll(/'((?:det|val|err)\.[a-zA-Z]+)'/g)) found.add(m[1]);
  assert.ok(found.size > 40, 'the scan found suspiciously few codes');
  for (const k of found) assert.ok(k in LOCALES.en, `${k} is emitted but has no string`);
});

test('every key the page and the CLI ask for literally exists', () => {
  const html = read('../index.html');
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g))
    for (const pair of m[1].split(';')) keys.add(pair.split(':')[1]?.trim());
  for (const f of ['src/app.js', 'src/plan.js', 'bin/smp-check.mjs'])
    for (const m of read(`../${f}`).matchAll(/\bt(?:Html)?\('([a-z][\w.]+)'/gi)) keys.add(m[1]);
  keys.delete(undefined);
  assert.ok(keys.size > 60, 'the scan found suspiciously few keys');
  for (const key of keys) assert.ok(key in LOCALES.en, `asked for a key nobody wrote: ${key}`);
});

test('the English questions are the guide’s, verbatim where it matters', () => {
  // A spot check against the PDF text (v1.1, §6.1), so a well-meant edit is caught.
  assert.equal(LOCALES.en['req.maintenance.q'], 'How do you plan to procure long term maintenance of your software?');
  assert.equal(LOCALES.en['req.support.q'], 'What level of support will be provided for users of the software and how will this support be organised?');
  assert.equal(LOCALES.en['req.version_control.q'], 'How will you manage versioning of your software?');
});

test('t interpolates, falls back to English, then to the key itself', () => {
  setLang('es');
  assert.equal(t('det.testsFound', { n: 3 }), '3 archivo(s) de prueba');
  assert.equal(t('no.such.key'), 'no.such.key');
  const backup = LOCALES.es['check.go'];
  delete LOCALES.es['check.go'];
  assert.equal(t('check.go'), LOCALES.en['check.go']);
  LOCALES.es['check.go'] = backup;
  setLang(DEFAULT_LANG);
});

test('the language is resolved from the URL, then the browser, then English', () => {
  assert.equal(resolveLang('es', ['en-GB']), 'es');
  assert.equal(resolveLang(null, ['es-CL', 'en']), 'es');
  assert.equal(resolveLang('de', ['de-AT']), 'en', 'German is not offered');
  assert.equal(resolveLang(null, []), 'en');
});
