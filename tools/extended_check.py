#!/usr/bin/env python3
"""Extended acceptance checks for T3 and T4, in the style of run.py.

run.py only has checks for T1 and T2, so a T3/T4 claim would otherwise rest
on the README. This script probes the running portal the same way: plain
HTTP, the demo headers from .dogfood.toml, standard library only. Every
request is read-only or one the portal must refuse, so running it does not
change the portal's data.

Usage:  python3 tools/extended_check.py .dogfood.toml > extended-report.txt

The BONUS lines cover the judging engine beyond the tiers: leave-one-judge-out
robustness, judge diagnostics, and the signed, reproducible results bundle.
"""

import base64
import datetime
import json
import sys
import urllib.error
import urllib.request

try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    tomllib = None

EVENT = "evt_01"


def load(path):
    if tomllib:
        with open(path, "rb") as f:
            return tomllib.load(f)
    sys.path.insert(0, ".")
    import run  # reuse run.py's minimal parser

    with open(path, encoding="utf-8") as f:
        return run.parse_toml(f.read())


def request(base, path, header=None, method="GET", body=None):
    req = urllib.request.Request(base + path, method=method)
    if header:
        name, _, value = header.partition(":")
        req.add_header(name.strip(), value.strip())
    if body is not None:
        req.data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8", "replace"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)
    except Exception as e:  # noqa: BLE001
        return 0, f"{type(e).__name__}: {e}", {}


