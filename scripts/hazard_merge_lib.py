"""Geometry helpers for merging hazard-area polygons (shapely)."""

from __future__ import annotations

from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import transform, unary_union  # noqa: F401  (re-exported)
from shapely.validation import make_valid  # noqa: F401  (re-exported)


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
