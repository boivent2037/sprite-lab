#!/usr/bin/env node
/**
 * Test checkerboard removal with subtle drop shadows.
 * Generates a synthetic sprite on checkerboard, runs removal, reports halo pixels.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { removeCheckerboardFromRgba } from '../src/core/checkerboard.ts';
import { opaqueFraction } from '../src/core/opaque.ts';
import { minCheckerDist, detectCheckerColors, lum } from '../src/edgeCleanup.ts';

const SIZE = 256;
const TILE = 32;

function makeCheckerboard(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  const light: [number, number, number] = [255, 255, 255];
  const dark: [number, number, number] = [196, 196, 196];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const c = (Math.floor(x / TILE) + Math.floor(y / TILE)) % 2 === 0 ? light : dark;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

function drawDisk(
  data: Uint8ClampedArray,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number, number],
) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = (y * SIZE + x) * 4;
      const a = color[3] / 255;
      data[i] = Math.round(data[i] * (1 - a) + color[0] * a);
      data[i + 1] = Math.round(data[i + 1] * (1 - a) + color[1] * a);
      data[i + 2] = Math.round(data[i + 2] * (1 - a) + color[2] * a);
      data[i + 3] = 255;
    }
  }
}

async function savePng(data: Uint8ClampedArray, w: number, h: number, out: string) {
  await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } }).png().toFile(out);
}

function countCheckerHalos(data: Uint8ClampedArray, w: number, h: number): number {
  const { colors } = detectCheckerColors(data, w, h);
  let halos = 0;
  const n = w * h;

  for (let idx = 0; idx < n; idx++) {
    const i = idx * 4;
    if (data[i + 3] < 16) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (minCheckerDist(r, g, b, colors) > 40) continue;
    if (lum(r, g, b) > 170) continue; // ignore kept shadow pixels

    // Opaque checker-colored pixel = leftover halo
    halos++;
  }

  return halos;
}

async function main() {
  const outDir = path.resolve('test-output-checker');
  fs.mkdirSync(outDir, { recursive: true });

  const data = makeCheckerboard();
  // Drop shadow (subtle grey — confuses naive checker matchers)
  drawDisk(data, 140, 148, 52, [55, 55, 55, 90]);
  drawDisk(data, 138, 146, 52, [75, 75, 75, 70]);
  // Gold coin body
  drawDisk(data, 128, 128, 48, [220, 170, 40, 255]);

  const source = { data, width: SIZE, height: SIZE };
  const inputPath = path.join(outDir, 'input-checker-shadow.png');
  await savePng(data, SIZE, SIZE, inputPath);

  const result = removeCheckerboardFromRgba(source);
  const outputPath = path.join(outDir, 'output-checker-shadow.png');
  await savePng(result.data, SIZE, SIZE, outputPath);

  const halos = countCheckerHalos(result.data, SIZE, SIZE);
  const opaque = opaqueFraction(result);
  const shadowKept = (() => {
    let n = 0;
    for (let y = 130; y < 165; y++) {
      for (let x = 100; x < 175; x++) {
        const i = (y * SIZE + x) * 4;
        const l = lum(result.data[i], result.data[i + 1], result.data[i + 2]);
        if (result.data[i + 3] > 16 && l < 150 && l > 40) n++;
      }
    }
    return n;
  })();

  console.log('\nCheckerboard + shadow test');
  console.log(`  input:       ${inputPath}`);
  console.log(`  output:      ${outputPath}`);
  console.log(`  opaque:      ${(opaque * 100).toFixed(1)}%`);
  console.log(`  halos:       ${halos} checker-colored pixels (lower is better)`);
  console.log(`  shadow kept: ${shadowKept} pixels in shadow region`);

  if (halos > 120) {
    console.error('\n✗ Too many checker halos remain');
    process.exit(1);
  }
  if (shadowKept < 80) {
    console.error('\n✗ Drop shadow was over-removed');
    process.exit(1);
  }
  if (opaque < 0.08) {
    console.error('\n✗ Sprite was over-removed');
    process.exit(1);
  }

  console.log('\n✓ Checkerboard shadow test OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
