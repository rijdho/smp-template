// UI wiring. Every decision lives in requirements.js, plan.js and evidence.js; this file only
// moves values between the DOM and those modules, which is what keeps the behaviour testable in
// Node without a browser. Only github.js touches the network.

import { LEVELS, REQUIREMENTS, byId, requirementsFor } from './requirements.js?v=18';
import {
  changeLevel, createPlan, parsePlan, planToJson, planToMarkdown, questionKey, stamp, validatePlan,
} from './plan.js?v=18';
import { CHECK_IDS, checkPlan } from './evidence.js?v=18';
import { CROSSWALK, SOURCES } from './crosswalk.js?v=18';
import { MARK, formatReport } from './report.js?v=18';
import { RepoError, githubView, parseRepo } from './github.js?v=18';
import { LANGS, getLang, resolveLang, setLang, t } from './i18n/index.js?v=18';

const $ = (id) => document.getElementById(id);
const KEY = { draft: 'smp-template:draft', lang: 'smp-template:lang', theme: 'smp-template:theme' };

const VIEWS = ['plan', 'check', 'how', 'caveats', 'about'];
const VIEW_TITLE = { plan: 'nav.plan', check: 'nav.check', how: 'how.title', caveats: 'caveats.title', about: 'about.title' };

let view = 'plan';
let plan = loadDraft() ?? createPlan();
let lastCheck = null;
let controller = null;
let confirmNew = false;
let confirmToEditor = false;

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Translate with every interpolated value escaped, for strings that are inserted as HTML. */
const tHtml = (key, vars = {}) => t(key, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)])));

// ── storage (a per-browser convenience; never required for the page to work) ──

function loadDraft() {
  try {
    const raw = localStorage.getItem(KEY.draft);
    return raw ? parsePlan(raw).plan ?? null : null;
  } catch {
    return null;
  }
}

let saveTimer = null;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY.draft, JSON.stringify(plan)); } catch { /* private mode */ }
  }, 300);
}

// ── views ─────────────────────────────────────────────────────────────────────

function showView(next, { push = true } = {}) {
  view = VIEWS.includes(next) ? next : 'plan';
  for (const node of document.querySelectorAll('.view')) node.hidden = node.dataset.view !== view;
  for (const b of document.querySelectorAll('.nav-item')) b.classList.toggle('active', b.dataset.view === view);
  $('cmd-title').textContent = t(VIEW_TITLE[view]);
  closeRail();
  if (push) writeUrl();
}

function writeUrl() {
  const q = new URLSearchParams();
  if (view !== 'plan') q.set('view', view);
  if (getLang() !== 'en') q.set('lang', getLang());
  const repo = $('repo').value.trim();
  if (view === 'check' && repo) q.set('repo', repo);
  const s = q.toString();
  history.replaceState(null, '', s ? `?${s}` : location.pathname);
}

function openRail() {
  $('app').classList.add('rail-open');
  $('menu').setAttribute('aria-expanded', 'true');
}
function closeRail() {
  $('app').classList.remove('rail-open');
  $('menu').setAttribute('aria-expanded', 'false');
}

// ── i18n and theme ────────────────────────────────────────────────────────────

function applyI18n() {
  document.documentElement.lang = getLang();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-html]')) node.innerHTML = t(node.dataset.i18nHtml);
  for (const node of document.querySelectorAll('[data-i18n-attr]'))
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) node.setAttribute(attr.trim(), t(key.trim()));
    }
  for (const b of $('lang').querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.code === getLang()));
  $('cmd-title').textContent = t(VIEW_TITLE[view]);
  // Everything drawn from data carries translated labels, so it is redrawn.
  renderLevels();
  renderRequirements();
  renderValidity();
  renderReqTable();
  if (lastCheck) renderCheck(lastCheck);
}

