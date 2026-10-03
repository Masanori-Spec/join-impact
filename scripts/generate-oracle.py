#!/usr/bin/env python3
"""Generate independent materialized-join fixtures with Python stdlib only.

SQLite, not Join Impact's grouped algorithm, decides each concrete output pair.
Python Decimal (100 significant digits) then sums actual materialized rows. This
intentionally slow reference runs only on small datasets; the production engine
must never materialize its potentially billion-row result.

Regenerate: python3 scripts/generate-oracle.py
Check:      python3 scripts/generate-oracle.py --check
"""
from __future__ import annotations

import argparse
import csv
from collections import Counter, defaultdict
from decimal import Decimal, localcontext
import io
import json
from pathlib import Path
import random
import re
import sqlite3
import unicodedata

DESTINATION = Path(__file__).resolve().parents[1] / "fixtures" / "oracle.json"
SEED = 0x4A4F494E
# ECMAScript WhiteSpace + LineTerminator, deliberately not Python str.strip().
JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
DECIMAL = re.compile(r"[+-]?(0|[1-9][0-9]*)(?:\.([0-9]+))?\Z")
ZERO = Decimal(0)


def amount(value: str) -> Decimal | None:
    match = DECIMAL.fullmatch(value)
    if not match or len(match[1]) > 30 or len(match[2] or "") > 12:
        return None
    return Decimal(value)


def canonical(value: Decimal) -> str:
    if not value:
        return "0"
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def normalize(value: str, mode: str) -> str:
    if mode in ("trim", "trim-nfc"):
        value = value.strip(JS_WHITESPACE)
    if mode in ("nfc", "trim-nfc"):
        value = unicodedata.normalize("NFC", value)
    return value


def as_csv(headers: list[str], rows: list[list[str]], delimiter: str, crlf: bool) -> str:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, delimiter=delimiter, lineterminator="\r\n" if crlf else "\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return stream.getvalue()


def collision_count(rows: list[list[str]], width: int, mode: str) -> int:
    original: dict[tuple[str, ...], set[tuple[str, ...]]] = defaultdict(set)
    for row in rows:
        raw = tuple(row[:width])
        original[tuple(normalize(value, mode) for value in raw)].add(raw)
    return sum(len(raw_keys) > 1 for raw_keys in original.values())


