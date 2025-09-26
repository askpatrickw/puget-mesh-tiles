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

let cachedModuleRender = null;
let cachedCliTemplate = null; // function (stylePath, z,x,y, env) -> Buffer

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
  // Prefer module API once per process
  if (cachedModuleRender === null) {
    cachedModuleRender = getRenderTileFromModule();
  }
  if (typeof cachedModuleRender === 'function') {
    try {
      const res = cachedModuleRender(styleObj, z, x, y, opts);
      return res && typeof res.then === 'function' ? await res : res;
    } catch (e) {
      // If module fails (e.g., tilePath issues), fall back to CLI for the remainder
      cachedModuleRender = undefined;
    }
  }

  // Fallback: use CLI. Detect and cache a working invocation once.
  if (cachedCliTemplate === null) {
    cachedCliTemplate = detectCliTemplate(styleObj, opts.tilePath);
  }
  if (!cachedCliTemplate) {
    throw new Error('mbgl-render CLI not detected; unsupported arguments');
  }
  return cachedCliTemplate(styleObj, z, x, y, opts.tilePath);
}

function detectCliTemplate(styleObj, tilePath) {
  const bin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'mbgl-render.cmd' : 'mbgl-render');
  // Prepare one temporary dir + style.json reused for probes
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbgl-render-'));
  const stylePath = path.join(tmpDir, 'style.json');
  fs.writeFileSync(stylePath, JSON.stringify(styleObj));
  const outPng = path.join(tmpDir, 'tile.png');
  const z=8, x=0, y=0; // harmless probe tile
  const envBase = { ...process.env, TILE_PATH: tilePath || '', tilePath: tilePath || '', MBTILES_DIR: tilePath || '' };

  // Candidate builders (return args array)
  const build = {
    positionalWithImage: (extra=[]) => [stylePath, String(z), String(x), String(y), outPng, ...extra],
  };

  const variants = [
    build.positionalWithImage(['--tilePath', tilePath || '']),
    build.positionalWithImage(['--tile-path', tilePath || '']),
    build.positionalWithImage(['--tilepath', tilePath || '']),
    build.positionalWithImage(['-p', tilePath || '']),
    build.positionalWithImage(['-t', tilePath || '']),
    build.positionalWithImage(),
  ];

  for (const args of variants) {
    const run = spawnSync(bin, args, { stdio: ['ignore', 'inherit', 'inherit'], env: envBase });
    if (!run.error && run.status === 0 && fs.existsSync(outPng)) {
      return (styleObj2, Z, X, Y, tilePath2) => {
        // Write style again in case styleObj changed
        fs.writeFileSync(stylePath, JSON.stringify(styleObj2));
        // Rebuild args with actual tile and tilePath
        const finalArgs = args.slice();
        finalArgs[1] = String(Z);
        finalArgs[2] = String(X);
        finalArgs[3] = String(Y);
        finalArgs[4] = outPng;
        // Update any tilePath occurrences
        for (let i = 0; i < finalArgs.length; i++) {
          if (['--tilePath','--tile-path','--tilepath','-p','-t'].includes(finalArgs[i])) {
            if (i+1 < finalArgs.length) finalArgs[i+1] = tilePath2 || '';
          }
        }
        const env = { ...envBase, TILE_PATH: tilePath2 || '', tilePath: tilePath2 || '', MBTILES_DIR: tilePath2 || '' };
        const run2 = spawnSync(bin, finalArgs, { stdio: ['ignore', 'inherit', 'inherit'], env });
        if (run2.error || run2.status !== 0) {
          throw run2.error || new Error(`mbgl-render failed (${run2.status})`);
        }
        const png = fs.readFileSync(outPng);
        if (!png || png.length === 0) throw new Error('mbgl-render produced no output');
        return png;
      };
    }
  }
  return null;
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
  // Inject MBTiles file name (not absolute path) to work with tilePath
  const mbtilesName = path.basename(path.resolve(mbtiles));
  const styleStr = JSON.stringify(styleJson).replace(/MBTILES_PATH/g, mbtilesName);
  const styleObj = JSON.parse(styleStr);

  const lines = fs.readFileSync(tilelist, 'utf8').trim().split(/\r?\n/);
  const tilePath = path.dirname(path.resolve(mbtiles));
  // Probe once up front to select rendering strategy and validate environment
  if (lines.length > 0) {
    const [pz, px, py] = lines[0].split(',').map(s => parseInt(s, 10));
    try {
      await renderTileCompat(styleObj, pz, px, py, { scale: 1, tilePath });
      // success, continue
    } catch (e) {
      console.error('Renderer initialization failed:', e && e.message ? e.message : e);
      process.exit(1);
    }
  }

  for (const [idx, line] of lines.entries()) {
    if (!line.trim()) continue;
    const [z,x,y] = line.split(',').map(s => parseInt(s, 10));
    const png = await renderTileCompat(styleObj, z, x, y, { scale: 1, tilePath });
    const dir = path.join(outdir, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${y}.png`), png);
    if ((idx+1) % 500 === 0) console.log(`Rendered ${idx+1} / ${lines.length} tiles...`);
  }
  console.log(`Done. Wrote ${lines.length} tiles to ${outdir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
