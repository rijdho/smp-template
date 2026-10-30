// The checks, against repositories held in memory. Every expected outcome is written out, so a
// change to a heuristic shows up as a changed line here rather than as a quietly different
// verdict on somebody's repository.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECK_IDS, MIN_PROSE, checkPlan, identifyLicense, licenceMatches, normUrl, proseLength, readCff, verdictOf,
} from '../src/evidence.js';
import { createPlan } from '../src/plan.js';
import { REQUIREMENT_IDS } from '../src/requirements.js';

const TODAY = '2026-09-29';
const PROSE = 'This tool does one thing and explains it at length. '.repeat(8);

/** A repository view over an object of path → content. */
function repo(files, extra = {}) {
  return {
    source: 'fixture',
    vcs: 'git',
    remotes: ['https://github.com/acme/tool'],
    files: Object.keys(files),
    license: null,
    read: async (p) => files[p] ?? null,
    ...extra,
  };
}

/** A complete, well-kept repository: every check in the catalogue has something to find. */
const GOOD = {
  'README.md': `# Tool\n\n[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/1/badge)](x)\n\n${PROSE}\n\n## Installation\n\nnpm i tool\n\nDOI 10.5281/zenodo.123\n`,
  LICENSE: 'Apache License\n Version 2.0, January 2004\n',
  'CITATION.cff': 'cff-version: 1.2.0\nmessage: "Cite it"\ntitle: Tool\nauthors:\n  - name: A\nlicense: Apache-2.0\ndoi: 10.5281/zenodo.123\n',
  'CONTRIBUTING.md': 'How to contribute.',
  'CODE_OF_CONDUCT.md': 'Be kind.',
  'tests/tool.test.mjs': 'test()',
  '.github/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: npm test\n',
  'eslint.config.js': 'export default []',
  'package.json': '{ "name": "acme-tool" }',
  'SECURITY.md': 'Report privately.',
};

/** A high-level plan that commits to everything GOOD shows, all in place. */
function fullPlan(status = 'in_place') {
  const p = createPlan({ level: 'high', title: 'T', softwareTitle: 'Tool', now: new Date('2026-09-01T00:00:00Z') });
  const r = p.smp.requirements;
  for (const e of Object.values(r)) Object.assign(e, { status, answer: 'Answered.' });
  Object.assign(r.version_control, { system: 'git', url: 'https://github.com/acme/tool.git' });
  Object.assign(r.repository, { archive: 'zenodo', doi: 'https://doi.org/10.5281/zenodo.123' });
  Object.assign(r.licensing, { spdx: 'Apache-2.0' });
  Object.assign(r.citation, { doi: '10.5281/zenodo.123' });
  Object.assign(r.developer_documentation, { code_of_conduct: 'CODE_OF_CONDUCT.md' });
  Object.assign(r.testing, { automated: true });
  Object.assign(r.engineering_quality, { checklist: 'openssf_best_practices', linter_config: 'eslint.config.js' });
  Object.assign(r.packaging, { registry: 'npm', package_name: 'acme-tool' });
  Object.assign(r.maintenance, { until: '2028-12-31' });
  return p;
}

/** { requirement: verdict } and { checkId: outcome }, which is what the assertions compare. */
const verdicts = (res) => Object.fromEntries(res.requirements.map((r) => [r.id, r.verdict]));
const outcomes = (res) => Object.fromEntries(res.requirements.flatMap((r) => r.checks.map((c) => [c.id, c.outcome])));

test('a well-kept repository evidences every checkable requirement of a full plan', async () => {
  const res = await checkPlan(fullPlan(), repo(GOOD), { today: TODAY });
  assert.deepEqual(verdicts(res), {
    purpose: 'declared', version_control: 'evidenced', repository: 'evidenced', user_documentation: 'evidenced',
    licensing: 'evidenced', deployment_documentation: 'evidenced', citation: 'evidenced',
    developer_documentation: 'evidenced', testing: 'evidenced', engineering_quality: 'evidenced',
    packaging: 'evidenced', maintenance: 'declared', support: 'declared', risk_analysis: 'evidenced',
  });
  assert.deepEqual(res.summary, {
    total: 14, inScope: 14, answered: 14, checkable: 11,
    evidenced: 11, missing: 0, pending: 0, declared: 3, unanswered: 0, skipped: 0, failing: 0,
  });
});

test('every check in the catalogue actually ran in that test', async () => {
  // Without this, a check that silently returns null for every input would still pass above.
  const res = await checkPlan(fullPlan(), repo(GOOD), { today: TODAY });
  const ran = new Set(Object.keys(outcomes(res)));
  for (const ids of Object.values(CHECK_IDS)) for (const id of ids) assert.ok(ran.has(id), `${id} never ran`);
  assert.deepEqual(Object.keys(CHECK_IDS), REQUIREMENT_IDS);
});

