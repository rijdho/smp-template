// Holding a plan to the repository it describes.
//
// A plan says what will be done; the repository shows what was. This module reads a
// "repository view" and reports, per requirement, whether each machine-checkable commitment
// in the plan is visible in the repository: not only whether the plan mentions something,
// but whether the thing mentioned exists.
//
// A repository view is anything with this shape, which is what lets the same checks run in
// the browser against GitHub (github.js), in the CLI against a local checkout
// (bin/local-view.mjs), and in the tests against a fixture held in memory:
//
//   {
//     source:  'github' | 'local' | 'fixture',
//     vcs:     'git' | null,              the version control system detected, if any
//     remotes: string[],                  URLs the repository is published at
//     files:   string[],                  tracked files, POSIX paths relative to the root
//     license: string | null,             SPDX id the host detected, if it offers one
//     read:    async (path) => string | null
//   }
//
// Pure apart from `read`, which the caller supplies. `today` is passed in, never taken from
// the clock, so a test of an expiry date means the same thing next year.

import { REQUIREMENTS, byId } from './requirements.js?v=18';
import { normaliseDoi } from './plan.js?v=18';

/** What a single check found. `declared`: the plan says it, nothing in a repository could confirm it. */
export const OUTCOMES = Object.freeze(['evidenced', 'missing', 'pending', 'declared', 'skipped']);

/** The verdict for a whole requirement, from its checks and its status. */
export const VERDICTS = Object.freeze(['evidenced', 'missing', 'pending', 'declared', 'unanswered', 'skipped']);

const given = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

// ── file lookup ─────────────────────────────────────────────────────────────

const lower = (s) => s.toLowerCase();

/** The tracked file at `path`, matched case-insensitively (README.md vs Readme.md), or null. */
export function findFile(view, path) {
  const want = lower(path);
  return view.files.find((f) => lower(f) === want) ?? null;
}

const findAny = (view, paths) => {
  for (const p of paths) {
    const hit = findFile(view, p);
    if (hit) return hit;
  }
  return null;
};

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|rst))?$/i;
const README_FILE = /^readme(\.(md|rst|txt|markdown))?$/i;

export const findLicenseFile = (view) => view.files.find((f) => LICENSE_FILE.test(f)) ?? null;
export const findReadme = (view) => view.files.find((f) => README_FILE.test(f)) ?? null;

/** For a field whose default names a conventional file, the usual other places it lives. */
function conventionalPlaces(name) {
  return [name, `.github/${name}`, `docs/${name}`];
}

// ── licences ────────────────────────────────────────────────────────────────

/**
 * The SPDX id a licence text most likely is, or null.
 *
 * The GNU and Mozilla texts name each other in passing (GPL-3.0 section 13 and MPL-2.0
 * section 1.12 mention the Affero licence; the current GPL-2.0 text ends by pointing to the
 * Lesser one), so for those the title that comes first in the text wins, and its version is read
 * from the words right after it.
 *
 * The text cannot tell `-only` from `-or-later` (that lives in the file headers, not in the
 * licence), so GPL-family results are the bare family and version, and `licenceMatches`
 * compares on that.
 */
