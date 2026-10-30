// Creating, validating, moving and writing out a plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  changeLevel, compactPlan, createPlan, fieldValueOk, isValid, normaliseDoi, parsePlan, planToJson,
  planToMarkdown, questionKey, stamp, validatePlan,
} from '../src/plan.js';
import { FIELD_TYPES, REQUIREMENTS } from '../src/requirements.js';
import { setLang, t } from '../src/i18n/index.js';

const NOW = new Date('2026-09-29T10:00:00Z');

/** A plan that is valid: every required metadata field filled. */
function valid(level = 'medium') {
  const p = createPlan({ level, title: 'SMP for Example', softwareTitle: 'Example', now: NOW });
  p.smp.contact.name = 'Ada Lovelace';
  return p;
}

const codes = (plan, severity = 'error') => validatePlan(plan).filter((p) => p.severity === severity).map((p) => `${p.path} ${p.code}`);

test('a new plan carries every requirement of its level, planned and unanswered', () => {
  const p = createPlan({ level: 'low', now: NOW });
  assert.deepEqual(Object.keys(p.smp.requirements), ['purpose', 'version_control', 'user_documentation', 'licensing', 'deployment_documentation']);
  for (const e of Object.values(p.smp.requirements)) assert.deepEqual(e, { status: 'planned', answer: '' });
  assert.equal(p.smp.created, '2026-09-29T10:00:00Z');
  assert.equal(p.smp.language, 'eng');
  assert.equal(p.smp.guide.doi, '10.5281/zenodo.7038280');
  assert.throws(() => createPlan({ level: 'extreme' }));
});

test('a blank plan fails exactly on the three things a person has to type', () => {
  assert.deepEqual(codes(createPlan({ now: NOW })), [
    'smp.title val.required', 'smp.contact.name val.required', 'smp.software.title val.required',
  ]);
});

test('unanswered questions are warnings, not errors', () => {
  const p = valid();
  assert.equal(isValid(p), true);
  assert.equal(codes(p, 'warning').length, 12);
  p.smp.requirements.purpose.answer = 'Does a thing.';
  assert.equal(codes(p, 'warning').length, 11);
});

test('not applicable needs a reason', () => {
  const p = valid();
  p.smp.requirements.packaging.status = 'not_applicable';
  assert.deepEqual(codes(p), ['smp.requirements.packaging.answer val.justify']);
  p.smp.requirements.packaging.answer = 'A web page, served as is; nothing to install.';
  assert.deepEqual(codes(p), []);
});

test('a missing requirement of the level, an unknown one and an unknown field are all errors', () => {
  const p = valid();
  delete p.smp.requirements.citation;
  p.smp.requirements.astrology = { status: 'planned', answer: '' };
  p.smp.requirements.licensing.spxd = 'MIT';
  assert.deepEqual(codes(p), [
    'smp.requirements.citation val.levelGap',
    'smp.requirements.licensing.spxd val.unknownField',
    'smp.requirements.astrology val.unknownRequirement',
  ]);
});

test('field values are checked by type, and blank strings count as absent', () => {
  const p = valid();
  const r = p.smp.requirements;
  Object.assign(r.licensing, { spdx: 'Apache 2' });
  Object.assign(r.citation, { doi: 'zenodo 123', cff: '/etc/CITATION.cff' });
  Object.assign(r.testing, { automated: 'yes', results_url: '' });
  Object.assign(r.maintenance, { until: '2026-02-30' });
  Object.assign(r.packaging, { registry: 'rubygems' });
  assert.deepEqual(codes(p), [
    'smp.requirements.licensing.spdx val.spdx',
    'smp.requirements.citation.cff val.path',
    'smp.requirements.citation.doi val.doi',
    'smp.requirements.testing.automated val.bool',
    'smp.requirements.packaging.registry val.enum',
    'smp.requirements.maintenance.until val.date',
  ]);
});

test('each field type accepts what it should and refuses what it should not', () => {
  const cases = {
    text: [['anything', true], [3, false]],
    url: [['https://example.org/x', true], ['example.org', false]],
    path: [['docs/INSTALL.md', true], ['/abs', false], ['../up', false], ['a//b', false], ['a\\b', false]],
    spdx: [['Apache-2.0', true], ['GPL-3.0-or-later', true], ['MIT OR Apache-2.0', true], ['Apache 2', false]],
    doi: [['10.5281/zenodo.7038280', true], ['https://doi.org/10.5281/zenodo.7038280', true], ['zenodo.1', false]],
    bool: [[true, true], ['true', false]],
    date: [['2027-12-31', true], ['2027-13-01', false], ['31.12.2027', false]],
    enum: [['a', true], ['c', false]],
  };
  assert.deepEqual(Object.keys(cases).sort(), [...FIELD_TYPES].sort(), 'a field type has no cases here');
  for (const [type, pairs] of Object.entries(cases))
    for (const [value, expected] of pairs)
      assert.equal(fieldValueOk({ type, options: ['a', 'b'] }, value), expected, `${type} ${JSON.stringify(value)}`);
});

