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
const { renderTile } = require('@consbio/mbgl-renderer');

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
  // Inject local MBTiles path into style (replace token "MBTILES_PATH" if present)
  const styleStr = JSON.stringify(styleJson).replace(/MBTILES_PATH/g, path.resolve(mbtiles));
  const styleObj = JSON.parse(styleStr);

  const lines = fs.readFileSync(tilelist, 'utf8').trim().split(/\r?\n/);
  for (const [idx, line] of lines.entries()) {
    if (!line.trim()) continue;
    const [z,x,y] = line.split(',').map(s => parseInt(s, 10));
    const png = await renderTile(styleObj, z, x, y, { scale: 1 });
    const dir = path.join(outdir, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${y}.png`), png);
    if ((idx+1) % 500 === 0) console.log(`Rendered ${idx+1} / ${lines.length} tiles...`);
  }
  console.log(`Done. Wrote ${lines.length} tiles to ${outdir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
