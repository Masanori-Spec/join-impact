import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { auditJoin, LIMITS } from "../../build/engine.js";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";
const artifactDir =
  process.env.BROWSER_ARTIFACT_DIR || "tests/browser/artifacts";
await mkdir(artifactDir, { recursive: true });
const results = [];
const pageErrors = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
} catch (error) {
  await writeFile(
    `${artifactDir}/results.json`,
    JSON.stringify(
      {
        stage: "launch",
        status: "blocked",
        testsRun: 0,
        error: error.message,
        results,
      },
      null,
      2,
    ),
  );
  console.error(
    "Browser launch failed; no scenarios ran. Sandbox remains enabled.",
  );
  throw error;
}
const defaults = {
  leftText: "customer_id,amount\nA,100\nB,50\nC,10\n",
  rightText: "customer_id,segment\nA,retail\nA,online\nB,retail\nB,online\n",
  options: {
    leftKeys: ["customer_id"],
    rightKeys: ["customer_id"],
    measure: "amount",
    join: "left",
    blank: "never",
    normalization: "exact",
    leftDelimiter: ",",
    rightDelimiter: ",",
  },
};
const defaultReport = await auditJoin(defaults);
async function setup(page, language = "en") {
  await page.goto(baseURL);
  await page.locator("#language").selectOption(language);
}
async function ready(page) {
  await page.locator("#results").waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document.querySelector("#audit").getAttribute("aria-busy") === "false",
  );
  assert.equal(await page.locator("#error").isVisible(), false);
  assert.equal(await page.locator("#download").isDisabled(), false);
}
async function fill(page, request = defaults) {
  await page.locator("#left").fill(request.leftText);
  await page.locator("#right").fill(request.rightText);
  for (const side of ["left", "right"]) {
    await page
      .locator(`#${side}-delimiter`)
      .selectOption(
        request.options[`${side}Delimiter`] === "\t"
          ? "tab"
          : request.options[`${side}Delimiter`] || ",",
      );
  }
  await page
    .locator("#key-count")
    .selectOption(String(request.options.leftKeys.length));
  for (let index = 0; index < request.options.leftKeys.length; index++) {
    await page
      .locator(`#left-key-${index}`)
      .selectOption(request.options.leftKeys[index]);
    await page
      .locator(`#right-key-${index}`)
      .selectOption(request.options.rightKeys[index]);
  }
  await page.locator("#measure").selectOption(request.options.measure);
  for (const [name, fallback] of [
    ["join", "left"],
    ["blank", "never"],
    ["normalization", "exact"],
  ]) {
    await page
      .locator(`#${name}`)
      .selectOption(request.options[name] || fallback);
  }
}
async function downloadReport(page) {
  const pending = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), "join-impact-report.json");
  let bytes = Buffer.alloc(0);
  for await (const chunk of await download.createReadStream())
    bytes = Buffer.concat([bytes, chunk]);
  assert.ok(
    bytes.length <= LIMITS.reportBytes,
    "download stays within the engine JSON budget",
  );
  return JSON.parse(bytes.toString("utf8"));
}
async function assertParity(page, expected) {
  for (const field of ["original", "retainedOnce", "joined"]) {
    assert.equal(
      await page.locator(`[data-total="${field}"] .total-value`).textContent(),
      expected.selected.measure[field],
    );
  }
  assert.equal(
    await page.locator('[data-metric="affected"] strong').textContent(),
    String(
      expected.selected.counts.multipliedLeftRows +
        expected.selected.counts.droppedLeftRows,
    ),
  );
  assert.equal(
    await page.locator('[data-metric="outputRows"] strong').textContent(),
    expected.selected.counts.outputRows,
  );
  assert.equal(
    await page.locator('[data-metric="absReplicated"] strong').textContent(),
    expected.selected.measure.absoluteReplicated,
  );
  assert.equal(
    await page.locator('[data-metric="absDropped"] strong').textContent(),
    expected.selected.measure.absoluteDropped,
  );
  assert.deepEqual(
    await downloadReport(page),
    expected,
    "download matches actual engine report exactly",
  );
}
async function fakeWorker(page, mode) {
  await page.addInitScript(
    ({ report, mode }) => {
      window.__workers = { created: 0, terminated: 0, posted: 0 };
      window.Worker = class {
        constructor() {
          this.id = ++window.__workers.created;
          if (mode === "constructor" && this.id === 1)
            throw new Error("Simulated constructor error");
        }
        terminate() {
          window.__workers.terminated++;
        }
        postMessage(message) {
          window.__workers.posted++;
          if (mode === "post" && this.id === 1)
            throw new Error("Simulated postMessage failure");
          // Capture handlers now: tests must not accidentally pass merely because
          // production clears .onmessage on termination. Stale closures still fire.
          const deliver = this.onmessage;
          const fail = this.onerror;
          const badMessage = this.onmessageerror;
          if (this.id === 1 && mode === "error") {
            setTimeout(() => fail?.({ preventDefault() {} }), 10);
            return;
          }
          if (this.id === 1 && mode === "messageerror") {
            setTimeout(() => badMessage?.({}), 10);
            return;
          }
          if (
            this.id === 1 &&
            [
              "invalid",
              "invalid-nested",
              "missing-id",
              "undefined",
              "thrown",
            ].includes(mode)
          ) {
            let data = { requestId: message.requestId, report: {} };
            if (mode === "invalid-nested") {
              const broken = structuredClone(report);
              broken.selected.witnesses[0].leftRecords = null;
              data.report = broken;
            }
            if (mode === "undefined") data = undefined;
            if (mode === "missing-id") data = { report };
            if (mode === "thrown")
              data = {
                requestId: message.requestId,
                error: { code: "TEST", message: "Simulated engine error" },
              };
            setTimeout(() => deliver?.({ data }), 10);
            return;
          }
          if (mode === "id")
            setTimeout(
              () =>
                deliver?.({
                  data: {
                    requestId: message.requestId + 100,
                    error: { message: "Stale ID" },
                  },
                }),
              5,
            );
          const output = structuredClone(report);
          if (this.id === 1 && mode === "late")
            output.selected.measure.joined = "999";
          setTimeout(
            () =>
              deliver?.({
                data: { requestId: message.requestId, report: output },
              }),
            this.id === 1 && mode === "late" ? 280 : 30,
          );
          if (mode === "after-complete")
            setTimeout(() => fail?.({ preventDefault() {} }), 110);
        }
      };
    },
    { report: defaultReport, mode },
  );
}
async function fileDelays(page) {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    window.__fileReads = 0;
    File.prototype.arrayBuffer = async function (...args) {
      window.__fileReads++;
      if (this.name.startsWith("bad"))
        throw new Error("Simulated unreadable file");
      const bytes = await original.apply(this, args);
      if (this.name.startsWith("slow"))
        await new Promise((resolve) => setTimeout(resolve, 300));
      return bytes;
    };
  });
}
const file = (name, contents) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
});
async function test(name, fn, viewport = { width: 1440, height: 1100 }) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await fn(page);
    assert.deepEqual(errors, [], "No uncaught browser exceptions");
    results.push({ name, status: "passed" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "failed", error: error.stack });
    await page
      .screenshot({
        path: `${artifactDir}/${name.replace(/[^a-z0-9]+/gi, "-")}-failure.png`,
        fullPage: true,
      })
      .catch(() => {});
    console.error(`FAIL ${name}\n${error.stack}`);
  } finally {
    pageErrors.push(...errors);
    await page.close();
  }
}

