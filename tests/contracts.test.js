import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditJoin, formulaSafeCell } from "../build/engine.js";
const cli = (...args) =>
  spawnSync(process.execPath, ["src/cli.js", ...args], {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 2 * 1024 * 1024,
  });
const base = [
  "--left",
  "fixtures/orders.csv",
  "--right",
  "fixtures/customers.csv",
  "--left-key",
  "customer",
  "--right-key",
  "customer",
  "--measure",
  "amount",
];
test("acceptance fixture: CLI JSON and shared API agree byte-for-byte", async () => {
  const leftText = await readFile("fixtures/orders.csv", "utf8"),
    rightText = await readFile("fixtures/customers.csv", "utf8");
  const expected = await auditJoin({
    leftText,
    rightText,
    options: {
      leftKeys: ["customer"],
      rightKeys: ["customer"],
      measure: "amount",
    },
  });
  const actual = cli(...base);
  assert.equal(actual.status, 0, actual.stderr);
  assert.deepEqual(JSON.parse(actual.stdout), expected);
  assert.equal(expected.selected.measure.joined, "310");
  assert.equal(expected.selected.counts.outputRows, "6");
  assert.equal(actual.stdout, JSON.stringify(expected) + "\n");
});
test("inner fixture decomposes dropped and replicated contributions", () => {
  const result = cli(...base, "--join", "inner");
  assert.equal(result.status, 0, result.stderr);
  const r = JSON.parse(result.stdout);
  assert.equal(r.selected.measure.original, "160");
  assert.equal(r.selected.measure.retainedOnce, "130");
  assert.equal(r.selected.measure.joined, "280");
  assert.equal(r.selected.measure.dropped, "30");
  assert.equal(r.selected.measure.replicated, "150");
  assert.equal(r.selected.measure.netChange, "120");
  assert.equal(r.selected.counts.outputRows, "5");
});
test("expectations distinguish failed audit from input error", () => {
  const result = cli(
    ...base,
    "--expect-many-to-one",
    "--max-unmatched",
    "0",
    "--max-expansion",
    "1.49",
  );
  assert.equal(result.status, 1);
  const r = JSON.parse(result.stdout);
  assert.equal(r.expectations.checks.length, 3);
  assert.ok(r.expectations.checks.every((c) => !c.passed));
  assert.equal(
    cli(...base, "--max-expansion", "1.5", "--max-unmatched", "1").status,
    0,
  );
});
for (const [name, args] of [
  ["unknown argument", ["--missing"]],
  ["duplicate single flag", ["--join", "left", "--join", "inner"]],
  ["missing value", ["--join"]],
  ["negative integer", ["--max-unmatched", "-1"]],
  ["exponent ratio", ["--max-expansion", "1e2"]],
  ["redundant ratio zeros", ["--max-expansion", "1.00"]],
  ["plus ratio", ["--max-expansion", "+1"]],
  ["invalid timeout", ["--timeout-ms", "99"]],
  ["bad format", ["--format", "csv"]],
  ["bad delimiter", ["--left-delimiter", "pipe"]],
  ["key mismatch", ["--left-key", "note"]],
  ["nonexistent key", ["--right-key", "missing"]],
  ["bad join", ["--join", "outer"]],
])
  test(`CLI rejects ${name}`, () => {
    const r = cli(...base, ...args);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, "");
  });
