import assert from "node:assert/strict";
import test from "node:test";
import { analyzeJoin, auditJoin, parseCsv, LIMITS } from "../build/engine.js";

const defaults = { leftKeys: ["key"], rightKeys: ["key"], measure: "amount" };
const request = (
  leftText = "key,amount\na,1\n",
  rightText = "key\na\n",
  options = {},
) => ({
  leftText,
  rightText,
  options: {
    ...defaults,
    leftKeys: [...defaults.leftKeys],
    rightKeys: [...defaults.rightKeys],
    ...options,
  },
});
const csv = (headers, rows, delimiter = ",") =>
  [headers, ...rows]
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          return /["\r\n]/.test(text) || text.includes(delimiter)
            ? `"${text.replaceAll('"', '""')}"`
            : text;
        })
        .join(delimiter),
    )
    .join("\n") + "\n";
const rejects = (fn, message) =>
  assert.throws(
    fn,
    (error) => {
      assert.equal(error.name, "AuditError", message);
      assert.equal(typeof error.code, "string", message);
      assert.ok(error.code.length, message);
      assert.equal(typeof error.message, "string", message);
      return true;
    },
    message,
  );
const metrics = (report) => ({
  baseline: {
    counts: report.baseline.counts,
    measure: report.baseline.measure,
    collisionGroupsTotal: report.baseline.collisionGroupsTotal,
  },
  selected: {
    counts: report.selected.counts,
    measure: report.selected.measure,
    collisionGroupsTotal: report.selected.collisionGroupsTotal,
  },
  comparison: report.comparison,
  expectations: report.expectations,
});

for (const [name, text] of [
  ["unterminated quoted field", 'key,amount\n"broken,1\n'],
  ["quote in unquoted field", 'key,amount\nbr"oken,1\n'],
  ["text after closing quote", 'key,amount\n"broken"suffix,1\n'],
  ["space after closing quote", 'key,amount\n"broken" ,1\n'],
  ["ragged short row", "key,amount\na\n"],
  ["ragged long row", "key,amount\na,1,extra\n"],
  ["bare blank record under multiple columns", "key,amount\n\n"],
  ["duplicate header", "key,key\na,1\n"],
  ["empty header", "key,\na,1\n"],
  ["empty input", ""],
  ["BOM only", "\ufeff"],
]) {
  test(`CSV rejects ${name}`, () => rejects(() => parseCsv(text), name));
}

test("CSV preserves escaped quotes, multiline CRLF fields, BOM digest bytes, and source locations", () => {
  const text =
    '\ufeffkey,amount,note\r\n"a\r\nb",1,"say ""hi"""\r\nz,-2,end\r\n';
  const parsed = parseCsv(text);
  assert.deepEqual(parsed.headers, ["key", "amount", "note"]);
  assert.deepEqual(parsed.rows, [
    { values: ["a\r\nb", "1", 'say "hi"'], record: 2, line: 2 },
    { values: ["z", "-2", "end"], record: 3, line: 4 },
  ]);
  assert.equal(parsed.bytes, Buffer.byteLength(text));
  assert.deepEqual(parseCsv("key\n\n").rows, [
    { values: [""], record: 2, line: 2 },
  ]);
  assert.deepEqual(parseCsv('key\n""\n').rows, [
    { values: [""], record: 2, line: 2 },
  ]);
  assert.equal(parseCsv("key\n").rows.length, 0);
  assert.equal(parseCsv("key").rows.length, 0);
  assert.deepEqual(
    parseCsv("key,amount\ra,1\rb,2").rows.map((row) => row.line),
    [2, 3],
  );
});

test("CSV supports all documented delimiters without auto-detection or silent text changes", () => {
  for (const delimiter of [",", ";", "\t"]) {
    const rows = [
      ["a,b;c\td", "1.25"],
      ["🚀", "-2"],
    ];
    assert.deepEqual(
      parseCsv(csv(["key", "amount"], rows, delimiter), delimiter).rows.map(
        (row) => row.values,
      ),
      rows,
    );
  }
  for (const delimiter of ["", "|", ":", "||", "\n"])
    rejects(() => parseCsv("key\na\n", delimiter));
});

