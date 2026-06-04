import type { BackgroundAnalysis, RgbaImage } from './types';

function magentaCast(r: number, g: number, b: number): number {
  return Math.max(0, Math.min(r, b) - g);
}

function greenCast(r: number, g: number, b: number): number {
  return Math.max(0, g - Math.max(r, b));
}

function borderHasCheckerPattern(data: Uint8ClampedArray, width: number, height: number): boolean {
  let whiteish = 0;
  let greyish = 0;
  let samples = 0;

  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min > 42) return;
    samples++;
    if (max > 225) whiteish++;
    else if (max > 130 && max < 215) greyish++;
  };

  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    sample(0, y);
    sample(width - 1, y);
  }

  if (samples === 0) return false;
  return whiteish / samples > 0.1 && greyish / samples > 0.1;
}

function borderIsSolidLight(data: Uint8ClampedArray, width: number, height: number): boolean {
  const colors: [number, number, number][] = [];
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    colors.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    sample(0, y);
    sample(width - 1, y);
  }
  if (colors.length === 0) return false;

  const avg: [number, number, number] = [
    Math.round(colors.reduce((s, c) => s + c[0], 0) / colors.length),
    Math.round(colors.reduce((s, c) => s + c[1], 0) / colors.length),
    Math.round(colors.reduce((s, c) => s + c[2], 0) / colors.length),
  ];
  const max = Math.max(avg[0], avg[1], avg[2]);
  if (max < 180) return false;

  let match = 0;
  for (const c of colors) {
    const dist = Math.abs(c[0] - avg[0]) + Math.abs(c[1] - avg[1]) + Math.abs(c[2] - avg[2]);
    if (dist < 50) match++;
  }
  return match / colors.length > 0.65;
}

/** Downscale large images for faster backdrop detection. */
export function sampleForAnalysis(img: RgbaImage, maxDim = 512): RgbaImage {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1) return img;

  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const data = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.round(x / scale));
      const sy = Math.min(img.height - 1, Math.round(y / scale));
      const si = (sy * img.width + sx) * 4;
      const di = (y * w + x) * 4;
      data[di] = img.data[si];
      data[di + 1] = img.data[si + 1];
      data[di + 2] = img.data[si + 2];
      data[di + 3] = img.data[si + 3];
    }
  }
  return { data, width: w, height: h };
}

export function analyzeBackgroundFromRgba(img: RgbaImage): BackgroundAnalysis {
  const sample = sampleForAnalysis(img);
  const { data, width, height } = sample;
  const n = width * height;

  let transparent = 0;
  let magenta = 0;
  let green = 0;

  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 200) {
      transparent++;
      continue;
    }
    if (magentaCast(r, g, b) > 60) magenta++;
    if (greenCast(r, g, b) > 60) green++;
  }

  if (transparent / n > 0.02) {
    return { kind: 'transparent', label: 'Already transparent' };
  }

  const mFrac = magenta / n;
  const gFrac = green / n;

  if (mFrac > 0.06 && mFrac >= gFrac) {
    return { kind: 'magenta', label: 'Magenta screen' };
  }
  if (gFrac > 0.06) {
    return { kind: 'green', label: 'Green screen' };
  }

  if (borderHasCheckerPattern(data, width, height)) {
    return { kind: 'checkerboard', label: 'Checkerboard' };
  }

  if (borderIsSolidLight(data, width, height)) {
    return { kind: 'solid', label: 'Solid backdrop' };
  }

  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ].map(([x, y]) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
  });
  const spread = Math.max(
    ...corners.map((c) =>
      Math.max(
        Math.abs(c[0] - corners[0][0]),
        Math.abs(c[1] - corners[0][1]),
        Math.abs(c[2] - corners[0][2]),
      ),
    ),
  );
  if (spread < 24) {
    return { kind: 'solid', label: 'Solid backdrop' };
  }

  return { kind: 'none', label: 'No backdrop detected' };
}
