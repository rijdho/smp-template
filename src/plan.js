// A plan: how it is created, what makes it valid, and how it is written out.
//
// Pure: no DOM, no network, no clock except where a caller passes one in. The page, the CLI
// and the tests all go through these functions, which is what lets the tests pin behaviour
// with exact expected values.
//
// The envelope follows the conventions of the RDA DMP Common Standard (maDMP, v1.2), so a
// reader who knows one recognises the other: a single top-level object (`smp`, as maDMP has
// `dmp`), snake_case keys, `created` and `modified` as ISO 8601 date-times, `language` as an
// ISO 639-3 code, and a `contact` with `name`, `mbox` and a typed `contact_id`. It is less
// strict than maDMP in one place, on purpose: maDMP requires the contact's e-mail and
// identifier, and an SMP committed to a public repository is exactly where a personal
// address should be optional.

import { GUIDE, LEVELS, REQUIREMENTS, STATUSES, byId, requirementsFor } from './requirements.js?v=20';

export const SCHEMA_VERSION = '0.1.0';
export const SCHEMA_ID = 'https://rijdho.github.io/smp-template/schema/smp.schema.json';

/** Keys every requirement entry may carry besides its declared fields. */
export const ENTRY_KEYS = Object.freeze(['status', 'answer']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** An empty string is how a blank form field arrives, and it means "not given". */
const given = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

const RX = {
  url: /^https?:\/\/[^\s/$.?#][^\s]*$/i,
  // One or more SPDX identifiers joined by AND / OR / WITH. Deliberately permissive about
  // the identifiers themselves: the SPDX list grows, and a checker that rejects a licence it
  // has not heard of is worse than one that accepts a typo it cannot recognise.
  spdx: /^\(?[A-Za-z0-9.+-]+\)?(\s+(AND|OR|WITH)\s+\(?[A-Za-z0-9.+-]+\)?)*$/,
  doi: /^10\.\d{4,9}\/\S+$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  dateTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
  lang: /^[a-z]{3}$/,
  mbox: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
};

/** Strip a resolver prefix, so `https://doi.org/10.5281/x` and `10.5281/x` compare equal. */
export function normaliseDoi(value) {
  if (!given(value)) return '';
  return String(value).trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, '');
}

function validDate(s) {
  if (!RX.date.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A relative path inside the repository: no leading slash, no parent segments, no backslashes. */
function validPath(s) {
  if (typeof s !== 'string' || s.startsWith('/') || s.includes('\\')) return false;
  return !s.split('/').some((seg) => seg === '..' || seg === '');
}

/** Whether `value` is acceptable for `field`. Only called for values that are given. */
export function fieldValueOk(field, value) {
  switch (field.type) {
    case 'text': return typeof value === 'string';
    case 'url': return typeof value === 'string' && RX.url.test(value.trim());
    case 'path': return validPath(value);
    case 'spdx': return typeof value === 'string' && RX.spdx.test(value.trim());
    case 'doi': return typeof value === 'string' && RX.doi.test(normaliseDoi(value));
    case 'bool': return typeof value === 'boolean';
    case 'date': return typeof value === 'string' && validDate(value);
    case 'enum': return field.options.includes(value);
    default: throw new Error(`unknown field type ${field.type}`);
  }
}

/** A blank plan for a level: every requirement the level asks for, all `planned`. */
export function createPlan({ level = 'medium', title = '', softwareTitle = '', now = new Date() } = {}) {
  if (!LEVELS.includes(level)) throw new Error(`unknown level ${level}`);
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const requirements = {};
  for (const r of requirementsFor(level)) requirements[r.id] = { status: 'planned', answer: '' };
  return {
    $schema: SCHEMA_ID,
    smp: {
      schema_version: SCHEMA_VERSION,
      title,
      created: stamp,
      modified: stamp,
      language: 'eng',
      level,
      contact: { name: '' },
      software: { title: softwareTitle },
      guide: { title: GUIDE.title, version: GUIDE.version, doi: GUIDE.conceptDoi },
      requirements,
    },
  };
}

/**
 * Move a plan to another level, keeping every answer it already has. Requirements the new
 * level adds arrive blank and `planned`; requirements it drops are kept only if they carry
 * something, because silently deleting a written answer is the one outcome nobody wants.
 */
export function changeLevel(plan, level) {
  if (!LEVELS.includes(level)) throw new Error(`unknown level ${level}`);
  const next = structuredClone(plan);
  const reqs = next.smp.requirements ?? {};
  const wanted = new Set(requirementsFor(level).map((r) => r.id));
  const out = {};
  for (const r of REQUIREMENTS) {
    const entry = reqs[r.id];
    const hasContent = entry && Object.entries(entry).some(([k, v]) => k !== 'status' && given(v));
    if (wanted.has(r.id)) out[r.id] = entry ?? { status: 'planned', answer: '' };
    else if (hasContent) out[r.id] = entry;
  }
  next.smp.level = level;
  next.smp.requirements = out;
  return next;
}

/**
 * Every problem with a plan, as `{ severity, path, code, vars }`. `code` is an i18n key under
 * `val.` so the page and the CLI can both say it in words. Errors make a plan invalid;
 * warnings are what a draft normally has (an unanswered question) and do not.
 */
export function validatePlan(plan) {
  const out = [];
  const err = (path, code, vars = {}) => out.push({ severity: 'error', path, code, vars });
  const warn = (path, code, vars = {}) => out.push({ severity: 'warning', path, code, vars });

  if (!isObj(plan) || !isObj(plan.smp)) {
    err('smp', 'val.noRoot');
    return out;
  }
  const s = plan.smp;

  if (!given(s.title)) err('smp.title', 'val.required');
  if (!LEVELS.includes(s.level)) err('smp.level', 'val.enum', { allowed: LEVELS.join(', ') });
  if (!given(s.language)) err('smp.language', 'val.required');
  else if (!RX.lang.test(s.language)) err('smp.language', 'val.lang');
  for (const k of ['created', 'modified']) {
    if (!given(s[k])) err(`smp.${k}`, 'val.required');
    else if (!RX.dateTime.test(s[k])) err(`smp.${k}`, 'val.dateTime');
  }
  if (given(s.created) && given(s.modified) && RX.dateTime.test(s.created) && RX.dateTime.test(s.modified)
      && Date.parse(s.modified) < Date.parse(s.created)) err('smp.modified', 'val.modifiedBeforeCreated');

  if (!isObj(s.contact)) err('smp.contact', 'val.required');
  else {
    if (!given(s.contact.name)) err('smp.contact.name', 'val.required');
    if (given(s.contact.mbox) && !RX.mbox.test(s.contact.mbox)) err('smp.contact.mbox', 'val.mbox');
    if (given(s.contact.contact_id)) {
      const id = s.contact.contact_id;
      if (!isObj(id) || !given(id.identifier) || !given(id.type)) err('smp.contact.contact_id', 'val.typedId');
    }
  }

  if (!isObj(s.software)) err('smp.software', 'val.required');
  else {
    if (!given(s.software.title)) err('smp.software.title', 'val.required');
    if (given(s.software.repository_url) && !RX.url.test(s.software.repository_url))
      err('smp.software.repository_url', 'val.url');
  }

  if (!isObj(s.requirements)) {
    err('smp.requirements', 'val.required');
    return out;
  }

  if (LEVELS.includes(s.level))
    for (const r of requirementsFor(s.level))
      if (!isObj(s.requirements[r.id])) err(`smp.requirements.${r.id}`, 'val.levelGap', { level: s.level });

  for (const [id, entry] of Object.entries(s.requirements)) {
    const at = `smp.requirements.${id}`;
    const req = byId(id);
    if (!req) {
      err(at, 'val.unknownRequirement');
      continue;
    }
    if (!isObj(entry)) {
      err(at, 'val.type');
      continue;
    }
    if (!STATUSES.includes(entry.status)) err(`${at}.status`, 'val.enum', { allowed: STATUSES.join(', ') });
    if (given(entry.answer) && typeof entry.answer !== 'string') err(`${at}.answer`, 'val.type');
    if (entry.status === 'not_applicable' && !given(entry.answer)) err(`${at}.answer`, 'val.justify');
    else if (!given(entry.answer)) warn(`${at}.answer`, 'val.unanswered');

    const known = new Set([...ENTRY_KEYS, ...req.fields.map((fd) => fd.key)]);
    for (const k of Object.keys(entry)) if (!known.has(k)) err(`${at}.${k}`, 'val.unknownField');
    for (const fd of req.fields) {
      const v = entry[fd.key];
      if (!given(v)) continue;
      if (!fieldValueOk(fd, v))
        err(`${at}.${fd.key}`, `val.${fd.type}`, fd.type === 'enum' ? { allowed: fd.options.join(', ') } : {});
    }
  }

  // Guide-level coherence that no single field can express.
  const repo = s.requirements.repository;
  if (isObj(repo) && repo.archive === 'none' && repo.status !== 'not_applicable' && !given(repo.answer))
    err('smp.requirements.repository.answer', 'val.noArchiveJustify');

  return out;
}

export const isValid = (plan) => validatePlan(plan).every((p) => p.severity !== 'error');

/** A copy with blank strings dropped, which is what a downloaded smp.json should contain. */
export function compactPlan(plan) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isObj(v)) return v;
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      const w = walk(val);
      if (!given(w)) continue;
      if (isObj(w) && Object.keys(w).length === 0) continue;
      o[k] = w;
    }
    return o;
  };
  const out = walk(plan);
  // `answer` stays even when empty: an unanswered question is information, and the next
  // editor should see the slot rather than wonder whether it was deleted.
  for (const [id, entry] of Object.entries(out.smp?.requirements ?? {})) {
    const original = plan.smp.requirements[id];
    out.smp.requirements[id] = { status: original.status, answer: original.answer ?? '', ...entry };
  }
  return out;
}

