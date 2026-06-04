#!/usr/bin/env node
/**
 * Reproduce the "light halo around a dark sprite" defect and verify the
 * multi-pass alpha matte removes it while preserving the sprite edge.
 *
 * Scene: dark rounded card (like the UI buttons) on a light/white backdrop,
 * with a realistic anti-aliased boundary (the source of the light halo).
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { runSpritesheetPipeline } from '../src/core/pipeline.ts';
import { opaqueFraction } from '../src/core/opaque.ts';

const W = 256;
const H = 256;

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Signed distance to a rounded rectangle centered in the image. */
function roundedRectCoverage(x: number, y: number): number {
  const halfW = 80;
  const halfH = 80;
  const radius = 24;
  const cx = W / 2;
  const cy = H / 2;
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  const dist = outside + inside - radius;
  // ~1.5px anti-aliased band → coverage in [0,1]
  return Math.min(1, Math.max(0, 0.5 - dist / 1.5));
}

function buildScene(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  const bg: [number, number, number] = [250, 250, 250];
  const card: [number, number, number] = [28, 33, 46];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const c = roundedRectCoverage(x, y);
      data[i] = Math.round(card[0] * c + bg[0] * (1 - c));
      data[i + 1] = Math.round(card[1] * c + bg[1] * (1 - c));
      data[i + 2] = Math.round(card[2] * c + bg[2] * (1 - c));
      data[i + 3] = 255;
    }
  }
  return data;
}

async function savePng(data: Uint8ClampedArray, out: string) {
  await sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } }).png().toFile(out);
}

function isCardRegion(x: number, y: number): boolean {
  return roundedRectCoverage(x, y) > 0.95;
}

function isHaloRing(x: number, y: number): boolean {
  const c = roundedRectCoverage(x, y);
  return c > 0.02 && c < 0.6;
}

async function main() {
  const outDir = path.resolve('test-output-halo');
  fs.mkdirSync(outDir, { recursive: true });

  const source = { data: buildScene(), width: W, height: H };
  await savePng(source.data, path.join(outDir, 'input.png'));

  const result = runSpritesheetPipeline(source, { engine: 'auto', frames: false });
  const out = result.keyed;
  await savePng(out.data, path.join(outDir, 'output.png'));

  let lightHalo = 0; // opaque + light near the boundary = leftover white fringe
  let ringPixels = 0;
  let cardKept = 0;
  let cardTotal = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = out.data[i + 3];
      const l = luma(out.data[i], out.data[i + 1], out.data[i + 2]);

      if (isHaloRing(x, y)) {
        ringPixels++;
        if (a > 60 && l > 150) lightHalo++;
      }
      if (isCardRegion(x, y)) {
        cardTotal++;
        if (a > 200 && l < 90) cardKept++;
      }
    }
  }

  const opaque = opaqueFraction(out);
  const cardKeptFrac = cardTotal ? cardKept / cardTotal : 0;

  console.log('\nLight-halo matte test');
  console.log(`  detect:     ${result.analysis.label}`);
  console.log(`  input:      ${path.join(outDir, 'input.png')}`);
  console.log(`  output:     ${path.join(outDir, 'output.png')}`);
  console.log(`  opaque:     ${(opaque * 100).toFixed(1)}%`);
  console.log(`  light halo: ${lightHalo} / ${ringPixels} ring px (lower is better)`);
  console.log(`  card kept:  ${(cardKeptFrac * 100).toFixed(1)}% dark+opaque`);

  if (lightHalo > 24) {
    console.error('\n✗ Light halo still present around sprite');
    process.exit(1);
  }
  if (cardKeptFrac < 0.95) {
    console.error('\n✗ Sprite body was damaged');
    process.exit(1);
  }

  console.log('\n✓ Halo matte test OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
