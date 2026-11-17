#!/usr/bin/env python3
"""Claude Code usage today, for the claude-usage Herdr mod.

Reads the transcripts under ~/.claude/projects (read-only) and prints one JSON object:
{"tokens": all tokens today, "cost": API-equivalent USD today, "sessions": transcripts
with a reply today, "updated": epoch ms}. Each API message is counted once, by its id.
Cost is an estimate at Anthropic list prices, not what a subscription bills.

Usage: usage.py [~/.claude]
"""
import glob, json, os, sys
from datetime import datetime, timezone

CLAUDE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), ".claude")

# USD per million tokens: [input, output, cache read, cache write]. Cache writes priced at the 5m rate.
PRICES = {
    "claude-fable-5-2": [8, 40, 0.2, 10],
    "claude-fable-5": [10, 50, 1, 12.5],
    "claude-opus-5-5": [4, 20, 0.2, 5],
    "claude-opus-5": [5, 25, 0.5, 6.25],
    "claude-opus-4-6": [5, 25, 0.5, 6.25],
    "claude-opus-4-1": [15, 75, 1.5, 18.75],
    "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
    "claude-sonnet-4-6": [3, 15, 0.3, 3.75],
    "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
    "claude-haiku-4-5": [1, 5, 0.1, 1.25],
}
# A model not in the table is priced by its family's current model.
FAMILY = [("fable", "claude-fable-5-2"), ("mythos", "claude-fable-5-2"), ("opus", "claude-opus-5-5"),
          ("haiku", "claude-haiku-5-5"), ("sonnet", "claude-sonnet-5-5")]


def price(model):
    base = model.split("@")[0]
    base = base[: -9] if len(base) > 9 and base[-9] == "-" and base[-8:].isdigit() else base  # -20251001
    if base in PRICES:
        return PRICES[base]
    for key, fam in FAMILY:
        if key in base:
            return PRICES[fam]
    return PRICES["claude-sonnet-5-5"]


def midnight_ts():
    now = datetime.now().astimezone()
    return now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def stamp(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def main():
    start = midnight_ts()
    seen = {}  # message id -> (model, usage) of the last line that carried it
    sessions = set()
    for path in glob.glob(os.path.join(CLAUDE, "projects", "*", "*.jsonl")):
        try:
            if os.path.getmtime(path) < start:
                continue
            with open(path, "rb") as f:
                for raw in f:
                    if b'"usage"' not in raw:
                        continue
                    try:
                        d = json.loads(raw)
                    except Exception:
                        continue
                    t = stamp(d.get("timestamp") or "")
                    msg = d.get("message") or {}
                    u, mid = msg.get("usage"), msg.get("id")
                    if not u or not mid or t is None or t < start:
                        continue
                    seen[mid] = (msg.get("model") or "", u)
                    sessions.add(path)
        except OSError:
            continue

    tokens, cost = 0, 0.0
    for model, u in seen.values():
        i = u.get("input_tokens", 0) or 0
        o = u.get("output_tokens", 0) or 0
        cr = u.get("cache_read_input_tokens", 0) or 0
        cw = u.get("cache_creation_input_tokens", 0) or 0
        tokens += i + o + cr + cw
        p = price(model)
        cost += (i * p[0] + o * p[1] + cr * p[2] + cw * p[3]) / 1e6

    out = {"tokens": tokens, "cost": round(cost, 4), "sessions": len(sessions),
           "updated": int(datetime.now(timezone.utc).timestamp() * 1000)}
    out["limits"] = plan_limits()
    print(json.dumps(out))


# Plan limits: "used" percent for the 5-hour window, the weekly window and the Fable weekly
# limit, from the same usage endpoint Claude Code's own status line reads. The OAuth token
# comes from the macOS keychain item Claude Code writes; it is sent only to api.anthropic.com.
# The answer is cached for 60 s so a second herdr window running the mod does not hit the endpoint again.
LIMIT_CACHE = os.path.join(os.path.expanduser("~"), ".cache", "claude-usage-mod", "limits.json")
LIMIT_TTL = 60


def plan_limits():
    try:
        if os.path.getmtime(LIMIT_CACHE) > datetime.now().timestamp() - LIMIT_TTL:
            with open(LIMIT_CACHE) as f:
                return json.load(f)
    except OSError:
        pass
    try:
        import subprocess, urllib.request
        raw = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                             capture_output=True, text=True, timeout=10, check=True).stdout
        token = json.loads(raw)["claudeAiOauth"]["accessToken"]
        req = urllib.request.Request("https://api.anthropic.com/api/oauth/usage", headers={
            "Authorization": "Bearer " + token, "anthropic-beta": "oauth-2025-04-20"})
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.load(r)
    except Exception as e:
        return {"error": type(e).__name__}
    fable = None
    for lim in d.get("limits") or []:
        name = ((lim.get("scope") or {}).get("model") or {}).get("display_name") or ""
        if lim.get("group") == "weekly" and "fable" in name.lower():
            fable = lim
    out = {
        "session": {"used": (d.get("five_hour") or {}).get("utilization"), "resets_at": (d.get("five_hour") or {}).get("resets_at")},
        "weekly": {"used": (d.get("seven_day") or {}).get("utilization"), "resets_at": (d.get("seven_day") or {}).get("resets_at")},
        "fable": {"used": fable.get("percent"), "resets_at": fable.get("resets_at")} if fable else None,
    }
    try:
        os.makedirs(os.path.dirname(LIMIT_CACHE), exist_ok=True)
        with open(LIMIT_CACHE, "w") as f:
            json.dump(out, f)
    except OSError:
        pass
    return out


if __name__ == "__main__":
    main()
