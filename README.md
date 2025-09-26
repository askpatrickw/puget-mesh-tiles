# Puget Mesh — Offline Map Tiles

This repository builds and **publishes split ZIPs of offline raster map tiles** covering the **Puget Sound Basin** for **Meshcore / T-Deck** usage.  
Tiles are generated from OpenStreetMap extracts, clipped to the Basin polygon.

---

## Quick start

1. Commit your Basin polygon to `./shapes/puget_basin.geojson`.  
   - Format: GeoJSON, WGS84 (EPSG:4326).  
   - Shapefile (`.shp` + sidecars) also supported if you prefer, but GeoJSON is leaner.  
2. Push this repo to GitHub.  
3. Run the **build-tiles** workflow (manually or on schedule).  
4. Download split ZIPs from the Release, extract to a microSD so you have `tiles/{z}/{x}/{y}.png` at the SD root.  
5. Insert into T-Deck; Meshcore will pick up the `tiles/` folder automatically.

---

## Defaults

- **Area**: Puget Sound Basin polygon from `./shapes/puget_basin.geojson` (+10 km buffer).  
- **Sources**:  
  - OSM extracts from Geofabrik:  
    - Washington (always)  
    - British Columbia (optional, toggle `INCLUDE_BC=true`)  
- **Clipping**: `osmium extract` trims WA+BC to the Basin polygon (`puget_basin.osm.pbf`).  
- **Tile builder**: Planetiler → vector MBTiles → raster tiles with `mbgl-renderer`.  
- **Zooms**: `z8–12` (regional through city-level).  
- **Packaging**: split ZIPs (`zip -s 2000m`) + `SHA256SUMS` → Release assets.

---

## Repository structure

```
.github/workflows/build-tiles.yml   # CI to build & publish releases
scripts/
  fetch_basin_polygon.py            # Load local geometry (default ./shapes/puget_basin.geojson); buffer
  compute_tiles.py                  # Enumerate z/x/y tiles intersecting polygon via mercantile + shapely
  render_raster_tiles.js            # Use @consbio/mbgl-renderer to rasterize listed tiles
  package_and_split.sh              # Create split ZIPs + SHA256SUMS
shapes/
  puget_basin.geojson               # Committed Puget Basin polygon (required)
styles/
  bright-min.json                   # Minimal MapLibre style; points to local vector MBTiles
README.md                           # You are here
```


---

## Workflow overview

1. **Load local basin polygon** (`./shapes/puget_basin.geojson`) → `basin.geojson`.  
2. **Download OSM extracts** (WA + optional BC).  
3. **Merge + clip** with `osmium extract` to produce `puget_basin.osm.pbf`.  
4. **Planetiler** converts PBF → `tiles/vector.mbtiles`.  
5. **Rasterize** selected tiles → `tiles/{z}/{x}/{y}.png`.  
6. **Package** split ZIPs + checksums → uploaded to the Release.

---

## Configuration knobs

Override via workflow **inputs** or repository **variables**:

- `ZOOM_MIN` / `ZOOM_MAX` (default: 8 / 12)  
- `BASIN_BUFFER_KM` (default: 10)  
- `INCLUDE_BC` (default: false)  
- `STYLE_JSON` (default: `styles/bright-min.json`)  

---

## Local testing (optional)

Dependencies: Python 3.10+, Node 18+, Java 17+, osmium-tool.

Example run:

```bash
# 1. Ensure you have ./shapes/puget_basin.geojson committed.
python3 scripts/fetch_basin_polygon.py --local ./shapes/puget_basin.geojson --out basin.geojson --buffer-km 10

# 2. Download WA/BC and clip with osmium
curl -L -o data/wa.osm.pbf https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf
curl -L -o data/bc.osm.pbf https://download.geofabrik.de/north-america/canada/british-columbia-latest.osm.pbf
osmium merge data/wa.osm.pbf data/bc.osm.pbf -o data/wa_bc.osm.pbf
osmium extract --polygon ./shapes/puget_basin.geojson --strategy=complete_ways -o data/puget_basin.osm.pbf data/wa_bc.osm.pbf

# 3. Build vector tiles
java -Xmx8g -jar planetiler.jar --download=false --osm-path=data/puget_basin.osm.pbf --output=tiles/vector.mbtiles --min-zoom=8 --max-zoom=12 --bounds-file=basin.geojson

# 4. Compute tile list
python3 scripts/compute_tiles.py --geom basin.geojson --zmin 8 --zmax 12 --prefix tilelist

# 5. Rasterize tiles
node scripts/render_raster_tiles.js --style styles/bright-min.json --mbtiles tiles/vector.mbtiles --tilelist tilelist_all.txt --outdir tiles

# 6. Package
bash scripts/package_and_split.sh tiles RELEASE_ASSETS/test

```

---

## Notes

- **First pipeline run** can take a while on GitHub-hosted runners, especially at higher zooms.
- If you need `z13–14` or cross-border coverage, consider a **self-hosted runner** with more CPU/RAM and a longer timeout.
- The provided style is intentionally minimal; you may swap it for a richer OpenMapTiles-compatible style once you validate the flow.