/** Touch `modified`, keeping `created`, as maDMP asks. */
export function stamp(plan, now = new Date()) {
  const next = structuredClone(plan);
  next.smp.modified = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return next;
}

export const planToJson = (plan) => `${JSON.stringify(compactPlan(plan), null, 2)}\n`;

/**
 * Parse text as a plan. Returns `{ plan }` or `{ error }` with an i18n key; never throws, so
 * a pasted or uploaded file cannot take the page down.
 */
export function parsePlan(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'val.notJson' };
  }
  if (!isObj(data) || !isObj(data.smp)) return { error: 'val.noRoot' };
  return { plan: data };
}

const mdEscape = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * The plan as Markdown, for a README section, a review, or a funder that wants a document.
 * `t` is the translator, passed in so this module needs no i18n state of its own.
 */
export function planToMarkdown(plan, t) {
  const s = plan.smp;
  const lines = [];
  lines.push(`# ${s.title || t('md.untitled')}`, '');
  lines.push(`| ${t('md.field')} | ${t('md.value')} |`, '|---|---|');
  lines.push(`| ${t('md.software')} | ${mdEscape(s.software?.title)} |`);
  if (s.software?.repository_url) lines.push(`| ${t('md.repository')} | ${mdEscape(s.software.repository_url)} |`);
  lines.push(`| ${t('md.level')} | ${t(`level.${s.level}`)} |`);
  lines.push(`| ${t('md.contact')} | ${mdEscape(s.contact?.name)} |`);
  lines.push(`| ${t('md.created')} | ${mdEscape(s.created)} |`);
  lines.push(`| ${t('md.modified')} | ${mdEscape(s.modified)} |`);
  lines.push('');
  for (const r of REQUIREMENTS) {
    const e = s.requirements?.[r.id];
    if (!e) continue;
    lines.push(`## ${t(`req.${r.id}.title`)}`, '');
    lines.push(`*${t(questionKey(r.id, s.level))}*`, '');
    lines.push(`${t('md.status')}: **${t(`status.${e.status}`)}**`, '');
    lines.push(given(e.answer) ? String(e.answer).trim() : `_${t('md.unanswered')}_`, '');
    const commitments = r.fields.filter((fd) => given(e[fd.key]));
    if (commitments.length) {
      for (const fd of commitments) {
        const v = fd.type === 'bool' ? t(e[fd.key] ? 'md.yes' : 'md.no')
          : fd.type === 'enum' ? t(`opt.${r.id}.${fd.key}.${e[fd.key]}`)
          : `\`${e[fd.key]}\``;
        lines.push(`- ${t(`field.${r.id}.${fd.key}`)}: ${v}`);
      }
      lines.push('');
    }
  }
  lines.push('---', '', t('md.footer', { guide: GUIDE.title, doi: GUIDE.conceptDoi }), '');
  return lines.join('\n');
}

/**
 * The i18n key of the guide's question for a requirement at a level. The guide words a few
 * questions differently from the medium level up (user and installation documentation, the
 * licence) and again at the high level (a checklist for quality, an SPDX identifier for the
 * licence, a full dependency description for deployment); everything else is shared.
 */
export const HIGH_VARIANTS = Object.freeze(['licensing', 'deployment_documentation', 'engineering_quality']);
export const MEDIUM_PLUS_VARIANTS = Object.freeze(['user_documentation', 'licensing', 'deployment_documentation']);

export function questionKey(id, level) {
  if (level === 'high' && HIGH_VARIANTS.includes(id)) return `req.${id}.q.high`;
  if ((level === 'medium' || level === 'high') && MEDIUM_PLUS_VARIANTS.includes(id)) return `req.${id}.q.medium`;
  return `req.${id}.q`;
}