def materialized_plan(left: list[list[str]], right: list[list[str]], options: dict, mode: str) -> dict:
    width = len(options["leftKeys"])
    left_keys = [tuple(normalize(value, mode) for value in row[:width]) for row in left]
    right_keys = [tuple(normalize(value, mode) for value in row[:width]) for row in right]
    values = [amount(row[width]) for row in left]
    # JSON-array text encoding is collision-free for compound text keys.
    def sql_key(key: tuple[str, ...]) -> str | None:
        return None if options["blank"] == "never" and "" in key else json.dumps(key, ensure_ascii=False)

    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE l (id INTEGER PRIMARY KEY, key TEXT)")
    db.execute("CREATE TABLE r (id INTEGER PRIMARY KEY, key TEXT)")
    db.executemany("INSERT INTO l VALUES (?, ?)", [(i, sql_key(key)) for i, key in enumerate(left_keys)])
    db.executemany("INSERT INTO r VALUES (?, ?)", [(i, sql_key(key)) for i, key in enumerate(right_keys)])
    join = "LEFT JOIN" if options["join"] == "left" else "INNER JOIN"
    pairs = db.execute(f"SELECT l.id, r.id FROM l {join} r ON l.key = r.key ORDER BY l.id, r.id").fetchall()
    matched_ids = {pair[0] for pair in db.execute("SELECT l.id, r.id FROM l INNER JOIN r ON l.key = r.key").fetchall()}
    retained_ids = {pair[0] for pair in pairs}
    frequencies = Counter(pair[0] for pair in pairs)
    right_duplicate_groups = db.execute("SELECT COUNT(*) FROM (SELECT key FROM r WHERE key IS NOT NULL GROUP BY key HAVING COUNT(*) > 1)").fetchone()[0]
    db.close()

    original = sum((value for value in values if value is not None), ZERO)
    retained = sum((values[i] for i in retained_ids if values[i] is not None), ZERO)
    # These sums iterate materialized output rows, rather than multiplying group
    # subtotals as the audited implementation does.
    joined = sum((values[i] for i, _ in pairs if values[i] is not None), ZERO)
    seen: set[int] = set()
    replicated_values = []
    for i, _ in pairs:
        if i in seen and values[i] is not None:
            replicated_values.append(values[i])
        seen.add(i)
    dropped_values = [values[i] for i in range(len(left)) if i not in retained_ids and values[i] is not None]
    count = {
        "leftRows": len(left),
        "rightRows": len(right),
        "outputRows": str(len(pairs)),
        "matchedLeftRows": len(matched_ids),
        "unmatchedLeftRows": len(left) - len(matched_ids),
        "droppedLeftRows": len(left) - len(retained_ids),
        "multipliedLeftRows": sum(count > 1 for count in frequencies.values()),
        "extraOutputRows": str(len(pairs) - len(retained_ids)),
        "blankLeftRows": sum("" in key for key in left_keys),
        "blankRightRows": sum("" in key for key in right_keys),
        "rightDuplicateGroups": right_duplicate_groups,
    }
    measure = {
        "column": "amount",
        "validRows": sum(value is not None for value in values),
        "blankRows": sum(row[width] == "" for row in left),
        "invalidRows": sum(value is None and row[width] != "" for row, value in zip(left, values)),
        "original": canonical(original),
        "retainedOnce": canonical(retained),
        "joined": canonical(joined),
        "dropped": canonical(sum(dropped_values, ZERO)),
        "replicated": canonical(sum(replicated_values, ZERO)),
        "netChange": canonical(joined - original),
        "absoluteReplicated": canonical(sum((abs(value) for value in replicated_values), ZERO)),
        "absoluteDropped": canonical(sum((abs(value) for value in dropped_values), ZERO)),
    }
    return {"normalization": mode, "counts": count, "measure": measure,
            "collisionGroupsTotal": collision_count(left, width, mode) + collision_count(right, width, mode)}