test("literal NULL/null, leading zeroes, case, prototype names and formula-looking keys stay text", () => {
  const keys = [
    "NULL",
    "null",
    "01",
    "1",
    "A",
    "a",
    "__proto__",
    "constructor",
    "toString",
    "=SUM(A1)",
    "-0",
    "0",
  ];
  const left = csv(
    ["key", "amount"],
    keys.map((key, i) => [key, String(i + 1)]),
  );
  const right = csv(
    ["key"],
    [...keys.map((key) => [key]), ["NULL"], ["__proto__"]],
  );
  const report = analyzeJoin(request(left, right));
  assert.equal(report.selected.counts.outputRows, "14");
  assert.equal(report.selected.counts.matchedLeftRows, keys.length);
  assert.equal(report.selected.counts.rightDuplicateGroups, 2);
  assert.equal(report.selected.measure.joined, "86");
  assert.deepEqual(
    report.selected.witnesses.map((w) => w.key),
    [["__proto__"], ["NULL"]],
  );
});

test("compound keys use injective tuple encoding, including delimiter and quote characters", () => {
  const keys = [
    ["a|b", "c"],
    ["a", "b|c"],
    ["a\u001fb", "c"],
    ["a", "b\u001fc"],
    ['["a","b"]', "c"],
    ["a", '"b",c'],
  ];
  const left = csv(
    ["a", "b", "amount"],
    keys.map((key, i) => [...key, String(i + 1)]),
  );
  const right = csv(
    ["x", "y"],
    keys.map((key) => [...key]).concat([["a|b", "c"]]),
  );
  const plan = analyzeJoin(
    request(left, right, { leftKeys: ["a", "b"], rightKeys: ["x", "y"] }),
  ).selected;
  assert.equal(plan.counts.outputRows, "7");
  assert.equal(plan.counts.multipliedLeftRows, 1);
  assert.equal(plan.measure.joined, "22");
  assert.deepEqual(plan.witnesses[0].key, ["a|b", "c"]);
});

test("trim follows JavaScript Unicode whitespace, NFC is canonical, and case is untouched", () => {
  const cases = [
    ["\u00a0é\u3000", "é", "trim", true],
    ["e\u0301", "é", "nfc", true],
    ["\ufeffe\u0301\u202f", "é", "trim-nfc", true],
    ["\u0085A\u0085", "A", "trim", false],
    ["\u200bA\u200b", "A", "trim", false],
    ["A", "a", "trim-nfc", false],
    ["①", "1", "nfc", false],
  ];
  for (const [leftKey, rightKey, normalization, matches] of cases) {
    const report = analyzeJoin(
      request(
        csv(["key", "amount"], [[leftKey, "0.1"]]),
        csv(["key"], [[rightKey]]),
        { normalization, join: "inner" },
      ),
    );
    assert.equal(
      report.selected.counts.matchedLeftRows,
      Number(matches),
      JSON.stringify(cases),
    );
    assert.equal(report.selected.measure.joined, matches ? "0.1" : "0");
  }
});

test("blank policy applies after normalization to any component, while NULL stays literal", () => {
  const left = csv(
    ["a", "b", "amount"],
    [
      [" ", "x", "2"],
      ["a", "", "3"],
      ["NULL", "x", "5"],
    ],
  );
  const right = csv(
    ["a", "b"],
    [
      ["", "x"],
      ["a", ""],
      ["NULL", "x"],
    ],
  );
  const options = {
    leftKeys: ["a", "b"],
    rightKeys: ["a", "b"],
    normalization: "trim",
    join: "inner",
  };
  const never = analyzeJoin(
    request(left, right, { ...options, blank: "never" }),
  );
  const match = analyzeJoin(
    request(left, right, { ...options, blank: "match" }),
  );
  assert.equal(never.selected.counts.blankLeftRows, 2);
  assert.equal(never.selected.counts.matchedLeftRows, 1);
  assert.equal(never.selected.measure.dropped, "5");
  assert.equal(match.baseline.counts.matchedLeftRows, 2);
  assert.equal(match.selected.counts.matchedLeftRows, 3);
  assert.equal(match.selected.measure.joined, "10");
});

