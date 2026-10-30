# Actionable SMP

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23797138.svg)](https://doi.org/10.5281/zenodo.23797138)

**Write a Software Management Plan as a file the software carries, and check what the plan
promises against what the repository actually shows.**

The questions, requirements and management levels are those of the *Practical guide to Software
Management Plans* (Martinez-Ortiz et al., 2023). The answers become `smp.json`, a
machine-readable plan whose envelope follows the RDA DMP Common Standard. A checker then reads
the repository: every commitment the plan marks as *in place* (a licence, a CI configuration that mentions tests,
a citation file with the archived DOI) has to be visible there, and the build fails when it is
not. Writing a plan touches no network at all; checking one in the browser talks only to GitHub.

For research software engineers, data stewards and funders who want a management plan that can
be checked against the software it describes.

🔗 **Live:** https://rijdho.github.io/smp-template/

For use without a connection, [`demo.html`](demo.html) is the whole page in one file: download it
(**Download raw file** on GitHub) and open it in a browser. No server needed.

Available in **English and Spanish** (auto-detected from the browser, switchable).

## What it does

- **Write the plan.** Pick a management level (low, medium, high), answer the guide's questions
  for it, and add checkable commitments: the SPDX licence, the citation file, the test
  directory, the package registry and so on. Each requirement is *planned*, *in place* or *not
  applicable*. Download the result as `smp.json` for the repository and as `SMP.md` for people.
- **Check a repository.** Give it a public GitHub repository and it reads the `smp.json` at the
  root, or the plan being written, and looks for every commitment in the repository's files.
  Each file it found links to GitHub; the result downloads as a Markdown report (the same one
  CI writes), and a plan read from a repository can be opened in the editor.
- **Check in CI.** The same checker runs from the command line against a local checkout, and as
  a GitHub Action that fails the build when an in-place commitment is missing.

The number it reports first is the distance between two levels: how many of the guide's
questions the plan *answers*, and how many of its requirements the repository *evidences*.

## The method

### Requirements and levels

Fourteen requirements from §5.1 of the guide, grouped into the three templates of §6:

| Level | Requirements | For software that |
|---|---|---|
| Low | 5: purpose, version control, user documentation, licensing, deployment documentation | serves one analysis or a one-off project |
| Medium | 12: the above plus repository, citation, developer documentation, testing, engineering quality, packaging, maintenance | is a project's output and outlives it |
| High | 14: the above plus support and risk analysis | others depend on in production |

The guide contradicts itself in two places, and the choices made here are pinned by tests:

- **Table 4 gives the low level only purpose and version control**; Table 1 and the low-level
  template (§6.3.1) both add user documentation, deployment documentation and licensing. This
  tool follows Table 1 and the template, which is what a researcher actually fills in.
- **Table 3 swaps two questions**: the support question is printed against Maintenance and the
  maintenance question against Support. Here each question stays with the requirement it asks
  about, as in Table 2 and the high-level template.

### Status and verdicts

A plan is allowed to be ahead of its software. *In place* is a claim: the checker fails when the
repository does not show it. *Planned* runs the same checks and reports them as pending without
failing. *Not applicable* needs a reason in the answer. The one finding a planned requirement
cannot soften is a maintenance period that has already ended.

Per requirement the checker reports one verdict: *evidenced*, *missing*, *pending*, *declared
only* (the plan answers it, but nothing in a repository could confirm it, as with purpose and
support), *unanswered* or *not applicable*.

### The file

`smp.json` is validated by [`schema/smp.schema.json`](schema/smp.schema.json) (JSON Schema
2020-12), which is **generated** from `src/requirements.js`, the same catalogue the page and the
checker use; a test fails if the two drift. The envelope follows the
[RDA DMP Common Standard](https://github.com/RDA-DMP-Common/RDA-DMP-Common-Standard) v1.2: one
top-level object (`smp` as maDMP has `dmp`), snake_case keys, ISO 8601 `created` and
`modified`, an ISO 639-3 `language`, and a `contact` with a typed `contact_id`. It departs from
maDMP in one place: the contact's e-mail is optional, because the plan lives in a public
repository. This repository's own plan is [`smp.json`](smp.json), and CI checks it.

### Architecture

```
src/requirements.js   the catalogue: requirements, levels, checkable fields (single source of truth)
src/plan.js           create, validate, change level, write smp.json and SMP.md
src/evidence.js       the checks, against any "repository view"
src/github.js         a repository view over the GitHub API (the page)
src/report.js         the result as text or Markdown, shared by the CLI and the page
src/crosswalk.js      the requirements in maSMP and ELIXIR SMP terms
bin/local-view.mjs    a repository view over a local git checkout (tracked files only)
bin/smp-check.mjs     the command-line checker; action.yml wraps it
src/app.js            the page: moves values between the DOM and the modules above, nothing more
```

No build step, no runtime dependency. The page is `index.html` plus ES modules served as they
are; every relative import carries the same `?v=N`, and `tests/assets.lock.json` fails the suite
when a served file changes without the number moving.

### Related work

[maSMP](https://github.com/zbmed-semtec/maSMPs) (ZB MED) extends the RDA DMP ontology to
software management plans; [MAUS](https://github.com/MPDL/MAUS) (Max Planck Digital Library)
builds plans in RDMO and exports them to GitHub; the Netherlands eScience Center's
[SMP Tool](https://doi.org/10.5281/zenodo.18183231) and the
[ELIXIR Software Management Plan](https://github.com/elixir-europe/smp) guide authors through
the questions; [somef2smp](https://github.com/oeg-upm/somef2smp) (OEG-UPM) turns the metadata
SOMEF extracts from a repository into a plan. This tool works in the other direction: it holds
the plan to the repository.

The How it works view carries a crosswalk, [`src/crosswalk.js`](src/crosswalk.js): for each of
the fourteen requirements, the matching properties of the maSMP v2.1.0 profiles (which
somef2smp also writes) and the matching questions of the ELIXIR SMP v1.0.0. Terms that overlap
without meaning the same are marked as partial; schema.org `citation`, for instance, lists what
a work cites, not how to cite it. `tests/crosswalk.test.mjs` checks every term against the
property list and question counts read from both sources. The SMP Tool and MAUS are not
mapped, because their question sets were not checked item by item.

## Using the checker

```bash
node bin/smp-check.mjs [dir] [--plan smp.json] [--strict] [--format text|md|json] [--lang en|es]
```

Exit code 0 when every in-place commitment is visible and the plan is valid, 1 when one is not
(with `--strict`, planned ones count too), 2 for usage errors. Only tracked files count: a file
on disk that was never committed is not evidence of anything a reader can see. A tracked file
is read as it is in the working tree, so run the checker on a clean checkout.

As a GitHub Action:

```yaml
- uses: actions/checkout@v4
- uses: rijdho/smp-template@v0.1.0
  with:
    plan: smp.json     # default
    strict: false      # default
```

The report is also written to the run's summary page.

## The demo file

`demo.html` is generated by `scripts/build-demo.mjs` from `index.html` and its sources: the styles,
both fonts (as `data:` URLs), the theme bootstrap and every module are inlined, each module in
its own scope. It keeps the page's Content-Security-Policy as strict as it was: the inline
script and style are allowed by their SHA-256 hashes, not by `'unsafe-inline'`, so a copy
edited by hand stops running rather than running something else. `tests/demo.test.mjs` fails
when the committed file is not what the build produces.

## Tests

```bash
node --test tests/*.test.mjs
```

Dependency-free, on Node's built-in runner. Three layers: the method (requirements per level,
validation rules, and every check against repositories held in memory, with exact expected
outcomes), the checker end to end on temporary git checkouts, and the page's guards (the CSP,
cache-busting, the house style copy, and parity of the English and Spanish catalogues including
every key the page builds at runtime). `tests/schema.test.mjs` fails when the committed schema
is not what the generator produces.

## Run locally

Node 20 or later and git, for the tests and the checker; nothing is installed.

```bash
python3 -m http.server 8000     # any static server; then open http://localhost:8000
node scripts/build-demo.mjs      # regenerate demo.html after changing any served file
node scripts/build-schema.mjs    # after changing src/requirements.js
node scripts/sync-house.mjs      # after the house style changes
```

## Caveats

- **Evidence is presence, not quality.** A test directory shows there are tests, not that they
  test anything. The checker stops a plan from claiming what is not there; it cannot say that
  what is there is good.
- **Several checks are heuristics, with arbitrary thresholds stated so they can be argued
  with**: user documentation needs 300 characters of prose in the README; installation
  documentation needs a heading such as Installation or Usage; licences are recognised from the
  text of about a dozen common licences, and a licence the text cannot tell apart (`-only` from
  `-or-later`) is compared by family.
- **Some requirements cannot be checked from a repository.** Purpose, support, and the text of a
  maintenance or risk plan are reported as *declared only*, never counted as passed.
- **Some common layouts are not recognised yet.** A licence split into `LICENSE-MIT` and
  `LICENSE-APACHE`, or kept in a REUSE `LICENSES/` folder, is not found; a directory given as the
  documentation path is not read; installation headings are recognised in Markdown only.
- **Nothing outside the repository is fetched.** A DOI, a documentation site or a registry entry
  counts when the repository mentions it; none is resolved.
- **The page checks public GitHub repositories only**, within GitHub's 60 unauthenticated API
  requests an hour (two per check). The command-line checker works on any local git checkout.
- **The Spanish questions are our translation** of the English guide, which remains the
  reference.

## License

Copyright 2026 Ricardo Hartley Belmar. The code is under [MIT](LICENSE); the schema and the texts are under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The guide's questions, requirements
and levels are used under CC BY 4.0 from Martinez-Ortiz et al. (2023),
<https://doi.org/10.5281/zenodo.7038280>. The code has been under MIT since 2026-10-20. Before
that, while the repository was private, it was under Apache-2.0, and copies taken then keep that
licence. [`NOTICE`](NOTICE) carries the
details.

## Citation

If you use this tool, please cite it: see [`CITATION.cff`](CITATION.cff) or the "Cite this
repository" button. Archived on Zenodo: concept DOI
<https://doi.org/10.5281/zenodo.23797138> (always resolves to the latest version).