function initLang() {
  $('lang').innerHTML = LANGS.map(
    (l) => `<button type="button" data-code="${l.code}" aria-current="false" title="${escapeHtml(l.label)}">${l.code.toUpperCase()}</button>`,
  ).join('');
  $('lang').addEventListener('click', (e) => {
    const code = e.target.closest('button')?.dataset.code;
    if (!code) return;
    setLang(code);
    try { localStorage.setItem(KEY.lang, code); } catch { /* private mode */ }
    applyI18n();
    writeUrl();
  });
  let stored = null;
  try { stored = localStorage.getItem(KEY.lang); } catch { /* private mode */ }
  const fromUrl = new URLSearchParams(location.search).get('lang');
  setLang(resolveLang(fromUrl || stored, navigator.languages ?? [navigator.language]));
}

function initTheme() {
  $('theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY.theme, next); } catch { /* private mode */ }
  });
}

// ── the plan: metadata fields ─────────────────────────────────────────────────

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys.at(-1)] = value;
}

function fillMeta() {
  for (const input of document.querySelectorAll('[data-bind]')) input.value = getPath(plan.smp, input.dataset.bind) ?? '';
}

function onMetaInput(e) {
  const input = e.target.closest('[data-bind]');
  if (!input) return;
  setPath(plan.smp, input.dataset.bind, input.value);
  // An ORCID iD makes the identifier typed, as maDMP's contact_id is.
  if (input.dataset.bind === 'contact.contact_id.identifier') {
    if (input.value.trim()) plan.smp.contact.contact_id.type = 'orcid';
    else delete plan.smp.contact.contact_id;
  }
  changed();
}

function changed() {
  plan = stamp(plan);
  saveDraft();
  renderValidity();
}

// ── the plan: level ───────────────────────────────────────────────────────────

function renderLevels() {
  $('levels').innerHTML = LEVELS.map((level) => {
    const n = requirementsFor(level).length;
    const on = plan.smp.level === level;
    return `<button type="button" class="level" role="radio" aria-checked="${on}" data-level="${level}">
      <span class="level-name">${escapeHtml(t(`level.${level}`))}</span>
      <span class="level-n mono">${escapeHtml(t('plan.reqs.count', { n }))}</span>
      <span class="level-desc">${escapeHtml(t(`level.${level}.desc`))}</span>
    </button>`;
  }).join('');
}

function onLevelClick(e) {
  const level = e.target.closest('[data-level]')?.dataset.level;
  if (!level || level === plan.smp.level) return;
  plan = changeLevel(plan, level);
  changed();
  renderLevels();
  renderRequirements();
}

// ── the plan: requirements ────────────────────────────────────────────────────

function fieldControl(req, fd, entry) {
  const id = `f-${req.id}-${fd.key}`;
  const value = entry[fd.key];
  const label = escapeHtml(t(`field.${req.id}.${fd.key}`));
  const attrs = `id="${id}" data-req="${req.id}" data-key="${fd.key}" data-type="${fd.type}"`;
  if (fd.type === 'bool')
    return `<label class="chk"><input type="checkbox" ${attrs} ${value === true ? 'checked' : ''} /> <span>${label}</span></label>`;
  if (fd.type === 'enum') {
    const opts = [`<option value="">${escapeHtml(t('opt.unset'))}</option>`, ...fd.options.map((o) =>
      `<option value="${o}" ${value === o ? 'selected' : ''}>${escapeHtml(t(`opt.${req.id}.${fd.key}.${o}`))}</option>`)];
    return `<label class="field"><span>${label}</span><select class="input" ${attrs}>${opts.join('')}</select></label>`;
  }
  const type = fd.type === 'date' ? 'date' : fd.type === 'url' ? 'url' : 'text';
  const ph = fd.default ? ` placeholder="${escapeHtml(t('plan.default', { value: fd.default }))}"` : '';
  return `<label class="field"><span>${label}</span>
    <input class="input" type="${type}" ${attrs} value="${escapeHtml(value ?? '')}" autocomplete="off" spellcheck="false"${ph} /></label>`;
}