test("decimal parser rejects exponents, currency, separators, whitespace, noncanonical integers, and overflow", () => {
  const valid = [
    "0",
    "-0",
    "+0",
    "1.2300",
    "-2.5",
    "+3",
    "0.000000000001",
    "999999999999999999999999999999.999999999999",
  ];
  const invalid = [
    "1e3",
    "1E3",
    "NaN",
    "Infinity",
    "-Infinity",
    "$1",
    "1,000",
    " 1",
    "1 ",
    "\t1",
    "1\n",
    "1\r",
    "1\r\n",
    "\u00a01",
    "01",
    "-01",
    "+01",
    ".5",
    "1.",
    "--1",
    "0x10",
    "１２",
    "1_000",
    "1000000000000000000000000000000",
    "0.0000000000001",
  ];
  const left = csv(
    ["key", "amount"],
    [...valid, "", ...invalid].map((value) => ["x", value]),
  );
  const plan = analyzeJoin(request(left, "key\nx\nx\n")).selected;
  assert.equal(plan.measure.validRows, valid.length);
  assert.equal(plan.measure.blankRows, 1);
  assert.equal(plan.measure.invalidRows, invalid.length);
  assert.equal(plan.counts.leftRows, valid.length + 1 + invalid.length);
  assert.equal(plan.invalidMeasureSamples.length, LIMITS.invalidSamples);
  assert.equal(plan.invalidMeasureSamplesTruncated, true);
  assert.equal(plan.measure.original, "1000000000000000000000000000001.73");
  assert.equal(plan.measure.joined, "2000000000000000000000000000003.46");
});

test("signed cancellation cannot hide absolute replicated or dropped contribution", () => {
  const left =
    "key,amount\na,9007199254740993.01\na,-9007199254740993.00\nb,-0.01\n";
  const plan = analyzeJoin(
    request(left, "key\na\na\na\n", { join: "inner" }),
  ).selected;
  assert.equal(plan.measure.original, "0");
  assert.equal(plan.measure.retainedOnce, "0.01");
  assert.equal(plan.measure.joined, "0.03");
  assert.equal(plan.measure.replicated, "0.02");
  assert.equal(plan.measure.dropped, "-0.01");
  assert.equal(plan.measure.netChange, "0.03");
  assert.equal(plan.measure.absoluteReplicated, "36028797018963972.02");
  assert.equal(plan.measure.absoluteDropped, "0.01");
  assert.equal(plan.counts.extraOutputRows, "4");
  assert.equal(plan.witnesses[0].key[0], "a");
});

test("source record permutation changes provenance but not any numeric audit metric", () => {
  const leftRows = [
    [" A", "3"],
    ["A", "-2"],
    ["é", "1.1"],
    ["e\u0301", "0.2"],
    ["", "5"],
    ["missing", "-4"],
    ["a", "invalid"],
  ];
  const rightRows = [["A"], [" A"], ["é"], ["e\u0301"], [""], ["a"]];
  const options = {
    normalization: "trim-nfc",
    join: "inner",
    blank: "match",
    expect: { maxUnmatchedRows: 0, maxExpansion: "2" },
  };
  const before = analyzeJoin(
    request(csv(["key", "amount"], leftRows), csv(["key"], rightRows), options),
  );
  const after = analyzeJoin(
    request(
      csv(["key", "amount"], [...leftRows].reverse()),
      csv(
        ["key"],
        [rightRows[3], ...rightRows.slice(0, 3), ...rightRows.slice(4)],
      ),
      options,
    ),
  );
  assert.deepEqual(metrics(before), metrics(after));
});

test("non-key columns are irrelevant and adding a unique unrelated right key cannot affect join output or money", () => {
  const base = analyzeJoin(
    request("key,amount,note\na,2,x\nb,-1,y\n", "key,note\na,p\na,q\n"),
  );
  const changed = analyzeJoin(
    request(
      "key,amount,note,other\na,2,unrelated,zzz\nb,-1,changed,yyy\n",
      "key,note,other\na,changed,q\na,again,p\nunrelated,z,x\n",
    ),
  );
  for (const plan of ["baseline", "selected"]) {
    assert.deepEqual(changed[plan].measure, base[plan].measure);
    const { rightRows: ignoredBefore, ...beforeCounts } = base[plan].counts;
    const { rightRows: ignoredAfter, ...afterCounts } = changed[plan].counts;
    assert.deepEqual(afterCounts, beforeCounts);
    assert.deepEqual(changed[plan].witnesses, base[plan].witnesses);
  }
});

