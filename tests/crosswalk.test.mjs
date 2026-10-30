// The crosswalk against its sources. The property list and the question counts below were read
// from maSMP v2.1.0 and the ELIXIR SMP v1.0.0 paper on 2026-09-29; a term that is not in them
// is a term somebody remembered rather than read.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CROSSWALK, SOURCES } from '../src/crosswalk.js';
import { REQUIREMENT_IDS } from '../src/requirements.js';

/** Every property of the four maSMP v2.1.0 profiles (Software*Profile and SoftwareManagementPlanProfile). */
const MASMP_PROPERTIES = new Set(["alternateName", "archivedAt", "author", "buildInstructions", "changelog", "citation", "codeRepository", "codeSampleType", "conditionsOfAccess", "contributor", "copyrightHolder", "dateModified", "datePublished", "deployInstructions", "description", "developerDocumentation", "discussionUrl", "ethicalLegalSocial", "headline", "identifier", "input", "installInstructions", "installUrl", "intendedUse", "isAccessibleForFree", "issueTracker", "keywords", "learningResource", "license", "maintainer", "managedSoftware", "memoryRequirements", "name", "operatingSystem", "output", "processorRequirements", "programmingLanguage", "publisher", "questionnaire", "readme", "referencePublication", "relatedMngPlan", "releaseNotes", "researchProject", "result", "runtimePlatform", "sameAs", "softwareHelp", "softwareRequirements", "softwareTested", "softwareVersion", "storageRequirements", "target", "targetProduct", "testInput", "testInstructions", "testType", "testedWith", "url", "userDocumentation", "version", "versionControlSystem"]);

/** ELIXIR SMP v1.0.0: seven chapters, 21 questions. */
const ELIXIR = { Accessibility: 3, Documentation: 3, Testing: 2, Interoperability: 1, Versioning: 3, Reproducibility: 5, Recognition: 4 };

test('the ELIXIR chapters add up to the 21 questions ELIXIR states', () => {
  assert.equal(Object.values(ELIXIR).reduce((a, b) => a + b, 0), 21);
});

test('every requirement has a row, with a list for every source', () => {
  assert.deepEqual(Object.keys(CROSSWALK), REQUIREMENT_IDS);
  for (const [id, row] of Object.entries(CROSSWALK)) assert.deepEqual(Object.keys(row), Object.keys(SOURCES), id);
});

test('every maSMP term is a property of the v2.1.0 profiles', () => {
  for (const [id, row] of Object.entries(CROSSWALK))
    for (const { term } of row.masmp) assert.ok(MASMP_PROPERTIES.has(term), `${id}: ${term} is not a maSMP property`);
});

test('every ELIXIR reference names a real chapter and questions it has', () => {
  for (const [id, row] of Object.entries(CROSSWALK))
    for (const { term } of row.elixir) {
      const m = /^([A-Za-z]+) ([\d,–\s]+)(?: \(.+\))?$/.exec(term);
      assert.ok(m, `${id}: cannot read "${term}"`);
      const [, chapter, nums] = m;
      assert.ok(chapter in ELIXIR, `${id}: no ELIXIR chapter ${chapter}`);
      for (const part of nums.split(',')) {
        const [a, b = a] = part.trim().split('–').map(Number);
        assert.ok(a >= 1 && b <= ELIXIR[chapter] && a <= b, `${id}: ${chapter} has no question ${part.trim()}`);
      }
    }
});
