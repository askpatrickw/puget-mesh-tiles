#!/usr/bin/env node
/**
 * Rasterize a list of tiles (z,x,y) to PNGs using @consbio/mbgl-renderer.
 *
 * Example:
 *   node render_raster_tiles.js --style styles/bright-min.json --mbtiles tiles/vector.mbtiles \
 *        --tilelist tilelist_all.txt --outdir tiles
 */
const fs = require('fs');
const path = require('path');
let cachedModuleRender = null;

// Try to load renderTile from the module, but be flexible about export shapes
function getRenderTileFromModule() {
  try {
    const mod = require('@consbio/mbgl-renderer');
    // Try common export shapes
    if (mod && typeof mod.renderTile === 'function') return mod.renderTile;
    if (mod && typeof mod.render === 'function') return mod.render;
    if (mod && mod.default && typeof mod.default.renderTile === 'function') return mod.default.renderTile;
    if (mod && mod.default && typeof mod.default.render === 'function') return mod.default.render;
    if (typeof mod === 'function') return mod; // some builds export the function directly
  } catch (e) {
    // ignore; will fall back to CLI
  }
  return null;
}
async function renderTileCompat(styleObj, z, x, y, opts = {}) {
  if (cachedModuleRender === null) {
    cachedModuleRender = getRenderTileFromModule();
  }
  if (typeof cachedModuleRender !== 'function') {
    throw new Error('mbgl-renderer Node API unavailable (renderTile not found)');
  }
  const res = cachedModuleRender(styleObj, z, x, y, opts);
  return res && typeof res.then === 'function' ? await res : res;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    out[args[i].replace(/^--/, '')] = args[i+1];
  }
  return out;
}

async function main() {
  const { style, mbtiles, tilelist, outdir } = parseArgs();
  if (!style || !mbtiles || !tilelist || !outdir) {
    console.error("Usage: --style <style.json> --mbtiles <vector.mbtiles> --tilelist <file> --outdir <dir>");
    process.exit(2);
  }
  const styleJson = JSON.parse(fs.readFileSync(style, 'utf8'));
  // Inject absolute MBTiles path and compute tile directory
  const absMbtiles = path.resolve(mbtiles);
  const tileDir = path.dirname(absMbtiles);
  const styleStr = JSON.stringify(styleJson).replace(/MBTILES_PATH/g, absMbtiles);
  const styleObj = JSON.parse(styleStr);

  const lines = fs.readFileSync(tilelist, 'utf8').trim().split(/\r?\n/);
  // Probe once up front to validate environment
  if (lines.length > 0) {
    const [pz, px, py] = lines[0].split(',').map(s => parseInt(s, 10));
    try {
      await renderTileCompat(styleObj, pz, px, py, { scale: 1, tilePath: tileDir });
    } catch (e) {
      console.error('Renderer initialization failed:', e && e.message ? e.message : e);
      process.exit(1);
    }
  }

  for (const [idx, line] of lines.entries()) {
    if (!line.trim()) continue;
    const [z,x,y] = line.split(',').map(s => parseInt(s, 10));
    const png = await renderTileCompat(styleObj, z, x, y, { scale: 1, tilePath: tileDir });
    const dir = path.join(outdir, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${y}.png`), png);
    if ((idx+1) % 500 === 0) console.log(`Rendered ${idx+1} / ${lines.length} tiles...`);
  }
  console.log(`Done. Wrote ${lines.length} tiles to ${outdir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
