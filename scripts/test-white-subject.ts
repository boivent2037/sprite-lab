#!/usr/bin/env node
/**
 * Regression test for the reported bug: white subjects on a white/light
 * backdrop must NOT be deleted. A white-clothed figure (line-art outline) on a
 * near-white background should keep its body while the backdrop is removed.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { runSpritesheetPipeline } from '../src/core/pipeline.ts';
import { opaqueFraction } from '../src/core/opaque.ts';

const W = 256;
const H = 256;

function buildScene(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  const set = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  };

  // Near-white backdrop
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, [250, 250, 250]);

  // Filled shape with a thin darker line-art outline (anime style)
  const fillRectOutlined = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    fill: [number, number, number],
    outline: [number, number, number],
  ) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const edge = x <= x0 + 1 || x >= x1 - 1 || y <= y0 + 1 || y >= y1 - 1;
        set(x, y, edge ? outline : fill);
      }
  };
  const disk = (cx: number, cy: number, r: number, c: [number, number, number], outline?: [number, number, number]) => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        set(x, y, outline && d > r - 2 ? outline : c);
      }
  };

  const lineArt: [number, number, number] = [60, 55, 65];

  // Hair (dark) + head (skin)
  disk(128, 70, 40, [38, 32, 44]);
  disk(128, 78, 26, [236, 205, 178], lineArt);

  // White dress / body (the part that was being wrongly deleted)
  fillRectOutlined(92, 104, 164, 196, [252, 252, 252], lineArt);
  // White skirt flare
  fillRectOutlined(80, 176, 176, 212, [251, 251, 251], lineArt);

  // White socks (small white pieces near the bottom)
  fillRectOutlined(104, 214, 120, 240, [253, 253, 253], lineArt);
  fillRectOutlined(136, 214, 152, 240, [253, 253, 253], lineArt);

  return data;
}

async function savePng(data: Uint8ClampedArray, out: string) {
  await sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } }).png().toFile(out);
}

function opaqueInRect(data: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number): number {
  let opaque = 0;
  let total = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      total++;
      if (data[(y * W + x) * 4 + 3] > 40) opaque++;
    }
  return total ? opaque / total : 0;
}

async function main() {
  const outDir = path.resolve('test-output-white');
  fs.mkdirSync(outDir, { recursive: true });

  const source = { data: buildScene(), width: W, height: H };
  await savePng(source.data, path.join(outDir, 'input.png'));

  const result = runSpritesheetPipeline(source, { engine: 'auto', frames: false });
  const out = result.keyed;
  await savePng(out.data, path.join(outDir, 'output.png'));

  const dressKept = opaqueInRect(out.data, 110, 120, 146, 180); // dress interior
  const sockKept = opaqueInRect(out.data, 106, 218, 118, 236); // a white sock
  const bgGone = 1 - opaqueInRect(out.data, 0, 0, 20, 20); // top-left corner

  console.log('\nWhite-subject regression test');
  console.log(`  detect:     ${result.analysis.label}`);
  console.log(`  input:      ${path.join(outDir, 'input.png')}`);
  console.log(`  output:     ${path.join(outDir, 'output.png')}`);
  console.log(`  opaque:     ${(opaqueFraction(out) * 100).toFixed(1)}%`);
  console.log(`  dress kept: ${(dressKept * 100).toFixed(1)}% (must stay high)`);
  console.log(`  sock kept:  ${(sockKept * 100).toFixed(1)}% (must stay high)`);
  console.log(`  bg removed: ${(bgGone * 100).toFixed(1)}% of corner`);

  if (dressKept < 0.9) {
    console.error('\n✗ White dress was deleted');
    process.exit(1);
  }
  if (sockKept < 0.9) {
    console.error('\n✗ White socks were deleted');
    process.exit(1);
  }
  if (bgGone < 0.9) {
    console.error('\n✗ Background was not removed');
    process.exit(1);
  }

  console.log('\n✓ White-subject test OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
