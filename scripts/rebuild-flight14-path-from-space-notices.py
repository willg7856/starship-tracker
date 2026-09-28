#!/usr/bin/env python3
"""Rebuild public/data/flight14-ship-track.json from Space Notices.

Pulls the live ship-41 feed and merges it with the Trajectory-layer seed
embedded in the Space Notices Flight 14 page bundle (when available).
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from collections import defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACK_PATH = ROOT / "public" / "data" / "flight14-ship-track.json"
ENTRY_URL = (
    "https://space-notices.com/entry/launch-starship-starlink-31-1-starship-flight-14"
)
LIVE_URL = "https://data.space-notices.com/space-notices-data/ship-41"
UA = "Mozilla/5.0 (compatible; ship-41-tracker/1.0)"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def extract_seed_points(js: str) -> list[dict]:
    start = js.find("let f=[")
    end = js.find("[P,I]=(0,g.useState)(f)")
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError("Could not locate Space Notices seed trajectory array")
    objs = re.findall(
        r"\{id:(\d+),latitude:(-?\d+\.?\d*),longitude:(-?\d+\.?\d*)\}",
        js[start:end],
    )
    if len(objs) < 100:
        raise RuntimeError(f"Seed trajectory too short ({len(objs)} points)")
    return [
        {"id": int(oid), "lat": float(lat), "lon": float(lon)} for oid, lat, lon in objs
    ]


def main() -> int:
    html = fetch(ENTRY_URL).decode("utf-8", "ignore")
    chunks = sorted(set(re.findall(r"/_next/static/chunks/[^\"']+\.js", html)))
    seed = None
    for chunk in chunks:
        js = fetch(f"https://www.space-notices.com{chunk}").decode("utf-8", "ignore")
        if "space-notices-data/ship-41" in js and "let f=[" in js:
            seed = extract_seed_points(js)
            break
    if seed is None:
        raise RuntimeError("No Space Notices chunk contained the ship-41 seed path")

    live = json.loads(fetch(LIVE_URL).decode("utf-8"))
    by_id = {p["id"]: p for p in seed}
    for p in live:
        by_id[int(p["id"])] = {
            "id": int(p["id"]),
            "lat": float(p["latitude"]),
            "lon": float(p["longitude"]),
        }
    merged = sorted(by_id.values(), key=lambda x: x["id"])

    cur = json.loads(TRACK_PATH.read_text())
    buckets: dict[tuple[float, float], deque] = defaultdict(deque)
    for p in cur.get("points", []):
        buckets[(round(p["lat"], 6), round(p["lon"], 6))].append(p)

    points = []
    last_t = 0.0
    last_alt = 92.0
    for p in merged:
        key = (round(p["lat"], 6), round(p["lon"], 6))
        if buckets[key]:
            src = buckets[key].popleft()
            src_t = float(src["t"])
            if not points or 0 <= src_t - last_t <= 120:
                t = src_t if not points else max(src_t, last_t)
            else:
                t = last_t + 10.0
            alt = float(src["alt_m"])
        else:
            t = last_t + 10.0
            alt = last_alt if last_alt < 100 else -20.0
        last_t, last_alt = t, alt
        points.append(
            {
                "t": round(t, 1) if abs(t - round(t, 1)) < 1e-9 else t,
                "lat": p["lat"],
                "lon": p["lon"],
                "alt_m": int(round(alt))
                if abs(alt - round(alt)) < 0.51
                else round(alt, 3),
                "sn_id": p["id"],
            }
        )

    out_points = [
        {"t": p["t"], "lat": p["lat"], "lon": p["lon"], "alt_m": p["alt_m"]}
        for p in points
    ]

    lf = dict(cur.get("landingFix") or {})
    last = out_points[-1]
    if isinstance(lf.get("gps_time"), (int, float)) and isinstance(
        lf.get("mission_time"), (int, float)
    ):
        gps_time = lf["gps_time"] + (last["t"] - lf["mission_time"])
    else:
        gps_time = None

    out = {
        "source": "Space Notices Flight 14 trajectory (seed + live ship-41 feed)",
        "url": ENTRY_URL,
        "description": (
            "Full Flight 14 Ship path from the Space Notices Trajectory layer: "
            "hardcoded seed series merged with "
            f"{LIVE_URL}."
        ),
        "vehicle": "Ship 41",
        "flight": 14,
        "phase": "flight",
        "landingFix": lf,
        "splashdown": cur.get("splashdown"),
        "points": out_points,
        "segments": cur.get(
            "segments",
            {
                "entry_index": 0,
                "splashdown_index": max(0, len(out_points) - 1),
                "coast_end_index": 0,
                "landing_start_index": 0,
            },
        ),
        "noticePolygons": cur.get("noticePolygons", []),
        "rawPointCount": len(out_points),
        "archivedThrough": {
            "mission_time": last["t"],
            "gps_time": gps_time,
            "lat": last["lat"],
            "lon": last["lon"],
            "space_notices_id": points[-1]["sn_id"],
        },
        "spaceNotices": {
            "seedPointCount": len(seed),
            "liveFeedUrl": LIVE_URL,
            "latestId": points[-1]["sn_id"],
            "mergedPointCount": len(out_points),
        },
    }

    TRACK_PATH.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(
        f"Wrote {TRACK_PATH} ({len(out_points)} points, latest id {points[-1]['sn_id']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