test('the envelope follows maDMP: dates, language, typed contact id, modified after created', () => {
  const p = valid();
  p.smp.language = 'en';
  p.smp.created = '2026-09-29';
  p.smp.contact.contact_id = { identifier: '0000-0002-1825-0097' };
  p.smp.contact.mbox = 'not-an-address';
  assert.deepEqual(codes(p), [
    'smp.language val.lang', 'smp.created val.dateTime', 'smp.contact.mbox val.mbox', 'smp.contact.contact_id val.typedId',
  ]);
  const q = valid();
  q.smp.modified = '2020-01-01T00:00:00Z';
  assert.deepEqual(codes(q), ['smp.modified val.modifiedBeforeCreated']);
});

test('an archive of none has to be justified', () => {
  const p = valid();
  p.smp.requirements.repository.archive = 'none';
  assert.deepEqual(codes(p), ['smp.requirements.repository.answer val.noArchiveJustify']);
});

test('changing level keeps answers, adds what is new, and never drops a written answer', () => {
  const p = valid('high');
  p.smp.requirements.support.answer = 'Issues on GitHub, answered weekly.';
  const low = changeLevel(p, 'low');
  // Five of low, plus support because it carries an answer; the other eight empty ones go.
  assert.deepEqual(Object.keys(low.smp.requirements), [
    'purpose', 'version_control', 'user_documentation', 'licensing', 'deployment_documentation', 'support',
  ]);
  assert.equal(low.smp.requirements.support.answer, 'Issues on GitHub, answered weekly.');
  assert.equal(p.smp.level, 'high', 'the original plan was mutated');
  const back = changeLevel(low, 'high');
  assert.equal(Object.keys(back.smp.requirements).length, 14);
  assert.equal(isValid(low), true, 'a requirement kept from another level is not an error');
});

test('compactPlan drops blank values but keeps every requirement and its answer slot', () => {
  const p = valid();
  p.smp.requirements.licensing.spdx = '';
  p.smp.contact.mbox = '';
  const c = compactPlan(p);
  assert.equal('mbox' in c.smp.contact, false);
  assert.deepEqual(c.smp.requirements.licensing, { status: 'planned', answer: '' });
  assert.equal(Object.keys(c.smp.requirements).length, 12);
  assert.equal(planToJson(p).endsWith('}\n'), true);
});

test('stamp moves modified and keeps created', () => {
  const p = stamp(valid(), new Date('2026-10-01T08:30:00Z'));
  assert.equal(p.smp.created, '2026-09-29T10:00:00Z');
  assert.equal(p.smp.modified, '2026-10-01T08:30:00Z');
});

test('parsePlan never throws', () => {
  assert.deepEqual(parsePlan('{'), { error: 'val.notJson' });
  assert.deepEqual(parsePlan('[]'), { error: 'val.noRoot' });
  assert.deepEqual(parsePlan('{"dmp":{}}'), { error: 'val.noRoot' });
  assert.ok(parsePlan(planToJson(valid())).plan);
});

test('a DOI compares equal with or without its resolver', () => {
  assert.equal(normaliseDoi('https://doi.org/10.5281/zenodo.1'), '10.5281/zenodo.1');
  assert.equal(normaliseDoi('doi: 10.5281/zenodo.1'), '10.5281/zenodo.1');
  assert.equal(normaliseDoi(''), '');
});

test('the guide words three questions differently at the high level and two from medium up', () => {
  assert.equal(questionKey('licensing', 'low'), 'req.licensing.q');
  assert.equal(questionKey('licensing', 'medium'), 'req.licensing.q.medium');
  assert.equal(questionKey('licensing', 'high'), 'req.licensing.q.high');
  assert.equal(questionKey('user_documentation', 'high'), 'req.user_documentation.q.medium');
  assert.equal(questionKey('engineering_quality', 'medium'), 'req.engineering_quality.q');
  assert.equal(questionKey('engineering_quality', 'high'), 'req.engineering_quality.q.high');
  assert.equal(questionKey('purpose', 'high'), 'req.purpose.q');
});

test('the Markdown carries every requirement, its question, status and commitments', () => {
  setLang('en');
  const p = valid();
  p.smp.requirements.licensing = { status: 'in_place', answer: 'Apache-2.0 | checked with a script.', spdx: 'Apache-2.0' };
  p.smp.requirements.testing.automated = true;
  const md = planToMarkdown(p, t);
  assert.match(md, /^# SMP for Example$/m);
  for (const r of REQUIREMENTS.filter((x) => p.smp.requirements[x.id]))
    assert.ok(md.includes(`## ${t(`req.${r.id}.title`)}`), `${r.id} missing from the Markdown`);
  assert.ok(md.includes(t('req.licensing.q.medium')));
  assert.ok(md.includes('Status: **In place**'));
  assert.ok(md.includes('- Licence (SPDX identifier): `Apache-2.0`'));
  assert.ok(md.includes('- Tests run automatically (CI): yes'));
  assert.ok(md.includes('https://doi.org/10.5281/zenodo.7038280'));
});
