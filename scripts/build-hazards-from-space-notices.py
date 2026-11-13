"""Build public/data/flight15-hazards.json from Space Notices' Flight 15 notices."""
import importlib.util, json, sys
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location("m", "/home/user/starship-tracker/scripts/merge-flight14-hazard-polygons.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

notices = json.load(open(sys.argv[1]))
groups = {"Launch": [], "Reentry & Catch": [], "Contingency": []}
skipped = []
for n in notices:
    reason = (n.get("reason") or "").upper()
    if n.get("cancelled") or "FLIGHT 14" in reason or "KV-01" in reason:
        skipped.append(n["id"]); continue
    cat = n.get("category")
    key = cat if cat in groups else "Contingency"
    # Space Notices rings are [lon, lat]; the merge helpers want [lat, lon].
    groups[key].append({"polygons": [[[p[1], p[0]] for p in ring] for ring in (n.get("areas") or [])]})

def merge(items):
    parts = []
    for it in items:
        for ring in it["polygons"]:
            g = m.ring_to_poly(ring)
            if g is None: continue
            parts.extend(list(g.geoms) if g.geom_type == "MultiPolygon" else [g])
    if not parts: return []
    u = m.only_polys(m.make_valid(m.unary_union(parts)))
    return m.poly_to_rings(u) if u is not None else []

out = []
names = {
    "Launch": ("hazard-launch", "Flight 15 launch / ascent hazard areas"),
    "Reentry & Catch": ("hazard-reentry", "Flight 15 re-entry and catch hazard areas (Starbase return)"),
    "Contingency": ("hazard-contingency", "Flight 15 contingency re-entry areas (Hawaii, Chile, Indian Ocean)"),
}
for key, items in groups.items():
    rings = merge(items)
    print(f"{key}: {len(items)} notices -> {len(rings)} rings")
    if rings:
        out.append({"id": names[key][0], "name": names[key][1], "type": "MERGED", "polygons": rings})
data = {
    "flight": 15,
    "source": "https://space-notices.com/entry/launch-starship-starlink-31-2-starship-flight-15",
    "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "note": "Union of active (not cancelled) Flight 15 NOTAM/NAVWARNING/LNM/TFR areas from Space Notices, merged per group.",
    "skipped": skipped,
    "noticePolygons": out,
}
Path("/home/user/starship-tracker/public/data/flight15-hazards.json").write_text(json.dumps(data, separators=(",", ":")) + "\n")
print("skipped", skipped)