test('an empty repository fails every in-place commitment it can see', async () => {
  const res = await checkPlan(fullPlan(), repo({}, { vcs: null, remotes: [] }), { today: TODAY });
  assert.deepEqual(outcomes(res), {
    'vc.system': 'missing', 'vc.url': 'declared', 'repo.doi': 'missing', 'doc.user': 'missing',
    'lic.file': 'missing', 'doc.deploy': 'missing', 'cit.cff': 'missing', 'dev.contributing': 'missing',
    'dev.coc': 'missing', 'test.files': 'missing', 'test.ci': 'missing', 'eq.checklist': 'missing',
    'eq.linter': 'missing', 'pkg.manifest': 'missing', 'mnt.until': 'declared', 'risk.policy': 'missing',
  });
  assert.equal(res.summary.failing, 11);
});

test('the same empty repository against a planned plan fails nothing', async () => {
  const res = await checkPlan(fullPlan('planned'), repo({}, { vcs: null, remotes: [] }), { today: TODAY });
  assert.equal(res.summary.failing, 0);
  assert.equal(res.summary.pending, 11);
  assert.ok(Object.values(outcomes(res)).every((o) => o === 'pending' || o === 'declared'));
});

test('an expired maintenance period fails even when only planned', async () => {
  const p = fullPlan('planned');
  p.smp.requirements.maintenance.until = '2026-01-31';
  const res = await checkPlan(p, repo(GOOD), { today: TODAY });
  const m = res.requirements.find((r) => r.id === 'maintenance');
  assert.equal(m.verdict, 'missing');
  assert.deepEqual(m.checks[0], { id: 'mnt.until', outcome: 'missing', detail: 'det.expired', vars: { until: '2026-01-31' } });
  // The last day itself is still covered.
  p.smp.requirements.maintenance.until = TODAY;
  assert.equal((await checkPlan(p, repo(GOOD), { today: TODAY })).requirements.find((r) => r.id === 'maintenance').verdict, 'declared');
});

test('not applicable is skipped, and runs no checks', async () => {
  const p = fullPlan();
  Object.assign(p.smp.requirements.packaging, { status: 'not_applicable', answer: 'A static page.' });
  const res = await checkPlan(p, repo({}), { today: TODAY });
  const pk = res.requirements.find((r) => r.id === 'packaging');
  assert.deepEqual([pk.verdict, pk.checks], ['skipped', []]);
  assert.equal(res.summary.inScope, 13);
});

test('contradictions between the plan and the repository are missing, with both values', async () => {
  const p = fullPlan();
  p.smp.requirements.licensing.spdx = 'MIT';
  p.smp.requirements.version_control.url = 'https://gitlab.com/acme/tool';
  p.smp.requirements.citation.doi = '10.5281/zenodo.999';
  p.smp.requirements.packaging.package_name = 'other-name';
  const res = await checkPlan(p, repo(GOOD), { today: TODAY });
  const find = (id) => res.requirements.flatMap((r) => r.checks).find((c) => c.id === id);
  assert.deepEqual(find('lic.match'), { id: 'lic.match', outcome: 'missing', detail: 'det.licMismatch', vars: { declared: 'MIT', found: 'Apache-2.0' } });
  assert.deepEqual(find('lic.cff').vars, { declared: 'MIT', found: 'Apache-2.0' });
  assert.equal(find('vc.url').outcome, 'missing');
  assert.equal(find('cit.doi').detail, 'det.cffNoDoi');
  assert.equal(find('pkg.name').outcome, 'missing');
});

test('the heuristics: a thin README, one without an install heading, CI that never tests', async () => {
  const files = {
    'README.md': '# Tool\n\nShort.\n',
    '.github/workflows/pages.yml': 'jobs:\n  deploy:\n    steps:\n      - run: echo hi\n',
    'src/app_test.py': '',
  };
  const res = await checkPlan(fullPlan(), repo(files), { today: TODAY });
  const find = (id) => res.requirements.flatMap((r) => r.checks).find((c) => c.id === id);
  assert.deepEqual(find('doc.user').vars, { file: 'README.md', n: 6, min: MIN_PROSE });
  assert.equal(find('doc.deploy').detail, 'det.noInstallSection');
  assert.equal(find('test.files').outcome, 'evidenced', 'app_test.py is a test file');
  assert.equal(find('test.ci').detail, 'det.ciNoTests');
});

test('explicit paths are honoured, and the defaults look in the usual places', async () => {
  const p = fullPlan();
  Object.assign(p.smp.requirements.deployment_documentation, { path: 'docs/INSTALL.md' });
  Object.assign(p.smp.requirements.testing, { path: 'spec' });
  const files = { ...GOOD, 'docs/INSTALL.md': 'Steps.', 'spec/a.rb': '', '.github/SECURITY.md': 'x', '.github/CONTRIBUTING.md': 'x' };
  delete files['SECURITY.md'];
  delete files['CONTRIBUTING.md'];
  const res = await checkPlan(p, repo(files), { today: TODAY });
  const o = outcomes(res);
  assert.equal(o['doc.deploy'], 'evidenced');
  assert.equal(o['test.files'], 'evidenced');
  assert.equal(o['risk.policy'], 'evidenced', '.github/SECURITY.md is found by default');
  assert.equal(o['dev.contributing'], 'evidenced', '.github/CONTRIBUTING.md is found by default');
});