test("same inputs and semantically identical option insertion orders produce identical report JSON", async () => {
  const first = request("key,amount\n a,0.1\na,-0.2\n", "key\na\na\n", {
    normalization: "trim",
    expect: { maxUnmatchedRows: 0, manyToOne: true, maxExpansion: "2" },
  });
  const second = {
    rightText: first.rightText,
    options: {
      expect: { maxExpansion: "2", manyToOne: true, maxUnmatchedRows: 0 },
      normalization: "trim",
      measure: "amount",
      rightKeys: ["key"],
      leftKeys: ["key"],
    },
    leftText: first.leftText,
  };
  assert.equal(
    JSON.stringify(await auditJoin(first)),
    JSON.stringify(await auditJoin(second)),
  );
});

for (const [name, options] of [
  ["unknown option", { typo: true }],
  ["unknown expectation", { expect: { typo: 0 } }],
  ["empty key list", { leftKeys: [], rightKeys: [] }],
  ["mismatched key count", { rightKeys: ["key", "extra"] }],
  [
    "duplicate selected key",
    { leftKeys: ["key", "key"], rightKeys: ["key", "key"] },
  ],
  [
    "four keys",
    { leftKeys: ["a", "b", "c", "d"], rightKeys: ["a", "b", "c", "d"] },
  ],
  ["non-text key", { leftKeys: [1] }],
  ["missing key column", { leftKeys: ["absent"] }],
  ["missing measure column", { measure: "absent" }],
  ["unsupported join", { join: "outer" }],
  ["unsupported blank policy", { blank: "null" }],
  ["unsupported normalization", { normalization: "nfkc" }],
  ["numeric expansion", { expect: { maxExpansion: 2 } }],
  ["negative expansion", { expect: { maxExpansion: "-1" } }],
  ["negative unmatched limit", { expect: { maxUnmatchedRows: -1 } }],
  ["fractional unmatched limit", { expect: { maxUnmatchedRows: 0.5 } }],
  [
    "unsafe unmatched limit",
    { expect: { maxUnmatchedRows: 9007199254740992 } },
  ],
  ["non-boolean cardinality", { expect: { manyToOne: "true" } }],
]) {
  test(`options reject ${name}`, () =>
    rejects(() => analyzeJoin(request(undefined, undefined, options))));
}

for (const value of [
  "+1",
  "1.0",
  "1.50",
  "01",
  "-0",
  "0.0",
  "1\n",
  "1e0",
  " 1",
]) {
  test(`expansion threshold must be canonical: ${JSON.stringify(value)}`, () =>
    rejects(() =>
      analyzeJoin(
        request(undefined, undefined, { expect: { maxExpansion: value } }),
      ),
    ));
}

test("expectations use exact rational comparisons and apply to selected normalization", () => {
  const left = "key,amount\n a,1\na,2\nb,3\n";
  const right = "key\na\na\n";
  const fail = analyzeJoin(
    request(left, right, {
      normalization: "trim",
      expect: {
        manyToOne: true,
        maxUnmatchedRows: 0,
        maxExpansion: "1.666666666666",
      },
    }),
  );
  assert.equal(fail.expectations.checks.length, 3);
  assert.equal(fail.expectations.passed, false);
  assert.ok(fail.expectations.checks.every((check) => !check.passed));
  const pass = analyzeJoin(
    request(left, right, {
      normalization: "trim",
      expect: { maxUnmatchedRows: 1, maxExpansion: "1.666666666667" },
    }),
  );
  assert.equal(pass.expectations.passed, true);
  const threshold = analyzeJoin(
    request("key,amount\na,1\n", "key\na\na\n", {
      expect: { maxExpansion: "2" },
    }),
  );
  assert.equal(threshold.expectations.passed, true);
});

