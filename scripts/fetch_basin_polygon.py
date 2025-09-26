#!/usr/bin/env python3

import json, sys, argparse
from pathlib import Path
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
from shapely.ops import unary_union
from pyproj import Transformer

# Optional shapefile support (pyshp). Only imported if needed.
try:
    import shapefile as pyshp  # pyshp
except Exception:
    pyshp = None

def km_buffer_wgs84(geom, km: float):
    """Buffer a WGS84 geometry by km using a Web Mercator round-trip (approx)."""
    if km <= 0:
        return geom
    transformer_to = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    transformer_back = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)

    def proj_coords(coords, forward=True):
        if forward:
            return [transformer_to.transform(x, y) for (x, y) in coords]
        else:
            return [transformer_back.transform(x, y) for (x, y) in coords]

    if isinstance(geom, (Polygon, MultiPolygon)):
        g = geom
    else:
        g = geom.convex_hull

    # Project exterior rings only for simplicity
    def buf_poly(p: Polygon):
        ext = proj_coords(list(p.exterior.coords), True)
        from shapely.geometry import Polygon as SPoly
        g3857 = SPoly(ext)
        gbuf = g3857.buffer(km * 1000.0)
        back = proj_coords(list(gbuf.exterior.coords), False)
        return SPoly(back)

    if isinstance(g, Polygon):
        return buf_poly(g)
    else:
        parts = [buf_poly(p) for p in g.geoms]
        return unary_union(parts)

def load_geojson(path: Path):
    gj = json.loads(path.read_text(encoding="utf-8"))
    geoms = []
    if gj.get("type") == "FeatureCollection":
        for feat in gj.get("features", []):
            geom = feat.get("geometry")
            if geom:
                geoms.append(shape(geom))
    elif gj.get("type") in ("Feature",):
        geoms.append(shape(gj.get("geometry")))
    else:
        geoms.append(shape(gj))
    if not geoms:
        raise SystemExit(f"No geometries found in {path}")
    return unary_union(geoms)

def load_shapefile(path: Path):
    if pyshp is None:
        raise SystemExit("pyshp (shapefile) is not installed; add 'pyshp' to requirements or use GeoJSON.")
    r = pyshp.Reader(str(path))
    geoms = []
    for shp in r.shapes():
        # pyshp shapes implement __geo_interface__
        gi = getattr(shp, "__geo_interface__", None)
        if gi is None:
            # Build a polygon from parts if necessary (basic support)
            pts = [(x, y) for x, y in shp.points]
            if not pts:
                continue
            from shapely.geometry import Polygon
            geoms.append(Polygon(pts))
        else:
            geoms.append(shape(gi))
    if not geoms:
        raise SystemExit(f"No geometries found in {path}")
    return unary_union(geoms)

def main():
    ap = argparse.ArgumentParser(description="Load a local basin polygon and write a buffered GeoJSON")
    ap.add_argument("--local", default="./shapes/puget_basin.geojson", help="Path to local geometry (.geojson/.json or .shp)")
    ap.add_argument("--out", required=True, help="Output GeoJSON file path")
    ap.add_argument("--buffer-km", type=float, default=10.0, help="Outward buffer in kilometers (default 10)")
    args = ap.parse_args()

    src = Path(args.local)
    if not src.exists():
        raise SystemExit(f"Geometry file not found: {src}")

    ext = src.suffix.lower()
    if ext in (".geojson", ".json"):
        geom = load_geojson(src)
        source = f"local:{src.name}"
    elif ext == ".shp":
        geom = load_shapefile(src)
        source = f"local:{src.name}"
    else:
        raise SystemExit(f"Unsupported geometry format: {ext}. Use .geojson/.json or .shp")

    if args.buffer_km > 0:
        try:
            geom = km_buffer_wgs84(geom, args.buffer_km)
        except Exception as e:
            print(f"Warning: buffer failed ({e}); continuing without buffer", file=sys.stderr)

    out = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"source": source, "buffer_km": args.buffer_km},
            "geometry": mapping(geom)
        }]
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out), encoding="utf-8")
    print(f"Wrote {args.out} from {source}")

if __name__ == "__main__":
    main()
