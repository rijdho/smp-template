// A repository view (see src/evidence.js) over a local checkout, for the CLI and the Action.
//
// Only TRACKED files count. A file that exists on disk but is not committed is not evidence
// of anything a reader of the repository can see, and it is exactly what CI would not have.
// Outside a git repository the view falls back to walking the directory, and says so with
// `vcs: null`, which the version-control check then reports.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP = new Set(['.git', 'node_modules', '_ref', '.claude', 'dist']);

function git(dir, args) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function walk(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/**
 * A remote URL without its user part. A CI checkout may be cloned as
 * https://x-access-token:<token>@github.com/o/r, and the remotes end up in the report.
 */
export const withoutUserinfo = (url) => url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');

/** Remote URLs as `git remote -v` lists them, without credentials, deduplicated. */
function remotesOf(dir) {
  const text = git(dir, ['remote', '-v']);
  if (!text) return [];
  return [...new Set(text.split('\n').map((l) => l.split(/\s+/)[1]).filter(Boolean).map(withoutUserinfo))];
}

export function localView(dir) {
  const inside = git(dir, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
  const listed = inside ? git(dir, ['ls-files', '-z']) : null;
  const files = listed != null
    ? listed.split('\0').filter(Boolean)
    : walk(dir);
  return {
    source: 'local',
    vcs: inside ? 'git' : null,
    remotes: inside ? remotesOf(dir) : [],
    files,
    license: null,
    read: async (path) => {
      const full = join(dir, path);
      return existsSync(full) ? readFileSync(full, 'utf8') : null;
    },
  };
}