function requirementCard(req, entry) {
  const inLevel = req.levels.includes(plan.smp.level);
  const statuses = ['planned', 'in_place', 'not_applicable'].map((s) => `
    <label class="seg"><input type="radio" name="st-${req.id}" value="${s}" data-req="${req.id}" data-key="status"
      ${entry.status === s ? 'checked' : ''} /><span>${escapeHtml(t(`status.${s}`))}</span></label>`).join('');
  const fields = req.fields.map((fd) => fieldControl(req, fd, entry)).join('');
  const open = req.fields.some((fd) => entry[fd.key] !== undefined && entry[fd.key] !== '');
  return `<article class="req" id="req-${req.id}" data-status="${entry.status}">
    <header class="req-h">
      <p class="eyebrow">${escapeHtml(t(`focus.${req.focus}`))}${inLevel ? '' : ` · ${escapeHtml(t('plan.extra'))}`}</p>
      <h3>${escapeHtml(t(`req.${req.id}.title`))}</h3>
    </header>
    <p class="question">${escapeHtml(t(questionKey(req.id, plan.smp.level)))}</p>
    <div class="segs" role="radiogroup" aria-label="${escapeHtml(t('plan.status.label'))}">${statuses}</div>
    <p class="hint status-hint">${escapeHtml(t(`status.hint.${entry.status}`))}</p>
    <label class="field"><span>${escapeHtml(t('plan.answer.label'))}</span>
      <textarea class="input" rows="3" data-req="${req.id}" data-key="answer"
        placeholder="${escapeHtml(t('plan.answer.ph'))}">${escapeHtml(entry.answer ?? '')}</textarea></label>
    ${fields ? `<details class="commit" ${open ? 'open' : ''}><summary>${escapeHtml(t('plan.commitments'))}</summary>
      <p class="hint">${escapeHtml(t('plan.commitments.hint'))}</p><div class="grid2">${fields}</div></details>` : ''}
  </article>`;
}

function renderRequirements() {
  const entries = plan.smp.requirements ?? {};
  const shown = REQUIREMENTS.filter((r) => entries[r.id]);
  $('reqs').innerHTML = shown.map((r) => requirementCard(r, entries[r.id])).join('');
  $('reqs-count').textContent = t('plan.reqs.count', { n: requirementsFor(plan.smp.level).length });
}

function onReqInput(e) {
  const node = e.target.closest('[data-req][data-key]');
  if (!node) return;
  const { req, key, type } = node.dataset;
  const entry = plan.smp.requirements[req];
  let value;
  if (node.type === 'checkbox') value = node.checked ? true : undefined;
  else if (node.type === 'radio') value = node.value;
  else value = node.value;
  if (value === undefined || (value === '' && key !== 'answer')) delete entry[key];
  else entry[key] = type === 'doi' ? value.trim() : value;
  if (key === 'status') {
    const card = $(`req-${req}`);
    card.dataset.status = value;
    card.querySelector('.status-hint').textContent = t(`status.hint.${value}`);
  }
  changed();
}

// ── the plan: validity ────────────────────────────────────────────────────────

/** A problem's path in words: the label the visitor sees next to the field. */
function problemLabel(path) {
  const META = {
    'smp.title': 'plan.title.label', 'smp.software.title': 'plan.software.label',
    'smp.software.repository_url': 'plan.repo.label', 'smp.language': 'plan.lang.label',
    'smp.contact.name': 'plan.contact.label', 'smp.contact.mbox': 'plan.mbox.label',
    'smp.contact.contact_id': 'plan.orcid.label', 'smp.level': 'plan.level.title',
  };
  if (META[path]) return t(META[path]);
  const m = /^smp\.requirements\.([a-z_]+)(?:\.([a-z_]+))?$/.exec(path);
  if (m && byId(m[1])) {
    const title = t(`req.${m[1]}.title`);
    if (!m[2]) return title;
    const key = m[2] === 'answer' ? 'plan.answer.label' : m[2] === 'status' ? 'plan.status.label' : `field.${m[1]}.${m[2]}`;
    return `${title}: ${t(key)}`;
  }
  return path;
}

