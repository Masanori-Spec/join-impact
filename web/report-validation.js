// Reject malformed worker responses before any part of a report is rendered.
// This checks the complete shape consumed by the UI; the engine owns semantics.
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const string = (v) => typeof v === "string";
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const decimal = (v) => string(v) && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v);
const integer = (v) => string(v) && /^(0|[1-9]\d*)$/.test(v);
const boolean = (v) => typeof v === "boolean";
const array = (v, check) => Array.isArray(v) && v.every(check);
const tuple = (v) => array(v, string) && v.length >= 1 && v.length <= 3;
const fields = (v, names, check) => names.every((name) => check(v[name]));
const record = (v) =>
  object(v) && count(v.record) && v.record >= 2 && count(v.line) && v.line >= 2;
const normalization = (v) => ["exact", "trim", "nfc", "trim-nfc"].includes(v);
function validPlan(plan) {
  if (!object(plan) || !normalization(plan.normalization)) return false;
  const c = plan.counts;
  if (
    !object(c) ||
    !fields(
      c,
      [
        "leftRows",
        "rightRows",
        "matchedLeftRows",
        "unmatchedLeftRows",
        "droppedLeftRows",
        "multipliedLeftRows",
        "blankLeftRows",
        "blankRightRows",
        "rightDuplicateGroups",
      ],
      count,
    ) ||
    !fields(c, ["outputRows", "extraOutputRows"], integer)
  )
    return false;
  const m = plan.measure;
  if (
    !object(m) ||
    !string(m.column) ||
    !fields(m, ["validRows", "blankRows", "invalidRows"], count) ||
    !fields(
      m,
      [
        "original",
        "retainedOnce",
        "joined",
        "dropped",
        "replicated",
        "netChange",
        "absoluteReplicated",
        "absoluteDropped",
      ],
      decimal,
    )
  )
    return false;
  if (
    !fields(plan, ["witnessGroupsTotal", "collisionGroupsTotal"], count) ||
    !fields(
      plan,
      [
        "witnessesTruncated",
        "collisionsTruncated",
        "invalidMeasureSamplesTruncated",
      ],
      boolean,
    )
  )
    return false;
  if (
    !array(
      plan.witnesses,
      (w) =>
        object(w) &&
        tuple(w.key) &&
        boolean(w.keyTruncated) &&
        count(w.leftCount) &&
        count(w.rightCount) &&
        integer(w.outputRows) &&
        boolean(w.unmatched) &&
        fields(
          w,
          ["replicated", "dropped", "absoluteReplicated", "absoluteDropped"],
          decimal,
        ) &&
        boolean(w.samplesTruncated) &&
        array(
          w.leftRecords,
          (r) =>
            record(r) &&
            string(r.measure) &&
            ["valid", "blank", "invalid"].includes(r.measureStatus),
        ) &&
        array(w.rightRecords, record) &&
        array(
          w.pairs,
          (p) =>
            object(p) &&
            count(p.leftRecord) &&
            (p.rightRecord === null || count(p.rightRecord)),
        ),
    )
  )
    return false;
  if (
    !array(
      plan.collisions,
      (c) =>
        object(c) &&
        ["left", "right"].includes(c.side) &&
        tuple(c.key) &&
        boolean(c.keyTruncated) &&
        count(c.rawKeyCount) &&
        count(c.rowCount) &&
        boolean(c.samplesTruncated) &&
        array(
          c.rawSamples,
          (r) =>
            object(r) &&
            tuple(r.key) &&
            boolean(r.keyTruncated) &&
            array(r.records, count),
        ),
    )
  )
    return false;
  return array(
    plan.invalidMeasureSamples,
    (v) => record(v) && string(v.value) && boolean(v.truncated),
  );
}
export function validReport(report) {
  if (
    !object(report) ||
    report.schemaVersion !== "1.0" ||
    !object(report.inputs)
  )
    return false;
  if (
    !["left", "right"].every(
      (s) =>
        object(report.inputs[s]) &&
        fields(report.inputs[s], ["bytes", "rows"], count) &&
        array(report.inputs[s].columns, string) &&
        /^[a-f0-9]{64}$/.test(report.inputs[s].sha256),
    )
  )
    return false;
  const o = report.options;
  if (
    !object(o) ||
    !["left", "inner"].includes(o.join) ||
    !["never", "match"].includes(o.blank) ||
    !normalization(o.normalization) ||
    !tuple(o.leftKeys) ||
    !tuple(o.rightKeys) ||
    o.leftKeys.length !== o.rightKeys.length ||
    !string(o.measure)
  )
    return false;
  if (!validPlan(report.baseline) || !validPlan(report.selected)) return false;
  if (
    !object(report.comparison) ||
    !decimal(report.comparison.outputRowsDelta) ||
    !decimal(report.comparison.joinedTotalDelta) ||
    !Number.isSafeInteger(report.comparison.newCollisionGroups)
  )
    return false;
  if (
    !object(report.expectations) ||
    !boolean(report.expectations.passed) ||
    !Array.isArray(report.expectations.checks) ||
    !object(report.limits)
  )
    return false;
  return array(report.notes, string);
}
