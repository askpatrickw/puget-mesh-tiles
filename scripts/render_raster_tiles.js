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
  const mod = require('mbgl-renderer');
  if (typeof mod === 'function') return mod; // default export is render()
  if (mod && typeof mod.render === 'function') return mod.render;
  if (mod && typeof mod.renderTile === 'function') return mod.renderTile;
  if (mod && mod.default && typeof mod.default === 'function') return mod.default;
  if (mod && mod.default && typeof mod.default.render === 'function') return mod.default.render;
  if (mod && mod.default && typeof mod.default.renderTile === 'function') return mod.default.renderTile;
  throw new Error('mbgl-renderer Node API not found (render or renderTile)');
}

function tileBBox(z, x, y) {
  const n = Math.pow(2, z);
  const lonLeft = (x / n) * 360 - 180;
  const lonRight = ((x + 1) / n) * 360 - 180;
  const latTop = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const latBottom = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  return [lonLeft, latBottom, lonRight, latTop];
}

function loadStyleWithMbtilesBasename(styleJsonPath, mbtilesAbsPath) {
  const styleJson = JSON.parse(fs.readFileSync(styleJsonPath, 'utf8'));
  // mbgl-renderer expects service name (without .mbtiles) in URLs like mbtiles://<service>
  const basename = path.basename(mbtilesAbsPath);
  const serviceName = basename.replace(/\.mbtiles$/i, '');
  const styleStr = JSON.stringify(styleJson).replace(/MBTILES_PATH/g, serviceName);
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
  let renderFn;
  try {
    renderFn = getRenderFn();
    // Probe one tile by rendering a 256x256 image for that tile's bounds
    const bounds = tileBBox(pz, px, py);
    await Promise.resolve(renderFn(styleObj, 256, 256, { bounds, ratio: 1, tilePath }));
  } catch (e) {
    console.error('Renderer initialization failed:', e && e.message ? e.message : e);
    process.exit(1);
  }

  for (const [idx, line] of lines.entries()) {
    if (!line.trim()) continue;
    const [z,x,y] = line.split(',').map(s => parseInt(s, 10));
    const bounds = tileBBox(z, x, y);
    const png = await Promise.resolve(renderFn(styleObj, 256, 256, { bounds, ratio: 1, tilePath }));
    const dir = path.join(outdir, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${y}.png`), png);
    if ((idx+1) % 500 === 0) console.log(`Rendered ${idx+1} / ${lines.length} tiles...`);
  }
  console.log(`Done. Wrote ${lines.length} tiles to ${outdir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
