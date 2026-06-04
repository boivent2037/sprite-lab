#!/usr/bin/env node
/**
 * CLI test for the spritesheet pipeline — run before trusting the browser UI.
 *
 * Usage:
 *   npm run test:pipeline -- path/to/spritesheet.png
 *   npm run test:pipeline -- path/to/spritesheet.png --engine fast
 *   npm run test:pipeline -- path/to/spritesheet.png --out ./output
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { runSpritesheetPipeline } from '../src/core/pipeline.ts';
import { analyzeBackgroundFromRgba } from '../src/core/analyzeBackground.ts';
import { opaqueFraction } from '../src/core/opaque.ts';

async function loadRgba(filePath: string) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  };
}

async function savePng(
  rgba: { data: Uint8ClampedArray; width: number; height: number },
  outPath: string,
) {
  await sharp(Buffer.from(rgba.data), {
    raw: { width: rgba.width, height: rgba.height, channels: 4 },
  })
    .png()
    .toFile(outPath);
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let engine: 'auto' | 'fast' = 'auto';
  let outDir = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--engine' && argv[i + 1]) {
      engine = argv[++i] === 'fast' ? 'fast' : 'auto';
    } else if (arg === '--out' && argv[i + 1]) {
      outDir = argv[++i];
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { input: positional[0], engine, outDir };
}

async function main() {
  const { input, engine, outDir } = parseArgs(process.argv.slice(2));

  if (!input) {
    console.error('Usage: npm run test:pipeline -- <image.png> [--engine auto|fast] [--out dir]');
    process.exit(1);
  }

  const absInput = path.resolve(input);
  if (!fs.existsSync(absInput)) {
    console.error(`File not found: ${absInput}`);
    process.exit(1);
  }

  console.log(`\nSprite Lab pipeline test`);
  console.log(`  input:  ${absInput}`);
  console.log(`  engine: ${engine}`);

  const source = await loadRgba(absInput);
  console.log(`  size:   ${source.width}×${source.height}`);

  const preAnalysis = analyzeBackgroundFromRgba(source);
  console.log(`  detect: ${preAnalysis.label} (${preAnalysis.kind})`);
  console.log(`  opaque: ${(opaqueFraction(source) * 100).toFixed(1)}% before`);

  const t0 = performance.now();
  const result = runSpritesheetPipeline(source, { engine, frames: true });
  const ms = Math.round(performance.now() - t0);

  console.log(`\n✓ Background removed in ${ms}ms`);
  console.log(`  opaque: ${(result.opaqueFraction * 100).toFixed(1)}% after`);
  console.log(`  frames: ${result.frames.length}`);

  const defaultOut = path.join(
    path.dirname(absInput),
    `${path.basename(absInput, path.extname(absInput))}-pipeline-out`,
  );
  const outputDir = outDir ? path.resolve(outDir) : defaultOut;
  fs.mkdirSync(outputDir, { recursive: true });

  const keyedPath = path.join(outputDir, 'keyed.png');
  await savePng(result.keyed, keyedPath);
  console.log(`\n  keyed:  ${keyedPath}`);

  const framesDir = path.join(outputDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  for (let i = 0; i < result.frames.length; i++) {
    const framePath = path.join(framesDir, `frame_${String(i + 1).padStart(3, '0')}.png`);
    await savePng(result.frames[i].image, framePath);
  }
  console.log(`  frames: ${framesDir}/ (${result.frames.length} files)`);

  console.log('\n✓ Pipeline OK\n');
}

main().catch((err) => {
  console.error('\n✗ Pipeline failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
