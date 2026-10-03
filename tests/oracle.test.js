import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeJoin, auditJoin } from "../build/engine.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/oracle.json", import.meta.url), "utf8"),
);

function comparable(plan) {
  return {
    normalization: plan.normalization,
    counts: plan.counts,
    measure: plan.measure,
    collisionGroupsTotal: plan.collisionGroupsTotal,
  };
}

test("independent oracle provenance and coverage are retained", () => {
  assert.equal(fixture.caseCount, fixture.cases.length);
  assert.ok(fixture.caseCount >= 800);
  assert.match(fixture.reference, /SQLite concrete LEFT\/INNER JOIN/);
  assert.deepEqual(
    [
      ...new Set(fixture.cases.map((c) => c.request.options.leftKeys.length)),
    ].sort(),
    [1, 2, 3],
  );
  assert.deepEqual(
    [
      ...new Set(fixture.cases.map((c) => c.request.options.normalization)),
    ].sort(),
    ["exact", "nfc", "trim", "trim-nfc"],
  );
});

for (const fixtureCase of fixture.cases) {
  test(`SQLite/Decimal materialized oracle: ${fixtureCase.name}`, () => {
    const actual = analyzeJoin(fixtureCase.request);
    assert.deepEqual(
      comparable(actual.baseline),
      fixtureCase.expected.baseline,
    );
    assert.deepEqual(
      comparable(actual.selected),
      fixtureCase.expected.selected,
    );
    assert.deepEqual(actual.comparison, fixtureCase.expected.comparison);
    assert.equal(actual.schemaVersion, "1.0");
    assert.equal(actual.expectations.passed, true);
    assert.equal(
      actual.inputs.left.bytes,
      Buffer.byteLength(fixtureCase.request.leftText),
    );
    assert.equal(
      actual.inputs.right.bytes,
      Buffer.byteLength(fixtureCase.request.rightText),
    );
    assert.equal(actual.inputs.left.rows, actual.selected.counts.leftRows);
    assert.equal(actual.inputs.right.rows, actual.selected.counts.rightRows);
    assert.doesNotThrow(() => JSON.stringify(actual));
    assert.ok(Buffer.byteLength(JSON.stringify(actual)) <= 1024 * 1024);
  });
}

test("public async audit matches the independently verified sync report and hashes exact input", async () => {
  for (const fixtureCase of fixture.cases.filter((_, i) => i % 37 === 0)) {
    const request = {
      ...fixtureCase.request,
      leftText: "\ufeff" + fixtureCase.request.leftText,
    };
    const sync = analyzeJoin(request);
    const asyncReport = await auditJoin(request);
    for (const side of ["left", "right"]) {
      assert.equal(
        asyncReport.inputs[side].sha256,
        createHash("sha256").update(request[`${side}Text`]).digest("hex"),
      );
      const { sha256, ...rest } = asyncReport.inputs[side];
      assert.deepEqual(rest, sync.inputs[side]);
    }
    const { inputs, ...asyncRest } = asyncReport;
    const { inputs: ignored, ...syncRest } = sync;
    assert.deepEqual(asyncRest, syncRest);
  }
});
