// What each of the guide's requirements is called in two other published SMP vocabularies.
//
// Every term below was read from the source it cites on 2026-09-29, not recalled:
//
//   maSMP   the maSMP profiles v2.1.0 (ZB MED), properties of SoftwareSourceCodeProfile,
//           SoftwareApplicationProfile, SoftwareTestActionProfile and
//           SoftwareManagementPlanProfile. https://github.com/zbmed-semtec/maSMPs
//           somef2smp (OEG-UPM) writes these same properties, so this column covers it too.
//   ELIXIR  the ELIXIR Software Management Plan v1.0.0 (2021-10-25): 21 questions in seven
//           chapters, numbered as in the ELIXIR SMP paper. https://github.com/elixir-europe/smp
//
// `partial: true` marks a term that overlaps the requirement without meaning the same thing.
// The clearest case is schema.org `citation`, which is the works a creative work cites, not how
// to cite it; somef2smp nonetheless maps a repository's citation information onto it.
// An empty list means the vocabulary has nothing for the requirement. The eScience Center's SMP
// Tool and MAUS are not mapped: their question sets were not checked item by item.

export const SOURCES = Object.freeze({
  masmp: { name: 'maSMP', version: '2.1.0', url: 'https://github.com/zbmed-semtec/maSMPs' },
  elixir: { name: 'ELIXIR SMP', version: '1.0.0', url: 'https://github.com/elixir-europe/smp' },
});

const t = (term, partial = false) => Object.freeze(partial ? { term, partial } : { term });

export const CROSSWALK = Object.freeze({
  purpose: {
    masmp: [t('intendedUse')],
    elixir: [t('Documentation 2')],
  },
  version_control: {
    masmp: [t('versionControlSystem'), t('codeRepository')],
    elixir: [t('Versioning 1–3')],
  },
  repository: {
    masmp: [t('archivedAt'), t('identifier')],
    elixir: [t('Accessibility 1'), t('Reproducibility 1'), t('Recognition 2')],
  },
  user_documentation: {
    masmp: [t('userDocumentation'), t('readme')],
    elixir: [t('Documentation 1, 3')],
  },
  licensing: {
    masmp: [t('license')],
    elixir: [t('Accessibility 2–3')],
  },
  deployment_documentation: {
    masmp: [t('installInstructions'), t('deployInstructions'), t('buildInstructions'), t('softwareRequirements')],
    elixir: [t('Documentation 3'), t('Reproducibility 2–3')],
  },
  citation: {
    masmp: [t('citation', true), t('referencePublication', true)],
    elixir: [t('Recognition 1, 3')],
  },
  developer_documentation: {
    masmp: [t('developerDocumentation')],
    elixir: [t('Documentation 1')],
  },
  testing: {
    masmp: [t('testedWith'), t('testInstructions')],
    elixir: [t('Testing 1–2')],
  },
  engineering_quality: {
    masmp: [],
    elixir: [t('Testing 1 (linting)', true)],
  },
  packaging: {
    masmp: [t('installUrl', true)],
    elixir: [t('Recognition 4', true)],
  },
  maintenance: {
    masmp: [t('maintainer', true)],
    elixir: [],
  },
  support: {
    masmp: [t('issueTracker', true), t('softwareHelp', true)],
    elixir: [t('Reproducibility 5')],
  },
  risk_analysis: {
    masmp: [t('ethicalLegalSocial', true)],
    elixir: [],
  },
});