test('a licence the host detected wins over reading the text', async () => {
  const p = fullPlan();
  p.smp.requirements.licensing.spdx = 'GPL-3.0-or-later';
  const files = { ...GOOD, LICENSE: 'something unrecognisable' };
  delete files['CITATION.cff'];
  const unknown = await checkPlan(p, repo(files), { today: TODAY });
  assert.equal(outcomes(unknown)['lic.match'], 'declared', 'an unidentifiable licence is not a mismatch');
  const hosted = await checkPlan(p, repo(files, { license: 'GPL-3.0' }), { today: TODAY });
  assert.equal(outcomes(hosted)['lic.match'], 'evidenced');
});

test('identifyLicense tells the GPL family apart', () => {
  assert.equal(identifyLicense('GNU AFFERO GENERAL PUBLIC LICENSE Version 3, 19 November 2007'), 'AGPL-3.0');
  assert.equal(identifyLicense('GNU LESSER GENERAL PUBLIC LICENSE Version 2.1'), 'LGPL-2.1');
  assert.equal(identifyLicense('GNU GENERAL PUBLIC LICENSE Version 2, June 1991'), 'GPL-2.0');
  assert.equal(identifyLicense('MIT License\n\nPermission is hereby granted, free of charge, to any person'), 'MIT');
  assert.equal(identifyLicense('Redistribution and use in source and binary forms ... Neither the name'), 'BSD-3-Clause');
  assert.equal(identifyLicense('Redistribution and use in source and binary forms'), 'BSD-2-Clause');
  assert.equal(identifyLicense('Attribution 4.0 International'), 'CC-BY-4.0');
  assert.equal(identifyLicense('All rights reserved.'), null);
  assert.equal(identifyLicense(''), null);
});

test('identifyLicense goes by the title, not by licences a text names in passing', () => {
  // GPL-3.0 section 13 and MPL-2.0 section 1.12 name the Affero licence; the GPL-2.0 text
  // ends by pointing to the Lesser one. Abridged from the real texts.
  assert.equal(identifyLicense('GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007 ... 13. Use with the GNU Affero General Public License.'), 'GPL-3.0');
  assert.equal(identifyLicense('Mozilla Public License Version 2.0 ... "Secondary License" means either the GNU General Public License, Version 2.0, the GNU Lesser General Public License, Version 2.1, the GNU Affero General Public License, Version 3.0'), 'MPL-2.0');
  assert.equal(identifyLicense('GNU GENERAL PUBLIC LICENSE Version 2, June 1991 ... use the GNU Lesser General Public License instead of this License.'), 'GPL-2.0');
});

test('licenceMatches ignores -only/-or-later and reads expressions', () => {
  assert.equal(licenceMatches('AGPL-3.0-or-later', 'AGPL-3.0'), true);
  assert.equal(licenceMatches('GPL-3.0-only', 'GPL-3.0-or-later'), true);
  assert.equal(licenceMatches('MIT OR Apache-2.0', 'Apache-2.0'), true);
  assert.equal(licenceMatches('(MIT AND CC-BY-4.0)', 'CC-BY-4.0'), true);
  assert.equal(licenceMatches('GPL-3.0', 'AGPL-3.0'), false);
  assert.equal(licenceMatches('', 'MIT'), false);
});

test('readCff reads top-level scalars and unquotes them', () => {
  const cff = readCff('cff-version: 1.2.0\ntitle: "A: tool"\nauthors:\n  - family-names: X\n    doi: nested\ndoi: \'10.1/x\'\n');
  assert.deepEqual(cff, { 'cff-version': '1.2.0', title: 'A: tool', authors: '', doi: '10.1/x' });
});

test('proseLength skips headings, badges, fences and rules', () => {
  assert.equal(proseLength('# H\n[![b](x)](y)\n```\ncode code code\n```\n---\nabc\n  de  \n'), 5);
});

test('verdictOf: missing beats pending beats evidenced beats declared', () => {
  const r = (...o) => o.map((outcome) => ({ outcome }));
  assert.equal(verdictOf('in_place', 'x', r('evidenced', 'missing', 'pending')), 'missing');
  assert.equal(verdictOf('planned', 'x', r('evidenced', 'pending')), 'pending');
  assert.equal(verdictOf('in_place', 'x', r('declared', 'evidenced')), 'evidenced');
  assert.equal(verdictOf('in_place', 'x', r('declared')), 'declared');
  assert.equal(verdictOf('in_place', '', r()), 'unanswered');
  assert.equal(verdictOf('not_applicable', 'x', r('missing')), 'skipped');
});

test('normUrl treats the usual spellings of one GitHub remote as the same', () => {
  const want = 'https://github.com/acme/tool';
  for (const u of ['https://github.com/acme/tool', 'https://github.com/acme/tool.git/', 'git@github.com:acme/tool.git',
    'ssh://git@github.com/acme/tool.git', 'ssh://git@github.com:22/acme/tool', 'http://GitHub.com/acme/tool/']) {
    assert.equal(normUrl(u), want, u);
  }
});
