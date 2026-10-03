# Exact semantics

## Grain, eligibility, and multiplicity

Every left CSV data record is one fact. The chosen measure is attached to that record, even when duplicate left keys exist. No primary key is inferred.

For a left record `i`, let `n_i` be the number of eligible right records with an equal selected key tuple. Keys are encoded as structured tuples, not joined with a delimiter. Values such as `a|b` cannot collide with a different tuple. JavaScript Maps avoid prototype-key traps.

- Inner join multiplicity: `m_i = n_i`
- Left join multiplicity: `m_i = max(1, n_i)`
- Output rows: sum of `m_i`

The grouped algorithm indexes input keys and counts matches; it does not enumerate the joined dataset. Only bounded witness pairs are enumerated. Input rows and key indexes still consume memory within the documented resource budget. Sorting group explanations is O(G log G); it is not a streaming arbitrary-size engine.

## Decimal model

An accepted amount has optional `+`/`-`, integer part `0` or 1–30 digits with no leading zero, and an optional 1–12 digit fractional part. Input `1.00` is valid and represented exactly as `1`; `01`, `.5`, `1.`, ` 1`, `1e3`, and `$1` are invalid. Each value is scaled by 10^12 into a BigInt, so addition and multiplicity products are exact. Input length bounds do not restrict the larger exact sum/product. Negative zero outputs as `0`.

Blank and invalid amounts have no numeric contribution. They are counted separately; invalid examples are sampled. Their records continue to participate in row counts, witnesses, and expectations. A report with excluded measures must not be read as a complete sum of intended amounts.

For valid amount `a_i`:

- Original = sum of `a_i`
- Retained once = sum of `a_i` for `m_i > 0`
- Joined = sum of `a_i × m_i`
- Dropped = original − retained once
- Replicated = joined − retained once
- Net change = joined − original = replicated − dropped
- Absolute replicated = sum of `abs(a_i) × max(0, m_i − 1)`
- Absolute dropped = sum of `abs(a_i)` for `m_i = 0`

Positive and negative contributions can cancel, so neither zero net change nor zero signed replication proves an unchanged join. `multipliedLeftRows`, `droppedLeftRows`, absolute contributions, and source witnesses remain important.

## Blanks and normalization

CSV has no inherent database NULL type. `NULL`, `null`, and `NA` remain literal strings. A tuple is blank when **any** component is an empty string after the chosen normalization. `never` means blank tuples cannot match; `match` allows exact equality of blank-containing tuples.

Exact is the baseline. `trim` removes ECMAScript leading/trailing whitespace, `nfc` applies Unicode NFC, and `trim-nfc` applies trim followed by NFC. All plans remain case-sensitive. Normalization may turn spaces into blanks and can therefore reduce eligible matches under `never`. It can also collapse distinct IDs, so a larger match count is not a recommendation.

A collision is >1 distinct raw tuple on one side mapping to the same normalized tuple. Cross-side spelling differences alone are not a within-side collision. Blank collisions are included even when unmatchable. Witnesses group the selected normalized tuple; raw collision samples disclose original spellings.

## Witness interpretation

Causal witnesses cover groups with multiplied or dropped left rows, ranked by absolute replicated + absolute dropped contribution, then serialized-key order. A dropped inner group has `rightCount=0`, `outputRows=0`, and a sampled pair `{leftRecord, rightRecord:null}` representing the missing counterpart; it does not describe an output row. A left-join unmatched record is retained unchanged, so it is counted as unmatched but is not a changed-measure witness.

Record numbers include the header (`2` is the first data record). Physical start lines are separate because quoted fields can contain line breaks. Witnesses are samples, with explicit totals/truncation. Key display strings are capped at 160 UTF-16 units without splitting a surrogate pair; truncation is flagged. Full keys are retained for matching, never truncated before analysis. Invalid measure samples are capped at 12.

## Determinism and fingerprints

For identical input text and options, JSON property ordering, metrics, witnesses, and hashes are deterministic. There are no timestamps, filenames, locale-sensitive sorts, random IDs, or floating-point measure operations. Permuting source records preserves aggregate metrics, but appropriately changes record-number witnesses and raw-file SHA-256 digests.

SHA-256 covers original UTF-8 text, including the leading BOM and original line endings. The CLI rejects invalid UTF-8 instead of replacing bytes; browser file decoding has the same rule. `analyzeJoin` is synchronous and omits hashes; `auditJoin` is the public asynchronous API including hashes. Digests are reproducibility fingerprints, not signatures, redaction, or proof of authenticity.

## Expectations and errors

Many-to-one checks all matchable right groups, even if no left row uses them. Max unmatched counts all unmatched left records. Max expansion compares integer products exactly, avoiding a rounded ratio. A zero-left audit vacuously passes every nonnegative expansion bound (displayed count ratio `0/0`). Invalid/blank measures do not automatically fail expectations, which are structural rather than numeric-completeness checks.

Input/parse/limit errors throw `AuditError`; no partial report is returned. Only witness samples truncate. Workers give cancellation and wall-time control. The CLI has a 384 MiB worker old-generation limit and a 20-second default wall limit; browser memory limits depend on the browser, so input budgets and explicit cancellation are the primary controls.
