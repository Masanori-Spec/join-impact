import { parseCsv, LIMITS } from "../src/engine.ts";
import { validReport } from "./report-validation.js";

const $ = (id) => document.getElementById(id);
const staticJapanese = Object.fromEntries(
  [...document.querySelectorAll("[data-i18n]")].map((node) => [
    node.dataset.i18n,
    node.textContent,
  ]),
);
staticJapanese.title = "結合前に、\n数字の変化を知る。";
const copy = {
  ja: {
    ...staticJapanese,
    failedFile:
      "読み込めなかったファイルがあります。再選択するか、その入力テキストを編集してから監査してください。",
    previousRetained:
      "読み込み失敗。以前の入力を表示しています。再選択または編集が必要です。",
    noColumns: "CSVを入力してください",
    parsed: "{rows}レコード · {columns}列",
    leftKey: "左のキー {n}",
    rightKey: "右のキー {n}",
    changed: "入力が変わりました。監査を再実行してください。",
    swapped: "左右を入れ替えました。キーと集計列を確認してください。",
    running: "監査中… キーごとの件数と正確な合計を計算しています。",
    cancelled: "監査を中止しました。入力はそのままです。",
    completed: "監査完了。現在の入力とルールに対応する結果です。",
    loading: "ファイルを読み込んでいます…",
    needInputs: "左右のCSVを入力してください。",
    pendingRead: "ファイルを読み込み中です。完了後に再実行してください。",
    tooLarge: "各CSVはUTF-8で4 MiB以下にしてください。",
    readError:
      "ファイルを読み取れませんでした。再選択するか、テキストを貼り付けてください。",
    chooseKeys: "各キーと左の集計列を選択してください。",
    workerError: "処理を完了できませんでした。再実行してください。",
    badReport: "不正な応答を受信しました。監査を再実行してください。",
    original: "元の合計",
    retainedOnce: "残存レコードを1回ずつ",
    joined: "結合後の合計",
    affected: "影響を受けた左レコード",
    affectedDetail: "複製 {multiplied} / 脱落 {dropped}",
    outputRows: "結合後の行数",
    outputDetail: "左入力 {left} / 追加 {extra}",
    absReplicated: "複製された金額の絶対値合計",
    absDropped: "脱落した金額の絶対値合計",
    signed: "符号付き: {value}",
    net: "純増減: {value}",
    noImpact: "複製・脱落した左レコードはありません。",
    impact:
      "{rows}件の左レコードが複製または脱落。{net} 合計の差だけでは影響を判断できません。",
    measureExcluded:
      "集計から除外: 空欄 {blank}件 / 無効値 {invalid}件（有効 {valid}件）",
    comparisonTitle: "完全一致と、選んだ正規化を比較",
    comparisonHint:
      "結合方法・空欄の扱いは同じ条件です。正規化は推奨ではなく、変更の影響を表示しています。",
    metric: "指標",
    exactPlan: "完全一致",
    selectedPlan: "選択した処理",
    total: "結合後の合計",
    unmatched: "未一致の左レコード",
    multiplied: "複製される左レコード",
    droppedRows: "脱落する左レコード",
    collisionGroups: "正規化の衝突グループ",
    comparisonDelta:
      "行数の差 {rows} / 合計の差 {total} / 衝突グループ数の差 {collisions}",
    witnessesTitle: "なぜ変わる？ 原因のキーとレコード",
    witnessesHint:
      "影響金額の絶対値が大きいグループ順。レコード番号はヘッダーを含み、物理行は各レコードの開始行です。",
    noWitnesses: "複製・脱落の原因グループはありません。",
    witnessSummary: "キー {key} · 左 {left} × 右 {right} → {output}行",
    witnessAmounts:
      "符号付き複製 {replicated} / 脱落 {dropped} · 絶対値: 複製 {absoluteReplicated} / 脱落 {absoluteDropped}",
    unmatchedKey: "一致する右レコードなし",
    leftRecords: "左のレコード",
    rightRecords: "右のレコード",
    record: "レコード番号",
    physical: "物理行",
    amount: "集計値",
    state: "状態",
    valid: "有効",
    blankValue: "空欄",
    invalid: "無効",
    noRight: "対応する右レコードなし",
    pairs: "対応のサンプル（左レコード → 右レコード）: {pairs}",
    nullRight: "なし",
    samplesTruncated:
      "証拠サンプルは一部のみです。集計は全対象レコードに基づいています。",
    groupsShown: "{shown} / {total}グループを表示",
    keyTruncated: "長いキーの表示は省略されています。",
    collisionTitle: "正規化で同じになる、異なるキー",
    collisionHint:
      "各テーブル内で、元は異なるキーが同じキーにまとまった箇所です。",
    noCollisions: "選択した処理での衝突はありません。",
    collisionSummary: "{side} · {count}種類 / {rows}レコード → {key}",
    leftSide: "左",
    rightSide: "右",
    rawRecords: "{key} · レコード {records}",
    invalidTitle: "除外した無効な集計値",
    invalidHint:
      "空白付き・通貨・指数・桁区切りなどは数値として受け付けません。CSV内の値をそのまま表示しています。",
    rawValue: "入力値",
    evidenceTitle: "入力の指紋・計算条件・限界",
    fingerprint: "{side}: {rows}レコード / {columns}列 / {bytes} UTF-8 bytes",
    exactDecimals:
      "小数演算は正確です。元の合計 − 脱落 + 複製 = 結合後の合計。符号付きの増減と、影響の絶対値合計を併記しています。",
    context: "{join}結合 · 空欄: {blank} · {normalization} · 集計列: {measure}",
    exportUnavailable: "現在の入力に対応する監査結果がありません。",
  },
  en: {
    skip: "Skip to audit tool",
    local: "Processed on your device",
    eyebrow: "CSV JOIN · MEASURE IMPACT AUDIT",
    title: "Know what a join\ndoes to your totals.",
    intro:
      "See why a CSV join multiplies or drops your numbers. Follow the change from exact totals to the records that caused it.",
    privacy:
      "At runtime, processing stays in your browser. No CSV uploads, external APIs, or analytics tracking.",
    preview: "DUPLICATE KEYS? · SYNTHETIC EXAMPLE",
    originalShort: "Original total",
    joinedShort: "After the join",
    previewNote:
      "More rows can mean repeated amounts. Find the records behind the change.",
    try: "Start with a small example",
    sampleSafe: "Loads synthetic data and runs an audit",
    sampleDefault: "160 → 310",
    sampleCancel: "Cancellation trap",
    sampleUnicode: "Unicode cleanup",
    step1: "01 / INPUT",
    inputs: "Bring two CSV tables",
    swap: "Swap tables ⇄",
    left: "Left CSV · your measure",
    leftHint: "The table with the amounts or quantities to audit",
    right: "Right CSV · matching data",
    rightHint: "The table joined to each left record by its key",
    chooseFile: "Choose a CSV file",
    delimiter: "Delimiter",
    comma: "Comma",
    tab: "Tab",
    semicolon: "Semicolon",
    limits:
      "UTF-8 · Up to 4 MiB, 40,000 rows, and 64 columns per file. Header required. File line endings are preserved; editing text uses browser-normalized LF line endings.",
    step2: "02 / JOIN POLICY",
    policy: "Make the join rules explicit",
    keys: "Join keys",
    measure: "Left measure column",
    decimalNote:
      "Exact decimal arithmetic. Blank and invalid amounts are excluded and counted. No currency symbols, exponents, or thousands separators.",
    joinLabel: "Join type",
    leftJoin: "LEFT · keep every left record",
    innerJoin: "INNER · keep matched records only",
    blankLabel: "Blank key policy",
    blankNever: "Never match blank keys",
    blankMatch: "Match blank keys to blank keys",
    normalizeLabel: "Compare cleanup (optional)",
    exact: "Exact keys only",
    trim: "Trim surrounding whitespace",
    nfc: "Unicode NFC",
    trimNfc: "Trim + Unicode NFC",
    keyNote:
      "Case-sensitive. NULL is literal text. A composite key is blank if any component is empty after cleanup.",
    audit: "Audit join impact ↗",
    cancel: "Cancel",
    emptyTitle: "Every changed total has a cause",
    emptyBody:
      "Choose your CSVs and join rules. Exact totals, affected-record counts, and causal evidence will appear here.",
    step3: "03 / IMPACT REPORT",
    resultTitle: "From changed totals to their cause.",
    download: "Save JSON ↓",
    exportNote:
      "The JSON contains sample keys, amounts, and input SHA-256 fingerprints. Review it before sharing.",
    methodTitle: "What are we counting?",
    method1Title: "Original → retained once → joined",
    method1:
      "Separate amounts lost to unmatched keys from amounts repeated by duplicates. Counts and absolute amounts expose impacts even when positive and negative values cancel.",
    method2Title: "Records and physical lines",
    method2:
      "Record numbers include the header as record 1. With quoted newlines, a record number can differ from its starting physical line.",
    method3Title: "Audit without building the join",
    method3:
      "Exact arithmetic over key counts avoids materializing the Cartesian output. Only evidence samples are capped; audited data is never silently truncated.",
    footer:
      "Descriptive comparison only. This does not establish data correctness or recommend the right join.",
    failedFile:
      "A selected file could not be loaded. Reselect it or edit that input before auditing.",
    previousRetained:
      "Load failed. Previous input is shown; reselect the file or edit the text.",
    noColumns: "Enter CSV first",
    parsed: "{rows} records · {columns} columns",
    leftKey: "Left key {n}",
    rightKey: "Right key {n}",
    changed: "Inputs changed. Run the audit again for a current report.",
    swapped: "Tables swapped. Review the reset keys and measure column.",
    running: "Auditing… counting matches and calculating exact totals.",
    cancelled: "Audit cancelled. Your inputs are unchanged.",
    completed:
      "Audit complete. This report matches the current inputs and rules.",
    loading: "Reading file…",
    needInputs: "Enter both the left and right CSV.",
    pendingRead: "A file is still loading. Run the audit after it finishes.",
    tooLarge: "Each CSV must be no larger than 4 MiB in UTF-8.",
    readError: "The file could not be read. Choose it again or paste its text.",
    chooseKeys: "Select each key and a left measure column.",
    workerError: "Processing could not finish. Please run the audit again.",
    badReport: "An invalid response was received. Please run the audit again.",
    original: "Original total",
    retainedOnce: "Retained once",
    joined: "Joined total",
    affected: "Affected left records",
    affectedDetail: "Multiplied {multiplied} / dropped {dropped}",
    outputRows: "Output rows",
    outputDetail: "Left input {left} / extra {extra}",
    absReplicated: "Absolute replicated amount",
    absDropped: "Absolute dropped amount",
    signed: "Signed: {value}",
    net: "Net change: {value}",
    noImpact: "No left records were multiplied or dropped.",
    impact:
      "{rows} left records were multiplied or dropped. {net}. A net total alone cannot show the full impact.",
    measureExcluded:
      "Excluded from totals: {blank} blank / {invalid} invalid amounts ({valid} valid)",
    comparisonTitle: "Exact keys vs. selected cleanup",
    comparisonHint:
      "Both plans use the same join and blank-key policy. Cleanup is compared, never automatically recommended.",
    metric: "Metric",
    exactPlan: "Exact keys",
    selectedPlan: "Selected cleanup",
    total: "Joined total",
    unmatched: "Unmatched left records",
    multiplied: "Multiplied left records",
    droppedRows: "Dropped left records",
    collisionGroups: "Cleanup collision groups",
    comparisonDelta:
      "Output-row delta {rows} / total delta {total} / collision-group delta {collisions}",
    witnessesTitle: "Why it changed: causal keys and records",
    witnessesHint:
      "Groups are ranked by absolute affected amounts. Record numbers include the header. Physical lines identify where each record starts.",
    noWitnesses: "No multiplied or dropped record groups.",
    witnessSummary: "Key {key} · left {left} × right {right} → {output} rows",
    witnessAmounts:
      "Signed replicated {replicated} / dropped {dropped} · absolute replicated {absoluteReplicated} / dropped {absoluteDropped}",
    unmatchedKey: "No matching right record",
    leftRecords: "Left records",
    rightRecords: "Right records",
    record: "Record",
    physical: "Physical line",
    amount: "Measure",
    state: "Status",
    valid: "Valid",
    blankValue: "Blank",
    invalid: "Invalid",
    noRight: "No matching right records",
    pairs: "Sample record matches (left record → right record): {pairs}",
    nullRight: "none",
    samplesTruncated:
      "Evidence samples are partial. Totals include all audited records.",
    groupsShown: "Showing {shown} of {total} groups",
    keyTruncated: "Long keys have been shortened for display.",
    collisionTitle: "Different raw keys, one cleaned key",
    collisionHint:
      "Within each table, these distinct original keys collapse to the same cleaned key.",
    noCollisions: "No collisions under the selected cleanup.",
    collisionSummary: "{side} · {count} variants / {rows} records → {key}",
    leftSide: "Left",
    rightSide: "Right",
    rawRecords: "{key} · records {records}",
    invalidTitle: "Invalid amounts excluded from totals",
    invalidHint:
      "Whitespace, currency symbols, exponents, and thousands separators are not accepted as decimal amounts. Values below are shown as raw text.",
    rawValue: "Raw value",
    evidenceTitle: "Input fingerprints, calculation rules, and limits",
    fingerprint:
      "{side}: {rows} records / {columns} columns / {bytes} UTF-8 bytes",
    exactDecimals:
      "Decimal arithmetic is exact. Original − dropped + replicated = joined. Signed effects and absolute affected amounts are shown separately.",
    context:
      "{join} join · blanks: {blank} · {normalization} · measure: {measure}",
    exportUnavailable: "There is no report for the current inputs.",
  },
};
let locale = "ja";
let statusKey = "";
let revision = 0;
let requestSequence = 0;
let active = null;
let report = null;
const sides = ["left", "right"];
const headers = { left: [], right: [] };
const fileTokens = { left: 0, right: 0 };
const reading = { left: false, right: false };
const fileFailures = { left: false, right: false };
// Textareas normalize line endings. Keep exact decoded uploads (including BOM
// and quoted CRLF) until the user actually edits the corresponding textarea.
const originalText = { left: null, right: null };
const sourceText = (side) => originalText[side] ?? $(side).value;
const byteLimit = LIMITS.bytesPerFile;
const t = (key, values = {}) =>
  (copy[locale][key] ?? copy.en[key] ?? key).replace(/\{(\w+)\}/g, (_, field) =>
    String(values[field] ?? ""),
  );
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function setStatus(key) {
  statusKey = key;
  $("status").textContent = key ? t(key) : "";
}
function showError(message) {
  $("error").textContent = message;
  $("error").hidden = false;
}
function clearError() {
  $("error").hidden = true;
  $("error").textContent = "";
}
function retire() {
  if (active) {
    const old = active;
    active = null;
    old.worker.onmessage = null;
    old.worker.onerror = null;
    old.worker.onmessageerror = null;
    old.worker.terminate();
  }
  $("cancel").hidden = true;
  $("audit").setAttribute("aria-busy", "false");
}
function clearReport() {
  report = null;
  $("results").hidden = true;
  $("report-body").replaceChildren();
  $("empty").hidden = false;
  $("download").disabled = true;
}
function invalidate(key = "changed") {
  revision++;
  retire();
  clearReport();
  clearError();
  setStatus(key);
}
function delimiter(side) {
  return $(`${side}-delimiter`).value === "tab"
    ? "\t"
    : $(`${side}-delimiter`).value;
}
function selectValues() {
  return {
    left: [...document.querySelectorAll(".left-key")].map((s) => s.value),
    right: [...document.querySelectorAll(".right-key")].map((s) => s.value),
    measure: $("measure").value,
  };
}
function optionsFor(select, choices, desired, fallbackIndex = 0) {
  select.replaceChildren();
  if (!choices.length) {
    const option = node("option", t("noColumns"));
    option.value = "";
    select.append(option);
    return;
  }
  for (const value of choices) {
    const option = node("option", value);
    option.value = value;
    select.append(option);
  }
  select.value = choices.includes(desired)
    ? desired
    : (choices[fallbackIndex] ?? choices[0]);
}
function defaultMeasure() {
  return (
    headers.left.find((name) =>
      /^(amount|value|total|revenue|金額|数量)$/i.test(name),
    ) ??
    headers.left[1] ??
    headers.left[0] ??
    ""
  );
}
function buildMappings(preserve = selectValues()) {
  const container = $("key-mappings");
  container.replaceChildren();
  for (let index = 0; index < Number($("key-count").value); index++) {
    const row = node("div", undefined, "mapping-row");
    for (const side of sides) {
      if (side === "right") row.append(node("span", "→"));
      const field = node("div");
      const label = node("label", t(`${side}Key`, { n: index + 1 }));
      label.htmlFor = `${side}-key-${index}`;
      const select = node("select");
      select.id = `${side}-key-${index}`;
      select.className = `${side}-key`;
      optionsFor(select, headers[side], preserve[side]?.[index], index);
      select.addEventListener("change", () => invalidate());
      field.append(label, select);
      row.append(field);
    }
    container.append(row);
  }
  optionsFor($("measure"), headers.left, preserve.measure || defaultMeasure());
}
function refreshHeaders() {
  const selections = selectValues();
  for (const side of sides) {
    const text = sourceText(side);
    headers[side] = [];
    if (!text) {
      $(`${side}-info`).textContent = "";
      continue;
    }
    try {
      if (new TextEncoder().encode(text).length > byteLimit)
        throw new Error(t("tooLarge"));
      const parsed = parseCsv(text, delimiter(side));
      headers[side] = parsed.headers;
      $(`${side}-info`).textContent = t("parsed", {
        rows: parsed.rows.length,
        columns: parsed.headers.length,
      });
    } catch (error) {
      $(`${side}-info`).textContent = error.message;
    }
  }
  buildMappings(selections);
}
function cancelReads() {
  for (const side of sides) {
    fileTokens[side]++;
    reading[side] = false;
    $(`${side}-file`).value = "";
    $(`${side}-file-note`).textContent = "";
  }
}
for (const side of sides) {
  $(side).addEventListener("input", () => {
    originalText[side] = null;
    fileFailures[side] = false;
    fileTokens[side]++;
    reading[side] = false;
    $(`${side}-file`).value = "";
    $(`${side}-file-note`).textContent = "";
    invalidate();
    refreshHeaders();
  });
  $(`${side}-delimiter`).addEventListener("change", () => {
    invalidate();
    refreshHeaders();
  });
  $(`${side}-file`).addEventListener("change", async (event) => {
    const token = ++fileTokens[side];
    const file = event.target.files?.[0];
    fileFailures[side] = false;
    reading[side] = false;
    invalidate();
    $(`${side}-file-note`).textContent = "";
    if (!file) return;
    if (file.size > byteLimit) {
      fileFailures[side] = true;
      $(`${side}-file-note`).textContent = t("previousRetained");
      showError(t("tooLarge"));
      return;
    }
    reading[side] = true;
    $(`${side}-file-note`).textContent = t("loading");
    try {
      const bytes = await file.arrayBuffer();
      if (fileTokens[side] !== token) return;
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
      if (fileTokens[side] !== token) return;
      if (new TextEncoder().encode(text).length > byteLimit)
        throw new Error(t("tooLarge"));
      originalText[side] = text;
      $(side).value = text;
      reading[side] = false;
      $(`${side}-file-note`).textContent = file.name;
      invalidate();
      refreshHeaders();
    } catch (error) {
      if (fileTokens[side] !== token) return;
      reading[side] = false;
      fileFailures[side] = true;
      $(`${side}-file-note`).textContent = t("previousRetained");
      showError(
        error.message === t("tooLarge") ? error.message : t("readError"),
      );
    }
  });
}
$("key-count").addEventListener("change", () => {
  invalidate();
  buildMappings();
});
for (const id of ["measure", "join", "blank", "normalization"]) {
  $(id).addEventListener("change", () => invalidate());
}
$("swap").addEventListener("click", () => {
  invalidate("swapped");
  cancelReads();
  [fileFailures.left, fileFailures.right] = [
    fileFailures.right,
    fileFailures.left,
  ];
  const leftSource = sourceText("left");
  const rightSource = sourceText("right");
  originalText.left = rightSource;
  originalText.right = leftSource;
  $("left").value = rightSource;
  $("right").value = leftSource;
  [$("left-delimiter").value, $("right-delimiter").value] = [
    $("right-delimiter").value,
    $("left-delimiter").value,
  ];
  for (const side of sides) {
    if (fileFailures[side])
      $(`${side}-file-note`).textContent = t("previousRetained");
  }
  $("key-count").value = "1";
  refreshHeaders();
  buildMappings({ left: [], right: [], measure: defaultMeasure() });
});
function readRequest() {
  if (sides.some((side) => reading[side])) throw new Error(t("pendingRead"));
  if (sides.some((side) => fileFailures[side]))
    throw new Error(t("failedFile"));
  if (sides.some((side) => !sourceText(side))) throw new Error(t("needInputs"));
  if (
    sides.some(
      (side) => new TextEncoder().encode(sourceText(side)).length > byteLimit,
    )
  )
    throw new Error(t("tooLarge"));
  // Parsing here gives useful errors before the worker; the engine validates again.
  for (const side of sides) parseCsv(sourceText(side), delimiter(side));
  const values = selectValues();
  if (!values.measure || [...values.left, ...values.right].some((v) => !v))
    throw new Error(t("chooseKeys"));
  return {
    leftText: sourceText("left"),
    rightText: sourceText("right"),
    options: {
      leftKeys: values.left,
      rightKeys: values.right,
      measure: values.measure,
      join: $("join").value,
      blank: $("blank").value,
      normalization: $("normalization").value,
      leftDelimiter: delimiter("left"),
      rightDelimiter: delimiter("right"),
    },
  };
}
function startAudit() {
  retire();
  clearReport();
  clearError();
  let request;
  try {
    request = readRequest();
  } catch (error) {
    setStatus("");
    showError(error.message);
    return;
  }
  const requestId = ++requestSequence;
  const inputRevision = revision;
  let worker;
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    const job = { worker, requestId, inputRevision };
    active = job;
    const isCurrent = () => active === job && revision === inputRevision;
    const fail = (message) => {
      if (!isCurrent()) return;
      retire();
      clearReport();
      setStatus("");
      showError(message);
    };
    worker.onmessage = ({ data }) => {
      if (!isCurrent()) return;
      if (!data || typeof data !== "object") {
        fail(t("badReport"));
        return;
      }
      if (!Number.isSafeInteger(data.requestId)) {
        fail(t("badReport"));
        return;
      }
      if (data.requestId !== requestId) return;
      if (data.error) {
        fail(
          typeof data.error.message === "string"
            ? data.error.message
            : t("workerError"),
        );
        return;
      }
      if (!validReport(data.report)) {
        fail(t("badReport"));
        return;
      }
      try {
        report = data.report;
        renderReport();
        retire();
        $("download").disabled = false;
        setStatus("completed");
      } catch {
        fail(t("badReport"));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      fail(t("workerError"));
    };
    worker.onmessageerror = () => fail(t("badReport"));
    $("cancel").hidden = false;
    $("audit").setAttribute("aria-busy", "true");
    setStatus("running");
    worker.postMessage({ requestId, request });
  } catch {
    if (active?.worker === worker) retire();
    clearReport();
    setStatus("");
    showError(t("workerError"));
  }
}
$("audit").addEventListener("click", startAudit);
$("cancel").addEventListener("click", () => {
  retire();
  clearReport();
  clearError();
  setStatus("cancelled");
});
const samples = {
  default: {
    left: "customer_id,amount\nA,100\nB,50\nC,10\n",
    right: "customer_id,segment\nA,retail\nA,online\nB,retail\nB,online\n",
  },
  cancel: {
    left: "key,amount\nA,100\nB,-100\nC,25\n",
    right: "key,label\nA,one\nA,two\nB,one\nB,two\nC,one\n",
  },
  unicode: {
    left: "key,amount\n café ,100\ncafe\u0301,50\nz,10\n",
    right: "key,label\ncafé,composed\ncafe\u0301,decomposed\n",
    normalization: "trim-nfc",
  },
};
for (const name of Object.keys(samples)) {
  $(`sample-${name}`).addEventListener("click", () => {
    invalidate();
    cancelReads();
    const sample = samples[name];
    for (const side of sides) {
      fileFailures[side] = false;
      originalText[side] = sample[side];
      $(side).value = sample[side];
      $(`${side}-delimiter`).value = ",";
    }
    $("key-count").value = "1";
    $("join").value = "left";
    $("blank").value = "never";
    $("normalization").value = sample.normalization || "exact";
    refreshHeaders();
    buildMappings({
      left: [headers.left[0]],
      right: [headers.right[0]],
      measure: "amount",
    });
    startAudit();
  });
}
function table(headings, rows, className = "") {
  const wrapper = node("div", undefined, `table-wrap ${className}`);
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", headings.join(" / "));
  const tableNode = node("table");
  const head = node("thead");
  const tr = node("tr");
  for (const heading of headings) {
    const th = node("th", heading);
    th.scope = "col";
    tr.append(th);
  }
  head.append(tr);
  const body = node("tbody");
  for (const values of rows) {
    const row = node("tr");
    for (const value of values) row.append(node("td", value));
    body.append(row);
  }
  tableNode.append(head, body);
  wrapper.append(tableNode);
  return wrapper;
}
function reportBox(title, description, className = "") {
  const box = node("section", undefined, `report-box ${className}`);
  box.append(node("h3", t(title)));
  if (description) box.append(node("p", t(description)));
  return box;
}
function keyText(key) {
  return JSON.stringify(key);
}
function renderReport() {
  if (!report) return;
  const plan = report.selected;
  const measure = plan.measure;
  const counts = plan.counts;
  const root = $("report-body");
  root.replaceChildren();
  $("report-context").textContent = t("context", {
    join: report.options.join.toUpperCase(),
    blank: t(report.options.blank === "never" ? "blankNever" : "blankMatch"),
    normalization: t(
      { exact: "exact", trim: "trim", nfc: "nfc", "trim-nfc": "trimNfc" }[
        plan.normalization
      ],
    ),
    measure: measure.column,
  });
  const flow = node("div", undefined, "total-flow");
  for (const field of ["original", "retainedOnce", "joined"]) {
    if (field !== "original") flow.append(node("span", "→", "flow-arrow"));
    const card = node("div", undefined, "total-card");
    card.dataset.total = field;
    card.append(
      node("p", t(field)),
      node("strong", measure[field], "total-value"),
    );
    flow.append(card);
  }
  root.append(flow);
  const affected = counts.multipliedLeftRows + counts.droppedLeftRows;
  root.append(
    node(
      "p",
      affected
        ? t("impact", {
            rows: affected,
            net: t("net", { value: measure.netChange }),
          })
        : t("noImpact"),
      `result-banner${affected ? " warn" : ""}`,
    ),
  );
  const metrics = node("div", undefined, "metric-grid");
  for (const [key, value, detail] of [
    [
      "affected",
      affected,
      t("affectedDetail", {
        multiplied: counts.multipliedLeftRows,
        dropped: counts.droppedLeftRows,
      }),
    ],
    [
      "outputRows",
      counts.outputRows,
      t("outputDetail", {
        left: counts.leftRows,
        extra: counts.extraOutputRows,
      }),
    ],
    [
      "absReplicated",
      measure.absoluteReplicated,
      t("signed", { value: measure.replicated }),
    ],
    [
      "absDropped",
      measure.absoluteDropped,
      t("signed", { value: measure.dropped }),
    ],
  ]) {
    const metric = node("div", undefined, "metric");
    metric.dataset.metric = key;
    metric.append(
      node("span", t(key)),
      node("strong", value),
      node("p", detail),
    );
    metrics.append(metric);
  }
  root.append(metrics);
  root.append(
    node(
      "p",
      t("measureExcluded", {
        blank: measure.blankRows,
        invalid: measure.invalidRows,
        valid: measure.validRows,
      }),
      measure.blankRows || measure.invalidRows ? "notice" : "help",
    ),
  );
  if (plan.normalization !== "exact") {
    const baseline = report.baseline;
    const compare = reportBox(
      "comparisonTitle",
      "comparisonHint",
      "comparison",
    );
    compare.id = "normalization-comparison";
    compare.append(
      table(
        [t("metric"), t("exactPlan"), t("selectedPlan")],
        [
          [t("outputRows"), baseline.counts.outputRows, counts.outputRows],
          [t("total"), baseline.measure.joined, measure.joined],
          [
            t("unmatched"),
            baseline.counts.unmatchedLeftRows,
            counts.unmatchedLeftRows,
          ],
          [
            t("multiplied"),
            baseline.counts.multipliedLeftRows,
            counts.multipliedLeftRows,
          ],
          [
            t("droppedRows"),
            baseline.counts.droppedLeftRows,
            counts.droppedLeftRows,
          ],
          [
            t("collisionGroups"),
            baseline.collisionGroupsTotal,
            plan.collisionGroupsTotal,
          ],
        ],
      ),
    );
    compare.append(
      node(
        "p",
        t("comparisonDelta", {
          rows: report.comparison.outputRowsDelta,
          total: report.comparison.joinedTotalDelta,
          collisions: report.comparison.newCollisionGroups,
        }),
        "help",
      ),
    );
    root.append(compare);
  }
  const witnesses = reportBox("witnessesTitle", "witnessesHint");
  witnesses.id = "witnesses";
  witnesses.append(
    node(
      "p",
      t("groupsShown", {
        shown: plan.witnesses.length,
        total: plan.witnessGroupsTotal,
      }),
      "help",
    ),
  );
  if (!plan.witnesses.length) witnesses.append(node("p", t("noWitnesses")));
  for (const witness of plan.witnesses) {
    const item = node("details", undefined, "witness");
    item.append(
      node(
        "summary",
        t("witnessSummary", {
          key: keyText(witness.key),
          left: witness.leftCount,
          right: witness.rightCount,
          output: witness.outputRows,
        }),
      ),
    );
    const body = node("div", undefined, "witness-body");
    if (witness.unmatched) body.append(node("p", t("unmatchedKey")));
    body.append(node("p", t("witnessAmounts", witness)));
    if (witness.keyTruncated)
      body.append(node("p", t("keyTruncated"), "notice"));
    const grid = node("div", undefined, "witness-grid");
    const left = node("div");
    left.append(
      node("h4", t("leftRecords")),
      table(
        [t("record"), t("physical"), t("amount"), t("state")],
        witness.leftRecords.map((r) => [
          r.record,
          r.line,
          r.measure,
          t(r.measureStatus === "blank" ? "blankValue" : r.measureStatus),
        ]),
      ),
    );
    const right = node("div");
    right.append(node("h4", t("rightRecords")));
    if (witness.rightRecords.length)
      right.append(
        table(
          [t("record"), t("physical")],
          witness.rightRecords.map((r) => [r.record, r.line]),
        ),
      );
    else right.append(node("p", t("noRight"), "help"));
    grid.append(left, right);
    body.append(grid);
    body.append(
      node(
        "p",
        t("pairs", {
          pairs:
            witness.pairs
              .map(
                (p) => `${p.leftRecord} → ${p.rightRecord ?? t("nullRight")}`,
              )
              .join("; ") || "—",
        }),
      ),
    );
    if (witness.samplesTruncated)
      body.append(node("p", t("samplesTruncated"), "notice"));
    item.append(body);
    witnesses.append(item);
  }
  if (plan.witnessesTruncated)
    witnesses.append(node("p", t("samplesTruncated"), "notice"));
  root.append(witnesses);
  const collisions = reportBox("collisionTitle", "collisionHint");
  collisions.id = "collisions";
  if (!plan.collisions.length) collisions.append(node("p", t("noCollisions")));
  else
    collisions.append(
      node(
        "p",
        t("groupsShown", {
          shown: plan.collisions.length,
          total: plan.collisionGroupsTotal,
        }),
        "help",
      ),
    );
  for (const collision of plan.collisions) {
    const card = node("div", undefined, "collision-card");
    card.append(
      node(
        "h4",
        t("collisionSummary", {
          side: t(`${collision.side}Side`),
          count: collision.rawKeyCount,
          rows: collision.rowCount,
          key: keyText(collision.key),
        }),
      ),
    );
    const list = node("ul");
    for (const raw of collision.rawSamples) {
      list.append(
        node(
          "li",
          t("rawRecords", {
            key: keyText(raw.key),
            records: raw.records.join(", "),
          }),
        ),
      );
      if (raw.keyTruncated)
        list.append(node("li", t("keyTruncated"), "notice"));
    }
    card.append(list);
    if (collision.keyTruncated)
      card.append(node("p", t("keyTruncated"), "notice"));
    if (collision.samplesTruncated)
      card.append(node("p", t("samplesTruncated"), "notice"));
    collisions.append(card);
  }
  if (plan.collisionsTruncated)
    collisions.append(node("p", t("samplesTruncated"), "notice"));
  root.append(collisions);
  if (plan.invalidMeasureSamples.length) {
    const invalid = reportBox("invalidTitle", "invalidHint");
    invalid.id = "invalid-measures";
    invalid.append(
      table(
        [t("record"), t("physical"), t("rawValue")],
        plan.invalidMeasureSamples.map((r) => [
          r.record,
          r.line,
          `${r.value}${r.truncated ? "…" : ""}`,
        ]),
      ),
    );
    if (plan.invalidMeasureSamplesTruncated)
      invalid.append(node("p", t("samplesTruncated"), "notice"));
    root.append(invalid);
  }
  const evidence = node("details", undefined, "audit-details");
  evidence.append(node("summary", t("evidenceTitle")));
  const evidenceBody = node("div");
  evidenceBody.append(node("p", t("exactDecimals")));
  for (const side of sides) {
    const input = report.inputs[side];
    evidenceBody.append(
      node(
        "p",
        t("fingerprint", {
          side: t(`${side}Side`),
          ...input,
          columns: input.columns.length,
        }),
      ),
    );
    evidenceBody.append(node("p", `SHA-256 ${input.sha256}`, "digest"));
  }
  for (const note of report.notes) evidenceBody.append(node("p", note));
  evidence.append(evidenceBody);
  root.append(evidence);
  $("results").hidden = false;
  $("empty").hidden = true;
}
$("download").addEventListener("click", () => {
  if (!report || active) {
    showError(t("exportUnavailable"));
    return;
  }
  const blob = new Blob([JSON.stringify(report) + "\n"], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = node("a");
  link.href = url;
  link.download = "join-impact-report.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function setLocale(value) {
  locale = value;
  document.documentElement.lang = value;
  document.title =
    value === "ja"
      ? "Join Impact · 結合前に、数字の変化を知る"
      : "Join Impact · Know what a join does to your totals";
  for (const element of document.querySelectorAll("[data-i18n]"))
    element.textContent = t(element.dataset.i18n);
  refreshHeaders();
  setStatus(statusKey);
  if (report) renderReport();
}
$("language").addEventListener("change", (event) =>
  setLocale(event.target.value),
);
setLocale("ja");
