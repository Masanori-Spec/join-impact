# Verification status

This file distinguishes observed checks from pending checks. It will be updated when the release is frozen and when publication CI is verified.

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

## Browser gate and environment limit

The source includes 36 real Playwright Chromium scenarios, screenshot capture, and machine-readable results. The scenarios and screenshots are authored but not executed/generated locally. The UI worker and report-shape validator also passed syntax and real-engine integration checks; these do not replace browser execution. This cloud execution sandbox blocks the required local Chromium socket/localhost path. That restriction is not bypassed. Local real-browser execution and manual screenshot inspection are **not claimed**.

The GitHub browser job uses `ubuntu-22.04`, sandbox-enabled Chromium, and a localhost static server. The runner choice follows a prior project's observed Ubuntu 24 headless-shell startup failure before test execution and successful Ubuntu 22 execution; it is not a claim that Ubuntu 24 is universally incompatible. The `ubuntu-22.04` GitHub hosted runner is [scheduled for retirement on **2027-04-17**](https://github.com/actions/runner-images/issues/14254); migrate and revalidate before that date. An exact-commit CI pass is required before calling the browser suite verified. Screenshots saved by CI are evidence artifacts, not a manual visual review unless their pixels are actually inspected.

## Limits of evidence

Tests establish behavior within the documented bounded CSV/decimal/equijoin scope. They do not validate business grain, production customer datasets, paid demand, all spreadsheet importers, all browsers, accessibility conformance, or security certification.

## Observed cancellation controls

A local 40,000-row/side, distinct-key, trim-normalization audit was run with a 100 ms CLI limit: it exited 3 with no stdout and terminated the worker. The same workload received SIGINT during processing and exited 130 with no stdout. These were observed process-control checks, separate from the browser suite's deterministic mocked-worker interruption tests.
