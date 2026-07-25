#!/usr/bin/env python3
"""Rebuild src/data/flight13-ship-track.json from Space Notices.

Pulls the live ship-40 feed and merges it with the Trajectory-layer seed
embedded in the Space Notices Flight 13 page bundle.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from collections import defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACK_PATH = ROOT / "src" / "data" / "flight13-ship-track.json"
ENTRY_URL = "https://space-notices.com/entry/launch-starship-flight-13"
LIVE_URL = "https://data.space-notices.com/space-notices-data/ship-40"
UA = "Mozilla/5.0 (compatible; ship-40-tracker/1.0)"


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
    if len(objs) < 1000:
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
        if "space-notices-data/ship-40" in js and "let f=[" in js:
            seed = extract_seed_points(js)
            break
    if seed is None:
        raise RuntimeError("No Space Notices chunk contained the ship-40 seed path")

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
    for p in cur["points"]:
        buckets[(round(p["lat"], 6), round(p["lon"], 6))].append(p)

    points = []
    last_t = 0.0
    last_alt = 92.0
    for p in merged:
        key = (round(p["lat"], 6), round(p["lon"], 6))
        if buckets[key]:
            src = buckets[key].popleft()
            src_t = float(src["t"])
            # Keep mission time monotonic and avoid inheriting old archive holes.
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

    def find_index(lat: float, lon: float) -> int | None:
        for i, p in enumerate(out_points):
            if abs(p["lat"] - lat) < 1e-6 and abs(p["lon"] - lon) < 1e-6:
                return i
        return None

    entry_index = find_index(-26.665963, 41.09617) or cur["segments"]["entry_index"]
    splashdown_index = (
        find_index(-17.600414, 106.721456) or cur["segments"]["splashdown_index"]
    )
    lf = cur["landingFix"]
    last = out_points[-1]
    gps_time = lf["gps_time"] + (last["t"] - lf["mission_time"])

    out = {
        "source": "Space Notices Flight 13 trajectory (seed + live ship-40 feed)",
        "url": "https://space-notices.com/entry/launch-starship-flight-13",
        "description": (
            "Full Flight 13 Ship path from the Space Notices Trajectory layer: "
            "hardcoded seed series merged with "
            "https://data.space-notices.com/space-notices-data/ship-40. "
            "Mission times and altitudes carried over from the prior Space Notices "
            "archive where positions match."
        ),
        "landingFix": lf,
        "splashdown": cur["splashdown"],
        "points": out_points,
        "segments": {
            "entry_index": entry_index,
            "splashdown_index": splashdown_index,
            "coast_end_index": entry_index,
            "landing_start_index": entry_index,
        },
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
