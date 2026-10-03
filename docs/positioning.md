# Problem and honest differentiation

Research checked on 2026-10-03. Sources below describe a real workflow hazard; they do not validate customer demand or uniqueness.

## Existing capabilities

- [pandas merge](https://pandas.pydata.org/docs/reference/api/pandas.merge.html) supports relationship validation and merge-origin indicators. Its null-key matching behavior differs from usual SQL. These are strong existing features; Join Impact is not a replacement for pandas.
- [Looker symmetric aggregates](https://docs.cloud.google.com/looker/docs/best-practices/understanding-symmetric-aggregates) explains how fanout can repeat facts and why primary-key/grain declarations matter. Our record-level arithmetic cannot infer those business declarations.
- [DuckDB profiling](https://duckdb.org/docs/lts/sql/statements/profiling) describes EXPLAIN estimates and EXPLAIN ANALYZE execution cardinalities. SQL can reproduce the audit's counts and measure decomposition.
- [csvkit csvjoin](https://csvkit.readthedocs.io/en/latest/scripts/csvjoin.html) already offers CSV join types and parsing controls, and warns about its memory requirements.
- [Easy Data Transform Join](https://www.easydatatransform.com/help/latest/windows/html/join.html) already helps explore duplicate, unmatched, and problematic keys.
- [Sparkpond CSV join](https://data.sparkpond.com/join-csv/) shows that browser-local join previews and duplicate/expansion warnings are established product patterns. The earlier feasibility research also identified [ExploreMyData CSV join](https://exploremydata.com/tools/csv-join); its page could not be retrieved during this build, so no current feature comparison is claimed here. Scope/availability of third-party tools can change.

## The narrow useful package

For an analyst with two exports and one amount column, Join Impact puts exact signed-measure decomposition, bounded causal source-record evidence, and side-by-side cleanup effects into a repeatable local report and CI exit contract. It deliberately does not merge/export the data, infer IDs as numbers, guess business grain, recommend whichever normalization yields more matches, or allocate a huge Cartesian result.

The difference is explanation and workflow packaging. Existing tools can reproduce these results, especially using SQL/code or broader workflows. No claim is made that competitors cannot implement them, that this is patentable/novel, that a paid market exists, or that production data has validated the tool.

## Next validation question

Do working analysts find the original→retained-once→joined explanation and concrete record references faster to act on than their existing SQL or dataframe checks? A synthetic portfolio demonstration cannot answer that. Any real customer research or data collection would need separate authorization and suitable privacy controls.
