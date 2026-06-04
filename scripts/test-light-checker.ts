#!/usr/bin/env node
/**
 * Regression test for the reported bug: a spritesheet exported on a LIGHT
 * transparency checkerboard (white ~252 + light grey ~234) left grey-tile
 * speckles scattered across the result.
 *
 * The grey tile is light enough that the checker detector reads the sheet as a
 * plain solid backdrop, so it goes through the flood path. This verifies the
 * flood + neutral-island cleanup clears BOTH tiles while keeping the colored
 * sprites (and their small white highlights) fully intact.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { runSpritesheetPipeline } from '../src/core/pipeline.ts';
import { opaqueFraction } from '../src/core/opaque.ts';

const W = 384;
const H = 256;
const TILE = 12;
const WHITE: [number, number, number] = [252, 252, 252];
const GREY: [number, number, number] = [234, 234, 234]; // light grey — dodges checker detector

function build(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  const set = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  };
  // Baked transparency checkerboard
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      set(x, y, (((x / TILE) | 0) + ((y / TILE) | 0)) & 1 ? GREY : WHITE);

  // Colored sprites with a dark outline + a small WHITE highlight (must survive)
  const sprite = (cx: number, cy: number) => {
    for (let y = -30; y <= 30; y++)
      for (let x = -22; x <= 22; x++) {
        const d = Math.hypot(x / 22, y / 30);
        if (d > 1) continue;
        set(cx + x, cy + y, d > 0.88 ? [35, 28, 20] : [70, 120, 60]);
      }
    // warm body bits + a small white "eye" highlight inside the sprite
    for (let y = -6; y <= 6; y++) for (let x = -3; x <= 3; x++) set(cx - 6 + x, cy - 8 + y, [250, 250, 250]);
    for (let y = 2; y <= 18; y++) for (let x = -10; x <= 10; x++) set(cx + x, cy + y, [150, 80, 50]);
  };
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) sprite(64 + c * 128, 70 + r * 110);
  return data;
}

function neutralLightOpaqueOutsideSprites(data: Uint8ClampedArray): number {
  // Count light-neutral opaque pixels in the gaps between sprites (pure backdrop area).
  let n = 0;
  const inSprite = (x: number, y: number) => {
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 3; c++) {
        const cx = 64 + c * 128, cy = 70 + r * 110;
        if (Math.hypot((x - cx) / 26, (y - cy) / 34) <= 1) return true;
      }
    return false;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (inSprite(x, y)) continue;
      const i = (y * W + x) * 4;
      if (data[i + 3] < 200) continue;
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (max - min < 22 && max > 215) n++;
    }
  return n;
}

function whiteHighlightKept(data: Uint8ClampedArray): number {
  // The eye highlight of the top-left sprite (cx=64,cy=70 → highlight at ~58,62)
  let opaque = 0, total = 0;
  for (let y = 58; y <= 66; y++)
    for (let x = 55; x <= 61; x++) { total++; if (data[(y * W + x) * 4 + 3] > 40) opaque++; }
  return total ? opaque / total : 0;
}

async function main() {
  const outDir = path.resolve('test-output-light-checker');
  fs.mkdirSync(outDir, { recursive: true });
  const source = { data: build(), width: W, height: H };
  await sharp(Buffer.from(source.data), { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(outDir, 'input.png'));

  const result = runSpritesheetPipeline(source, { engine: 'auto', frames: false });
  const out = result.keyed;
  await sharp(Buffer.from(out.data), { raw: { width: out.width, height: out.height, channels: 4 } }).png().toFile(path.join(outDir, 'output.png'));

  const speckles = neutralLightOpaqueOutsideSprites(out.data);
  const highlight = whiteHighlightKept(out.data);

  console.log('\nLight-checker speckle test');
  console.log(`  detect:        ${result.analysis.label}`);
  console.log(`  output:        ${path.join(outDir, 'output.png')}`);
  console.log(`  opaque:        ${(opaqueFraction(out) * 100).toFixed(1)}%`);
  console.log(`  bg speckles:   ${speckles} (must be near 0)`);
  console.log(`  highlight kept:${(highlight * 100).toFixed(1)}% (small white sprite detail must stay)`);

  if (speckles > 40) {
    console.error('\n✗ Checker grey-tile speckles were left in the background');
    process.exit(1);
  }
  if (highlight < 0.8) {
    console.error('\n✗ Small white sprite highlight was wrongly removed');
    process.exit(1);
  }
  console.log('\n✓ Light-checker test OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
