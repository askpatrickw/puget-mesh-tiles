#!/usr/bin/env node
/**
 * Fetch glyph PBFs for the fonts used by a MapLibre style and cache them locally.
 *
 * Usage:
 *   node scripts/fetch_glyphs.js \
 *     --style styles/topo-major.json \
 *     --out glyphs \
 *     --base https://demotiles.maplibre.org/fonts \
 *     --ranges "0-255,256-511,512-767,768-1023"
 */
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (!k.startsWith('--')) continue;
    const key = k.replace(/^--/, '');
    const val = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : 'true';
    out[key] = val;
  }
  return out;
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function extractFontStacks(style) {
  const stacks = new Set();
  function addFromArray(arr) {
    if (!Array.isArray(arr) || !arr.length) return;
    if (arr.every(s => typeof s === 'string')) {
      // MapLibre combines stack names with a comma and no space
      stacks.add(arr.join(','));
      for (const f of arr) stacks.add(f);
      return;
    }
    // Walk nested arrays to discover embedded string arrays (e.g., ["literal", [..]])
    const queue = [arr];
    while (queue.length) {
      const v = queue.shift();
      if (Array.isArray(v)) {
        if (v.length && v.every(x => typeof x === 'string')) {
          stacks.add(v.join(','));
          for (const f of v) stacks.add(f);
          continue;
        }
        for (const x of v) queue.push(x);
      }
    }
  }
  for (const layer of style.layers || []) {
    const tf = layer && layer.layout && layer.layout['text-font'];
    if (tf) addFromArray(tf);
  }
  return Array.from(stacks);
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const argv = parseArgs();
  const stylePath = argv.style;
  if (!stylePath) {
    console.error('Usage: --style <style.json> --out <dir> [--base <url>] [--ranges "0-255,256-511,..."]');
    process.exit(2);
  }
  const outDir = argv.out || 'glyphs';
  const base = (argv.base || process.env.GLYPHS_BASE || 'https://fonts.openmaptiles.org').replace(/\/$/, '');
  const rangesStr = argv.ranges || '0-255,256-511,512-767,768-1023';
  const ranges = rangesStr.split(',').map(s => s.trim()).filter(Boolean);

  const style = readJSON(stylePath);
  const stacks = extractFontStacks(style);
  if (!stacks.length) {
    console.log('No text fonts found in style; nothing to fetch.');
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Fetching glyphs for ${stacks.length} font stack(s) into ${outDir}`);

  const results = [];
  for (const stack of stacks) {
    const stackDir = path.join(outDir, stack);
    fs.mkdirSync(stackDir, { recursive: true });
    for (const range of ranges) {
      const target = path.join(stackDir, `${range}.pbf`);
      if (fs.existsSync(target)) {
        results.push({ stack, range, status: 'cached' });
        continue;
      }
      const u = `${base}/${encodeURIComponent(stack)}/${range}.pbf`;
      try {
        const buf = await fetchBuffer(u);
        fs.writeFileSync(target, buf);
        results.push({ stack, range, status: 'downloaded' });
      } catch (e) {
        results.push({ stack, range, status: `miss:${e.status||e.message}` });
      }
    }
  }

  // Write a simple manifest
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
    base,
    ranges,
    stacks,
    generated: new Date().toISOString()
  }, null, 2));

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log('Glyph fetch summary:', summary);
}

main().catch(err => { console.error(err); process.exit(1); });
