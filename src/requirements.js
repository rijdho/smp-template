// The fourteen core requirements of the Practical guide to Software Management Plans
// (Martinez-Ortiz et al. 2023, v1.1, https://doi.org/10.5281/zenodo.7038280, CC BY 4.0),
// and which of them each management level asks for.
//
// This file is the single source of truth. The JSON Schema in schema/ is GENERATED from it
// (scripts/build-schema.mjs), the form on the page is built from it, and the checks in
// evidence.js read the fields it declares. tests/schema.test.mjs fails if the committed
// schema and this file disagree.
//
// Two places where the guide contradicts itself, and what this file does about them:
//
//  1. The low level. Table 4 (§6.1.4) marks only Purpose and Version control, while Table 1
//     (§6.1.1) and the sample template (§6.3.1) both ask about user documentation,
//     deployment documentation and licensing as well. Two of the three places agree, and
//     the template is the part a researcher actually fills in, so low follows Table 1.
//  2. Table 3 (§6.1.3) prints the support question in the Maintenance row and the
//     maintenance question in the Support row. Table 2 and the high template (§6.3.3)
//     pair them the other way round, which is also what the words mean, so each question
//     stays with the requirement it asks about.
//
// Both were checked against the rendered pages, not only the extracted text.

export const GUIDE = Object.freeze({
  title: 'Practical guide to Software Management Plans',
  version: '1.1',
  conceptDoi: '10.5281/zenodo.7038280',
  versionDoi: '10.5281/zenodo.7589725',
  license: 'CC-BY-4.0',
});

export const LEVELS = Object.freeze(['low', 'medium', 'high']);

/** Where a requirement's work happens, per Figure 1 of the guide. */
export const FOCI = Object.freeze(['engineering', 'documentation', 'project']);

/**
 * Field types. Each maps to one rule in plan.js and one JSON Schema fragment in
 * build-schema.mjs, so a new type needs both.
 */
export const FIELD_TYPES = Object.freeze(['text', 'url', 'path', 'spdx', 'doi', 'bool', 'date', 'enum']);

const f = (key, type, extra = {}) => Object.freeze({ key, type, ...extra });

/**
 * The requirements, in the guide's order (§5.1). `levels` is the set of management levels
 * whose template includes the requirement. `fields` are the machine-readable commitments a
 * plan can make about it, beyond the free-text answer every requirement carries.
 */
export const REQUIREMENTS = Object.freeze([
  {
    id: 'purpose', section: '5.1', focus: 'project', levels: ['low', 'medium', 'high'],
    fields: [f('audience', 'text')],
  },
  {
    id: 'version_control', section: '5.1', focus: 'engineering', levels: ['low', 'medium', 'high'],
    fields: [
      f('system', 'enum', { options: ['git', 'mercurial', 'subversion', 'other'] }),
      f('url', 'url'),
    ],
  },
  {
    id: 'repository', section: '5.1', focus: 'project', levels: ['medium', 'high'],
    fields: [
      f('archive', 'enum', { options: ['zenodo', 'software_heritage', 'figshare', 'institutional', 'other', 'none'] }),
      f('doi', 'doi'),
    ],
  },
  {
    id: 'user_documentation', section: '5.1', focus: 'documentation', levels: ['low', 'medium', 'high'],
    fields: [f('path', 'path', { default: 'README.md' }), f('url', 'url')],
  },
  {
    id: 'licensing', section: '5.1', focus: 'project', levels: ['low', 'medium', 'high'],
    fields: [f('spdx', 'spdx'), f('dependency_check', 'text')],
  },
  {
    id: 'deployment_documentation', section: '5.1', focus: 'documentation', levels: ['low', 'medium', 'high'],
    fields: [f('path', 'path', { default: 'README.md' })],
  },
  {
    id: 'citation', section: '5.1', focus: 'project', levels: ['medium', 'high'],
    fields: [f('cff', 'path', { default: 'CITATION.cff' }), f('doi', 'doi')],
  },
  {
    id: 'developer_documentation', section: '5.1', focus: 'documentation', levels: ['medium', 'high'],
    fields: [f('contributing', 'path', { default: 'CONTRIBUTING.md' }), f('code_of_conduct', 'path')],
  },
  {
    id: 'testing', section: '5.1', focus: 'engineering', levels: ['medium', 'high'],
    fields: [f('path', 'path'), f('automated', 'bool'), f('results_url', 'url')],
  },
  {
    id: 'engineering_quality', section: '5.1', focus: 'engineering', levels: ['medium', 'high'],
    fields: [
      f('checklist', 'enum', { options: ['none', 'openssf_best_practices', 'other'] }),
      f('linter_config', 'path'),
    ],
  },
  {
    id: 'packaging', section: '5.1', focus: 'engineering', levels: ['medium', 'high'],
    fields: [
      f('registry', 'enum', { options: ['npm', 'pypi', 'cran', 'conda', 'crates', 'maven', 'container', 'none', 'other'] }),
      f('package_name', 'text'),
      f('manifest', 'path'),
    ],
  },
  {
    id: 'maintenance', section: '5.1', focus: 'project', levels: ['medium', 'high'],
    fields: [f('until', 'date'), f('retirement', 'text')],
  },
  {
    id: 'support', section: '5.1', focus: 'project', levels: ['high'],
    fields: [f('channel', 'url')],
  },
  {
    id: 'risk_analysis', section: '5.1', focus: 'project', levels: ['high'],
    fields: [f('security_policy', 'path', { default: 'SECURITY.md' })],
  },
].map((r) => Object.freeze({ ...r, levels: Object.freeze(r.levels), fields: Object.freeze(r.fields) })));

export const REQUIREMENT_IDS = Object.freeze(REQUIREMENTS.map((r) => r.id));

export const byId = (id) => REQUIREMENTS.find((r) => r.id === id) ?? null;

/** The requirements a level's template includes, in the guide's order. */
export const requirementsFor = (level) => REQUIREMENTS.filter((r) => r.levels.includes(level));

/**
 * How a plan describes the state of each requirement. This is the part that makes a plan
 * actionable rather than descriptive: a commitment marked `in_place` is a claim the checker
 * holds the repository to, `planned` is a claim it reports on without failing, and
 * `not_applicable` must say why.
 */
export const STATUSES = Object.freeze(['planned', 'in_place', 'not_applicable']);
