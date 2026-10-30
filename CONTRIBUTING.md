# Contributing

Issues and pull requests are welcome. Contributions are accepted under the licences of the
repository: MIT for code and CC BY 4.0 for the schema and texts. Submitting a contribution
means it is offered under those same terms.

Before opening a pull request:

1. Run the tests: `node --test tests/*.test.mjs`. They need Node 20 or later and git, and nothing else.
2. If you changed `src/requirements.js`, regenerate the schema with `node scripts/build-schema.mjs`
   and say in the pull request how the method changed.
3. If you changed any file the page serves, bump `?v=N` in `index.html` and in every relative
   import, then run `node tests/assets-lock.mjs --write`.
4. Regenerate the single-file demo with `node scripts/build-demo.mjs`; the tests fail until you do.
5. Every string the interface shows exists in both `src/i18n/en.js` and `src/i18n/es.js`; the
   tests say which one is missing.

A new check belongs in `src/evidence.js`, with a test in `tests/evidence.test.mjs` that states
its expected outcome exactly, a name under `chk.` and its messages under `det.` in both locales,
and a line in the README's caveats if it rests on a heuristic.
