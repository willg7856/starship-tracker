#!/usr/bin/env python3
"""Merge overlapping Flight 14 Space Notices hazard polygons for map display.

Overlapping notices from different authorities are unioned so the map shows
one clean footprint per region instead of stacked section borders. Disconnected
regions stay separate. Raw notices are preserved under noticePolygonsSource.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import transform, unary_union
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[1]
TRACK = ROOT / "public" / "data" / "flight14-ship-track.json"

REENTRY_KEYS = (
    "RE-ENTRY",
    "REENTRY",
    "SPLASHDOWN",
    "RETURN",
    "DEORBIT",
)


def is_reentry(notice: dict) -> bool:
    text = f"{notice.get('name') or ''} {notice.get('type') or ''}".upper()
    if any(k in text for k in REENTRY_KEYS):
        return True
    # Southern-hemisphere debris / splashdown belts without those keywords
    # (e.g. HYDROPAC space-debris warnings).
    lats = [p[0] for ring in notice.get("polygons") or [] for p in ring]
    return bool(lats) and (sum(lats) / len(lats) < -10)


def ring_to_poly(ring: list) -> Polygon | MultiPolygon | None:
    if not ring or len(ring) < 3:
        return None
    coords = [(p[1], p[0]) for p in ring]
    if coords[0] != coords[-1]:
        coords = coords + [coords[0]]

    unwrapped = [coords[0]]
    for lon, lat in coords[1:]:
        prev = unwrapped[-1][0]
        while lon - prev > 180:
            lon -= 360
        while lon - prev < -180:
            lon += 360
        unwrapped.append((lon, lat))

    try:
        poly = Polygon(unwrapped)
    except Exception:
        return None
    if not poly.is_valid:
        poly = make_valid(poly)
    return only_polys(poly)


def only_polys(geom):
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "Polygon":
        return geom if geom.area > 0 else None
    if geom.geom_type == "MultiPolygon":
        parts = [g for g in geom.geoms if g.area > 0]
        if not parts:
            return None
        return parts[0] if len(parts) == 1 else MultiPolygon(parts)
    if hasattr(geom, "geoms"):
        flat = []
        for g in geom.geoms:
            if g.geom_type == "Polygon" and g.area > 0:
                flat.append(g)
            elif g.geom_type == "MultiPolygon":
                flat.extend([p for p in g.geoms if p.area > 0])
        if not flat:
            return None
        return flat[0] if len(flat) == 1 else MultiPolygon(flat)
    return None


def collect(notices: list[dict], reentry: bool) -> list:
    geoms = []
    for notice in notices:
        if is_reentry(notice) != reentry:
            continue
        for ring in notice.get("polygons") or []:
            geom = ring_to_poly(ring)
            if geom is None:
                continue
            if geom.geom_type == "MultiPolygon":
                geoms.extend(list(geom.geoms))
            else:
                geoms.append(geom)
    return geoms


def normalize_lon(geom):
    def shift_poly(poly: Polygon) -> Polygon:
        cx = poly.centroid.x
        shift = 0
        while cx + shift > 180:
            shift -= 360
        while cx + shift < -180:
            shift += 360
        if shift == 0:
            return poly
        return transform(lambda x, y, z=None: (x + shift, y), poly)

    if geom.geom_type == "Polygon":
        return shift_poly(geom)
    if geom.geom_type == "MultiPolygon":
        return MultiPolygon([shift_poly(g) for g in geom.geoms])
    return geom


def poly_to_rings(geom) -> list[list[list[float]]]:
    geom = normalize_lon(geom)
    rings: list[list[list[float]]] = []
    polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    for poly in polys:
        if poly.geom_type != "Polygon" or poly.is_empty:
            continue
        exterior = list(poly.exterior.coords)
        ring = [[float(lat), float(lon)] for lon, lat in exterior]
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def merge_group(notices: list[dict], reentry: bool) -> list[list[list[float]]]:
    parts = collect(notices, reentry=reentry)
    if not parts:
        return []
    merged = only_polys(make_valid(unary_union(parts)))
    if merged is None:
        return []
    return poly_to_rings(merged)


def main() -> None:
    data = json.loads(TRACK.read_text())
    raw = data.get("noticePolygonsSource") or data.get("noticePolygons") or []
    if not raw:
        raise SystemExit("No notice polygons found to merge")

    ascent = merge_group(raw, reentry=False)
    reentry = merge_group(raw, reentry=True)

    merged = []
    if ascent:
        merged.append(
            {
                "id": "hazard-ascent-merged",
                "name": "Flight 14 ascent / debris hazard areas",
                "type": "MERGED",
                "polygons": ascent,
            }
        )
    if reentry:
        merged.append(
            {
                "id": "hazard-reentry-merged",
                "name": "Flight 14 re-entry / splashdown hazard areas",
                "type": "MERGED",
                "polygons": reentry,
            }
        )

    data["noticePolygonsSource"] = raw
    data["noticePolygons"] = merged
    data["hazardMerge"] = {
        "sourceNoticeCount": len(raw),
        "ascentRings": len(ascent),
        "reentryRings": len(reentry),
        "note": (
            "Display polygons are a geometric union of Flight 14 Space Notices. "
            "Overlaps are merged; disconnected regions stay separate."
        ),
    }
    TRACK.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(
        f"Merged {len(raw)} notices → "
        f"{len(ascent)} ascent rings, {len(reentry)} reentry rings"
    )


if __name__ == "__main__":
    main()
