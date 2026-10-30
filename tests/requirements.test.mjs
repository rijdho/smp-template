// The catalogue against the guide. These numbers are the guide's, so a change here is a
// change of method and should be argued in the commit message, not just made.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FIELD_TYPES, FOCI, LEVELS, REQUIREMENTS, REQUIREMENT_IDS, requirementsFor } from '../src/requirements.js';
import { ENTRY_KEYS } from '../src/plan.js';

test('fourteen requirements, in the order of §5.1', () => {
  assert.deepEqual(REQUIREMENT_IDS, [
    'purpose', 'version_control', 'repository', 'user_documentation', 'licensing',
    'deployment_documentation', 'citation', 'developer_documentation', 'testing',
    'engineering_quality', 'packaging', 'maintenance', 'support', 'risk_analysis',
  ]);
});

test('the low level follows Table 1 and template 6.3.1, not Table 4', () => {
  // Table 4 would give ['purpose', 'version_control']. See the header of requirements.js.
  assert.deepEqual(requirementsFor('low').map((r) => r.id), [
    'purpose', 'version_control', 'user_documentation', 'licensing', 'deployment_documentation',
  ]);
});

test('the medium level is Table 2, the high level is all fourteen (Tables 3 and 4)', () => {
  assert.deepEqual(requirementsFor('medium').map((r) => r.id), [
    'purpose', 'version_control', 'repository', 'user_documentation', 'licensing',
    'deployment_documentation', 'citation', 'developer_documentation', 'testing',
    'engineering_quality', 'packaging', 'maintenance',
  ]);
  assert.deepEqual(requirementsFor('high').map((r) => r.id), REQUIREMENT_IDS);
});

test('the levels nest: each includes everything the level below it does', () => {
  for (let i = 1; i < LEVELS.length; i++) {
    const below = new Set(requirementsFor(LEVELS[i - 1]).map((r) => r.id));
    const here = new Set(requirementsFor(LEVELS[i]).map((r) => r.id));
    for (const id of below) assert.ok(here.has(id), `${LEVELS[i]} drops ${id}`);
  }
});

test('every field is well formed and cannot collide with the entry keys', () => {
  for (const r of REQUIREMENTS) {
    assert.ok(FOCI.includes(r.focus), `${r.id}: focus ${r.focus}`);
    for (const l of r.levels) assert.ok(LEVELS.includes(l), `${r.id}: level ${l}`);
    const keys = r.fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, `${r.id} declares a field twice`);
    for (const f of r.fields) {
      assert.ok(FIELD_TYPES.includes(f.type), `${r.id}.${f.key}: type ${f.type}`);
      assert.ok(!ENTRY_KEYS.includes(f.key), `${r.id}.${f.key} would shadow ${f.key} of the entry`);
      if (f.type === 'enum') assert.ok(f.options?.length >= 2, `${r.id}.${f.key} has no options`);
      else assert.equal(f.options, undefined, `${r.id}.${f.key} has options but is not an enum`);
    }
  }
});
