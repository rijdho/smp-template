#!/usr/bin/env node
// Check a Software Management Plan against the repository it lives in.
//
//   node bin/smp-check.mjs [dir] [--plan smp.json] [--strict] [--format text|md|json] [--lang en|es]
//
// Exit codes, which are what CI reads:
//   0  every commitment marked in_place is visible in the repository, and the plan is valid
//   1  at least one is not, or the plan is invalid (with --strict, planned ones count too)
//   2  usage error (no plan file, unreadable JSON, unknown option), or the checker itself failed
//
// Dependency-free, like the rest of the repository: it runs on the Node that GitHub's runners
// already have, so the Action needs no install step.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkPlan } from '../src/evidence.js';
import { parsePlan, validatePlan } from '../src/plan.js';
import { setLang, t } from '../src/i18n/index.js';
import { formatReport as formatReportWith } from '../src/report.js';
import { localView } from './local-view.mjs';

export function parseArgs(argv) {
  const opts = { dir: '.', plan: 'smp.json', strict: false, format: 'text', lang: 'en' };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--strict') opts.strict = true;
    else if (a === '--plan') opts.plan = rest.shift();
    else if (a === '--format') opts.format = rest.shift();
    else if (a === '--lang') opts.lang = rest.shift();
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) return { error: `unknown option ${a}` };
    else opts.dir = a;
  }
  if (!['text', 'md', 'json'].includes(opts.format)) return { error: `unknown format ${opts.format}` };
  if (!opts.plan) return { error: '--plan needs a path' };
  return opts;
}

/** The report, in the CLI's language. The formatting itself lives in src/report.js, shared with the page. */
export const formatReport = (result, problems, opts = {}) => formatReportWith(result, problems, { ...opts, t });

/** Whether the run should fail CI. */
export function failed(result, problems, strict) {
  if (problems.some((p) => p.severity === 'error')) return true;
  if (result.summary.failing > 0) return true;
  return strict && result.summary.pending > 0;
}

export async function main(argv, { log = console.log, err = console.error, today } = {}) {
  const opts = parseArgs(argv);
  if (opts.error) {
    err(`smp-check: ${opts.error}`);
    return 2;
  }
  if (opts.help) {
    log('usage: smp-check [dir] [--plan smp.json] [--strict] [--format text|md|json] [--lang en|es]');
    return 0;
  }
  setLang(opts.lang);
  const dir = resolve(opts.dir);
  const planFile = resolve(dir, opts.plan);
  if (!existsSync(planFile)) {
    err(`smp-check: ${opts.plan} not found in ${dir}`);
    return 2;
  }
  const parsed = parsePlan(readFileSync(planFile, 'utf8'));
  if (parsed.error) {
    err(`smp-check: ${opts.plan}: ${t(parsed.error)}`);
    return 2;
  }
  const problems = validatePlan(parsed.plan);
  const result = await checkPlan(parsed.plan, localView(dir), today ? { today } : {});

  if (opts.format === 'json') log(JSON.stringify({ plan: opts.plan, problems, ...result }, null, 2));
  else log(formatReport(result, problems, { format: opts.format, planPath: opts.plan }));

  // In a GitHub Actions job, also leave the Markdown report on the run's summary page.
  if (process.env.GITHUB_STEP_SUMMARY && opts.format !== 'md') {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatReport(result, problems, { format: 'md', planPath: opts.plan }));
    } catch { /* a summary is a courtesy, never a reason to fail */ }
  }
  return failed(result, problems, opts.strict) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // exitCode rather than exit(): exit() can cut off a long report on a piped stdout. A crash
  // inside the checker is a tool error (2), not a failing plan (1).
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(err?.stack ?? String(err)); process.exitCode = 2; },
  );
}