test("UTF-8 accepts astral characters and rejects lone surrogates before digest or normalization", async () => {
  assert.equal(parseCsv("key\n🚀\n").bytes, 9);
  for (const value of ["\ud800", "\udfff", "a\ud800b", "\ud800\ud800"]) {
    rejects(() => parseCsv(`key\n${value}\n`));
    await assert.rejects(
      auditJoin(request(`key,amount\n${value},1\n`)),
      (error) => error.name === "AuditError",
    );
  }
});

test("hard row, column, cell and header limits reject rather than silently truncate", () => {
  assert.equal(
    parseCsv("key\n" + "a\n".repeat(LIMITS.rowsPerFile)).rows.length,
    LIMITS.rowsPerFile,
  );
  rejects(() => parseCsv("key\n" + "a\n".repeat(LIMITS.rowsPerFile + 1)));
  const headers = Array.from({ length: LIMITS.columns }, (_, i) => `c${i}`);
  assert.equal(parseCsv(csv(headers, [])).headers.length, LIMITS.columns);
  rejects(() => parseCsv(csv([...headers, "overflow"], [])));
  assert.equal(
    parseCsv("key\n" + "a".repeat(LIMITS.cellChars)).rows[0].values[0].length,
    LIMITS.cellChars,
  );
  rejects(() => parseCsv("key\n" + "a".repeat(LIMITS.cellChars + 1)));
  assert.equal(
    parseCsv("h".repeat(LIMITS.headerChars)).headers[0].length,
    LIMITS.headerChars,
  );
  rejects(() => parseCsv("h".repeat(LIMITS.headerChars + 1)));
});

test("hard UTF-8 byte budget is enforced independently of JavaScript character count", () => {
  const text = "key\n" + ("東".repeat(1000) + "\n").repeat(1400);
  assert.ok(text.length < LIMITS.bytesPerFile);
  assert.ok(Buffer.byteLength(text) > LIMITS.bytesPerFile);
  rejects(() => parseCsv(text));
  rejects(() => parseCsv("x".repeat(LIMITS.bytesPerFile + 1)));
});

test(
  "40,000 by 40,000 duplicate group is counted exactly without materializing 1.6 billion rows",
  { timeout: 15000 },
  () => {
    const size = LIMITS.rowsPerFile;
    const plan = analyzeJoin(
      request(
        "key,amount\n" + "a,0.1\n".repeat(size),
        "key\n" + "a\n".repeat(size),
      ),
    ).selected;
    assert.equal(plan.counts.outputRows, "1600000000");
    assert.equal(plan.counts.extraOutputRows, "1599960000");
    assert.equal(plan.counts.multipliedLeftRows, 40000);
    assert.equal(plan.measure.original, "4000");
    assert.equal(plan.measure.joined, "160000000");
    assert.equal(plan.measure.replicated, "159996000");
    assert.equal(plan.witnesses.length, 1);
    assert.equal(plan.witnesses[0].leftRecords.length, 5);
    assert.equal(plan.witnesses[0].rightRecords.length, 5);
    assert.equal(plan.witnesses[0].pairs.length, 8);
    assert.equal(plan.witnesses[0].samplesTruncated, true);
  },
);

test("witnesses are ranked by absolute effect then serialized key, and truncation never changes totals", () => {
  const leftRows = [];
  const rightRows = [];
  for (let i = 0; i < 35; i++) {
    const key = `k${String(i).padStart(2, "0")}`;
    leftRows.push([key, i === 34 ? "-1000" : "1"]);
    rightRows.push([key], [key]);
  }
  const report = analyzeJoin(
    request(csv(["key", "amount"], leftRows), csv(["key"], rightRows)),
  );
  const plan = report.selected;
  assert.equal(plan.witnessGroupsTotal, 35);
  assert.equal(plan.witnesses.length, 30);
  assert.equal(plan.witnessesTruncated, true);
  assert.deepEqual(
    plan.witnesses.slice(0, 3).map((w) => w.key[0]),
    ["k34", "k00", "k01"],
  );
  assert.equal(plan.measure.original, "-966");
  assert.equal(plan.measure.joined, "-1932");
  assert.equal(plan.measure.absoluteReplicated, "1034");
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= LIMITS.reportBytes);
});

