/** Join Impact v0.1: bounded CSV parsing and exact measure audit. No I/O. */
export const LIMITS = Object.freeze({
  bytesPerFile: 4 * 1024 * 1024,
  rowsPerFile: 40_000,
  columns: 64,
  cellChars: 16_384,
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
export class AuditError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuditError";
  }
}
const fail = (code: string, message: string): never => {
  throw new AuditError(code, message);
};
const enc = new TextEncoder();
export interface CsvRow {
  values: string[];
  record: number;
  line: number;
}
export interface CsvTable {
  headers: string[];
  rows: CsvRow[];
  bytes: number;
}
export type Normalization = "exact" | "trim" | "nfc" | "trim-nfc";
export interface Options {
  leftKeys: string[];
  rightKeys: string[];
  measure: string;
  join?: "left" | "inner";
  blank?: "never" | "match";
  normalization?: Normalization;
  leftDelimiter?: string;
  rightDelimiter?: string;
  expect?: {
    manyToOne?: boolean;
    maxUnmatchedRows?: number;
    maxExpansion?: string;
  };
}
export interface Request {
  leftText: string;
  rightText: string;
  options: Options;
}
function validateText(text: string) {
  if (typeof text !== "string") fail("INPUT", "CSV input must be text.");
  if (text.length > LIMITS.bytesPerFile)
    fail("LIMIT_BYTES", "CSV exceeds 4 MiB per file.");
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = text.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff))
        fail("UTF8", "CSV contains an unpaired Unicode surrogate.");
    } else if (c >= 0xdc00 && c <= 0xdfff)
      fail("UTF8", "CSV contains an unpaired Unicode surrogate.");
    else if (c === 0) fail("CONTROL", "CSV contains a NUL character.");
  }
  const bytes = enc.encode(text).length;
  if (bytes > LIMITS.bytesPerFile)
    fail("LIMIT_BYTES", "CSV exceeds 4 MiB per file.");
  return bytes;
}
export function parseCsv(text: string, delimiter = ","): CsvTable {
  if (![",", ";", "\t"].includes(delimiter))
    fail("DELIMITER", "Delimiter must be comma, semicolon, or tab.");
  const bytes = validateText(text);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.length) fail("EMPTY", "CSV needs a header row.");
  const records: CsvRow[] = [];
  let fields: string[] = [],
    value = "",
    state: "start" | "plain" | "quoted" | "closed" = "start";
  let line = 1,
    startLine = 1,
    active = false;
  const field = () => {
    if (value.length > LIMITS.cellChars)
      fail("LIMIT_CELL", `Cell exceeds ${LIMITS.cellChars} characters.`);
    fields.push(value);
    value = "";
    state = "start";
    if (fields.length > LIMITS.columns)
      fail("LIMIT_COLUMNS", "CSV exceeds 64 columns.");
  };
  const row = () => {
    field();
    if (records.length > LIMITS.rowsPerFile)
      fail("LIMIT_ROWS", "CSV exceeds 40,000 data records.");
    records.push({
      values: fields,
      record: records.length + 1,
      line: startLine,
    });
    fields = [];
    active = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    active = true;
    if (state === "quoted") {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else state = "closed";
      } else {
        value += c;
        if (c === "\n") line++;
        else if (c === "\r" && text[i + 1] !== "\n") line++;
      }
    } else if (c === delimiter) field();
    else if (c === "\r" || c === "\n") {
      row();
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++;
      startLine = line;
    } else if (state === "closed")
      fail(
        "CSV_QUOTE",
        `Unexpected character after closing quote on line ${line}.`,
      );
    else if (c === '"') {
      if (state !== "start")
        fail("CSV_QUOTE", `Quote inside unquoted field on line ${line}.`);
      state = "quoted";
    } else {
      state = "plain";
      value += c;
    }
    if (value.length > LIMITS.cellChars)
      fail("LIMIT_CELL", `Cell exceeds ${LIMITS.cellChars} characters.`);
  }
  if (state === "quoted") fail("CSV_QUOTE", "Unclosed quoted field.");
  if (active || fields.length || value.length || state === "closed") row();
  const headers = records.shift()!.values;
  if (headers.some((h) => !h.length))
    fail("HEADER", "Header names must be nonempty.");
  if (headers.some((h) => h.length > LIMITS.headerChars))
    fail("LIMIT_HEADER", "Header name exceeds 128 characters.");
  if (new Set(headers).size !== headers.length)
    fail("HEADER", "Duplicate header names are not allowed.");
  for (const r of records)
    if (r.values.length !== headers.length)
      fail(
        "CSV_WIDTH",
        `Record ${r.record} has ${r.values.length} fields; expected ${headers.length}.`,
      );
  return { headers, rows: records, bytes };
}
const SCALE = 10n ** 12n;
export function parseDecimal(value: string): bigint | null {
  if (!/^[+-]?(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,12})?$/.test(value))
    return null;
  const sign = value.startsWith("-") ? -1n : 1n;
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  return sign * (BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0")));
}
export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE)
    .toString()
    .padStart(12, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? "." + fraction : ""}`;
}
function resolveOptions(input: Options) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("OPTIONS", "Options must be an object.");
  const allowed = [
    "leftKeys",
    "rightKeys",
    "measure",
    "join",
    "blank",
    "normalization",
    "leftDelimiter",
    "rightDelimiter",
    "expect",
  ];
  for (const k of Object.keys(input))
    if (!allowed.includes(k)) fail("OPTIONS", `Unknown option: ${k}`);
  const options = {
    join: "left",
    blank: "never",
    normalization: "exact",
    leftDelimiter: ",",
    rightDelimiter: ",",
    expect: {},
    ...Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ),
  } as Required<Options>;
  if (!["left", "inner"].includes(options.join))
    fail("OPTIONS", "Join must be left or inner.");
  if (!["never", "match"].includes(options.blank))
    fail("OPTIONS", "Blank policy must be never or match.");
  if (!["exact", "trim", "nfc", "trim-nfc"].includes(options.normalization))
    fail("OPTIONS", "Unsupported normalization.");
  for (const side of ["leftKeys", "rightKeys"] as const) {
    const keys = options[side];
    if (
      !Array.isArray(keys) ||
      keys.length < 1 ||
      keys.length > 3 ||
      keys.some((k) => typeof k !== "string") ||
      new Set(keys).size !== keys.length
    )
      fail("OPTIONS", "Select 1–3 distinct key columns on each side.");
  }
  if (options.leftKeys.length !== options.rightKeys.length)
    fail("OPTIONS", "Key column counts must match.");
  if (typeof options.measure !== "string")
    fail("OPTIONS", "Select a left-side measure column.");
  if (
    !options.expect ||
    typeof options.expect !== "object" ||
    Array.isArray(options.expect)
  )
    fail("OPTIONS", "Expectations must be an object.");
  for (const k of Object.keys(options.expect))
    if (!["manyToOne", "maxUnmatchedRows", "maxExpansion"].includes(k))
      fail("OPTIONS", `Unknown expectation: ${k}`);
  const e = options.expect;
  if (e.manyToOne !== undefined && typeof e.manyToOne !== "boolean")
    fail("OPTIONS", "manyToOne must be boolean.");
  if (
    e.maxUnmatchedRows !== undefined &&
    (!Number.isSafeInteger(e.maxUnmatchedRows) || e.maxUnmatchedRows < 0)
  )
    fail("OPTIONS", "maxUnmatchedRows must be a nonnegative safe integer.");
  if (
    e.maxExpansion !== undefined &&
    (typeof e.maxExpansion !== "string" ||
      parseDecimal(e.maxExpansion) === null ||
      e.maxExpansion.startsWith("-") ||
      formatDecimal(parseDecimal(e.maxExpansion)!) !== e.maxExpansion)
  )
    fail(
      "OPTIONS",
      "maxExpansion must be a nonnegative canonical decimal string.",
    );
  // Explicit ordering and copies make JSON independent of caller property insertion order.
  return {
    leftKeys: [...options.leftKeys],
    rightKeys: [...options.rightKeys],
    measure: options.measure,
    join: options.join,
    blank: options.blank,
    normalization: options.normalization,
    leftDelimiter: options.leftDelimiter,
    rightDelimiter: options.rightDelimiter,
    expect: {
      ...(e.manyToOne === undefined ? {} : { manyToOne: e.manyToOne }),
      ...(e.maxUnmatchedRows === undefined
        ? {}
        : { maxUnmatchedRows: e.maxUnmatchedRows }),
      ...(e.maxExpansion === undefined ? {} : { maxExpansion: e.maxExpansion }),
    },
  };
}
const abs = (n: bigint) => (n < 0n ? -n : n);
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function display(value: string) {
  return {
    value: value.slice(
      0,
      LIMITS.displayChars -
        (/[\uD800-\uDBFF]/.test(value[LIMITS.displayChars - 1] || "") ? 1 : 0),
    ),
    truncated: value.length > LIMITS.displayChars,
  };
}
function displayKey(key: string[]) {
  return {
    key: key.map((k) => display(k).value),
    keyTruncated: key.some((k) => k.length > LIMITS.displayChars),
  };
}
function normalize(key: string[], policy: Normalization) {
  return key.map((value) => {
    if (policy === "trim" || policy === "trim-nfc") value = value.trim();
    if (policy === "nfc" || policy === "trim-nfc")
      value = value.normalize("NFC");
    return value;
  });
}
type Resolved = ReturnType<typeof resolveOptions>;
type Group = {
  key: string[];
  rows: CsvRow[];
  raw: Map<string, { key: string[]; count: number; records: number[] }>;
};
function groups(table: CsvTable, keys: number[], normalization: Normalization) {
  const result = new Map<string, Group>();
  for (const row of table.rows) {
    const raw = keys.map((k) => row.values[k]);
    const key = normalization === "exact" ? raw : normalize(raw, normalization);
    const encoded = JSON.stringify(key);
    let group = result.get(encoded);
    if (!group) {
      group = { key, rows: [], raw: new Map() };
      result.set(encoded, group);
    }
    group.rows.push(row);
    if (normalization === "exact") continue;
    const rawId = JSON.stringify(raw);
    let source = group.raw.get(rawId);
    if (!source) {
      source = { key: raw, count: 0, records: [] };
      group.raw.set(rawId, source);
    }
    source.count++;
    if (source.records.length < LIMITS.recordSamples)
      source.records.push(row.record);
  }
  return result;
}
function plan(
  left: CsvTable,
  right: CsvTable,
  options: Resolved,
  normalization: Normalization,
) {
  const lg = groups(
    left,
    options.leftKeys.map((k) => left.headers.indexOf(k)),
    normalization,
  );
  const rg = groups(
    right,
    options.rightKeys.map((k) => right.headers.indexOf(k)),
    normalization,
  );
  const measureIndex = left.headers.indexOf(options.measure);
  const matchable = (g: Group) =>
    options.blank === "match" || !g.key.includes("");
  const counts = {
    leftRows: left.rows.length,
    rightRows: right.rows.length,
    outputRows: 0n,
    matchedLeftRows: 0,
    unmatchedLeftRows: 0,
    droppedLeftRows: 0,
    multipliedLeftRows: 0,
    extraOutputRows: 0n,
    blankLeftRows: 0,
    blankRightRows: 0,
    rightDuplicateGroups: 0,
  };
  const sums = {
    original: 0n,
    retainedOnce: 0n,
    joined: 0n,
    dropped: 0n,
    replicated: 0n,
    netChange: 0n,
    absoluteReplicated: 0n,
    absoluteDropped: 0n,
  };
  let validRows = 0,
    blankRows = 0,
    invalidRows = 0;
  const invalidMeasureSamples: {
    record: number;
    line: number;
    value: string;
    truncated: boolean;
  }[] = [];
  for (const row of left.rows) {
    const v = row.values[measureIndex],
      amount = parseDecimal(v);
    if (amount !== null) validRows++;
    else if (v === "") blankRows++;
    else {
      invalidRows++;
      if (invalidMeasureSamples.length < LIMITS.invalidSamples)
        invalidMeasureSamples.push({
          record: row.record,
          line: row.line,
          ...display(v),
        });
    }
  }
  type Witness = {
    key: string[];
    keyTruncated: boolean;
    leftCount: number;
    rightCount: number;
    outputRows: string;
    unmatched: boolean;
    replicated: string;
    dropped: string;
    absoluteReplicated: string;
    absoluteDropped: string;
    leftRecords: {
      record: number;
      line: number;
      measure: string;
      measureStatus: "valid" | "blank" | "invalid";
    }[];
    rightRecords: { record: number; line: number }[];
    pairs: { leftRecord: number; rightRecord: number | null }[];
    samplesTruncated: boolean;
  };
  const candidates: { sort: string; severity: bigint; witness: Witness }[] = [];
  let witnessGroupsTotal = 0;
  const rank = (
    a: { severity: bigint; sort: string },
    b: { severity: bigint; sort: string },
  ) =>
    a.severity > b.severity
      ? -1
      : a.severity < b.severity
        ? 1
        : order(a.sort, b.sort);
  for (const [id, g] of lg) {
    const rightGroup = matchable(g) ? rg.get(id) : undefined;
    const n = rightGroup?.rows.length ?? 0,
      m = options.join === "left" ? Math.max(1, n) : n;
    const output = BigInt(g.rows.length) * BigInt(m);
    counts.outputRows += output;
    if (g.key.includes("")) counts.blankLeftRows += g.rows.length;
    if (n) counts.matchedLeftRows += g.rows.length;
    else counts.unmatchedLeftRows += g.rows.length;
    if (m === 0) counts.droppedLeftRows += g.rows.length;
    if (m > 1) {
      counts.multipliedLeftRows += g.rows.length;
      counts.extraOutputRows += BigInt(g.rows.length) * BigInt(m - 1);
    }
    let groupSum = 0n,
      groupAbs = 0n;
    for (const row of g.rows) {
      const amount = parseDecimal(row.values[measureIndex]);
      if (amount !== null) {
        groupSum += amount;
        groupAbs += abs(amount);
      }
    }
    const retained = m ? groupSum : 0n,
      joined = groupSum * BigInt(m),
      dropped = groupSum - retained,
      replicated = joined - retained;
    const absRep = m > 1 ? groupAbs * BigInt(m - 1) : 0n,
      absDrop = m === 0 ? groupAbs : 0n;
    sums.original += groupSum;
    sums.retainedOnce += retained;
    sums.joined += joined;
    sums.dropped += dropped;
    sums.replicated += replicated;
    sums.absoluteReplicated += absRep;
    sums.absoluteDropped += absDrop;
    if (m !== 1) {
      witnessGroupsTotal++;
      const ranking = { sort: id, severity: absRep + absDrop };
      if (
        candidates.length === LIMITS.witnessGroups &&
        rank(ranking, candidates[candidates.length - 1]) >= 0
      )
        continue;
      const pairs: { leftRecord: number; rightRecord: number | null }[] = [];
      for (const a of g.rows.slice(0, LIMITS.pairSamples)) {
        if (!n) {
          if (pairs.length < LIMITS.pairSamples)
            pairs.push({ leftRecord: a.record, rightRecord: null });
        } else
          for (const b of rightGroup!.rows.slice(0, LIMITS.pairSamples)) {
            if (pairs.length >= LIMITS.pairSamples) break;
            pairs.push({ leftRecord: a.record, rightRecord: b.record });
          }
        if (pairs.length >= LIMITS.pairSamples) break;
      }
      const witness: Witness = {
        ...displayKey(g.key),
        leftCount: g.rows.length,
        rightCount: n,
        outputRows: output.toString(),
        unmatched: n === 0,
        replicated: formatDecimal(replicated),
        dropped: formatDecimal(dropped),
        absoluteReplicated: formatDecimal(absRep),
        absoluteDropped: formatDecimal(absDrop),
        leftRecords: g.rows.slice(0, LIMITS.recordSamples).map((r) => ({
          record: r.record,
          line: r.line,
          measure: display(r.values[measureIndex]).value,
          measureStatus:
            parseDecimal(r.values[measureIndex]) !== null
              ? "valid"
              : r.values[measureIndex] === ""
                ? "blank"
                : "invalid",
        })),
        rightRecords: (rightGroup?.rows ?? [])
          .slice(0, LIMITS.recordSamples)
          .map((r) => ({ record: r.record, line: r.line })),
        pairs,
        samplesTruncated:
          g.rows
            .slice(0, LIMITS.recordSamples)
            .some((r) => r.values[measureIndex].length > LIMITS.displayChars) ||
          g.rows.length > LIMITS.recordSamples ||
          n > LIMITS.recordSamples ||
          (n ? output : BigInt(g.rows.length)) > BigInt(LIMITS.pairSamples),
      };
      candidates.push({ ...ranking, witness });
      candidates.sort(rank);
      if (candidates.length > LIMITS.witnessGroups) candidates.pop();
    }
  }
  for (const g of rg.values()) {
    if (g.key.includes("")) counts.blankRightRows += g.rows.length;
    if (matchable(g) && g.rows.length > 1) counts.rightDuplicateGroups++;
  }
  sums.netChange = sums.joined - sums.original;
  candidates.sort((a, b) =>
    a.severity > b.severity
      ? -1
      : a.severity < b.severity
        ? 1
        : order(a.sort, b.sort),
  );
  const collisionCandidates: {
    side: "left" | "right";
    key: string[];
    keyTruncated: boolean;
    rawKeyCount: number;
    rowCount: number;
    rawSamples: { key: string[]; keyTruncated: boolean; records: number[] }[];
    samplesTruncated: boolean;
    sort: string;
  }[] = [];
  for (const [side, map] of [
    ["left", lg],
    ["right", rg],
  ] as const)
    for (const [id, g] of map)
      if (g.raw.size > 1) {
        const raws = [...g.raw]
          .sort(([a], [b]) => order(a, b))
          .slice(0, LIMITS.collisionRawSamples)
          .map(([, r]) => ({ ...displayKey(r.key), records: r.records }));
        collisionCandidates.push({
          side,
          ...displayKey(g.key),
          rawKeyCount: g.raw.size,
          rowCount: g.rows.length,
          rawSamples: raws,
          samplesTruncated:
            g.raw.size > LIMITS.collisionRawSamples ||
            [...g.raw.values()].some((r) => r.count > LIMITS.recordSamples),
          sort: side + id,
        });
      }
  collisionCandidates.sort((a, b) => order(a.sort, b.sort));
  return {
    normalization,
    counts: {
      ...counts,
      outputRows: counts.outputRows.toString(),
      extraOutputRows: counts.extraOutputRows.toString(),
    },
    measure: {
      column: options.measure,
      validRows,
      blankRows,
      invalidRows,
      ...Object.fromEntries(
        Object.entries(sums).map(([k, v]) => [k, formatDecimal(v)]),
      ),
    } as {
      column: string;
      validRows: number;
      blankRows: number;
      invalidRows: number;
    } & Record<keyof typeof sums, string>,
    witnesses: candidates.slice(0, LIMITS.witnessGroups).map((c) => c.witness),
    witnessGroupsTotal,
    witnessesTruncated: witnessGroupsTotal > LIMITS.witnessGroups,
    collisions: collisionCandidates
      .slice(0, LIMITS.collisionGroups)
      .map(({ sort, ...c }) => c),
    collisionGroupsTotal: collisionCandidates.length,
    collisionsTruncated: collisionCandidates.length > LIMITS.collisionGroups,
    invalidMeasureSamples,
    invalidMeasureSamplesTruncated: invalidRows > LIMITS.invalidSamples,
  };
}
export function analyzeJoin(request: Request) {
  if (!request || typeof request !== "object")
    fail("INPUT", "Audit request must be an object.");
  const options = resolveOptions(request.options);
  const left = parseCsv(request.leftText, options.leftDelimiter),
    right = parseCsv(request.rightText, options.rightDelimiter);
  for (const [side, table, keys] of [
    ["left", left, options.leftKeys],
    ["right", right, options.rightKeys],
  ] as const)
    for (const k of keys)
      if (!table.headers.includes(k))
        fail("COLUMN", `Missing ${side} key column: ${k}`);
  if (!left.headers.includes(options.measure))
    fail("COLUMN", `Missing left measure column: ${options.measure}`);
  const baseline = plan(left, right, options, "exact"),
    selected =
      options.normalization === "exact"
        ? baseline
        : plan(left, right, options, options.normalization);
  const checks: {
    name: string;
    passed: boolean;
    actual: string;
    limit: string;
  }[] = [];
  const e = options.expect;
  if (e.manyToOne)
    checks.push({
      name: "many-to-one",
      passed: selected.counts.rightDuplicateGroups === 0,
      actual: String(selected.counts.rightDuplicateGroups),
      limit: "0 duplicate matchable right key groups",
    });
  if (e.maxUnmatchedRows !== undefined)
    checks.push({
      name: "max-unmatched-rows",
      passed: selected.counts.unmatchedLeftRows <= e.maxUnmatchedRows,
      actual: String(selected.counts.unmatchedLeftRows),
      limit: String(e.maxUnmatchedRows),
    });
  if (e.maxExpansion !== undefined) {
    const n = BigInt(selected.counts.outputRows),
      d = BigInt(selected.counts.leftRows);
    checks.push({
      name: "max-expansion",
      passed: d === 0n || n * SCALE <= parseDecimal(e.maxExpansion)! * d,
      actual: `${n}/${d}`,
      limit: e.maxExpansion,
    });
  }
  const report = {
    schemaVersion: "1.0",
    inputs: {
      left: {
        bytes: left.bytes,
        rows: left.rows.length,
        columns: left.headers,
      },
      right: {
        bytes: right.bytes,
        rows: right.rows.length,
        columns: right.headers,
      },
    },
    options,
    baseline,
    selected,
    comparison: {
      outputRowsDelta: (
        BigInt(selected.counts.outputRows) - BigInt(baseline.counts.outputRows)
      ).toString(),
      joinedTotalDelta: formatDecimal(
        parseDecimalOutput(selected.measure.joined) -
          parseDecimalOutput(baseline.measure.joined),
      ),
      newCollisionGroups:
        selected.collisionGroupsTotal - baseline.collisionGroupsTotal,
    },
    expectations: { passed: checks.every((c) => c.passed), checks },
    limits: LIMITS,
    notes: [
      "Every left CSV data record is treated as one fact; business grain is not inferred.",
      "Blank and invalid measures are excluded from every total; their records still count.",
      "NULL and null are literal text keys. Blank means an empty component after normalization.",
      "Signed totals can cancel. Inspect affected rows and absolute contributions.",
      "Witnesses are bounded samples, not a merged dataset. Record numbers include the header; line numbers are physical start lines.",
      "Normalization comparisons describe effects; more matches are not necessarily better.",
    ],
  };
  assertReportBudget(report);
  return report;
}
// Internal totals can exceed the input decimal length bound.
function parseDecimalOutput(value: string) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return (
    (BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0"))) *
    (negative ? -1n : 1n)
  );
}
function assertReportBudget(report: unknown) {
  if (enc.encode(JSON.stringify(report)).length + 1 > LIMITS.reportBytes)
    fail(
      "LIMIT_REPORT",
      "Report exceeds the 1 MiB output budget. Reduce selected key text or audit a smaller file.",
    );
}
export async function auditJoin(request: Request) {
  const report = analyzeJoin(request);
  async function sha256(text: string) {
    const bytes = new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", enc.encode(text)),
    );
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const [left, right] = await Promise.all([
    sha256(request.leftText),
    sha256(request.rightText),
  ]);
  const result = {
    ...report,
    inputs: {
      left: { sha256: left, ...report.inputs.left },
      right: { sha256: right, ...report.inputs.right },
    },
  };
  assertReportBudget(result);
  return result;
}
/** Spreadsheet-safe CSV cell encoding, for defensive downstream use. The CLI exports JSON/text only. */
export function formulaSafeCell(value: string): string {
  const safe =
    /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value)
      ? "'" + value
      : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
