#!/usr/bin/env node
/**
 * Downloads a curated set of CC0 PBR textures + HDRIs from Poly Haven,
 * resizes/encodes them to 1024px WebP, and writes a manifest.
 *
 * Usage: node scripts/fetch-textures.mjs [--force]
 * License: Poly Haven assets are CC0 (https://polyhaven.com/license)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT_TEX = path.join(ROOT, 'public', 'textures');
const OUT_HDRI = path.join(ROOT, 'public', 'hdri');
const MANIFEST = path.join(ROOT, 'src', 'lib', 'materials', 'texture-manifest.json');
const FORCE = process.argv.includes('--force');
const SIZE = 1024;
const CONCURRENCY = 6;

// Poly Haven asset ids grouped by use. Every id is a real Poly Haven texture slug.
export const TEXTURES = [
  // ---- countertops / slabs
  'marble_01', 'marble_tiles', 'granite_tile', 'granite_tile_02', 'granite_tile_03', 'granite_tile_04',
  'terrazzo_tiles', 'smooth_concrete_floor', 'kitchen_wood', 'oak_wood_planks', 'concrete_floor_01',
  // ---- backsplash / wall tile
  'long_white_tiles', 'square_tiled_wall', 'rounded_square_tiled_wall', 'marble_mosaic_tiles',
  'patterned_slate_tiles', 'stone_tile_wall', 'painted_brick', 'interior_tiles', 'square_tiles_02',
  'square_tiles', 'hexagonal_concrete_paving', 'slab_tiles', 'stone_tiles_02',
  // ---- floors
  'plank_flooring', 'plank_flooring_02', 'plank_flooring_03', 'plank_flooring_04', 'laminate_floor_02',
  'laminate_floor', 'herringbone_parquet', 'diagonal_parquet', 'rectangular_parquet', 'dark_wooden_planks',
  'wood_floor', 'large_floor_tiles_02', 'floor_tiles_06', 'floor_tiles_02', 'grey_tiles', 'large_grey_tiles',
  'slate_floor_02', 'terracotta_floor_tiles', 'checkered_pavement_tiles', 'tiled_floor_001',
  // ---- cabinet veneers
  'oak_veneer_01', 'white_oak_veneer', 'american_walnut_veneer', 'black_walnut_veneer_01', 'grey_oak_veneer_01',
  'washed_grey_oak_veneer', 'cherry_veneer', 'ash_veneer', 'mocha_oak_veneer', 'black_oak_veneer', 'natural_walnut_veneer',
  // ---- walls / plaster / ceilings
  'plastered_wall', 'white_plaster_02', 'painted_plaster_wall', 'white_rough_plaster', 'beige_wall_001',
  'grey_plaster_02', 'white_stucco', 'ceiling_interior',
  // ---- exterior siding / cladding / masonry
  'weathered_plank_siding', 'white_planks_clean', 'wood_plank_wall', 'exterior_wall_cladding',
  'exterior_wall_cladding_02', 'exterior_wall_cladding_03', 'box_profile_metal_sheet', 'corrugated_iron_02',
  'red_brick_03', 'brick_wall_001', 'brick_wall_04', 'dark_brick_wall', 'plaster_stone_wall_01',
  'mixed_stone_tiles', 'sandstone_blocks_04', 'castle_wall_slates',
  // ---- roofing
  'roof_tiles', 'grey_roof_tiles', 'clay_roof_tiles', 'roof_slates_02', 'red_slate_roof_tiles_01', 'roof_07',
  'roof_09', 'grey_roof_01', 'roof_3', 'ceramic_roof_01',
  // ---- ground / hardscape
  'leafy_grass', 'sparse_grass', 'concrete_pavers', 'interlocking_concrete_pavers', 'stone_pavers',
  'gravel_floor_02', 'slate_driveway', 'asphalt_01', 'concrete_pavement', 'patterned_concrete_pavers',
  'wood_floor_deck', 'grass_path_2',
];

export const HDRIS = [
  // indoor
  'studio_small_09', 'lebombo', 'blinds', 'brown_photostudio_02', 'photo_studio_loft_hall', 'bathroom', 'hotel_room',
  // outdoor
  'kloofendal_48d_partly_cloudy_puresky', 'qwantani_puresky', 'residential_garden', 'suburban_parking_area',
  'courtyard', 'spruit_sunrise',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'manhatten-texture-fetch/1.0' } });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
}

async function fetchBuffer(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'manhatten-texture-fetch/1.0' } });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function pickMap(files, key) {
  const m = files[key];
  if (!m) return null;
  const res = m['1k'] || m['2k'];
  if (!res) return null;
  const f = res.jpg || res.png;
  return f?.url || null;
}

async function processTexture(id) {
  const dir = path.join(OUT_TEX, id);
  await fs.mkdir(dir, { recursive: true });
  const files = await fetchJson(`https://api.polyhaven.com/files/${id}`);
  const maps = {
    diff: pickMap(files, 'Diffuse'),
    nor: pickMap(files, 'nor_gl'),
    arm: pickMap(files, 'arm'),
    rough: pickMap(files, 'Rough'),
    ao: pickMap(files, 'AO'),
    disp: pickMap(files, 'Displacement'),
  };
  // Prefer ARM (AO/Roughness/Metalness packed). Fall back to rough+ao.
  const wanted = ['diff', 'nor'];
  if (maps.arm) wanted.push('arm'); else { if (maps.rough) wanted.push('rough'); if (maps.ao) wanted.push('ao'); }
  const entry = { id, maps: {}, license: 'CC0', source: `https://polyhaven.com/a/${id}` };
  for (const k of wanted) {
    const url = maps[k];
    if (!url) continue;
    const out = path.join(dir, `${k}.webp`);
    if (!FORCE && (await exists(out))) { entry.maps[k] = `/textures/${id}/${k}.webp`; continue; }
    const buf = await fetchBuffer(url);
    const isColor = k === 'diff';
    await sharp(buf)
      .resize(SIZE, SIZE, { fit: 'cover' })
      .webp({ quality: isColor ? 82 : 78, effort: 4, smartSubsample: false })
      .toFile(out);
    entry.maps[k] = `/textures/${id}/${k}.webp`;
  }
  return entry;
}

async function processHdri(id) {
  await fs.mkdir(OUT_HDRI, { recursive: true });
  const out = path.join(OUT_HDRI, `${id}_1k.hdr`);
  if (!FORCE && (await exists(out))) return { id, url: `/hdri/${id}_1k.hdr` };
  const files = await fetchJson(`https://api.polyhaven.com/files/${id}`);
  const url = files?.hdri?.['1k']?.hdr?.url;
  if (!url) throw new Error(`no 1k hdr for ${id}`);
  const buf = await fetchBuffer(url);
  await fs.writeFile(out, buf);
  return { id, url: `/hdri/${id}_1k.hdr`, license: 'CC0', source: `https://polyhaven.com/a/${id}` };
}

async function pool(items, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      try {
        results[idx] = await worker(item);
        console.log(`ok   ${item}`);
      } catch (e) {
        results[idx] = null;
        console.error(`FAIL ${item}: ${e.message}`);
      }
    }
  });
  await Promise.all(runners);
  return results;
}

const textures = (await pool(TEXTURES, processTexture)).filter(Boolean);
const hdris = (await pool(HDRIS, processHdri)).filter(Boolean);
await fs.mkdir(path.dirname(MANIFEST), { recursive: true });
await fs.writeFile(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), size: SIZE, textures, hdris }, null, 2));
console.log(`\nWrote ${textures.length} textures and ${hdris.length} HDRIs → ${path.relative(ROOT, MANIFEST)}`);