def make_case(name: str, left: list[list[str]], right: list[list[str]], width: int,
              join: str, blank: str, mode: str, serial: int) -> dict:
    left_delimiter = [",", "\t", ";"][serial % 3]
    right_delimiter = [",", "\t", ";"][(serial // 3) % 3]
    options = {"leftKeys": [f"l{i + 1}" for i in range(width)], "rightKeys": [f"r{i + 1}" for i in range(width)],
               "measure": "amount", "join": join, "blank": blank, "normalization": mode,
               "leftDelimiter": left_delimiter, "rightDelimiter": right_delimiter}
    baseline = materialized_plan(left, right, options, "exact")
    selected = materialized_plan(left, right, options, mode)
    return {"name": name, "request": {
        "leftText": as_csv(options["leftKeys"] + ["amount", "irrelevant"], left, left_delimiter, serial % 2 == 0),
        "rightText": as_csv(options["rightKeys"] + ["irrelevant"], right, right_delimiter, serial % 2 == 1),
        "options": options},
        "expected": {"baseline": baseline, "selected": selected,
                     "comparison": {"outputRowsDelta": str(int(selected["counts"]["outputRows"]) - int(baseline["counts"]["outputRows"])),
                                    "joinedTotalDelta": canonical(Decimal(selected["measure"]["joined"]) - Decimal(baseline["measure"]["joined"])),
                                    "newCollisionGroups": selected["collisionGroupsTotal"]}}}


def generate() -> dict:
    rng = random.Random(SEED)
    key_pool = ["", " ", "A", " A", "A ", "a", "01", "1", "0", "-0", "NULL", "null", "é", "e\u0301", "\u00a0é\u3000", "__proto__", "constructor", "東京", "🚀", "x,y", "x;y", "x\ty", "x\ny", '"q"', "x|y", "x\u001fy", "\u0085A\u0085", "\u200bA\u200b", "\ufeffA"]
    amount_pool = ["0", "-0", "+0.0", "1", "-1", "0.1", "0.2", "-0.3", "1.2300", "+42.000000000001", "-999.999999999999", "999999999999999999999999999999.999999999999", "-999999999999999999999999999999.999999999999", "", " ", "1e3", "NaN", "01", ".5", "1.", "1,000", "$4", "0.0000000000001", "1000000000000000000000000000000"]
    cases = []
    with localcontext() as context:
        context.prec = 100
        for seed_case in range(48):
            width = seed_case % 3 + 1
            candidates = [tuple(rng.choice(key_pool) for _ in range(width)) for _ in range(7)]
            # Every case has cleanable and blank tuples; overlaps deliberately
            # include fractional negative values and both matched/unmatched rows.
            candidates += [tuple(["A"] * width), tuple([" A "] * width), tuple(["é"] * width), tuple(["e\u0301"] * width), tuple([""] * width)]
            left = [list(rng.choice(candidates)) + [rng.choice(amount_pool), f"left {i},\nmetadata"] for i in range(rng.randrange(0, 19))]
            right = [list(rng.choice(candidates)) + [f"right {i}; metadata"] for i in range(rng.randrange(0, 19))]
            for join in ("left", "inner"):
                for blank in ("never", "match"):
                    for mode in ("exact", "trim", "nfc", "trim-nfc"):
                        serial = len(cases)
                        cases.append(make_case(f"seed-{seed_case:02d}-{width}keys-{join}-{blank}-{mode}", left, right, width, join, blank, mode, serial))
        special = [
            ("decimal-cancellation", [["x", "9007199254740993.01", ""], ["x", "-9007199254740993.00", ""], ["y", "-0.01", ""]], [["x", ""], ["x", ""], ["x", ""]], 1),
            ("all-blank-components", [["", "a", "2.5", ""], ["x", "", "-1.25", ""], ["", "", "0.1", ""]], [["", "a", ""], ["x", "", ""], ["x", "", ""], ["", "", ""]], 2),
            ("tuple-delimiter-collision", [["a|b", "c", "7", ""], ["a", "b|c", "-3", ""], ["a\u001fb", "c", "2", ""]], [["a|b", "c", ""], ["a", "b|c", ""], ["a", "b\u001fc", ""]], 2),
            ("nfc-trim-collisions", [["é", "1.1", ""], ["e\u0301", "-0.1", ""], ["\u00a0é\ufeff", "0.01", ""], ["", "5", ""], [" ", "-5", ""]], [["é", ""], ["e\u0301", ""], [" é ", ""], ["", ""], [" ", ""]], 1),
        ]
        for name, left, right, width in special:
            for join in ("left", "inner"):
                for blank in ("never", "match"):
                    for mode in ("exact", "trim", "nfc", "trim-nfc"):
                        cases.append(make_case(f"{name}-{join}-{blank}-{mode}", left, right, width, join, blank, mode, len(cases)))
    return {"generator": "scripts/generate-oracle.py", "seed": SEED,
            "reference": "SQLite concrete LEFT/INNER JOIN rows, Python Decimal exact sums; no production imports",
            "caseCount": len(cases), "cases": cases}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = json.dumps(generate(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not DESTINATION.exists() or DESTINATION.read_text(encoding="utf-8") != text:
            raise SystemExit("Oracle fixtures differ. Run python3 scripts/generate-oracle.py")
        print(f"Oracle is reproducible: {json.loads(text)['caseCount']} cases")
    else:
        DESTINATION.write_text(text, encoding="utf-8")
        print(f"Wrote {json.loads(text)['caseCount']} independent oracle cases to {DESTINATION}")


if __name__ == "__main__":
    main()
