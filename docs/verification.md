# Verification status

This file records the observed verification of implementation commit `b8de2d648de58d19c3abe64357ec0ba0092027ce`, including the focused mobile comparison-table correction. Later documentation-only revisions do not change that verified application or test code.

## Local environment

- Node 24.19.0
- Shared TypeScript engine compiled with esbuild; strict TypeScript checking passed
- 939/939 Node tests passed in both UTC and Asia/Tokyo
- Full source formatting check and browser bundle build passed
- npm audit reported 0 known vulnerabilities in the pinned dependency tree on 2026-10-03 (a point-in-time package-advisory check, not a security guarantee)
- CLI synthetic acceptance: left `160→160→310`, 6 output rows; inner `160→130→280`, 5 output rows
- CLI/API parity, exact expectations, malformed arguments, invalid UTF-8, BOM digest, missing/oversized/directory/symlink/FIFO inputs, terminal-control escaping, and defensive formula encoding covered

## Independent oracle

Python stdlib SQLite materializes supported small joins; Python Decimal computes selected-measure sums independently of the grouped TypeScript algorithm. Seeded fixture generation is checked into source and tested for reproducibility. 832 generated cases passed, spanning 1–3 keys, left/inner joins, both blank policies, all four normalization modes, and exact signed decimals. The adversarial suite also includes 300 seeded CSV round trips and a 40,000 × 40,000 group counted as 1,600,000,000 output rows. Fixture regeneration passed `--check`. A separate reviewer additionally ran 1,000 direct-Cartesian arithmetic comparisons; those ad-hoc cases are supplemental review evidence, not part of the checked-in 939-test count.

## Browser verification and environment limit

The initial published commit `c47794706614026e21b8d8adee71c1ad5c4c8fa1` passed [GitHub CI run 37117292304](https://github.com/Masanori-Spec/join-impact/actions/runs/37117292304): all four Node 22/24 × UTC/Asia-Tokyo unit jobs passed 939 tests, and the sandbox-enabled Chromium job passed 36 browser scenarios. Its downloaded `results.json` reports zero failures and zero uncaught errors.

The downloaded desktop English and mobile Japanese/English screenshots were visually inspected. The desktop layout was coherent, and both 390-pixel mobile pages fit the viewport, but the comparison table's 420-pixel minimum width clipped the right-hand header inside its horizontal scroll container. The existing whole-page overflow check did not detect that inner-container defect.

The focused correction changes only mobile comparison-table wrapping and regression assertions: all three headers and cell contents must fit the visible comparison container without horizontal scrolling, in both languages and with long exact-decimal values. Corrected implementation commit `b8de2d648de58d19c3abe64357ec0ba0092027ce` passed [GitHub CI run 37117629971](https://github.com/Masanori-Spec/join-impact/actions/runs/37117629971): all four unit jobs passed 939 tests, and all 36 browser scenarios passed with zero uncaught errors, including the stronger inner-container checks.

The corrected desktop English and original-resolution 390-pixel mobile Japanese/English screenshots were independently inspected after download. Both mobile comparison tables now show all three complete headers and every sampled value without hidden columns; wrapping remains legible. The representative desktop layout is unchanged. This is a visual review of these three CI-captured states, not an exhaustive review of every possible input, device, or accessibility mode.

This cloud execution sandbox blocks the required local Chromium socket/localhost path. That restriction is not bypassed. No local real-browser execution is claimed. Screenshot inspection here uses downloaded CI artifacts, not a locally launched browser.

The GitHub browser job uses `ubuntu-22.04`, sandbox-enabled Chromium, and a localhost static server. The runner choice follows a prior project's observed Ubuntu 24 headless-shell startup failure before test execution and successful Ubuntu 22 execution; it is not a claim that Ubuntu 24 is universally incompatible. The `ubuntu-22.04` GitHub hosted runner is [scheduled for retirement on **2027-04-17**](https://github.com/actions/runner-images/issues/14254); migrate and revalidate before that date. The verified CI results above apply to their named commits. The screenshot review applies only to the representative artifact states described above; a saved screenshot alone is not evidence of manual review.

## Limits of evidence

Tests establish behavior within the documented bounded CSV/decimal/equijoin scope. They do not validate business grain, production customer datasets, paid demand, all spreadsheet importers, all browsers, accessibility conformance, or security certification.

## Observed cancellation controls

A local 40,000-row/side, distinct-key, trim-normalization audit was run with a 100 ms CLI limit: it exited 3 with no stdout and terminated the worker. The same workload received SIGINT during processing and exited 130 with no stdout. These were observed process-control checks, separate from the browser suite's deterministic mocked-worker interruption tests.