function problemItems(problems) {
  return problems.map((p) => `<li class="${p.severity}"><b>${escapeHtml(problemLabel(p.path))}</b> ${escapeHtml(t(p.code, p.vars))}</li>`).join('');
}

function renderValidity() {
  const problems = validatePlan(plan);
  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');
  const parts = [errors.length ? t('plan.valid.errors', { n: errors.length }) : t('plan.valid.ok')];
  if (warnings.length) parts.push(t('plan.valid.warnings', { n: warnings.length }));
  const box = $('validity');
  box.textContent = parts.join(' ');
  box.dataset.state = errors.length ? 'error' : 'ok';
  $('problems').innerHTML = problemItems(errors);
  $('problems').hidden = errors.length === 0;
}

// ── the plan: files ───────────────────────────────────────────────────────────

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onImport(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const parsed = parsePlan(await file.text());
  if (parsed.error) {
    $('import-status').textContent = t('plan.importFailed', { reason: t(parsed.error) });
    return;
  }
  plan = parsed.plan;
  saveDraft();
  fillMeta();
  renderLevels();
  renderRequirements();
  renderValidity();
  // The button is at the top and the validity box at the bottom, so say it next to the button.
  $('import-status').textContent = `${t('plan.imported')} ${$('validity').textContent}`;
}

function onNew() {
  // Two clicks rather than a confirm() dialog: a modal dialog blocks the page, and a draft is
  // one keystroke from being recoverable only if it was downloaded.
  if (!confirmNew) {
    confirmNew = true;
    $('new-plan').textContent = t('plan.new.confirm');
    setTimeout(() => { confirmNew = false; $('new-plan').textContent = t('plan.new'); }, 4000);
    return;
  }
  confirmNew = false;
  $('new-plan').textContent = t('plan.new');
  plan = createPlan();
  saveDraft();
  fillMeta();
  renderLevels();
  renderRequirements();
  renderValidity();
}

// ── the check ─────────────────────────────────────────────────────────────────

function showError(key, vars) {
  const box = $('check-error');
  box.textContent = t(key, vars);
  box.hidden = false;
}

async function onCheck(e) {
  e.preventDefault();
  $('check-error').hidden = true;
  // A result stays on screen only while it answers the question being asked: left under the
  // error of a new check, it reads as the result for the new repository.
  $('check-results').hidden = true;
  lastCheck = null;
  const target = parseRepo($('repo').value);
  if (!target) return showError('err.badRepo');
  writeUrl();
  controller?.abort();
  // A check that a newer one has replaced must leave the page to the newer one: its result,
  // its error and its finally would otherwise land on top of the check still running.
  const mine = controller = new AbortController();
  const source = document.querySelector('input[name="source"]:checked')?.value ?? 'repo';
  $('check-go').disabled = true;
  $('check-status').textContent = t('check.running');
  try {
    const repoView = await githubView(target, { signal: mine.signal });
    if (controller !== mine) return;
    let checked = plan;
    if (source === 'repo') {
      const planPath = repoView.files.find((f) => f.toLowerCase() === 'smp.json');
      if (!planPath) return showError('err.noPlan');
      const parsed = parsePlan((await repoView.read(planPath)) ?? '');
      if (parsed.error) return showError('err.badPlan', { reason: t(parsed.error) });
      checked = parsed.plan;
    }
    const result = await checkPlan(checked, repoView);
    if (controller !== mine) return;
    lastCheck = {
      ...result, problems: validatePlan(checked), plan: checked, source,
      owner: target.owner, name: target.repo, repo: `${target.owner}/${target.repo}`,
      branch: repoView.branch, truncated: repoView.truncated, files: new Set(repoView.files),
    };
    renderCheck(lastCheck);
  } catch (err) {
    if (err?.name === 'AbortError' || controller !== mine) return;
    if (err instanceof RepoError) showError(err.code, err.vars);
    else showError('err.network');
  } finally {
    if (controller === mine) {
      $('check-go').disabled = false;
      $('check-status').textContent = '';
    }
  }
}

