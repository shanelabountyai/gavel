"""Gavel — fixture freeze check (test oracle, never product code).

Regenerates the auctions and submissions with the pinned seed into a temporary directory, re-runs the
reference replay there, compares every sha256 with the committed fixtures/ (auctions.json,
submissions.jsonl, expected_bids.csv, expected_lots.csv, MANIFEST.json's recorded hashes and the
rules file hash), then re-runs golden_answers. Prints OK or names the first file whose bytes moved.
Used by `npm run fixtures:check`.

Usage: python3 tools/verify_fixtures.py [FIXTURES_DIR]
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GENERATED = ["auctions.json", "submissions.jsonl"]
DERIVED = ["expected_bids.csv", "expected_lots.csv"]


def sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def run(args: list) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable] + args, capture_output=True, text=True)


def main() -> int:
    fixtures = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "fixtures")
    manifest_path = os.path.join(fixtures, "MANIFEST.json")
    if not os.path.exists(manifest_path):
        print(f"no MANIFEST.json in {fixtures}; run tools/build_fixtures.py first")
        return 1
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    seed = manifest["seed"]
    bad = 0
    rules_hash = sha(os.path.join(ROOT, "rules", "auction.v1.json"))
    if rules_hash != manifest["rules_sha256"]:
        bad += 1
        print(f"MOVED rules/auction.v1.json: manifest {manifest['rules_sha256'][:12]}… file {rules_hash[:12]}…")
    expected = dict(manifest["sha256"])
    for name in GENERATED:
        p = os.path.join(fixtures, name)
        if not os.path.exists(p) or sha(p) != expected[name]:
            bad += 1
            print(f"MOVED {name}: committed file does not match MANIFEST.json")
    for name in DERIVED:
        p = os.path.join(fixtures, name)
        if os.path.exists(p):
            expected[name] = sha(p)
        else:
            bad += 1
            print(f"MISSING {name}; run tools/reference_replay.py --write-expected")
    with tempfile.TemporaryDirectory() as tmp:
        r = run([os.path.join(HERE, "build_fixtures.py"), "--seed", str(seed), "--out", tmp])
        if r.returncode != 0:
            print(r.stderr)
            return 1
        r = run([os.path.join(HERE, "reference_replay.py"), "--fixtures", tmp, "--write-expected"])
        if r.returncode != 0:
            print(r.stderr)
            return 1
        for name, h in sorted(expected.items()):
            p = os.path.join(tmp, name)
            got = sha(p) if os.path.exists(p) else None
            if got != h:
                bad += 1
                print(f"MOVED {name}: committed {h[:12]}… regenerated {str(got)[:12]}…")
            else:
                print(f"ok    {name} {h[:12]}…")
    r = run([os.path.join(HERE, "golden_answers.py")])
    if r.returncode != 0 or not r.stdout.rstrip().endswith("OK"):
        bad += 1
        print("golden_answers.py did not end with OK")
        print(r.stdout[-2000:])
    if bad:
        print(f"FAIL: {bad}")
        return 1
    print(f"OK seed={seed} rules={rules_hash[:12]}…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
