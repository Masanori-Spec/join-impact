# Join Impact

**CSVを結合する前に、「合計がなぜ変わるか」を確かめる。**

A local CSV join audit that explains an exact selected-measure total:

**original → retained once → joined**, with dropped contributions, extra replication, source-record witnesses, and normalization collisions.

This is an audit workbench, not a CSV merger. It never builds the Cartesian result. A 10,000 × 10,000 matching group is reported as **100,000,000 output rows** without creating those rows.

## What it answers / できること

- Which left records would disappear in an inner join?
- Which lookup duplicates repeat the selected amount, and by how much?
- Can positive and negative amounts hide a multiplicity problem?
- Does trimming or NFC normalization create collisions or change the total?
- Does this CSV pair satisfy a reproducible many-to-one / unmatched / expansion contract?

日本語・英語UI、ローカル処理、Node CLI、同一のTypeScript計算エンジン。整数化した `BigInt` で小数を正確に計算します。金額の通貨や業務上の正しい粒度を推測しません。

## Quick start

Requires Node 22 or 24 and npm. Installation/build downloads development packages; the finished UI processes data locally with no backend, telemetry, or runtime CDN.

```sh
npm ci --ignore-scripts
npm run build
npm run serve
```

Open **http://127.0.0.1:4173**. Keep the tab open during analysis. Use a current browser with BigInt, module Workers, and Web Crypto. Serve the files over localhost or HTTPS; opening `index.html` directly is unsupported. The server listens only on loopback and serves `dist/`.

The UI has synthetic sample data, a language switch, paired CSV/text inputs, 1–3 key mappings, explicit blank behavior, a selected left measure, join/normalization policies, cancellation, and a JSON report download. Inputs and settings invalidate prior results. No customer data or accounts are included.

## A concrete audit

```sh
node src/cli.js \
  --left fixtures/orders.csv --right fixtures/customers.csv \
  --left-key customer --right-key customer --measure amount \
  --join inner --format text
```

The four input amounts are `100`, `50`, `-20`, `30`; right key `001` occurs twice and `003` is absent.

| Plan | Original | Retained once | Joined | Dropped | Replicated | Output rows |
|---|---:|---:|---:|---:|---:|---:|
| Left | 160 | 160 | 310 | 0 | 150 | 6 |
| Inner | 160 | 130 | 280 | 30 | 150 | 5 |

`joined − original = replicated − dropped`. “Dropped” and “replicated” are **signed contributions**, not always loss or inflation. A duplicated `+100` and `−100` still sum to zero; affected-row counts and absolute contributions reveal the change.

## CLI contracts

```sh
node src/cli.js \
  --left fixtures/orders.csv --right fixtures/customers.csv \
  --left-key customer --right-key customer --measure amount \
  --expect-many-to-one --max-unmatched 0 --max-expansion 1
```

This example intentionally exits **1** and prints a valid failed-audit report. The synthetic lookup is duplicated and one left key is unmatched.

- Repeat `--left-key` / `--right-key` for compound keys. Correspondence is positional. Use `--option=value` for names beginning with `--`
- `--join left|inner`; `--blank never|match`; `--normalize exact|trim|nfc|trim-nfc`
- `--left-delimiter comma|tab|semicolon` and the corresponding right flag
- `--format json|text`, default JSON; redirect stdout to save a report
- `--max-expansion` is a canonical nonnegative decimal such as `1` or `1.5`, not `1.00`, `+1`, or exponential notation
- `--timeout-ms 100..60000`, default 20000; SIGINT/SIGTERM stop the audit worker
- `--help` documents every flag. No merged-data export

Exit codes: **0** successful audit; **1** expectation failure; **2** rejected file/input/options; **3** worker/runtime/timeout error; **130** canceled. Diagnostic text goes to stderr. Files must be regular, nonsymlink UTF-8 files. Inputs are bounded even if a file grows while being read.

Many-to-one checks all **matchable right-side key groups**, including groups absent from the left. `max-unmatched` counts left records with zero eligible right matches even in a left join. Expansion means output rows divided by input left rows; zero-left input satisfies every nonnegative bound. These are structural checks, not proof of correct business joins.

## Supported data and deliberate limits

- UTF-8 CSV, optional initial BOM, comma/tab/semicolon; quoted delimiters, escaped quotes, multiline fields, LF/CRLF/bare CR
- Header names are case-sensitive text. Duplicate/empty headers, ragged rows, malformed quotes, NUL, and invalid UTF-8 are rejected
- Keys remain text: `001` differs from `1`; `NULL` and `null` are literal strings
- Default blanks never match. Optional `match` permits them. A blank key has any empty component **after** normalization
- One left-side measure. Optional sign, up to 30 integer digits and 12 fractional digits; no currency, whitespace, comma grouping, exponent, NaN, or Infinity
- Blank/invalid measures are **excluded with visible counts**; their records still affect row counts. No implicit zeros or locale inference
- Trim uses JavaScript Unicode whitespace; NFC uses Unicode canonical composition. Case remains significant. Normalization is compared with exact matching; no automatic recommendation
- 4 MiB/file, 40,000 rows/file, 64 columns, 16,384 UTF-16 units/cell, 128/header. Unsupported input is rejected, never partially audited
- Witnesses are bounded: 30 groups, 5 source records/side, 8 pairs/group; 20 collision groups, 5 raw forms/group. Truncation is explicit. JSON output is capped at 1 MiB

Each CSV data record is assumed to be one fact. The tool cannot discover business grain, decide whether duplicates are legitimate, or prove a join is semantically correct. No SQL NULL inference, outer/right/as-of/fuzzy joins, measure expressions, database connectors, or automatic repair.

## Privacy and safety

The static app uses a dedicated Worker, bundled assets, no third-party scripts, and a Content Security Policy that blocks connections. Cancel terminates the Worker. File reads and worker responses have generation checks so replaced inputs cannot reintroduce an older report.

Reports contain selected keys, sampled amounts, source record numbers, headers, and input hashes. **Treat exported reports as potentially sensitive.** Export is JSON or plain text; never import untrusted formula-like values into a spreadsheet without proper sanitization. User strings are rendered as text, never HTML. See [SECURITY.md](SECURITY.md).

## Verification and design evidence

```sh
npm run check
python3 scripts/generate-oracle.py --check
npm run test:browser   # requires Playwright Chromium and the local server
```

- 939 Node tests, including 832 independent SQLite materialized joins / Python Decimal cases, compound keys, and normalization
- Adversarial parser, exact-arithmetic, count, collision, witness, CLI, and resource tests
- 36-scenario real-browser suite for UI/core parity, interruption, stale responses, replacement/swap, language, keyboard/mobile, and runtime network checks (execution status is tracked separately below)
- CI uses Node 22/24 × UTC/Asia-Tokyo plus a sandbox-enabled Chromium job

See [verification status](docs/verification.md) for **passed vs pending** gates and runner constraints. [Semantics](docs/semantics.md) explains the formula. [Positioning](docs/positioning.md) describes existing alternatives and the narrow workflow difference. [API contract](docs/api-contract.md) documents the shared engine.

## Why this scope

pandas, DuckDB, csvkit, BI engines, and visual data tools already cover much of joining and validation. Join Impact packages a specific explanation and repeatable CI contract: **exact measure decomposition + bounded original-record witnesses + side-by-side normalization effects**, without SQL or materializing the full join. This is a workflow choice, not a novelty, patent, paid-demand, or superiority claim.

## License

No project license has been selected. Public visibility does not itself grant an open-source license. Dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
