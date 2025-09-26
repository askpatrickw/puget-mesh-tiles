# Puget Mesh — Offline Map Tiles (Starter Repo)

This repository builds and **publishes split ZIPs of offline raster map tiles** covering the **Puget Sound Basin**
for **Meshcore / T‑Deck** usage. Defaults are safe and redistributable (self-rendered from OSM data).

> **Quick start**
>
> 1. Create a new GitHub repo and push this starter content.
> 2. Create a tag (e.g., `v0.1.0`) and push it, or manually run the workflow from the Actions tab.
> 3. Download split ZIPs from the Release, extract to a microSD so you have `tiles/{z}/{x}/{y}.png` at the SD root.
> 4. Insert into T‑Deck; Meshcore will pick up the `tiles/` folder automatically.

---

## Defaults

- **Approach**: self-generate from OSM data (Geofabrik, Washington-state extract).
- **Zooms**: `z8–12` (regional + city-level). Tune later as storage/time allows.
- **Area**: Puget Sound Basin polygon (buffered 10 km). Falls back to an approximate bounding polygon if ArcGIS is unreachable.
- **Renderer**: headless **mbgl-renderer** using a minimal style JSON.
- **Packaging**: split archives (`zip -s 2000m`) + SHA256 sums, uploaded as **Release assets**.

> Note: For cross-border coverage, add **British Columbia** PBF later. This starter keeps first runs light and fast.

---

## Repository structure

```
.github/workflows/build-tiles.yml   # CI to build & publish releases
scripts/
  fetch_basin_polygon.py            # Load local geometry (default ./shapes/puget_basin.geojson); buffer
  compute_tiles.py                  # Enumerate z/x/y tiles intersecting polygon via mercantile + shapely
  render_raster_tiles.js            # Use @consbio/mbgl-renderer to rasterize listed tiles
  package_and_split.sh              # Create split ZIPs + SHA256SUMS
styles/
  bright-min.json                   # Minimal MapLibre style; points to local vector MBTiles
README.md                           # You are here
```

---

## How it works

1. **Load local basin polygon** → `basin.geojson`
2. **Compute tiles** to render for each zoom tier → `tilelist_*.txt`
3. **Build vector MBTiles** (Planetiler from OSM PBF) → `tiles/vector.mbtiles`
4. **Rasterize** with `@consbio/mbgl-renderer` into `tiles/{z}/{x}/{y}.png`
5. **Package & split** → `RELEASE_ASSETS/` then upload to the Release

> The workflow uses **Washington** OSM extract only by default to keep runtime reasonable.
> To add BC later, set `INCLUDE_BC=true` as an env/variable and ensure the runner has enough time/disk.

---

## Legal & attribution

- Data © OpenStreetMap contributors (ODbL). Include attribution when you distribute.
- Style is an in-repo minimal MapLibre style (no third-party tile servers).
- **Do not** bulk-download from OSM public tile servers or commercial providers for redistribution.

---

## Configuration knobs

You can override these via workflow **inputs** or repository **variables**:

- `ZOOM_MIN` / `ZOOM_MAX` (default: 8 / 12)
- `BASIN_BUFFER_KM` (default: 10)
- `DATA_DIR` (default: `data/`)
- `INCLUDE_BC` (default: `false` — set to `true` to fetch British Columbia PBF)
- `STYLE_JSON` (default: `styles/bright-min.json`)

---

## Local testing (optional)

> **Geometry source**: commit one of the following to this repo and reference it via `--local` (default `./shapes/puget_basin.geojson`):
> - GeoJSON (`.geojson`/`.json`) in WGS84
> - ESRI Shapefile (`.shp` + sidecars `.shx`, `.dbf`, `.prj`)

You can run the scripts locally (Linux/macOS) if you install:
- Python 3.10+: `pip install shapely mercantile requests pyproj`
- Node 18+: `npm i -g @consbio/mbgl-renderer`
- Java 17+: for Planetiler

Then roughly:

```bash
python3 scripts/fetch_basin_polygon.py --out basin.geojson --buffer-km 10
python3 scripts/compute_tiles.py --geom basin.geojson --zmin 8 --zmax 12 --out tilelist_test.txt
# Download WA PBF into data/wa.osm.pbf first (see workflow for URLs)
# Build vector tiles with Planetiler (see workflow step) to tiles/vector.mbtiles
node scripts/render_raster_tiles.js --style styles/bright-min.json --mbtiles tiles/vector.mbtiles --tilelist tilelist_test.txt --outdir tiles
bash scripts/package_and_split.sh tiles RELEASE_ASSETS/test
```

---

## Notes

- **First pipeline run** can take a while on GitHub-hosted runners, especially at higher zooms.
- If you need `z13–14` or cross-border coverage, consider a **self-hosted runner** with more CPU/RAM and a longer timeout.
- The provided style is intentionally minimal; you may swap it for a richer OpenMapTiles-compatible style once you validate the flow.