/** A link to a file of the checked repository, for a check that found it. */
function fileLink(c, check) {
  const file = check.vars?.file;
  if (check.outcome !== 'evidenced' || !file || !c.files.has(file)) return '';
  const href = `https://github.com/${c.owner}/${c.name}/blob/${encodeURIComponent(c.branch)}/${file.split('/').map(encodeURIComponent).join('/')}`;
  return ` <a class="file-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" title="${escapeHtml(t('check.openFile'))}">↗</a>`;
}

function renderCheck(c) {
  const s = c.summary;
  $('check-results').hidden = false;
  const level = c.plan?.smp?.level;
  $('check-of').textContent = `${t('check.of', { repo: c.repo, branch: c.branch })} · ${t(`check.planFrom.${c.source}`, { level: level ? t(`level.${level}`).toLowerCase() : '?' })}`;
  $('to-editor').hidden = c.source !== 'repo';
  confirmToEditor = false;
  $('to-editor').textContent = t('check.toEditor');
  $('check-stats').innerHTML = [
    ['answered', tHtml('sum.answered', { a: s.answered, n: s.inScope })],
    ['evidenced', tHtml('sum.evidenced', { e: s.evidenced, n: s.inScope })],
    ['failing', tHtml('sum.failing', { m: s.failing })],
  ].map(([k, html]) => `<div class="stat" data-k="${k}">${html}</div>`).join('');

  const notes = [];
  if (c.truncated) notes.push(t('check.truncated'));
  const errors = c.problems.filter((p) => p.severity === 'error');
  if (errors.length) notes.push(t('check.plan.invalid', { n: errors.length }));
  $('check-notes').innerHTML = notes.map((n) => `<p class="hint">${escapeHtml(n)}</p>`).join('');
  $('check-problems').innerHTML = problemItems(errors);
  $('check-problems').hidden = errors.length === 0;

  $('check-list').innerHTML = c.requirements.map((r) => `
    <div class="verdict" data-verdict="${r.verdict}">
      <div class="verdict-h">
        <span class="verdict-title">${escapeHtml(t(`req.${r.id}.title`))}</span>
        <span class="tag" data-verdict="${r.verdict}">${escapeHtml(t(`verdict.${r.verdict}`))}</span>
        <span class="muted mono">${escapeHtml(t(`status.${r.status}`))}</span>
      </div>
      ${r.checks.length ? `<ul class="checks">${r.checks.map((k) => `
        <li data-outcome="${k.outcome}"><span class="mark" aria-hidden="true">${MARK[k.outcome]}</span>
          <span class="chk-name">${escapeHtml(t(`chk.${k.id}`))}</span>
          <span class="chk-out mono">${escapeHtml(t(`out.${k.outcome}`))}</span>
          <span class="chk-det">${escapeHtml(t(k.detail, k.vars))}${fileLink(c, k)}</span></li>`).join('')}</ul>` : ''}
    </div>`).join('');
}

function onDownloadReport() {
  if (!lastCheck) return;
  const text = formatReport(lastCheck, lastCheck.problems, {
    format: 'md', t, planPath: `${lastCheck.repo}@${lastCheck.branch} · ${t(`check.planFrom.${lastCheck.source}`, { level: t(`level.${lastCheck.plan.smp.level}`).toLowerCase() })}`,
  });
  download(`smp-report-${lastCheck.owner}-${lastCheck.name}.md`, text, 'text/markdown');
}

