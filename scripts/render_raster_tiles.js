#!/usr/bin/env node
/**
 * Rasterize a list of tiles (z,x,y) to PNGs using the Node API from @consbio/mbgl-renderer.
 *
 * Example:
 *   node render_raster_tiles.js --style styles/bright-min.json --mbtiles tiles/vector.mbtiles \
 *        --tilelist tilelist_all.txt --outdir tiles
 */
const fs = require('fs');
const path = require('path');

function getRenderFn() {
  const mod = require('@consbio/mbgl-renderer');
  if (mod && typeof mod.renderTile === 'function') return mod.renderTile;
  if (mod && typeof mod.render === 'function') return mod.render;
  if (mod && mod.default && typeof mod.default.renderTile === 'function') return mod.default.renderTile;
  if (mod && mod.default && typeof mod.default.render === 'function') return mod.default.render;
  throw new Error('mbgl-renderer Node API not found (renderTile/render)');
}

function loadStyleWithMbtilesBasename(styleJsonPath, mbtilesAbsPath) {
  const styleJson = JSON.parse(fs.readFileSync(styleJsonPath, 'utf8'));
  const basename = path.basename(mbtilesAbsPath);
  const styleStr = JSON.stringify(styleJson).replace(/MBTILES_PATH/g, basename);
  return JSON.parse(styleStr);
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
  const absMbtiles = path.resolve(mbtiles);
  const tilePath = path.dirname(absMbtiles);
  const styleObj = loadStyleWithMbtilesBasename(style, absMbtiles);

  const lines = fs.readFileSync(tilelist, 'utf8').trim().split(/\r?\n/);
  if (lines.length === 0) {
    console.error('Tilelist is empty');
    process.exit(2);
  }

  const [pz, px, py] = lines[0].split(',').map(s => parseInt(s, 10));
  let renderTile;
  try {
    renderTile = getRenderFn();
    // Probe one tile
    await Promise.resolve(renderTile(styleObj, pz, px, py, { tilePath, scale: 1 }));
  } catch (e) {
    console.error('Renderer initialization failed:', e && e.message ? e.message : e);
    process.exit(1);
  }

  for (const [idx, line] of lines.entries()) {
    if (!line.trim()) continue;
    const [z,x,y] = line.split(',').map(s => parseInt(s, 10));
    const png = await Promise.resolve(renderTile(styleObj, z, x, y, { tilePath, scale: 1 }));
    const dir = path.join(outdir, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${y}.png`), png);
    if ((idx+1) % 500 === 0) console.log(`Rendered ${idx+1} / ${lines.length} tiles...`);
  }
  console.log(`Done. Wrote ${lines.length} tiles to ${outdir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
