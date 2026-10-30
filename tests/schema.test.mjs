// The committed JSON Schema is what scripts/build-schema.mjs produces from the catalogue, and it
// agrees with plan.js about what a plan is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { schemaText } from '../scripts/build-schema.mjs';
import { REQUIREMENTS, LEVELS, STATUSES } from '../src/requirements.js';
import { SCHEMA_ID, SCHEMA_VERSION, parsePlan, validatePlan } from '../src/plan.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const schema = JSON.parse(read('../schema/smp.schema.json'));

test('the committed schema is exactly what the generator produces', () => {
  assert.equal(read('../schema/smp.schema.json'), schemaText(),
    'schema/smp.schema.json is stale or hand-edited: run node scripts/build-schema.mjs');
});

test('the schema names the same requirements, fields, levels and statuses as the code', () => {
  assert.equal(schema.$id, SCHEMA_ID);
  assert.equal(schema.properties.smp.properties.schema_version.const, SCHEMA_VERSION);
  assert.deepEqual(schema.properties.smp.properties.level.enum, [...LEVELS]);
  assert.deepEqual(schema.$defs.Status.enum, [...STATUSES]);
  const defs = schema.$defs.requirements;
  assert.deepEqual(Object.keys(defs), REQUIREMENTS.map((r) => r.id));
  for (const r of REQUIREMENTS)
    assert.deepEqual(Object.keys(defs[r.id].properties), ['status', 'answer', ...r.fields.map((f) => f.key)], r.id);
});

test('each level requires exactly its template', () => {
  for (const rule of schema.properties.smp.allOf) {
    const level = rule.if.properties.level.const;
    assert.deepEqual(rule.then.properties.requirements.required,
      REQUIREMENTS.filter((r) => r.levels.includes(level)).map((r) => r.id), level);
  }
});

test('the repository’s own smp.json is a valid plan', () => {
  const { plan, error } = parsePlan(read('../smp.json'));
  assert.equal(error, undefined);
  assert.deepEqual(validatePlan(plan), [],
    'smp.json has errors or unanswered questions');
});
