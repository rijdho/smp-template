// Generate schema/smp.schema.json from src/requirements.js.
//
// The schema is for everyone who does not run this code: an editor that validates smp.json as
// it is typed, another tool that reads plans, a reviewer. It is generated rather than written
// so it cannot drift from the catalogue the page and the checker use; tests/schema.test.mjs
// fails when the committed file differs from what this script produces.
//
//   node scripts/build-schema.mjs          write schema/smp.schema.json
//   node scripts/build-schema.mjs --stdout print it instead

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LEVELS, REQUIREMENTS, STATUSES } from '../src/requirements.js';
import { SCHEMA_ID, SCHEMA_VERSION } from '../src/plan.js';

const TYPE = {
  text: () => ({ type: 'string' }),
  url: () => ({ type: 'string', format: 'uri', pattern: '^https?://' }),
  path: () => ({ type: 'string', pattern: '^(?!/)(?!.*(^|/)\\.\\.(/|$))(?!.*//)[^\\\\]+$' }),
  spdx: () => ({ type: 'string', description: 'SPDX licence identifier or expression, e.g. Apache-2.0' }),
  doi: () => ({ type: 'string', pattern: '^(https?://(dx\\.)?doi\\.org/|doi:\\s*)?10\\.\\d{4,9}/\\S+$' }),
  bool: () => ({ type: 'boolean' }),
  date: () => ({ type: 'string', format: 'date' }),
  enum: (fd) => ({ type: 'string', enum: [...fd.options] }),
};

const typedId = (examples) => ({
  type: 'object',
  required: ['identifier', 'type'],
  properties: { identifier: { type: 'string' }, type: { type: 'string', examples } },
});

export function buildSchema() {
  const requirementDefs = {};
  for (const r of REQUIREMENTS) {
    const properties = {
      status: { $ref: '#/$defs/Status' },
      answer: { type: 'string', description: 'The answer to the guide’s question for this requirement.' },
    };
    for (const fd of r.fields) {
      properties[fd.key] = { ...TYPE[fd.type](fd), ...(fd.default ? { default: fd.default } : {}) };
    }
    requirementDefs[r.id] = {
      type: 'object',
      description: `Guide requirement "${r.id}" (§${r.section}); in the ${r.levels.join(', ')} template(s).`,
      required: ['status'],
      additionalProperties: false,
      properties,
    };
  }

  // Each level requires the requirements its template includes; the property set is the same.
  const levelRules = LEVELS.map((level) => ({
    if: { type: 'object', properties: { level: { const: level } }, required: ['level'] },
    then: {
      type: 'object',
      properties: {
        requirements: { type: 'object', required: REQUIREMENTS.filter((r) => r.levels.includes(level)).map((r) => r.id) },
      },
    },
  }));

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCHEMA_ID,
    title: 'Actionable Software Management Plan',
    description:
      `smp.json, schema version ${SCHEMA_VERSION}. Requirements and levels from the Practical guide to Software ` +
      'Management Plans (https://doi.org/10.5281/zenodo.7038280); envelope after the RDA DMP Common Standard. ' +
      'Generated from src/requirements.js; do not edit by hand. CC BY 4.0.',
    type: 'object',
    required: ['smp'],
    properties: {
      $schema: { type: 'string' },
      smp: {
        type: 'object',
        required: ['schema_version', 'title', 'created', 'modified', 'language', 'level', 'contact', 'software', 'requirements'],
        properties: {
          schema_version: { type: 'string', const: SCHEMA_VERSION },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          smp_id: typedId(['doi', 'handle', 'ark', 'url']),
          created: { type: 'string', format: 'date-time' },
          modified: { type: 'string', format: 'date-time' },
          language: { type: 'string', pattern: '^[a-z]{3}$', description: 'ISO 639-3 code of the answers.' },
          level: { type: 'string', enum: [...LEVELS] },
          contact: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 1 },
              mbox: { type: 'string', format: 'email' },
              contact_id: typedId(['orcid', 'isni', 'openid']),
            },
          },
          software: {
            type: 'object',
            required: ['title'],
            properties: {
              title: { type: 'string', minLength: 1 },
              repository_url: TYPE.url(),
            },
          },
          guide: {
            type: 'object',
            properties: { title: { type: 'string' }, version: { type: 'string' }, doi: { type: 'string' } },
          },
          requirements: {
            type: 'object',
            additionalProperties: false,
            properties: Object.fromEntries(REQUIREMENTS.map((r) => [r.id, { $ref: `#/$defs/requirements/${r.id}` }])),
          },
        },
        allOf: levelRules,
      },
    },
    $defs: {
      Status: {
        type: 'string',
        enum: [...STATUSES],
        description: 'in_place: a claim the checker holds the repository to. planned: reported, never failed. not_applicable: say why in answer.',
      },
      requirements: requirementDefs,
    },
  };
}

export const schemaText = () => `${JSON.stringify(buildSchema(), null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--stdout')) process.stdout.write(schemaText());
  else {
    writeFileSync(fileURLToPath(new URL('../schema/smp.schema.json', import.meta.url)), schemaText());
    console.log('schema/smp.schema.json written');
  }
}
