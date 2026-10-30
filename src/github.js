// A repository view (see evidence.js) over a public GitHub repository, for the page.
//
// Two hosts, both named in the page's Content-Security-Policy and nowhere else:
//   api.github.com              the repository record (default branch, detected licence)
//                               and the file tree, two requests in all
//   raw.githubusercontent.com   file contents, fetched only for the files a check reads
//
// Unauthenticated, so GitHub allows 60 API requests an hour per visitor IP. Raw file fetches
// do not count against that limit. No token is ever asked for: a page that stores a token in
// the browser is a page that can leak one.
//
// `fetchImpl` is injected so the tests can drive this module without a network.

export const GITHUB_API = 'https://api.github.com';
export const GITHUB_RAW = 'https://raw.githubusercontent.com';

/**
 * `owner/repo` from anything a person is likely to paste: the bare pair, the repository URL,
 * a URL to a file or branch inside it, or a clone URL. Null when it is none of those.
 */
export function parseRepo(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const m =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(s) ||
    /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(s) ||
    /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** Error with a code the page can translate. */
export class RepoError extends Error {
  constructor(code, vars = {}) {
    super(code);
    this.code = code;
    this.vars = vars;
  }
}

async function getJson(fetchImpl, url, signal) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json' }, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new RepoError('err.network');
  }
  if (res.status === 404) throw new RepoError('err.notFound');
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers?.get?.('x-ratelimit-reset'));
    const at = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString().slice(11, 16) : '?';
    throw new RepoError('err.rateLimit', { at });
  }
  if (!res.ok) throw new RepoError('err.http', { status: res.status });
  return res.json();
}

/**
 * Build a repository view of `owner/repo` at its default branch (or `ref`).
 * Throws RepoError for the cases a visitor can do something about.
 */
export async function githubView({ owner, repo, ref = null }, { fetchImpl = globalThis.fetch, signal } = {}) {
  const meta = await getJson(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}`, signal);
  const branch = ref || meta.default_branch;
  const tree = await getJson(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, signal);
  const files = (tree.tree ?? []).filter((n) => n.type === 'blob').map((n) => n.path);
  const spdx = meta.license?.spdx_id;

  const cache = new Map();
  const read = (path) => {
    if (!cache.has(path)) {
      const url = `${GITHUB_RAW}/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`;
      // A 404 is a file that is not there. Anything else (a throttled or failed request) is
      // an error: read as an empty file, it would turn into a confident "missing" verdict.
      cache.set(path, fetchImpl(url, { signal })
        .catch((e) => { throw e?.name === 'AbortError' ? e : new RepoError('err.network'); })
        .then((r) => {
          if (r.ok) return r.text();
          if (r.status === 404) return null;
          throw new RepoError('err.http', { status: r.status });
        }));
    }
    return cache.get(path);
  };

  return {
    source: 'github',
    vcs: 'git',
    remotes: [meta.html_url, `https://github.com/${owner}/${repo}`],
    files,
    // GitHub says NOASSERTION when it found a licence file it could not classify. That is
    // not a licence, so it falls through to reading the text.
    license: spdx && spdx !== 'NOASSERTION' ? spdx : null,
    truncated: Boolean(tree.truncated),
    branch,
    read,
  };
}
