# Browser verification

Build, serve locally, and run:

```sh
npm run build
npm run serve
# In another shell:
npm run test:browser
```

The Playwright runner uses Chromium with `chromiumSandbox: true`. Install the pinned browser through the normal CI dependency setup; there is no fallback that disables browser sandboxing or changes OS security settings. `BASE_URL` defaults to `http://127.0.0.1:4173`; `CHROMIUM_PATH` can select an installed Chromium. `BROWSER_ARTIFACT_DIR` defaults to `tests/browser/artifacts`.

Coverage includes actual engine/UI/JSON equality; exact totals across left/inner, blank-key, three-column composite keys and multiple delimiters; signed cancellation and absolute impact; Unicode cleanup collisions; physical lines versus record numbers; malformed CSV and invalid measures; file byte limits, fatal UTF-8 decoding, preserved BOM hashes, concurrent file races; changes and swapping that invalidate reports; cancellation, repeated starts and captured late callbacks after termination; worker construction, postMessage, engine, message, malformed-response and nested-shape errors; hostile HTML/formula text; same-origin-only asset traffic and a no-connect CSP; bounded evidence disclosures; keyboard access; mobile overflow and targets in both languages.

Successful representative runs save `desktop-report-en.png`, `mobile-report-ja.png`, and `mobile-report-en.png`. Failures save diagnostic screenshots. `results.json` contains machine-readable outcomes, including launch failures with `testsRun: 0` and `status: "blocked"`. A blocked launch is not a test pass.

Local browser execution is blocked in the authoring environment. These tests are intended for the authorized standard Ubuntu 22.04 CI runner with sandboxing enabled. Do not use alternate browser launch flags or socket routes to evade that restriction.