export function identifyLicense(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ');
  const has = (re) => re.test(t);
  if (has(/Apache License,? Version 2\.0/i)) return 'Apache-2.0';
  const titled = [
    [/GNU AFFERO GENERAL PUBLIC LICEN[CS]E/i, (v) => (/Version 3/i.test(v) ? 'AGPL-3.0' : null)],
    [/GNU LESSER GENERAL PUBLIC LICEN[CS]E/i, (v) => (/Version 3/i.test(v) ? 'LGPL-3.0' : /Version 2\.1/i.test(v) ? 'LGPL-2.1' : null)],
    [/GNU GENERAL PUBLIC LICEN[CS]E/i, (v) => (/Version 3/i.test(v) ? 'GPL-3.0' : /Version 2/i.test(v) ? 'GPL-2.0' : null)],
    [/Mozilla Public License/i, (v) => (/^,? (Version|v\.?) ?2\.0/i.test(v) ? 'MPL-2.0' : null)],
  ]
    .map(([re, version]) => ({ m: re.exec(t), version }))
    .filter(({ m }) => m)
    .sort((a, b) => a.m.index - b.m.index);
  if (titled.length) {
    const { m, version } = titled[0];
    return version(t.slice(m.index + m[0].length, m.index + m[0].length + 60));
  }
  if (has(/European Union Public Licen[cs]e/i)) return has(/v\. ?1\.2|1\.2/) ? 'EUPL-1.2' : null;
  if (has(/Attribution 4\.0 International/i)) return 'CC-BY-4.0';
  if (has(/This is free and unencumbered software released into the public domain/i)) return 'Unlicense';
  if (has(/Permission is hereby granted, free of charge/i)) return 'MIT';
  if (has(/Permission to use, copy, modify, and\/or distribute this software/i)) return 'ISC';
  if (has(/Redistribution and use in source and binary forms/i))
    return has(/Neither the name/i) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  return null;
}

/** An SPDX id reduced to what a licence text can show: no `-only`, `-or-later` or `+`. */
const licenceFamily = (id) => String(id).trim().replace(/(-only|-or-later|\+)$/i, '').toLowerCase();

/** Whether a detected licence is one the declared SPDX expression allows. */
export function licenceMatches(declared, detected) {
  if (!given(declared) || !given(detected)) return false;
  const ids = String(declared).replace(/[()]/g, ' ').split(/\s+(?:AND|OR|WITH)\s+/i).map(licenceFamily);
  return ids.includes(licenceFamily(detected));
}

// ── CITATION.cff ────────────────────────────────────────────────────────────

/**
 * The top-level scalar keys of a CITATION.cff, without a YAML parser. Enough to tell whether
 * the three keys CFF 1.2.0 requires are there and to read `doi` and `license`; not a
 * validator, which is what `cffconvert --validate` is for.
 */
export function readCff(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export const CFF_REQUIRED = Object.freeze(['cff-version', 'title', 'authors', 'message']);

// ── documentation heuristics ────────────────────────────────────────────────

/** Characters of prose once headings, badges, fences and link-only lines are set aside. */
export function proseLength(markdown) {
  let inFence = false;
  let n = 0;
  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence || !line) continue;
    if (/^#/.test(line) || /^\[!\[/.test(line) || /^<[^>]+>$/.test(line) || /^[-*_]{3,}$/.test(line)) continue;
    n += line.length;
  }
  return n;
}

/** The shortest README that counts as user documentation. Documented in Caveats. */
export const MIN_PROSE = 300;

const INSTALL_HEADING =
  /^#{1,6}\s.*\b(install|installation|getting started|quick ?start|set ?up|setup|usage|run(ning)? (it )?locally|deploy|deployment|build(ing)?|requirements|instalaci[oó]n|instalar|uso|requisitos|despliegue)\b/im;

const TEST_PATTERNS = [
  /(^|\/)(tests?|spec|__tests__)\//i,
  /(^|\/)[^/]+[._-](test|spec)\.[a-z0-9]+$/i,
  /(^|\/)test_[^/]+\.py$/i,
];

const CI_PATTERNS = [
  /^\.github\/workflows\/[^/]+\.ya?ml$/i,
  /^\.gitlab-ci\.ya?ml$/i,
  /^\.circleci\/config\.ya?ml$/i,
  /^\.forgejo\/workflows\/[^/]+\.ya?ml$/i,
  /^\.woodpecker(\.ya?ml|\/[^/]+\.ya?ml)$/i,
  /^azure-pipelines\.ya?ml$/i,
  /^\.travis\.ya?ml$/i,
  /^jenkinsfile$/i,
];

export const MANIFESTS = Object.freeze({
  npm: ['package.json'],
  pypi: ['pyproject.toml', 'setup.py', 'setup.cfg'],
  cran: ['DESCRIPTION'],
  conda: ['meta.yaml', 'recipe/meta.yaml', 'conda/meta.yaml', 'conda-recipe/meta.yaml'],
  crates: ['Cargo.toml'],
  maven: ['pom.xml'],
  container: ['Dockerfile', 'Containerfile'],
});