test("witness provenance points to real matching source pairs and marks blank/invalid amounts", () => {
  const left = 'key,amount\n"a\nb",1\n"a\nb",\n"a\nb",oops\nmissing,2\n';
  const right = 'key\n"a\nb"\n"a\nb"\n';
  const plan = analyzeJoin(request(left, right, { join: "inner" })).selected;
  const multiplied = plan.witnesses.find((w) => !w.unmatched);
  assert.deepEqual(multiplied.leftRecords, [
    { record: 2, line: 2, measure: "1", measureStatus: "valid" },
    { record: 3, line: 4, measure: "", measureStatus: "blank" },
    { record: 4, line: 6, measure: "oops", measureStatus: "invalid" },
  ]);
  assert.deepEqual(multiplied.rightRecords, [
    { record: 2, line: 2 },
    { record: 3, line: 4 },
  ]);
  assert.deepEqual(
    multiplied.pairs,
    [2, 3, 4].flatMap((leftRecord) =>
      [2, 3].map((rightRecord) => ({ leftRecord, rightRecord })),
    ),
  );
  const dropped = plan.witnesses.find((w) => w.unmatched);
  assert.equal(dropped.outputRows, "0");
  assert.deepEqual(dropped.pairs, [{ leftRecord: 5, rightRecord: null }]);
  assert.equal(dropped.leftRecords[0].line, 8);
  assert.deepEqual(plan.invalidMeasureSamples, [
    { record: 4, line: 6, value: "oops", truncated: false },
  ]);
});

test("collision samples include both sides, raw keys, blank collisions, and bounded raw/record lists", () => {
  const rawKeys = ["A", " A", "A ", " A ", "\tA", "A\t", "\u00a0A"];
  const leftRows = rawKeys.flatMap((key) =>
    Array.from({ length: 6 }, () => [key, "1"]),
  );
  leftRows.push(["", "1"], [" ", "1"]);
  const rightRows = rawKeys.map((key) => [key]);
  const plan = analyzeJoin(
    request(csv(["key", "amount"], leftRows), csv(["key"], rightRows), {
      normalization: "trim",
      blank: "never",
    }),
  ).selected;
  assert.equal(plan.collisionGroupsTotal, 3);
  const collision = plan.collisions.find(
    (c) => c.side === "left" && c.key[0] === "A",
  );
  assert.equal(collision.rawKeyCount, 7);
  assert.equal(collision.rowCount, 42);
  assert.equal(collision.rawSamples.length, 5);
  assert.ok(
    collision.rawSamples.every((sample) => sample.records.length === 5),
  );
  assert.equal(collision.samplesTruncated, true);
  assert.ok(plan.collisions.some((c) => c.side === "left" && c.key[0] === ""));
  assert.ok(plan.collisions.some((c) => c.side === "right"));
});

test("collision group and displayed-value budgets truncate only witnesses, never underlying matching", () => {
  const leftRows = [];
  const rightRows = [];
  for (let i = 0; i < 25; i++) {
    const key = `k${String(i).padStart(2, "0")}` + "x".repeat(200);
    leftRows.push([key, "1"], [` ${key}`, "2"]);
    rightRows.push([key], [`${key} `]);
  }
  const report = analyzeJoin(
    request(csv(["key", "amount"], leftRows), csv(["key"], rightRows), {
      normalization: "trim",
    }),
  );
  const plan = report.selected;
  assert.equal(plan.collisionGroupsTotal, 50);
  assert.equal(plan.collisions.length, 20);
  assert.equal(plan.collisionsTruncated, true);
  assert.equal(plan.counts.outputRows, "100");
  assert.equal(plan.measure.joined, "150");
  assert.ok(
    plan.collisions.every(
      (c) =>
        c.keyTruncated && c.key.every((k) => k.length <= LIMITS.displayChars),
    ),
  );
  assert.ok(
    plan.witnesses.every(
      (w) =>
        w.keyTruncated && w.key.every((k) => k.length <= LIMITS.displayChars),
    ),
  );
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= LIMITS.reportBytes);
});

