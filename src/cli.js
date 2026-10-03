#!/usr/bin/env node
import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { Worker } from "node:worker_threads";
const HELP = `join-impact 0.1.0 — explain a CSV join's measure impact\n\nUsage: node src/cli.js --left orders.csv --right customers.csv\n  --left-key customer --right-key customer --measure amount [options]\n\nRepeat --left-key / --right-key 1–3 times for compound text keys.\nUse --option=value for values beginning with --.\n  --join left|inner             Default: left\n  --blank never|match            Default: never (empty key component)\n  --normalize exact|trim|nfc|trim-nfc    Default: exact\n  --left-delimiter comma|tab|semicolon  Default: comma\n  --right-delimiter comma|tab|semicolon Default: comma\n  --expect-many-to-one           Require unique matchable right keys\n  --max-unmatched N              Maximum unmatched left records\n  --max-expansion DECIMAL        Maximum output / input-left row ratio\n  --format json|text             Default: json\n  --timeout-ms N                 100–60000, default: 20000\n  --help                        Show this help\n  --version                     Print version\n\nFiles: regular UTF-8 CSV, <=4 MiB/file, <=40,000 data records/file.\nNo merged data is exported. JSON is data, not spreadsheet-ready CSV.\nExit 0: audit passed; 1: expectation failed; 2: input/options rejected;\n3: timeout/runtime failure; 130: canceled. Build first: npm run build:core\n`;
class InputError extends Error {}
function options(args) {
  const values = new Map();
  const repeated = new Set(["--left-key", "--right-key"]);
  const flags = new Set(["--help", "--version", "--expect-many-to-one"]);
  const keys = new Set([
    "--left",
    "--right",
    "--left-key",
    "--right-key",
    "--measure",
    "--join",
    "--blank",
    "--normalize",
    "--left-delimiter",
    "--right-delimiter",
    "--max-unmatched",
    "--max-expansion",
    "--format",
    "--timeout-ms",
    ...flags,
  ]);
  for (let i = 0; i < args.length; i++) {
    const token = args[i],
      equal = token.indexOf("=");
    const key = equal < 0 ? token : token.slice(0, equal),
      inline = equal < 0 ? undefined : token.slice(equal + 1);
    if (flags.has(key) && inline !== undefined)
      throw new InputError(`Flag ${key} does not take a value`);
    if (!keys.has(key))
      throw new InputError(`Unknown argument: ${JSON.stringify(key)}`);
    if (values.has(key) && !repeated.has(key))
      throw new InputError(`Repeated argument: ${key}`);
    const value = flags.has(key)
      ? true
      : inline !== undefined
        ? inline
        : args[++i];
    if (
      value === undefined ||
      (inline === undefined &&
        typeof value === "string" &&
        value.startsWith("--"))
    )
      throw new InputError(`Missing value for ${key}`);
    if (repeated.has(key)) values.set(key, [...(values.get(key) || []), value]);
    else values.set(key, value);
  }
  return values;
}
async function boundedRead(path) {
  const entry = await lstat(path);
  if (!entry.isFile())
    throw new InputError(
      "Inputs must be regular files, not directories, devices, or symlinks.",
    );
  const handle = await open(
    path,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW || 0) |
      (constants.O_NONBLOCK || 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new InputError("Inputs must be regular files.");
    const max = 4 * 1024 * 1024;
    if (stat.size > max) throw new InputError("CSV exceeds 4 MiB per file.");
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > max) throw new InputError("CSV exceeds 4 MiB per file.");
    // Preserve a leading BOM in the original digest; parser removes it only for headers.
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, size),
      );
    } catch {
      throw new InputError("Input is not valid UTF-8.");
    }
  } finally {
    await handle.close();
  }
}
function numeric(
  value,
  label,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
) {
  if (
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new InputError(`Invalid ${label}`);
  return Number(value);
}
function terminalSafe(value) {
  return value.replace(
    /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
    (character) =>
      "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
function toText(report) {
  const p = report.selected,
    m = p.measure,
    c = p.counts;
  return (
    [
      "JOIN IMPACT · 0.1.0",
      `Plan: ${report.options.join}; blank=${report.options.blank}; normalization=${p.normalization}`,
      `Selected left measure: ${JSON.stringify(m.column)}`,
      `Total: ${m.original} → ${m.retainedOnce} retained once → ${m.joined} joined`,
      `Dropped contribution: ${m.dropped}; extra replicated contribution: ${m.replicated}; net change: ${m.netChange}`,
      `Absolute dropped: ${m.absoluteDropped}; absolute replicated: ${m.absoluteReplicated}`,
      `Rows: ${c.leftRows} left, ${c.rightRows} right → ${c.outputRows} joined; unmatched ${c.unmatchedLeftRows}; multiplied ${c.multipliedLeftRows}; dropped ${c.droppedLeftRows}`,
      `Measures: ${m.validRows} valid; ${m.blankRows} blank and ${m.invalidRows} invalid excluded`,
      `Normalization versus exact: rows ${report.comparison.outputRowsDelta}; selected total ${report.comparison.joinedTotalDelta}; collision groups ${p.collisionGroupsTotal}`,
      `Causal witness groups: ${p.witnesses.length}/${p.witnessGroupsTotal}${p.witnessesTruncated ? " (bounded)" : ""}`,
      ...p.witnesses.map(
        (w) =>
          `  key=${JSON.stringify(w.key)}${w.keyTruncated ? " (truncated)" : ""} left=${w.leftCount} right=${w.rightCount} output=${w.outputRows} dropped=${w.dropped} replicated=${w.replicated}; source records L=${w.leftRecords.map((r) => r.record).join(",")} R=${w.rightRecords.map((r) => r.record).join(",")}${w.samplesTruncated ? " (samples bounded)" : ""}`,
      ),
      `Expectations: ${report.expectations.passed ? "PASS" : "FAIL"}`,
      ...report.expectations.checks.map(
        (c) =>
          `  ${c.passed ? "PASS" : "FAIL"} ${c.name}: ${c.actual}; limit ${c.limit}`,
      ),
      `Input SHA-256: left=${report.inputs.left.sha256}; right=${report.inputs.right.sha256}`,
      ...report.notes.map((n) => `Note: ${n}`),
    ].join("\n") + "\n"
  );
}
async function main() {
  const args = options(process.argv.slice(2));
  if (args.has("--help")) {
    process.stdout.write(HELP);
    return;
  }
  if (args.has("--version")) {
    process.stdout.write("0.1.0\n");
    return;
  }
  for (const key of [
    "--left",
    "--right",
    "--left-key",
    "--right-key",
    "--measure",
  ])
    if (!args.has(key)) throw new InputError(`Required: ${key}. Use --help.`);
  const format = args.get("--format") ?? "json";
  if (!["json", "text"].includes(format))
    throw new InputError("Format must be json or text.");
  const timeout = numeric(args.get("--timeout-ms") ?? "20000", "timeout", {
    min: 100,
    max: 60000,
  });
  const delimiter = (key) => {
    const name = args.get(key) ?? "comma";
    const d = { comma: ",", tab: "\t", semicolon: ";" }[name];
    if (!d) throw new InputError(`Invalid delimiter for ${key}`);
    return d;
  };
  const [leftText, rightText] = await Promise.all([
    boundedRead(args.get("--left")).catch((error) => {
      throw new InputError(error.message);
    }),
    boundedRead(args.get("--right")).catch((error) => {
      throw new InputError(error.message);
    }),
  ]);
  const expect = {};
  if (args.has("--expect-many-to-one")) expect.manyToOne = true;
  if (args.has("--max-unmatched"))
    expect.maxUnmatchedRows = numeric(
      args.get("--max-unmatched"),
      "max-unmatched",
    );
  if (args.has("--max-expansion"))
    expect.maxExpansion = args.get("--max-expansion");
  const request = {
    leftText,
    rightText,
    options: {
      leftKeys: args.get("--left-key"),
      rightKeys: args.get("--right-key"),
      measure: args.get("--measure"),
      join: args.get("--join") ?? "left",
      blank: args.get("--blank") ?? "never",
      normalization: args.get("--normalize") ?? "exact",
      leftDelimiter: delimiter("--left-delimiter"),
      rightDelimiter: delimiter("--right-delimiter"),
      expect,
    },
  };
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./cli-worker.js", import.meta.url), {
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => {
      const e = new Error("Canceled.");
      e.exitCode = 130;
      finish(e);
    };
    const timer = setTimeout(
      () =>
        finish(new Error(`Audit exceeded ${timeout} ms; worker terminated.`)),
      timeout,
    );
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    worker.on("message", (message) => finish(null, message));
    worker.on("error", (error) => finish(error));
    worker.on("exit", (code) => {
      if (!settled)
        finish(
          new Error(`Audit worker exited before reporting (code ${code}).`),
        );
    });
  });
  if (result.error) {
    const error = new InputError(
      `[${result.error.code}] ${result.error.message}`,
    );
    if (result.error.code === "INTERNAL") error.exitCode = 3;
    throw error;
  }
  const output = terminalSafe(
    format === "json"
      ? JSON.stringify(result.report) + "\n"
      : toText(result.report),
  );
  if (Buffer.byteLength(output) > 1024 * 1024)
    throw new InputError("Serialized report exceeds the 1 MiB output budget.");
  process.stdout.write(output);
  process.exitCode = result.report.expectations.passed ? 0 : 1;
}
main().catch((error) => {
  process.stderr.write(
    terminalSafe(`join-impact: ${JSON.stringify(error.message)}\n`),
  );
  process.exitCode = error.exitCode || (error instanceof InputError ? 2 : 3);
});
