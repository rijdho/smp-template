// The command-line checker and the exit codes CI reads, on real git checkouts made in a
// temporary directory: the checker only counts TRACKED files, so the fixture has to be a
// repository and not just a folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { failed, main, parseArgs } from '../bin/smp-check.mjs';
import { withoutUserinfo } from '../bin/local-view.mjs';
import { createPlan, planToJson } from '../src/plan.js';

function checkout(files, { commit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'smp-check-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  if (commit) git('add', '-A');
  return dir;
}

function lowPlan(status) {
  const p = createPlan({ level: 'low', title: 'T', softwareTitle: 'S', now: new Date('2026-09-01T00:00:00Z') });
  p.smp.contact.name = 'A';
  for (const e of Object.values(p.smp.requirements)) Object.assign(e, { status, answer: 'x' });
  p.smp.requirements.licensing.spdx = 'MIT';
  return planToJson(p);
}

async function run(args) {
  const out = [];
  const code = await main(args, { log: (s) => out.push(s), err: (s) => out.push(s), today: '2026-09-29' });
  return { code, text: out.join('\n') };
}

const README = `# S\n\n${'Prose that documents the software. '.repeat(12)}\n\n## Installation\n\nRun it.\n`;
const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy';

test('0 when every in-place commitment is visible', async () => {
  const dir = checkout({ 'smp.json': lowPlan('in_place'), 'README.md': README, LICENSE: MIT });
  try {
    const { code, text } = await run([dir]);
    assert.equal(code, 0, text);
    assert.match(text, /5 of 5 questions answered/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('1 when one is not, and an untracked file does not count as evidence', async () => {
  const dir = checkout({ 'smp.json': lowPlan('in_place'), 'README.md': README });
  writeFileSync(join(dir, 'LICENSE'), MIT); // on disk, never added
  try {
    const { code, text } = await run([dir]);
    assert.equal(code, 1);
    assert.match(text, /✗ Software licensing and compatibility/);
    assert.match(text, /no LICENSE, LICENCE or COPYING file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('planned commitments pass, unless --strict', async () => {
  const dir = checkout({ 'smp.json': lowPlan('planned') });
  try {
    assert.equal((await run([dir])).code, 0);
    assert.equal((await run([dir, '--strict'])).code, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('2 for usage errors: no plan, broken JSON, unknown option', async () => {
  const dir = checkout({ 'broken.json': '{' });
  try {
    assert.equal((await run([dir])).code, 2);
    assert.equal((await run([dir, '--plan', 'broken.json'])).code, 2);
    assert.equal((await run([dir, '--frobnicate'])).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an invalid plan fails even when the repository is fine', async () => {
  const bad = JSON.parse(lowPlan('in_place'));
  bad.smp.level = 'extreme';
  const dir = checkout({ 'smp.json': JSON.stringify(bad), 'README.md': README, LICENSE: MIT });
  try {
    const { code, text } = await run([dir]);
    assert.equal(code, 1);
    assert.match(text, /smp\.level: must be one of: low, medium, high/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Markdown, JSON and Spanish output', async () => {
  const dir = checkout({ 'smp.json': lowPlan('in_place'), 'README.md': README, LICENSE: MIT });
  try {
    const md = (await run([dir, '--format', 'md'])).text;
    assert.match(md, /^\| · \| Purpose \| In place \| Declared only \|$/m);
    assert.match(md, /^\| ✓ \| Software licensing and compatibility \| In place \| ✓ Licence file: LICENSE<br>✓ Licence matches/m);
    const json = JSON.parse((await run([dir, '--format', 'json'])).text);
    assert.equal(json.summary.failing, 0);
    assert.match((await run([dir, '--lang', 'es'])).text, /5 de 5 preguntas respondidas/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('parseArgs and failed', () => {
  assert.deepEqual(parseArgs(['x', '--strict', '--plan', 'p.json']), { dir: 'x', plan: 'p.json', strict: true, format: 'text', lang: 'en' });
  assert.ok(parseArgs(['--format', 'xml']).error);
  const r = (failing, pending) => ({ summary: { failing, pending } });
  assert.equal(failed(r(0, 3), [], false), false);
  assert.equal(failed(r(0, 3), [], true), true);
  assert.equal(failed(r(1, 0), [], false), true);
  assert.equal(failed(r(0, 0), [{ severity: 'error' }], false), true);
  assert.equal(failed(r(0, 0), [{ severity: 'warning' }], false), false);
});

test('remotes lose their credentials before they reach the report', () => {
  assert.equal(withoutUserinfo('https://x-access-token:ghs_example@github.com/acme/tool'), 'https://github.com/acme/tool');
  assert.equal(withoutUserinfo('https://user@example.org/acme/tool.git'), 'https://example.org/acme/tool.git');
  assert.equal(withoutUserinfo('git@github.com:acme/tool.git'), 'git@github.com:acme/tool.git');
  assert.equal(withoutUserinfo('https://github.com/acme/tool'), 'https://github.com/acme/tool');
});