test("help and version do not require input files", () => {
  assert.match(cli("--help").stdout, /No merged data/);
  assert.equal(cli("--version").stdout, "0.1.0\n");
});
test("missing, directory, invalid UTF8, oversized, and symlink input fail safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "join-impact-"));
  try {
    await writeFile(join(dir, "invalid.csv"), Buffer.from([0xff, 0xfe]));
    await writeFile(join(dir, "large.csv"), "x".repeat(4 * 1024 * 1024 + 1));
    await symlink(
      join(process.cwd(), "fixtures/orders.csv"),
      join(dir, "link.csv"),
    );
    for (const path of [
      join(dir, "missing.csv"),
      dir,
      join(dir, "invalid.csv"),
      join(dir, "large.csv"),
      join(dir, "link.csv"),
    ]) {
      const r = cli("--left", path, ...base.slice(2));
      assert.equal(r.status, 2, `${path}: ${r.stderr}`);
      assert.equal(r.stdout, "");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("FIFO input is rejected without opening a blocking stream", async () => {
  const dir = await mkdtemp(join(tmpdir(), "join-impact-fifo-"));
  try {
    const fifo = join(dir, "input");
    const made = spawnSync("mkfifo", [fifo]);
    assert.equal(made.status, 0);
    const r = cli("--left", fifo, ...base.slice(2));
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.signal, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("CLI decoder preserves BOM in the digest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "join-impact-bom-"));
  try {
    const leftText = "\ufeffcustomer,amount\r\n001,0.1\r\n";
    await writeFile(join(dir, "bom.csv"), leftText);
    const r = cli("--left", join(dir, "bom.csv"), ...base.slice(2));
    assert.equal(r.status, 0, r.stderr);
    const expected = await auditJoin({
      leftText,
      rightText: await readFile("fixtures/customers.csv", "utf8"),
      options: {
        leftKeys: ["customer"],
        rightKeys: ["customer"],
        measure: "amount",
      },
    });
    assert.deepEqual(JSON.parse(r.stdout), expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("terminal-control source values remain JSON escaped in text output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "join-impact-terminal-"));
  try {
    await writeFile(
      join(dir, "a.csv"),
      "customer,amount\n\u001b[31m\u009b31m\u202e,1\n",
    );
    await writeFile(
      join(dir, "b.csv"),
      "customer\n\u001b[31m\u009b31m\u202e\n\u001b[31m\u009b31m\u202e\n",
    );
    const r = cli(
      "--left",
      join(dir, "a.csv"),
      "--right",
      join(dir, "b.csv"),
      ...base.slice(4),
      "--format",
      "text",
    );
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes("\u001b"));
    assert.ok(!r.stdout.includes("\u009b"));
    assert.ok(!r.stdout.includes("\u202e"));
    assert.match(r.stdout, /\\u001b/);
    assert.match(r.stdout, /\\u009b/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
for (const v of ["=1+1", "+SUM(A1)", "-3", "@SUM(1)", " \t=1", "\nnormal"])
  test(`formula defensive encoder quotes ${JSON.stringify(v)}`, () =>
    assert.ok(formulaSafeCell(v).startsWith("\"'")));
test("formula helper preserves ordinary text and escapes embedded quotes", () => {
  assert.equal(formulaSafeCell('hello "world"'), '"hello ""world"""');
});

test("explicit undefined optional policy fields normalize deterministically", async () => {
  const q = {
    leftText: "id,n\nx,1\n",
    rightText: "id\nx\n",
    options: { leftKeys: ["id"], rightKeys: ["id"], measure: "n" },
  };
  const a = await auditJoin(q),
    b = await auditJoin({
      ...q,
      options: {
        ...q.options,
        leftDelimiter: undefined,
        join: undefined,
        expect: undefined,
      },
    });
  assert.deepEqual(a, b);
});
test("witness flags truncated invalid measure text", async () => {
  const r = await auditJoin({
    leftText: "id,n\nx," + "x".repeat(200) + "\n",
    rightText: "id\nx\nx\n",
    options: { leftKeys: ["id"], rightKeys: ["id"], measure: "n" },
  });
  assert.equal(r.selected.witnesses[0].samplesTruncated, true);
  assert.equal(r.selected.witnesses[0].leftRecords[0].measure.length, 160);
});

test("CLI equals syntax supports headers beginning with dashes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "join-impact-dashes-"));
  try {
    await writeFile(join(dir, "a.csv"), "--id,amount\nA,2\n");
    await writeFile(join(dir, "b.csv"), "--id\nA\n");
    const r = cli(
      "--left=" + join(dir, "a.csv"),
      "--right=" + join(dir, "b.csv"),
      "--left-key=--id",
      "--right-key=--id",
      "--measure=amount",
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).selected.measure.joined, "2");
    assert.equal(cli("--help=true").status, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const arg of [
  "--join=",
  "--blank=",
  "--normalize=",
  "--format=",
  "--timeout-ms=",
  "--left-delimiter=",
])
  test(`CLI rejects explicit empty ${arg}`, () => {
    const result = cli(...base, arg);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
  });

test("UI report validation accepts real reports and rejects malformed nested data", async () => {
  const { validReport } = await import("../web/report-validation.js");
  const report = await auditJoin({
    leftText: "id,n\na,1\n",
    rightText: "id\na\na\n",
    options: { leftKeys: ["id"], rightKeys: ["id"], measure: "n" },
  });
  assert.equal(validReport(report), true);
  for (const mutate of [
    (r) => delete r.selected.measure.joined,
    (r) => (r.selected.witnesses[0].leftRecords[0].line = "2"),
    (r) => (r.inputs.left.sha256 = "bad"),
    (r) => (r.comparison.outputRowsDelta = 1),
    (r) => (r.selected.witnesses[0].pairs[0].rightRecord = {}),
    (r) => (r.selected.collisions = null),
  ]) {
    const broken = structuredClone(report);
    mutate(broken);
    assert.equal(validReport(broken), false);
  }
});
