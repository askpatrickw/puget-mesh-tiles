#!/usr/bin/env node
/**
 * Rasterize a list of tiles (z,x,y) to PNGs using @consbio/mbgl-renderer.
 *
 * Example:
 *   node render_raster_tiles.js --style styles/bright-min.json --mbtiles tiles/vector.mbtiles \
 *        --tilelist tilelist_all.txt --outdir tiles
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Try to load renderTile from the module, but be flexible about export shapes
function getRenderTileFromModule() {
  try {
    const mod = require('@consbio/mbgl-renderer');
    if (mod && typeof mod.renderTile === 'function') return mod.renderTile;
    if (mod && mod.default && typeof mod.default.renderTile === 'function') return mod.default.renderTile;
    if (typeof mod === 'function') return mod; // some builds export the function directly
  } catch (e) {
    // ignore; will fall back to CLI
  }
  return null;
}

async function renderTileCompat(styleObj, z, x, y, opts = {}) {
  const impl = getRenderTileFromModule();
  if (impl) {
    // Use the JS API
    const res = impl(styleObj, z, x, y, opts);
    return res && typeof res.then === 'function' ? await res : res;
  }

  // Fallback: call CLI from node_modules/.bin/mbgl-render
  const bin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'mbgl-render.cmd' : 'mbgl-render');
  // Write a temporary style file with injected mbtiles path already applied
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbgl-render-'));
  const stylePath = path.join(tmpDir, 'style.json');
  fs.writeFileSync(stylePath, JSON.stringify(styleObj));
  const outPng = path.join(tmpDir, 'tile.png');
  const tryArgs = [];
  // Known/guessed variants; try multiple in case of differing CLIs
  tryArgs.push(['--style', stylePath, '--tile', `${z}/${x}/${y}`, '--output', outPng]);
  tryArgs.push(['--style', stylePath, '--z', String(z), '--x', String(x), '--y', String(y), '--output', outPng]);
  tryArgs.push([stylePath, String(z), String(x), String(y), outPng]);
  tryArgs.push([stylePath, '--tile', `${z}/${x}/${y}`, outPng]);

  for (const baseArgs of tryArgs) {
    // Only pass scale when using the first two flag-based variants
    const args = [...baseArgs];
    if (opts && opts.scale && (baseArgs[0] === '--style')) {
      // Attempt common flags for scale, ignore errors
      args.push('--scale', String(opts.scale));
    }
    const run = spawnSync(bin, args, { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
    if (!run.error && run.status === 0 && fs.existsSync(outPng)) {
      const png = fs.readFileSync(outPng);
      if (png && png.length > 0) return png;
    }
  }

  throw new Error('mbgl-render CLI did not accept known arguments; please check @consbio/mbgl-renderer version');
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
  // Inject local MBTiles path into style (replace token "MBTILES_PATH" if present)
  const styleStr = JSON.stringify(styleJson).replace(/MBTILES_PATH/g, path.resolve(mbtiles));
  const styleObj = JSON.parse(styleStr);

  const lines = fs.readFileSync(tilelist, 'utf8').trim().split(/\r?\n/);
  for (const [idx, line] of lines.entries()) {
    if (!line.trim()) continue;
    const [z,x,y] = line.split(',').map(s => parseInt(s, 10));
    const png = await renderTileCompat(styleObj, z, x, y, { scale: 1 });
    const dir = path.join(outdir, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${y}.png`), png);
    if ((idx+1) % 500 === 0) console.log(`Rendered ${idx+1} / ${lines.length} tiles...`);
  }
  console.log(`Done. Wrote ${lines.length} tiles to ${outdir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
