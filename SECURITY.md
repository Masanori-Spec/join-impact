# Security and privacy

Join Impact is local analysis software, not a trusted-data or financial-decision boundary.

## Threat model and controls

- Untrusted CSV: strict parser, UTF-8 decoding, header/width/quote validation, NUL rejection, text-only keys, finite row/byte/cell limits
- Join explosion: count by key groups; never allocate Cartesian output
- Precision: bounded decimal syntax and BigInt arithmetic, no binary floating-point measure sums
- UI injection: DOM text sinks; no HTML rendering of CSV fields; local CSP forbids outbound connections, forms, objects, and frames
- Formula injection: no CSV/merged-data export. JSON/text preserve source strings for evidence. A defensive `formulaSafeCell` helper exists for downstream CSV use but is not a guarantee about every spreadsheet importer. Do not paste untrusted `=`, `+`, `-`, or `@` values into a spreadsheet as formulas
- Terminal controls: the CLI JSON-escapes source labels and keys. Text reports do not print raw untrusted ANSI sequences
- Resource exhaustion: 4 MiB and 40,000 rows per file, column/cell limits, bounded report and samples. CLI worker memory and wall-time limits; UI Worker cancellation. This is bounded in-memory analysis, not an unbounded streaming service
- Filesystem: CLI reads regular nonsymlink files, verifies opened-file type, uses bounded reads, and emits reports to stdout. The preview server exposes only bundled `dist/` assets on 127.0.0.1. Do not expose that server publicly

## Sensitive evidence

Input contents are not sent to a backend. The browser fetches the local static app/Worker assets; analysis has no network requests or telemetry. Installation and browser setup do require development-package downloads.

Reports contain selected source keys, amounts, headers, input hashes, and source record/line numbers. They may contain personal or business information. Saving, sharing, or uploading a report is your decision. The tool does not redact, encrypt, persist accounts, or manage report access. Close the tab to discard in-memory inputs; downloaded files remain wherever you save them.

No real accounts, customer data, credentials, university systems, or patent material are included in the synthetic fixtures.

## Reporting issues

Please avoid public issues containing private CSV data. Submit a minimal synthetic reproducer, version, Node/browser version, selected policies, and expected/observed result. No private support inbox or guaranteed response time is offered in this portfolio release.