def main():
    cfg = load(sys.argv[1] if len(sys.argv) > 1 else ".dogfood.toml")
    base = cfg["portal"]["base_url"].rstrip("/")
    auth = cfg["auth"]
    org, part, ja, jb = auth["organizer"], auth["participant"], auth["judge_a"], auth["judge_b"]
    checks = []

    def check(tier, label, ok, detail=""):
        checks.append((tier, label, ok, detail))

    # --- T3 ----------------------------------------------------------------
    s, _, _ = request(base, "/api/v1/projects/prj_01/vote", method="POST", body={})
    check("T3", "voting requires an account", s == 401, f"got {s}, wanted 401")

    s, b, _ = request(base, "/api/v1/projects/prj_07/vote", part, method="POST", body={})
    check("T3", "no voting for your own project", s == 403, f"got {s}: {b[:120]}")

    # These two only make sense (and are only safe: a POST to publish would
    # succeed) while the seeded 48-hour voting window is open.
    s, b, _ = request(base, f"/api/v1/events/{EVENT}")
    ev = json.loads(b) if s == 200 else {}
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    voting = bool(ev.get("voting_open_at")) and ev["voting_open_at"] <= now < (ev.get("voting_close_at") or "")
    if voting and not ev.get("results_published_at"):
        s, b, _ = request(base, f"/api/v1/events/{EVENT}/results", part)
        check("T3", "results hidden during voting", s == 403, f"got {s}, wanted 403: {b[:120]}")
        s, b, _ = request(base, f"/api/v1/events/{EVENT}/publish", org, method="POST", body={"published": True})
        check("T3", "publishing refused while voting open", s == 409, f"got {s}, wanted 409: {b[:120]}")
    else:
        check("T3", "results hidden during voting", None, "SKIPPED: the seeded voting window is not open (fresh `docker compose down -v && up` reopens it)")

    s1, b1, _ = request(base, f"/api/v1/events/{EVENT}/ballot", part)
    s2, b2, _ = request(base, f"/api/v1/events/{EVENT}/ballot", ja)
    s3, b3, _ = request(base, f"/api/v1/events/{EVENT}/ballot", part)
    try:
        o1 = [p["id"] for p in json.loads(b1)["projects"]]
        o2 = [p["id"] for p in json.loads(b2)["projects"]]
        o3 = [p["id"] for p in json.loads(b3)["projects"]]
        ok = s1 == s2 == 200 and o1 != o2 and o1 == o3 and sorted(o1) == sorted(o2)
    except Exception:  # noqa: BLE001
        ok = False
    check("T3", "ballot order randomized per voter", ok, "two voters should see different, individually stable orders")

    s, b, _ = request(base, "/api/v1/projects/prj_02/comments")
    check("T3", "project comments are readable", s == 200, f"got {s}")

    s, b, _ = request(base, "/api/v1/projects/prj_02/comments", method="POST", body={"body": "x"})
    check("T3", "commenting requires an account", s == 401, f"got {s}, wanted 401")

    s, b, _ = request(base, f"/api/v1/events/{EVENT}/duplicates", org)
    try:
        ok = s == 200 and any(p["duplicate"]["id"] == "prj_41" for p in json.loads(b))
    except Exception:  # noqa: BLE001
        ok = False
    check("T3", "duplicate submission detected", ok, "prj_41 should be reported as a duplicate of prj_07")

    s, b, _ = request(base, f"/api/v1/events/{EVENT}/audit", org)
    try:
        v = json.loads(b)["verification"]
        ok = s == 200 and v["ok"] and v["entries"] > 0
    except Exception:  # noqa: BLE001
        ok = False
    check("T3", "audit trail readable and verifies", ok, f"got {s}")

    s, _, _ = request(base, f"/api/v1/events/{EVENT}/audit", jb)
    check("T3", "audit trail refused to judges", s == 403, f"got {s}, wanted 403")

    limited = False
    for _ in range(12):
        s, _, _ = request(base, "/api/v1/auth/login", method="POST",
                          body={"email": "nobody@example.invalid", "password": "definitely-wrong"})
        if s == 429:
            limited = True
            break
    check("T3", "login attempts are rate limited", limited, "12 bad logins never returned 429")

    # --- T4 ----------------------------------------------------------------
    s, b, _ = request(base, "/api/v1/openapi.yaml")
    check("T4", "OpenAPI spec published", s == 200 and "openapi: 3.1" in b, f"got {s}")

    s, b, _ = request(base, "/api/v1/events", ja)
    check("T4", "REST API lists events", s == 200 and EVENT in b, f"got {s}")

    s, _, _ = request(base, f"/api/v1/events/{EVENT}/webhooks", org)
    s2, _, _ = request(base, f"/api/v1/events/{EVENT}/webhooks", ja)
    check("T4", "webhooks managed by organizers only", s == 200 and s2 == 403, f"organizer {s}, judge {s2}")

    s, b, _ = request(base, "/.well-known/dogfood-signing-key")
    try:
        ok = s == 200 and json.loads(b)["alg"] == "Ed25519"
    except Exception:  # noqa: BLE001
        ok = False
    check("T4", "record signing key published", ok, f"got {s}")

    bogus = {"payload": "eyJyb2xlIjoianVkZ2UifQ==", "signature": "A" * 88}
    s, b, _ = request(base, "/api/v1/records/verify", method="POST", body=bogus)
    try:
        ok = s == 200 and json.loads(b)["valid"] is False
    except Exception:  # noqa: BLE001
        ok = False
    check("T4", "forged record rejected", ok, f"got {s}: {b[:120]}")

    s, _, _ = request(base, f"/api/v1/events/{EVENT}/records/participant", part)
    check("T4", "participant certificate issued", s == 200, f"got {s}")

    s, b, h = request(base, f"/embed/{EVENT}")
    csp = h.get("Content-Security-Policy", "")
    check("T4", "embeddable gallery widget", s == 200 and "frame-ancestors *" in csp and "Glass Signal" in b,
          f"got {s}, CSP {csp!r}")

    s, b, _ = request(base, f"/api/v1/events/{EVENT}/export.json", org)
    try:
        d = json.loads(b)
        ok = s == 200 and len(d["projects"]) == 41 and len(d["scores"]) > 100
    except Exception:  # noqa: BLE001
        ok = False
    check("T4", "bulk export (fixtures format)", ok, f"got {s}")

    s, _, _ = request(base, "/api/v1/import", org, method="POST", body={"event": {}})
    check("T4", "bulk import restricted to admins", s == 403, f"got {s}, wanted 403")

    # --- judging engine (bonus) --------------------------------------------
    s, b, _ = request(base, f"/api/v1/events/{EVENT}/results", org)
    try:
        res = json.loads(b)
        rb = res["report"]["robustness"]
        ok = s == 200 and rb["refits"] == 30 and rb["winner_held"] + len(rb["winner_flips"] or []) == 30
    except Exception:  # noqa: BLE001
        res, ok = {}, False
    check("BONUS", "leave-one-judge-out robustness (30 refits)", ok, f"got {s}")

    try:
        flat = [j for j in res["judges"] if j["judge"] == "jdg_07"][0]
        ok = any(f.startswith("flat") for f in flat["flags"])
    except Exception:  # noqa: BLE001
        ok = False
    check("BONUS", "flat judge jdg_07 flagged", ok, "jdg_07 gave (4,4,4) to every project")

    s, b, _ = request(base, f"/api/v1/events/{EVENT}/results/bundle", org)
    try:
        d = json.loads(b)
        m = json.loads(base64.b64decode(d["manifest"]["payload"]))
        # v2 adds a Merkle root over every review; v1 bundles are still valid.
        v2 = m["type"] == "dogfood.results/v2"
        ok = (s == 200 and m["type"] in ("dogfood.results/v1", "dogfood.results/v2")
              and len(m["input_digest"]) == 64 and len(m["ranking"]) == 40
              and all(r["judge"].startswith("J-") for r in d["inputs"]["reviews"])
              and (not v2 or (len(m.get("review_root", "")) == 64
                              and m.get("review_count") == len(d["inputs"]["reviews"]))))
    except Exception:  # noqa: BLE001
        ok = False
    check("BONUS", "signed, pseudonymized results bundle", ok, f"got {s}")

    s, _, _ = request(base, f"/api/v1/events/{EVENT}/results/bundle", jb)
    check("BONUS", "unpublished bundle refused to judges", s == 403, f"got {s}, wanted 403")

    # --- report ------------------------------------------------------------
    print("DOGFOOD extended acceptance report (T3, T4, judging engine)")
    print(f"portal: {base}")
    print()
    width = max(len(c[1]) for c in checks) + 2
    for tier, label, ok, detail in checks:
        verdict = "SKIP" if ok is None else ("PASS" if ok else "FAIL")
        print(f"{tier}  {label} {'.' * (width - len(label))} {verdict}")
        if not ok and detail:
            print(f"       {detail}")
    print()
    for tier in ("T3", "T4", "BONUS"):
        results = [c[2] for c in checks if c[0] == tier and c[2] is not None]
        print(f"{tier}: {sum(results)}/{len(results)} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
