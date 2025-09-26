#!/usr/bin/env python3
import json, argparse
from shapely.geometry import shape, Polygon, box
import mercantile

def tiles_for_polygon(geom, z):
    # compute tile indices in bbox then filter by intersection
    minx, miny, maxx, maxy = geom.bounds
    tiles = []
    # mercantile expects lon,lat
    ul = mercantile.tile(minx, maxy, z)
    lr = mercantile.tile(maxx, miny, z)
    for x in range(ul.x, lr.x+1):
        for y in range(ul.y, lr.y+1):
            b = mercantile.bounds(x,y,z)
            tb = box(b.west, b.south, b.east, b.north)
            if tb.intersects(geom):
                tiles.append((z,x,y))
    return tiles

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--geom", required=True, help="GeoJSON file with polygon")
    ap.add_argument("--zmin", type=int, required=True)
    ap.add_argument("--zmax", type=int, required=True)
    ap.add_argument("--prefix", default="tilelist", help="Prefix for output files")
    args = ap.parse_args()

    gj = json.load(open(args.geom, "r", encoding="utf-8"))
    geom = None
    for f in gj.get("features", []):
        g = shape(f.get("geometry"))
        geom = g if geom is None else geom.union(g)
    if geom is None:
        raise SystemExit("No geometry in input")

    all_tiles = []
    for z in range(args.zmin, args.zmax+1):
        t = tiles_for_polygon(geom, z)
        with open(f"{args.prefix}_z{z}.txt", "w", encoding="utf-8") as f:
            for (zz,xx,yy) in t:
                f.write(f"{zz},{xx},{yy}\n")
        all_tiles.extend(t)

    with open(f"{args.prefix}_all.txt", "w", encoding="utf-8") as f:
        for (zz,xx,yy) in all_tiles:
            f.write(f"{zz},{xx},{yy}\n")

    print(f"Wrote {len(all_tiles)} tiles across z{args.zmin}..z{args.zmax}")

if __name__ == "__main__":
    main()