export const normUrl = (u) => String(u ?? '').trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '')
  .replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@([^/:]+)(:\d+)?\//, 'https://$1/')
  .replace(/^http:\/\//, 'https://');

// ── the checks ──────────────────────────────────────────────────────────────

/**
 * Each check returns `{ outcome, detail, vars }` or null when it does not apply to what the
 * plan says. `detail` is an i18n key under `det.`. `hard: true` marks a finding that stays a
 * failure even for a requirement that is only `planned` (a maintenance commitment that has
 * already run out is not something the future can fix).
 */
const ok = (detail, vars = {}) => ({ outcome: 'evidenced', detail, vars });
const miss = (detail, vars = {}, hard = false) => ({ outcome: 'missing', detail, vars, hard });
const said = (detail, vars = {}) => ({ outcome: 'declared', detail, vars });

const CHECKS = {
  version_control: [
    ['vc.system', async (e, view) => {
      if (e.system === 'other') return said('det.vcOther');
      if (!view.vcs) return miss('det.noVcs');
      if (given(e.system) && e.system !== view.vcs) return miss('det.vcsMismatch', { declared: e.system, found: view.vcs });
      return ok('det.vcsFound', { found: view.vcs });
    }],
    ['vc.url', async (e, view) => {
      if (!given(e.url)) return null;
      if (!view.remotes?.length) return said('det.noRemotes');
      return view.remotes.map(normUrl).includes(normUrl(e.url))
        ? ok('det.urlMatches') : miss('det.urlMismatch', { declared: e.url, found: view.remotes.join(', ') });
    }],
  ],

  repository: [
    ['repo.doi', async (e, view) => {
      if (e.archive === 'none') return said('det.noArchive');
      if (e.archive === 'software_heritage') return said('det.swh');
      if (!given(e.doi)) return given(e.archive) ? miss('det.noDoi') : null;
      const doi = normaliseDoi(e.doi).toLowerCase();
      for (const p of ['CITATION.cff', '.zenodo.json', 'codemeta.json', findReadme(view)].filter(Boolean)) {
        const hit = findFile(view, p);
        if (hit && lower((await view.read(hit)) ?? '').includes(doi)) return ok('det.doiIn', { file: hit });
      }
      return miss('det.doiNowhere', { doi });
    }],
  ],

  user_documentation: [
    ['doc.user', async (e, view) => {
      const hit = given(e.path) ? findFile(view, e.path) : findReadme(view);
      if (!hit) return miss('det.fileMissing', { file: e.path || 'README' });
      const n = proseLength(await view.read(hit));
      return n >= MIN_PROSE ? ok('det.docFound', { file: hit, n }) : miss('det.docThin', { file: hit, n, min: MIN_PROSE });
    }],
  ],

  licensing: [
    ['lic.file', async (e, view) => {
      const hit = findLicenseFile(view);
      return hit ? ok('det.fileFound', { file: hit }) : miss('det.noLicenseFile');
    }],
    ['lic.match', async (e, view) => {
      if (!given(e.spdx)) return null;
      const file = findLicenseFile(view);
      const detected = view.license || (file ? identifyLicense(await view.read(file)) : null);
      if (!detected) return file ? said('det.licUnknown', { declared: e.spdx }) : null;
      return licenceMatches(e.spdx, detected)
        ? ok('det.licMatch', { declared: e.spdx, found: detected })
        : miss('det.licMismatch', { declared: e.spdx, found: detected });
    }],
    ['lic.cff', async (e, view) => {
      if (!given(e.spdx)) return null;
      const cff = findFile(view, 'CITATION.cff');
      if (!cff) return null;
      const lic = readCff(await view.read(cff)).license;
      if (!given(lic)) return null;
      return licenceMatches(e.spdx, lic)
        ? ok('det.cffLicMatch', { found: lic })
        : miss('det.cffLicMismatch', { declared: e.spdx, found: lic });
    }],
  ],

  deployment_documentation: [
    ['doc.deploy', async (e, view) => {
      const path = given(e.path) ? e.path : 'README.md';
      const hit = /readme/i.test(path) && !given(e.path) ? findReadme(view) : findFile(view, path);
      if (!hit) return miss('det.fileMissing', { file: path });
      if (!/readme/i.test(hit)) return ok('det.fileFound', { file: hit });
      return INSTALL_HEADING.test((await view.read(hit)) ?? '')
        ? ok('det.installSection', { file: hit }) : miss('det.noInstallSection', { file: hit });
    }],
  ],

  citation: [
    ['cit.cff', async (e, view) => {
      const path = e.cff || 'CITATION.cff';
      const hit = findFile(view, path);
      if (!hit) return miss('det.fileMissing', { file: path });
      const cff = readCff(await view.read(hit));
      const lacking = CFF_REQUIRED.filter((k) => !(k in cff));
      return lacking.length ? miss('det.cffIncomplete', { file: hit, keys: lacking.join(', ') }) : ok('det.cffOk', { file: hit });
    }],
    ['cit.doi', async (e, view) => {
      if (!given(e.doi)) return null;
      const hit = findFile(view, e.cff || 'CITATION.cff');
      if (!hit) return null;
      const doi = normaliseDoi(e.doi).toLowerCase();
      return lower((await view.read(hit)) ?? '').includes(doi) ? ok('det.doiIn', { file: hit }) : miss('det.cffNoDoi', { doi, file: hit });
    }],
  ],

  developer_documentation: [
    ['dev.contributing', async (e, view) => {
      const hit = given(e.contributing) ? findFile(view, e.contributing) : findAny(view, conventionalPlaces('CONTRIBUTING.md'));
      return hit ? ok('det.fileFound', { file: hit }) : miss('det.fileMissing', { file: e.contributing || 'CONTRIBUTING.md' });
    }],
    ['dev.coc', async (e, view) => {
      if (!given(e.code_of_conduct)) return null;
      const hit = findFile(view, e.code_of_conduct);
      return hit ? ok('det.fileFound', { file: hit }) : miss('det.fileMissing', { file: e.code_of_conduct });
    }],
  ],

  testing: [
    ['test.files', async (e, view) => {
      if (given(e.path)) {
        const dir = `${lower(e.path).replace(/\/$/, '')}/`;
        const n = view.files.filter((f) => lower(f) === lower(e.path) || lower(f).startsWith(dir)).length;
        return n ? ok('det.testsUnder', { n, where: e.path }) : miss('det.fileMissing', { file: e.path });
      }
      const n = view.files.filter((f) => TEST_PATTERNS.some((re) => re.test(f))).length;
      return n ? ok('det.testsFound', { n, where: '*' }) : miss('det.noTests');
    }],
    ['test.ci', async (e, view) => {
      if (e.automated !== true) return null;
      const configs = view.files.filter((f) => CI_PATTERNS.some((re) => re.test(f)));
      if (!configs.length) return miss('det.noCi');
      for (const c of configs) if (/\btest/i.test((await view.read(c)) ?? '')) return ok('det.ciRunsTests', { file: c });
      return miss('det.ciNoTests', { files: configs.join(', ') });
    }],
  ],

  engineering_quality: [
    ['eq.checklist', async (e, view) => {
      if (e.checklist !== 'openssf_best_practices') return e.checklist === 'other' ? said('det.checklistOther') : null;
      const readme = findReadme(view);
      const text = readme ? (await view.read(readme)) ?? '' : '';
      return /bestpractices\.(coreinfrastructure\.org|dev)/i.test(text) ? ok('det.badgeFound') : miss('det.noBadge');
    }],
    ['eq.linter', async (e, view) => {
      if (!given(e.linter_config)) return null;
      const hit = findFile(view, e.linter_config);
      return hit ? ok('det.fileFound', { file: hit }) : miss('det.fileMissing', { file: e.linter_config });
    }],
  ],

  packaging: [
    ['pkg.manifest', async (e, view) => {
      const candidates = given(e.manifest) ? [e.manifest] : MANIFESTS[e.registry] ?? null;
      if (!candidates) return e.registry === 'none' ? said('det.noPackaging') : null;
      const hit = findAny(view, candidates);
      return hit ? ok('det.fileFound', { file: hit }) : miss('det.fileMissing', { file: candidates.join(' | ') });
    }],
    ['pkg.name', async (e, view) => {
      if (!given(e.package_name)) return null;
      const candidates = given(e.manifest) ? [e.manifest] : MANIFESTS[e.registry] ?? [];
      const hit = findAny(view, candidates);
      if (!hit) return null;
      return ((await view.read(hit)) ?? '').includes(e.package_name)
        ? ok('det.pkgNamed', { name: e.package_name, file: hit })
        : miss('det.pkgNotNamed', { name: e.package_name, file: hit });
    }],
  ],

  maintenance: [
    ['mnt.until', async (e, view, today) => {
      if (!given(e.until)) return null;
      return e.until < today ? miss('det.expired', { until: e.until }, true) : said('det.until', { until: e.until });
    }],
  ],

  risk_analysis: [
    ['risk.policy', async (e, view) => {
      const hit = given(e.security_policy) ? findFile(view, e.security_policy) : findAny(view, conventionalPlaces('SECURITY.md'));
      return hit ? ok('det.fileFound', { file: hit }) : miss('det.fileMissing', { file: e.security_policy || 'SECURITY.md' });
    }],
  ],
};

/** Every check id, per requirement, for the How-it-works table and the i18n test. */
export const CHECK_IDS = Object.freeze(Object.fromEntries(
  REQUIREMENTS.map((r) => [r.id, (CHECKS[r.id] ?? []).map(([id]) => id)]),
));

/** Combine a requirement's check results and status into one verdict. */
export function verdictOf(status, answer, results) {
  if (status === 'not_applicable') return 'skipped';
  const outs = results.map((r) => r.outcome);
  if (outs.includes('missing')) return 'missing';
  if (outs.includes('pending')) return 'pending';
  if (outs.includes('evidenced')) return 'evidenced';
  return given(answer) ? 'declared' : 'unanswered';
}

/**
 * Check every requirement in the plan against the repository view.
 * Returns `{ requirements: [{ id, status, answered, verdict, checks: [...] }], summary }`.
 */
export async function checkPlan(plan, view, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const entries = plan?.smp?.requirements ?? {};
  const requirements = [];
  for (const r of REQUIREMENTS) {
    const e = entries[r.id];
    if (!e || !byId(r.id)) continue;
    const checks = [];
    if (e.status !== 'not_applicable') {
      for (const [id, fn] of CHECKS[r.id] ?? []) {
        const res = await fn(e, view, today);
        if (!res) continue;
        // A commitment that is only planned is reported, not failed: the plan is allowed to
        // be ahead of the repository. Hard findings are the exception.
        const outcome = res.outcome === 'missing' && e.status === 'planned' && !res.hard ? 'pending' : res.outcome;
        checks.push({ id, outcome, detail: res.detail, vars: res.vars });
      }
    }
    requirements.push({ id: r.id, status: e.status, answered: given(e.answer), verdict: verdictOf(e.status, e.answer, checks), checks });
  }
  return { requirements, summary: summarise(requirements) };
}

/**
 * The headline numbers. `answered` is the plan-as-text level (a question has an answer);
 * `evidenced` is the plan-as-fact level (every machine check on it passed). The distance
 * between them is the point of the tool.
 */
export function summarise(requirements) {
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const r of requirements) counts[r.verdict]++;
  const inScope = requirements.filter((r) => r.verdict !== 'skipped');
  return {
    total: requirements.length,
    inScope: inScope.length,
    answered: inScope.filter((r) => r.answered).length,
    checkable: inScope.filter((r) => r.checks.some((c) => c.outcome !== 'declared')).length,
    ...counts,
    // What a CI gate fails on: a commitment marked in place that the repository does not show.
    failing: counts.missing,
  };
}