function onToEditor() {
  if (!lastCheck || lastCheck.source !== 'repo') return;
  // Two clicks, as for Start over: this replaces whatever is in the editor.
  if (!confirmToEditor) {
    confirmToEditor = true;
    $('to-editor').textContent = t('check.toEditor.confirm');
    setTimeout(() => { confirmToEditor = false; $('to-editor').textContent = t('check.toEditor'); }, 4000);
    return;
  }
  confirmToEditor = false;
  plan = structuredClone(lastCheck.plan);
  saveDraft();
  fillMeta();
  renderLevels();
  renderRequirements();
  renderValidity();
  showView('plan');
  $('import-status').textContent = `${t('plan.importedFrom', { repo: lastCheck.repo })} ${$('validity').textContent}`;
}

// ── how it works: the requirements table ─────────────────────────────────────

function renderReqTable() {
  const cell = (terms) => (terms.length
    ? terms.map((x) => `<code>${x.partial ? '≈ ' : ''}${escapeHtml(x.term)}</code>`).join('<br>')
    : `<span class="muted">${escapeHtml(t('how.xwalk.none'))}</span>`);
  const head = `<thead><tr><th>${escapeHtml(t('how.th.req'))}</th>${LEVELS.map((l) =>
    `<th class="c">${escapeHtml(t(`level.${l}`))}</th>`).join('')}${Object.values(SOURCES).map((s) =>
    `<th class="src">${escapeHtml(s.name)} ${escapeHtml(s.version)}</th>`).join('')}<th>${escapeHtml(t('how.th.checks'))}</th></tr></thead>`;
  const rows = REQUIREMENTS.map((r) => {
    const checks = CHECK_IDS[r.id].map((id) => t(`chk.${id}`)).join(', ') || t('how.none');
    return `<tr><td><b>${escapeHtml(t(`req.${r.id}.title`))}</b><br><span class="muted">${escapeHtml(t(`focus.${r.focus}`))}</span></td>${LEVELS.map((l) =>
      `<td class="c">${r.levels.includes(l) ? '✕' : ''}</td>`).join('')}${Object.keys(SOURCES).map((k) =>
      `<td class="xw">${cell(CROSSWALK[r.id][k])}</td>`).join('')}<td>${escapeHtml(checks)}</td></tr>`;
  }).join('');
  $('req-table').innerHTML = head + `<tbody>${rows}</tbody>`;
}

// ── start ─────────────────────────────────────────────────────────────────────

function init() {
  initLang();
  initTheme();
  fillMeta();

  document.querySelector('.rail nav').addEventListener('click', (e) => {
    const next = e.target.closest('.nav-item')?.dataset.view;
    if (next) showView(next);
  });
  $('menu').addEventListener('click', () => ($('app').classList.contains('rail-open') ? closeRail() : openRail()));
  $('rail-backdrop').addEventListener('click', closeRail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRail(); });

  document.querySelector('[data-view="plan"] .panel').addEventListener('input', onMetaInput);
  $('levels').addEventListener('click', onLevelClick);
  $('reqs').addEventListener('input', onReqInput);
  $('reqs').addEventListener('change', onReqInput);
  $('dl-json').addEventListener('click', () => download('smp.json', planToJson(plan), 'application/json'));
  $('dl-md').addEventListener('click', () => download('SMP.md', planToMarkdown(plan, t), 'text/markdown'));
  $('import-file').addEventListener('change', onImport);
  $('new-plan').addEventListener('click', onNew);
  $('to-check').addEventListener('click', () => {
    document.querySelector('input[name="source"][value="editor"]').checked = true;
    const repo = parseRepo(plan.smp.software?.repository_url ?? '');
    if (repo && !$('repo').value) $('repo').value = `${repo.owner}/${repo.repo}`;
    showView('check');
  });
  $('check-form').addEventListener('submit', onCheck);
  $('dl-report').addEventListener('click', onDownloadReport);
  $('to-editor').addEventListener('click', onToEditor);

  const params = new URLSearchParams(location.search);
  if (params.get('repo')) $('repo').value = params.get('repo');
  applyI18n();
  showView(params.get('view') ?? 'plan', { push: false });
  if (view === 'check' && params.get('repo')) $('check-form').requestSubmit();
}

init();