test("invalid amount samples are capped, explicit, and retain physical source line numbers", () => {
  const invalid = "x".repeat(200);
  const left = csv(
    ["key", "amount"],
    Array.from({ length: 20 }, (_, i) => [`key${i}`, invalid]),
  );
  const plan = analyzeJoin(request(left, "key\n")).selected;
  assert.equal(plan.measure.invalidRows, 20);
  assert.equal(plan.invalidMeasureSamples.length, 12);
  assert.equal(plan.invalidMeasureSamplesTruncated, true);
  assert.ok(
    plan.invalidMeasureSamples.every(
      (sample) =>
        sample.truncated &&
        sample.value.length === 160 &&
        sample.line === sample.record,
    ),
  );
  assert.equal(plan.measure.joined, "0");
});

test("header-only inputs have exact zero totals, no phantom data records, and JSON-safe reports", async () => {
  for (const join of ["left", "inner"]) {
    const report = await auditJoin(request("key,amount\n", "key\n", { join }));
    assert.equal(report.selected.counts.outputRows, "0");
    assert.equal(report.selected.counts.leftRows, 0);
    assert.equal(report.selected.counts.rightRows, 0);
    assert.equal(report.selected.measure.original, "0");
    assert.equal(report.selected.measure.joined, "0");
    assert.equal(report.selected.witnesses.length, 0);
    assert.equal(report.selected.collisions.length, 0);
    assert.equal(report.inputs.left.sha256.length, 64);
  }
});

test("documented exported limits remain fixed and immutable", () => {
  assert.deepEqual(LIMITS, {
    bytesPerFile: 4 * 1024 * 1024,
    rowsPerFile: 40000,
    columns: 64,
    cellChars: 16384,
    headerChars: 128,
    witnessGroups: 30,
    recordSamples: 5,
    pairSamples: 8,
    collisionGroups: 20,
    collisionRawSamples: 5,
    invalidSamples: 12,
    displayChars: 160,
    reportBytes: 1024 * 1024,
  });
  assert.equal(Object.isFrozen(LIMITS), true);
});

test("300 deterministic CSV round trips preserve every value and independently computed source location", () => {
  let seed = 0x435356;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const alphabet = [
    "a",
    "東",
    "🚀",
    '"',
    ",",
    ";",
    "\t",
    "\n",
    "\r",
    "\r\n",
    "",
    " ",
    "\u00a0",
    "__proto__",
  ];
  for (let i = 0; i < 300; i++) {
    const width = 1 + random(6);
    const delimiter = [",", ";", "\t"][random(3)];
    const headers = Array.from({ length: width }, (_, n) => `column_${n}`);
    const rows = Array.from({ length: random(12) }, () =>
      Array.from({ length: width }, () =>
        Array.from(
          { length: random(7) },
          () => alphabet[random(alphabet.length)],
        ).join(""),
      ),
    );
    const encoded = csv(headers, rows, delimiter);
    const parsed = parseCsv(encoded, delimiter);
    assert.deepEqual(parsed.headers, headers, `case ${i}`);
    assert.deepEqual(
      parsed.rows.map((row) => row.values),
      rows,
      `case ${i}`,
    );
    let nextLine = 2;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      assert.equal(
        parsed.rows[rowIndex].record,
        rowIndex + 2,
        `record case ${i}/${rowIndex}`,
      );
      assert.equal(
        parsed.rows[rowIndex].line,
        nextLine,
        `line case ${i}/${rowIndex}`,
      );
      // Encoding retains embedded line endings and adds one physical LF between records.
      nextLine +=
        1 +
        rows[rowIndex].reduce(
          (sum, value) => sum + (value.match(/\r\n|\r|\n/g) || []).length,
          0,
        );
    }
  }
});

