// The GitHub repository view, driven by a fake fetch: which URLs it asks for, what it makes of
// the answers, and how it fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GITHUB_API, GITHUB_RAW, RepoError, githubView, parseRepo } from '../src/github.js';

test('parseRepo takes what people paste', () => {
  const want = { owner: 'rijdho', repo: 'smp-template' };
  for (const s of [
    'rijdho/smp-template', 'https://github.com/rijdho/smp-template', 'github.com/rijdho/smp-template/',
    'https://github.com/rijdho/smp-template.git', 'git@github.com:rijdho/smp-template.git',
    'https://github.com/rijdho/smp-template/blob/main/smp.json', '  rijdho/smp-template  ',
  ]) assert.deepEqual(parseRepo(s), want, s);
  for (const s of ['', 'smp-template', 'https://gitlab.com/a/b', 'a/b/c d']) assert.equal(parseRepo(s), null, s);
});

/** A fetch that answers from a table of URL → { status, body } and records what was asked. */
function fakeFetch(table) {
  const asked = [];
  const fn = async (url) => {
    asked.push(url);
    const hit = table[url];
    if (!hit) return { ok: false, status: 404, headers: new Map(), json: async () => ({}), text: async () => '' };
    const { status = 200, body = '', headers = {} } = hit;
    return {
      ok: status >= 200 && status < 300, status,
      headers: new Map(Object.entries(headers)),
      json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return { fn, asked };
}

const META = `${GITHUB_API}/repos/acme/tool`;
const TREE = `${GITHUB_API}/repos/acme/tool/git/trees/main?recursive=1`;

test('two API requests build the view; file contents come from raw, once each', async () => {
  const { fn, asked } = fakeFetch({
    [META]: { body: { default_branch: 'main', html_url: 'https://github.com/acme/tool', license: { spdx_id: 'MIT' } } },
    [TREE]: { body: { truncated: false, tree: [{ type: 'blob', path: 'README.md' }, { type: 'tree', path: 'docs' }, { type: 'blob', path: 'docs/a b.md' }] } },
    [`${GITHUB_RAW}/acme/tool/main/docs/a%20b.md`]: { body: 'hello' },
  });
  const view = await githubView({ owner: 'acme', repo: 'tool' }, { fetchImpl: fn });
  assert.deepEqual(view.files, ['README.md', 'docs/a b.md']);
  assert.equal(view.license, 'MIT');
  assert.equal(view.vcs, 'git');
  assert.equal(view.branch, 'main');
  assert.equal(await view.read('docs/a b.md'), 'hello');
  assert.equal(await view.read('docs/a b.md'), 'hello');
  assert.equal(await view.read('missing.md'), null);
  assert.equal(asked.filter((u) => u.startsWith(GITHUB_API)).length, 2);
  assert.equal(asked.filter((u) => u.endsWith('a%20b.md')).length, 1, 'a file was fetched twice');
});

test('NOASSERTION is not a licence', async () => {
  const { fn } = fakeFetch({
    [META]: { body: { default_branch: 'main', html_url: 'x', license: { spdx_id: 'NOASSERTION' } } },
    [TREE]: { body: { tree: [] } },
  });
  assert.equal((await githubView({ owner: 'acme', repo: 'tool' }, { fetchImpl: fn })).license, null);
});

test('failures become codes the page can translate', async () => {
  const cases = [
    [{}, 'err.notFound'],
    [{ [META]: { status: 403, headers: { 'x-ratelimit-reset': '1790000000' } } }, 'err.rateLimit'],
    [{ [META]: { status: 500 } }, 'err.http'],
  ];
  for (const [table, code] of cases) {
    const { fn } = fakeFetch(table);
    await assert.rejects(githubView({ owner: 'acme', repo: 'tool' }, { fetchImpl: fn }),
      (e) => e instanceof RepoError && e.code === code, code);
  }
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(githubView({ owner: 'a', repo: 'b' }, { fetchImpl: offline }), (e) => e.code === 'err.network');
});

test('a failed raw read is an error, not an empty file', async () => {
  const { fn } = fakeFetch({
    [META]: { body: { default_branch: 'main', html_url: 'https://github.com/acme/tool' } },
    [TREE]: { body: { truncated: false, tree: [{ type: 'blob', path: 'README.md' }] } },
    [`${GITHUB_RAW}/acme/tool/main/README.md`]: { status: 503 },
  });
  const view = await githubView({ owner: 'acme', repo: 'tool' }, { fetchImpl: fn });
  await assert.rejects(view.read('README.md'), (e) => e instanceof RepoError && e.code === 'err.http' && e.vars.status === 503);
});