await test("initial controls keyboard and Japanese English", async (page) => {
  await page.goto(baseURL);
  await page.keyboard.press("Tab");
  assert.match(
    await page.evaluate(() => document.activeElement.textContent),
    /監査ツールへ/,
  );
  await page.keyboard.press("Enter");
  assert.match(page.url(), /#workspace$/);
  assert.equal(await page.locator("#empty").isVisible(), true);
  assert.equal(await page.locator("#results").isVisible(), false);
  await page.locator("#language").selectOption("en");
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(
    await page.getByLabel("Left CSV · your measure", { exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByLabel("Right CSV · matching data", { exact: true }).count(),
    1,
  );
  assert.equal(await page.getByLabel("Left key 1", { exact: true }).count(), 1);
  assert.match(await page.title(), /Join Impact/);
});
await test("required inputs malformed CSV and recovery", async (page) => {
  await setup(page);
  await page.locator("#audit").click();
  assert.match(
    await page.locator("#error").textContent(),
    /both the left and right/,
  );
  await page.locator("#left").fill('id,amount\n"broken,1');
  await page.locator("#right").fill("id\nA\n");
  await page.locator("#audit").click();
  assert.match(await page.locator("#error").textContent(), /Unclosed/);
  await page.locator("#sample-default").click();
  await ready(page);
});
await test("real default sample totals witnesses export and repeat", async (page) => {
  await setup(page);
  await page.locator("#sample-default").click();
  await ready(page);
  await assertParity(page, defaultReport);
  assert.equal(defaultReport.selected.measure.original, "160");
  assert.equal(defaultReport.selected.measure.joined, "310");
  assert.equal(await page.locator(".witness").count(), 2);
  await page.locator(".witness summary").first().click();
  assert.match(
    await page.locator(".witness-body").first().textContent(),
    /Physical line/,
  );
  for (let i = 0; i < 2; i++) {
    await page.locator("#audit").click();
    await ready(page);
  }
  await assertParity(page, defaultReport);
  await page.screenshot({
    path: `${artifactDir}/desktop-report-en.png`,
    fullPage: true,
  });
});
await test("signed cancellation trap exposes affected records and absolute impact", async (page) => {
  await setup(page);
  await page.locator("#sample-cancel").click();
  await ready(page);
  const request = {
    ...defaults,
    leftText: "key,amount\nA,100\nB,-100\nC,25\n",
    rightText: "key,label\nA,one\nA,two\nB,one\nB,two\nC,one\n",
    options: { ...defaults.options, leftKeys: ["key"], rightKeys: ["key"] },
  };
  const expected = await auditJoin(request);
  await assertParity(page, expected);
  assert.equal(expected.selected.measure.netChange, "0");
  assert.equal(expected.selected.measure.absoluteReplicated, "200");
  assert.match(
    await page.locator(".result-banner").textContent(),
    /2 left records/,
  );
});
await test("Unicode cleanup compares real plans and collision variants", async (page) => {
  await setup(page);
  await page.locator("#sample-unicode").click();
  await ready(page);
  const request = {
    ...defaults,
    leftText: "key,amount\n café ,100\ncafe\u0301,50\nz,10\n",
    rightText: "key,label\ncafé,composed\ncafe\u0301,decomposed\n",
    options: {
      ...defaults.options,
      leftKeys: ["key"],
      rightKeys: ["key"],
      normalization: "trim-nfc",
    },
  };
  const expected = await auditJoin(request);
  await assertParity(page, expected);
  assert.equal(expected.baseline.measure.joined, "160");
  assert.equal(expected.selected.measure.joined, "310");
  assert.equal(
    await page.locator("#normalization-comparison").isVisible(),
    true,
  );
  assert.equal(await page.locator(".collision-card").count(), 2);
  assert.match(await page.locator("#collisions").textContent(), /2 variants/);
});
await test("inner loss and retained once totals match engine", async (page) => {
  await setup(page);
  const request = {
    ...defaults,
    options: { ...defaults.options, join: "inner" },
  };
  await fill(page, request);
  await page.locator("#audit").click();
  await ready(page);
  const expected = await auditJoin(request);
  await assertParity(page, expected);
  assert.equal(expected.selected.measure.retainedOnce, "150");
  assert.equal(expected.selected.measure.joined, "300");
  assert.equal(expected.selected.measure.absoluteDropped, "10");
});
await test("blank policies are explicit and match actual engine", async (page) => {
  await setup(page);
  const request = {
    leftText: "id,amount\n,5\nA,2\n",
    rightText: "id\n\n\nA\n",
    options: { ...defaults.options, leftKeys: ["id"], rightKeys: ["id"] },
  };
  for (const blank of ["never", "match"]) {
    request.options.blank = blank;
    await fill(page, request);
    await page.locator("#audit").click();
    await ready(page);
    await assertParity(page, await auditJoin(request));
  }
});
await test("composite three key mapping delimiters and exact decimal precision", async (page) => {
  await setup(page);
  const request = {
    leftText: "a;b;c;amount\nx;y;z;9007199254740993.123456789012\nx;y;q;0.1\n",
    rightText: "u\tv\tw\nx\ty\tz\nx\ty\tz\nx\ty\tq\n",
    options: {
      ...defaults.options,
      leftKeys: ["a", "b", "c"],
      rightKeys: ["u", "v", "w"],
      leftDelimiter: ";",
      rightDelimiter: "\t",
    },
  };
  await fill(page, request);
  await page.locator("#audit").click();
  await ready(page);
  await assertParity(page, await auditJoin(request));
});
await test("multiline records and invalid measures are visibly accounted for", async (page) => {
  await setup(page);
  const request = {
    leftText:
      'id,amount,note\nA,0.1,"first\nsecond"\nA,USD 5,x\nB,,z\nA,0.2,z\n',
    rightText: "id\nA\nA\n",
    options: { ...defaults.options, leftKeys: ["id"], rightKeys: ["id"] },
  };
  await fill(page, request);
  await page.locator("#audit").click();
  await ready(page);
  const expected = await auditJoin(request);
  await assertParity(page, expected);
  await page.locator(".witness summary").first().click();
  const invalidRow = page.locator("#invalid-measures tbody tr").first();
  assert.deepEqual(await invalidRow.locator("td").allTextContents(), [
    "3",
    "4",
    "USD 5",
  ]);
  assert.match(
    await page.locator("#report-body").textContent(),
    /1 blank \/ 1 invalid/,
  );
});
await test("language keeps current report and input edits always remove stale report", async (page) => {
  await setup(page);
  await page.locator("#sample-default").click();
  await ready(page);
  const input = await page.locator("#left").inputValue();
  await page.locator("#language").selectOption("ja");
  assert.match(await page.locator("#status").textContent(), /監査完了/);
  assert.equal(await page.locator("#left").inputValue(), input);
  await page.locator("#language").selectOption("en");
  await page.locator("#left").fill(input + "D,1\n");
  await page.locator("#left").fill(input + "E,2\n");
  assert.equal(await page.locator("#results").isVisible(), false);
  assert.equal(await page.locator("#download").isDisabled(), true);
  assert.match(await page.locator("#status").textContent(), /Inputs changed/);
});
await test("every policy and mapping change invalidates prior report", async (page) => {
  await setup(page);
  for (const [id, value] of [
    ["join", "inner"],
    ["blank", "match"],
    ["normalization", "trim"],
    ["left-delimiter", ";"],
    ["right-delimiter", ";"],
    ["measure", "customer_id"],
    ["left-key-0", "amount"],
    ["right-key-0", "segment"],
    ["key-count", "2"],
  ]) {
    await page.locator("#sample-default").click();
    await ready(page);
    await page.locator(`#${id}`).selectOption(value);
    assert.equal(await page.locator("#results").isVisible(), false, id);
    assert.equal(await page.locator("#download").isDisabled(), true, id);
  }
});
await test("swap resets mapping and changes left measure safely", async (page) => {
  await setup(page);
  const request = {
    leftText: "a;amount\nX;10\n",
    rightText: "b\tvalue\nX\t20\n",
    options: {
      ...defaults.options,
      leftKeys: ["a"],
      rightKeys: ["b"],
      leftDelimiter: ";",
      rightDelimiter: "\t",
    },
  };
  await fill(page, request);
  await page.locator("#audit").click();
  await ready(page);
  await page.locator("#swap").click();
  assert.equal(await page.locator("#results").isVisible(), false);
  assert.equal(await page.locator("#left").inputValue(), request.rightText);
  assert.equal(await page.locator("#left-key-0").inputValue(), "b");
  assert.equal(await page.locator("#right-key-0").inputValue(), "a");
  assert.equal(await page.locator("#measure").inputValue(), "value");
  assert.equal(await page.locator("#left-delimiter").inputValue(), "tab");
  await page.locator("#audit").click();
  await ready(page);
  await assertParity(
    page,
    await auditJoin({
      leftText: request.rightText,
      rightText: request.leftText,
      options: {
        ...request.options,
        leftKeys: ["b"],
        rightKeys: ["a"],
        measure: "value",
        leftDelimiter: "\t",
        rightDelimiter: ";",
      },
    }),
  );
});
await test("CSV HTML formulas and URLs are inert with zero unexpected requests", async (page) => {
  const requests = [];
  const dialogs = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await setup(page);
  const hostile =
    "<img src=https://untrusted.invalid/tracker onerror=alert(1)>";
  const request = {
    leftText: `id,amount\n${hostile},1\n=HYPERLINK(https://untrusted.invalid),2\n`,
    rightText: `id\n${hostile}\n${hostile}\n=HYPERLINK(https://untrusted.invalid)\n=HYPERLINK(https://untrusted.invalid)\n`,
    options: { ...defaults.options, leftKeys: ["id"], rightKeys: ["id"] },
  };
  await fill(page, request);
  await page.locator("#audit").click();
  await ready(page);
  assert.match(
    await page.locator("#witnesses").textContent(),
    /<img src=https:\/\/untrusted.invalid/,
  );
  assert.match(await page.locator("#witnesses").textContent(), /=HYPERLINK/);
  assert.equal(
    await page
      .locator("#report-body img, #report-body script, #report-body iframe")
      .count(),
    0,
  );
  assert.deepEqual(dialogs, []);
  assert.ok(
    requests.every((url) => new URL(url).origin === new URL(baseURL).origin),
    requests.join("\n"),
  );
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /worker-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:/);
  await assertParity(page, await auditJoin(request));
});
await test("cancel terminates worker and captured late callback cannot revive output", async (page) => {
  await fakeWorker(page, "late");
  await setup(page);
  await fill(page);
  await page.locator("#audit").click();
  await page.locator("#cancel").click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#results").isVisible(), false);
  assert.match(await page.locator("#status").textContent(), /cancelled/);
  assert.equal(await page.evaluate(() => window.__workers.terminated), 1);
  await page.locator("#audit").click();
  await ready(page);
  assert.equal(
    await page.locator('[data-total="joined"] strong').textContent(),
    "310",
  );
});
await test("repeated start ignores captured callbacks from previous workers", async (page) => {
  await fakeWorker(page, "late");
  await setup(page);
  await fill(page);
  await page.locator("#audit").click();
  await page.locator("#audit").click();
  await ready(page);
  await page.waitForTimeout(350);
  assert.equal(
    await page.locator('[data-total="joined"] strong').textContent(),
    "310",
  );
  assert.equal(await page.evaluate(() => window.__workers.created), 2);
});
await test("edit during audit ignores captured stale output even after repeated edits", async (page) => {
  await fakeWorker(page, "late");
  await setup(page);
  await fill(page);
  await page.locator("#audit").click();
  await page.locator("#left").fill(defaults.leftText + "D,1\n");
  await page.locator("#left").fill(defaults.leftText + "E,2\n");
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#results").isVisible(), false);
  assert.match(await page.locator("#status").textContent(), /Inputs changed/);
  await page.locator("#audit").click();
  await ready(page);
});
for (const mode of [
  "constructor",
  "post",
  "error",
  "messageerror",
  "missing-id",
  "undefined",
  "invalid",
  "invalid-nested",
  "thrown",
]) {
  await test(`worker ${mode} failure clears state and recovers`, async (page) => {
    await fakeWorker(page, mode);
    await setup(page);
    await fill(page);
    await page.locator("#audit").click();
    await page.locator("#error").waitFor({ state: "visible" });
    assert.equal(await page.locator("#results").isVisible(), false);
    assert.equal(await page.locator("#cancel").isVisible(), false);
    assert.equal(await page.locator("#audit").isDisabled(), false);
    await page.locator("#audit").click();
    await ready(page);
  });
}
for (const mode of ["id", "after-complete"]) {
  await test(`worker ${mode} ignores irrelevant callback`, async (page) => {
    await fakeWorker(page, mode);
    await setup(page);
    await fill(page);
    await page.locator("#audit").click();
    await ready(page);
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#error").isVisible(), false);
    assert.equal(await page.locator("#results").isVisible(), true);
  });
}
await test("file bounds reject before reading and oversized paste is recoverable", async (page) => {
  await fileDelays(page);
  await setup(page);
  await page
    .locator("#left-file")
    .setInputFiles(
      file("large.csv", Buffer.alloc(LIMITS.bytesPerFile + 1, 65)),
    );
  assert.match(await page.locator("#error").textContent(), /4 MiB/);
  assert.equal(await page.evaluate(() => window.__fileReads), 0);
  await page.locator("#left").fill("x".repeat(LIMITS.bytesPerFile + 1));
  await page.locator("#right").fill(defaults.rightText);
  await page.locator("#audit").click();
  assert.match(await page.locator("#error").textContent(), /4 MiB/);
  await page.locator("#sample-default").click();
  await ready(page);
});
await test("failed file replacement cannot silently audit previous input", async (page) => {
  await fileDelays(page);
  await setup(page);
  await page.locator("#sample-default").click();
  await ready(page);
  await page
    .locator("#left-file")
    .setInputFiles(file("bad-replacement.csv", "id,amount\nNEW,1\n"));
  await page.locator("#error").waitFor({ state: "visible" });
  await page.locator("#audit").click();
  assert.equal(await page.locator("#results").isVisible(), false);
  assert.match(
    await page.locator("#error").textContent(),
    /Reselect it or edit/,
  );
  assert.match(
    await page.locator("#left-file-note").textContent(),
    /Previous input/,
  );
  await page.locator("#right").fill(defaults.rightText + "C,other\n");
  await page.locator("#audit").click();
  assert.match(
    await page.locator("#error").textContent(),
    /Reselect it or edit/,
  );
  await page
    .locator("#left-file")
    .setInputFiles(file("good.csv", defaults.leftText));
  await page.waitForFunction(
    () => document.querySelector("#left-file-note").textContent === "good.csv",
  );
  await page.locator("#audit").click();
  await ready(page);
});
await test("fatal UTF8 rejects invalid bytes and preserves BOM fingerprints", async (page) => {
  await setup(page);
  await page
    .locator("#left-file")
    .setInputFiles(file("invalid.csv", Buffer.from([0xc0, 0xaf])));
  await page.locator("#error").waitFor({ state: "visible" });
  assert.match(await page.locator("#error").textContent(), /could not be read/);
  const withBOM = "\ufeff" + defaults.leftText;
  await page.locator("#left-file").setInputFiles(file("left.csv", withBOM));
  await page
    .locator("#right-file")
    .setInputFiles(file("right.csv", defaults.rightText));
  await page.waitForFunction(
    () =>
      document.querySelector("#left-file-note").textContent === "left.csv" &&
      document.querySelector("#right-file-note").textContent === "right.csv",
  );
  assert.equal(await page.locator("#left").inputValue(), withBOM);
  await page.locator("#audit").click();
  await ready(page);
  await assertParity(page, await auditJoin({ ...defaults, leftText: withBOM }));
});
await test("uploaded CRLF stays distinct from LF with original digest through swap", async (page) => {
  await setup(page);
  const request = {
    leftText: '\ufeffid,amount\r\n"a\r\nb",2\r\n',
    rightText: 'id,amount\r\n"a\nb",3\r\n',
    options: {
      ...defaults.options,
      leftKeys: ["id"],
      rightKeys: ["id"],
      join: "inner",
    },
  };
  await page
    .locator("#left-file")
    .setInputFiles(file("left-crlf.csv", request.leftText));
  await page
    .locator("#right-file")
    .setInputFiles(file("right-mixed.csv", request.rightText));
  await page.waitForFunction(
    () =>
      document.querySelector("#left-file-note").textContent ===
        "left-crlf.csv" &&
      document.querySelector("#right-file-note").textContent ===
        "right-mixed.csv",
  );
  await page.locator("#join").selectOption("inner");
  await page.locator("#audit").click();
  await ready(page);
  const expected = await auditJoin(request);
  assert.equal(expected.selected.counts.matchedLeftRows, 0);
  await assertParity(page, expected);
  // Swap must move exact source text, not textarea-normalized copies.
  await page.locator("#swap").click();
  await page.locator("#audit").click();
  await ready(page);
  await assertParity(
    page,
    await auditJoin({
      ...request,
      leftText: request.rightText,
      rightText: request.leftText,
    }),
  );
  await page.locator("#swap").click();
  await page.locator("#audit").click();
  await ready(page);
  await assertParity(page, expected);
  // Actual editing intentionally makes the textarea's normalized content authoritative.
  const editedText = await page.locator("#left").inputValue();
  await page.locator("#left").fill(editedText + "Z,1\n");
  await page.locator("#audit").click();
  await ready(page);
  const edited = await auditJoin({
    ...request,
    leftText: editedText + "Z,1\n",
  });
  assert.equal(edited.selected.counts.matchedLeftRows, 1);
  await assertParity(page, edited);
});
await test("newest file wins and old file cannot overwrite pasted text", async (page) => {
  await fileDelays(page);
  await setup(page);
  await page
    .locator("#left-file")
    .setInputFiles(file("slow-old.csv", "id,amount\nOLD,1\n"));
  await page
    .locator("#left-file")
    .setInputFiles(file("new.csv", defaults.leftText));
  await page.waitForTimeout(380);
  assert.equal(await page.locator("#left").inputValue(), defaults.leftText);
  await page
    .locator("#left-file")
    .setInputFiles(file("slow-paste.csv", "id,amount\nSTALE,2\n"));
  await page.locator("#left").fill("id,amount\nPASTED,3\n");
  await page.waitForTimeout(380);
  assert.equal(
    await page.locator("#left").inputValue(),
    "id,amount\nPASTED,3\n",
  );
});
await test("pending file blocks audit and swap invalidates its completion", async (page) => {
  await fileDelays(page);
  await setup(page);
  await fill(page);
  await page
    .locator("#left-file")
    .setInputFiles(file("slow-swap.csv", "id,amount\nSTALE,1\n"));
  await page.locator("#audit").click();
  assert.match(await page.locator("#error").textContent(), /still loading/);
  await page.locator("#swap").click();
  await page.waitForTimeout(380);
  assert.equal(await page.locator("#left").inputValue(), defaults.rightText);
  assert.equal(await page.locator("#right").inputValue(), defaults.leftText);
  assert.equal(await page.locator("#results").isVisible(), false);
});
await test("sample replacement cancels both pending reads and file failure recovers", async (page) => {
  await fileDelays(page);
  await setup(page);
  await page
    .locator("#left-file")
    .setInputFiles(file("bad.csv", defaults.leftText));
  await page.locator("#error").waitFor({ state: "visible" });
  assert.match(await page.locator("#error").textContent(), /could not be read/);
  await page
    .locator("#left-file")
    .setInputFiles(file("slow-left.csv", "id,amount\nSTALE,1\n"));
  await page
    .locator("#right-file")
    .setInputFiles(file("slow-right.csv", "id\nSTALE\n"));
  await page.locator("#sample-default").click();
  await ready(page);
  await page.waitForTimeout(380);
  assert.equal(await page.locator("#left").inputValue(), defaults.leftText);
  assert.equal(await page.locator("#right").inputValue(), defaults.rightText);
  await assertParity(page, defaultReport);
});
await test("bounded evidence discloses sampling without truncating audit totals", async (page) => {
  await setup(page);
  const leftText =
    "id,amount\n" + Array.from({ length: 40 }, (_, i) => `K${i},1\n`).join("");
  const rightText =
    "id\n" + Array.from({ length: 40 }, (_, i) => `K${i}\nK${i}\n`).join("");
  const request = {
    leftText,
    rightText,
    options: { ...defaults.options, leftKeys: ["id"], rightKeys: ["id"] },
  };
  await fill(page, request);
  await page.locator("#audit").click();
  await ready(page);
  await assertParity(page, await auditJoin(request));
  assert.equal(await page.locator(".witness").count(), LIMITS.witnessGroups);
  assert.match(
    await page.locator("#witnesses").textContent(),
    /Showing 30 of 40/,
  );
  assert.match(
    await page.locator("#witnesses").textContent(),
    /samples are partial/,
  );
});
await test(
  "mobile layout both languages and long keys fit viewport",
  async (page) => {
    async function assertComparisonFits() {
      const fit = await page
        .locator(".comparison .table-wrap")
        .evaluate((wrapper) => {
          const bounds = wrapper.getBoundingClientRect();
          return {
            scrolls: wrapper.scrollWidth > wrapper.clientWidth + 1,
            headers: [...wrapper.querySelectorAll("th")].map((header) => {
              const cell = header.getBoundingClientRect();
              return {
                text: header.textContent,
                fits:
                  cell.left >= bounds.left - 1 &&
                  cell.right <= bounds.right + 1 &&
                  header.scrollWidth <= header.clientWidth + 1,
              };
            }),
            cellsFit: [...wrapper.querySelectorAll("td")].every(
              (cell) => cell.scrollWidth <= cell.clientWidth + 1,
            ),
          };
        });
      assert.equal(
        fit.scrolls,
        false,
        "comparison needs no horizontal scrolling",
      );
      assert.equal(fit.headers.length, 3);
      assert.ok(
        fit.headers.every((header) => header.fits),
        "all comparison headers are fully inside the visible container",
      );
      assert.ok(fit.cellsFit, "comparison values wrap within their cells");
      return fit;
    }
    await setup(page, "ja");
    await page.locator("#sample-unicode").click();
    await ready(page);
    for (const language of ["ja", "en"]) {
      await page.locator("#language").selectOption(language);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      for (const id of [
        "audit",
        "left",
        "right",
        "join",
        "blank",
        "normalization",
        "key-count",
        "measure",
      ]) {
        const box = await page.locator(`#${id}`).boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 390, `${id} fits`);
        assert.ok(box.height >= 40, `${id} has usable height`);
      }
      const comparison = await assertComparisonFits();
      assert.equal(
        comparison.headers[2].text,
        language === "ja" ? "選択した処理" : "Selected cleanup",
      );
      await page.screenshot({
        path: `${artifactDir}/mobile-report-${language}.png`,
        fullPage: true,
      });
    }
    const key = "x".repeat(160);
    const request = {
      leftText: `id,amount\n${key},999999999999999999999999999999\n`,
      rightText: `id\n${key}\n${key}\n`,
      options: {
        ...defaults.options,
        leftKeys: ["id"],
        rightKeys: ["id"],
        normalization: "trim",
      },
    };
    await fill(page, request);
    await page.locator("#audit").click();
    await ready(page);
    await assertComparisonFits();
    await page.locator(".witness summary").click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  },
  { width: 390, height: 844 },
);
await browser.close();
const failures = results.filter((result) => result.status === "failed");
await writeFile(
  `${artifactDir}/results.json`,
  JSON.stringify(
    {
      stage: "complete",
      status: failures.length ? "failed" : "passed",
      testsRun: results.length,
      failures: failures.length,
      uncaughtErrors: pageErrors,
      results,
    },
    null,
    2,
  ) + "\n",
);
if (failures.length) process.exitCode = 1;
console.log(
  `${results.length - failures.length}/${results.length} browser scenarios passed.`,
);