test("prototype-looking column names resolve by exact text without object-property side effects", () => {
  const plan = analyzeJoin({
    leftText: "__proto__,constructor,toString\na,b,0.25\n",
    rightText: "hasOwnProperty,valueOf\na,b\na,b\n",
    options: {
      leftKeys: ["__proto__", "constructor"],
      rightKeys: ["hasOwnProperty", "valueOf"],
      measure: "toString",
    },
  }).selected;
  assert.equal(plan.counts.outputRows, "2");
  assert.equal(plan.measure.joined, "0.5");
  assert.equal(Object.prototype.polluted, undefined);
  const poisoned = JSON.parse(
    '{"leftKeys":["key"],"rightKeys":["key"],"measure":"amount","__proto__":{"polluted":true}}',
  );
  rejects(() => analyzeJoin({ ...request(), options: poisoned }));
});

test("optional undefined settings resolve to defaults without aliasing or mutating caller arrays", () => {
  const source = request(undefined, undefined, {
    join: undefined,
    normalization: undefined,
    blank: undefined,
    expect: undefined,
  });
  const before = structuredClone(source);
  const report = analyzeJoin(source);
  assert.deepEqual(source, before);
  assert.equal(report.options.join, "left");
  assert.equal(report.options.blank, "never");
  assert.equal(report.options.normalization, "exact");
  source.options.leftKeys[0] = "changed-after-audit";
  source.options.rightKeys.push("changed-after-audit");
  assert.deepEqual(report.options.leftKeys, ["key"]);
  assert.deepEqual(report.options.rightKeys, ["key"]);
});

test("display truncation preserves Unicode scalar values and explicitly marks shortened measure samples", () => {
  const key = "a".repeat(159) + "🚀";
  const invalid = "b".repeat(159) + "🚀";
  const plan = analyzeJoin(
    request(
      csv(["key", "amount"], [[key, invalid]]),
      csv(["key"], [[key], [key]]),
    ),
  ).selected;
  const witness = plan.witnesses[0];
  assert.equal(witness.keyTruncated, true);
  assert.equal(witness.key[0].isWellFormed(), true);
  assert.ok(witness.key[0].length <= 160);
  assert.equal(witness.leftRecords[0].measure.isWellFormed(), true);
  assert.equal(witness.samplesTruncated, true);
  assert.equal(plan.invalidMeasureSamples[0].value.isWellFormed(), true);
  assert.equal(plan.invalidMeasureSamples[0].truncated, true);
});

test("exact byte limit is accepted when all cell/row limits also fit", () => {
  const unit = "x".repeat(8191) + "\n";
  const prefix = "key\n" + unit.repeat(511);
  const text =
    prefix +
    "x".repeat(LIMITS.bytesPerFile - Buffer.byteLength(prefix) - 1) +
    "\n";
  assert.equal(Buffer.byteLength(text), LIMITS.bytesPerFile);
  const table = parseCsv(text);
  assert.equal(table.bytes, LIMITS.bytesPerFile);
  assert.equal(table.rows.length, 512);
  rejects(() => parseCsv(text + "\n"));
});

test("dense escaped witness/collision output stays bounded while full audit totals remain exact", () => {
  const leftRows = [];
  const rightRows = [];
  const variants = ["", " ", "  ", "\t", "\u00a0", "\u3000"];
  for (let i = 0; i < 32; i++) {
    const key = "\u0001".repeat(160) + String(i);
    for (const space of variants) {
      const raw = space + key;
      for (let j = 0; j < 6; j++)
        leftRows.push([raw, raw, raw, "\u0002".repeat(180)]);
      rightRows.push([raw, raw, raw], [raw, raw, raw]);
    }
  }
  const report = analyzeJoin(
    request(
      csv(["a", "b", "c", "amount"], leftRows),
      csv(["x", "y", "z"], rightRows),
      {
        leftKeys: ["a", "b", "c"],
        rightKeys: ["x", "y", "z"],
        normalization: "trim",
      },
    ),
  );
  assert.equal(report.baseline.counts.outputRows, "2304");
  assert.equal(report.selected.counts.outputRows, "13824");
  assert.equal(report.selected.measure.invalidRows, 1152);
  assert.equal(report.selected.measure.joined, "0");
  assert.equal(report.selected.witnessGroupsTotal, 32);
  assert.equal(report.selected.collisionGroupsTotal, 64);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= LIMITS.reportBytes);
});
