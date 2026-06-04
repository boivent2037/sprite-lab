import { loadImage } from './imageProcessor';
import { refineEdgeMatteInPlace } from './core/edgeMatte';

export interface CheckerColors {
  colors: [number, number, number][];
}

const ALPHA_CUT = 16;

export function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function saturation(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

export function colorDist(r: number, g: number, b: number, tr: number, tg: number, tb: number): number {
  return Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb);
}

export function minCheckerDist(
  r: number,
  g: number,
  b: number,
  colors: [number, number, number][],
): number {
  let min = Infinity;
  for (const c of colors) {
    min = Math.min(min, colorDist(r, g, b, c[0], c[1], c[2]));
  }
  return min;
}

export function matchesChecker(
  r: number,
  g: number,
  b: number,
  colors: [number, number, number][],
  tolerance: number,
  maxSat = 42,
): boolean {
  if (saturation(r, g, b) > maxSat) return false;
  return minCheckerDist(r, g, b, colors) <= tolerance;
}

/** Sample border pixels to find the two checker tile greys/whites. */
export function detectCheckerColors(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): CheckerColors {
  const buckets = new Map<number, number>();

  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min > 40 || max < 120) return;
    const key = (Math.round(r / 16) << 16) | (Math.round(g / 16) << 8) | Math.round(b / 16);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  };

  for (let x = 0; x < w; x++) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    sample(0, y);
    sample(w - 1, y);
  }

  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  const colors: [number, number, number][] = [];

  for (const [key] of sorted) {
    if (colors.length >= 2) break;
    const r = ((key >> 16) & 0xff) * 16 + 8;
    const g = ((key >> 8) & 0xff) * 16 + 8;
    const b = (key & 0xff) * 16 + 8;
    const dup = colors.some(
      (c) => Math.abs(c[0] - r) + Math.abs(c[1] - g) + Math.abs(c[2] - b) < 40,
    );
    if (!dup) colors.push([r, g, b]);
  }

  if (colors.length === 0) {
    colors.push([255, 255, 255], [196, 196, 196]);
  } else if (colors.length === 1) {
    const c = colors[0][0];
    colors.push([Math.max(0, c - 64), Math.max(0, c - 64), Math.max(0, c - 64)]);
  }

  return { colors };
}

function hasTransparentNeighbor(data: Uint8ClampedArray, w: number, h: number, idx: number): boolean {
  const x = idx % w;
  const y = (idx / w) | 0;
  const nbs = [
    x > 0 ? idx - 1 : -1,
    x < w - 1 ? idx + 1 : -1,
    y > 0 ? idx - w : -1,
    y < h - 1 ? idx + w : -1,
  ];
  for (const nb of nbs) {
    if (nb >= 0 && data[nb * 4 + 3] < ALPHA_CUT) return true;
  }
  return false;
}

/**
 * 0 = reads as checker fringe, 1 = reads as sprite/shadow foreground.
 * Drop shadows are low-sat grey but sit closer to sprite edge colors than to checker tiles.
 */
export function foregroundAffinity(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  idx: number,
  checkerColors: [number, number, number][],
): number {
  const i = idx * 4;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const x = idx % w;
  const y = (idx / w) | 0;

  let fgR = 0;
  let fgG = 0;
  let fgB = 0;
  let fgCount = 0;

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = (ny * w + nx) * 4;
      if (data[ni + 3] < ALPHA_CUT) continue;

      const nr = data[ni];
      const ng = data[ni + 1];
      const nb = data[ni + 2];
      const ns = saturation(nr, ng, nb);
      const ck = minCheckerDist(nr, ng, nb, checkerColors);

      // Colored sprite body or a shadow that is darker than the checker tiles
      const darkerThanChecker =
        lum(nr, ng, nb) < Math.min(...checkerColors.map((c) => lum(c[0], c[1], c[2]))) - 12;

      if (ns > 36 || ck > 58 || darkerThanChecker) {
        fgR += nr;
        fgG += ng;
        fgB += nb;
        fgCount++;
      }
    }
  }

  if (fgCount === 0) return 0;

  const fgDist = colorDist(r, g, b, fgR / fgCount, fgG / fgCount, fgB / fgCount);
  const ckDist = minCheckerDist(r, g, b, checkerColors);
  return fgDist / (fgDist + ckDist + 1);
}

/** Fringe pixel: checker halo — not a sprite drop shadow. */
function isCheckerFringePixel(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  idx: number,
  checkerColors: [number, number, number][],
): boolean {
  const i = idx * 4;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const a = data[i + 3];
  const sat = saturation(r, g, b);
  const l = lum(r, g, b);
  const minCkLum = Math.min(...checkerColors.map((c) => lum(c[0], c[1], c[2])));

  // Drop shadows sit below checker luminance — keep them
  if (l < minCkLum - 18 && sat < 40) return false;

  const affinity = foregroundAffinity(data, w, h, idx, checkerColors);
  if (affinity > 0.52) return false;

  if (matchesChecker(r, g, b, checkerColors, 48, 40)) return true;

  // Semi-transparent anti-alias where checker shows through (not opaque shadow)
  if (a < 220 && l > minCkLum - 10 && sat < 38 && matchesChecker(r, g, b, checkerColors, 68, 48)) {
    return true;
  }

  // Light neutral halo on silhouette only — must still be checker-nearer than sprite
  if (l > minCkLum - 8 && sat < 26 && affinity < 0.38) {
    return minCheckerDist(r, g, b, checkerColors) <= 72;
  }

  return false;
}

export function peelCheckerFringeInPlace(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  checkerColors: [number, number, number][],
  maxPasses = 6,
) {
  const n = w * h;

  for (let pass = 0; pass < maxPasses; pass++) {
    const remove: number[] = [];

    for (let idx = 0; idx < n; idx++) {
      const i = idx * 4;
      if (data[i + 3] < ALPHA_CUT) continue;
      if (!hasTransparentNeighbor(data, w, h, idx)) continue;

      if (isCheckerFringePixel(data, w, h, idx, checkerColors)) {
        remove.push(idx);
      }
    }

    if (remove.length === 0) break;
    for (const idx of remove) data[idx * 4 + 3] = 0;
  }
}

function shouldExpandCheckerPixel(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  idx: number,
  checkerColors: [number, number, number][],
  tolerance: number,
): boolean {
  const i = idx * 4;
  if (data[i + 3] < ALPHA_CUT) return false;

  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  if (!matchesChecker(r, g, b, checkerColors, tolerance, 48)) return false;

  const l = lum(r, g, b);
  const minCkLum = Math.min(...checkerColors.map((c) => lum(c[0], c[1], c[2])));
  if (l < minCkLum - 16 && saturation(r, g, b) < 40) return false;

  return foregroundAffinity(data, w, h, idx, checkerColors) < 0.48;
}

/** In-place checkerboard matte removal with shadow-aware fringe peeling. */
export function removeCheckerboardInPlace(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): void {
  const n = w * h;
  const { colors: checkerColors } = detectCheckerColors(data, w, h);
  const tolerance = 52;

  let transparent = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < ALPHA_CUT) transparent++;
  }

  const alreadyKeyed = transparent / n > 0.02;

  if (!alreadyKeyed) {
    const isBg = (idx: number): boolean => {
      const i = idx * 4;
      if (data[i + 3] < ALPHA_CUT) return true;
      return matchesChecker(data[i], data[i + 1], data[i + 2], checkerColors, tolerance);
    };

    const visited = new Uint8Array(n);
    const queue: number[] = [];
    const pushIf = (idx: number) => {
      if (idx < 0 || idx >= n || visited[idx]) return;
      visited[idx] = 1;
      if (isBg(idx)) queue.push(idx);
    };

    for (let x = 0; x < w; x++) {
      pushIf(x);
      pushIf((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      pushIf(y * w);
      pushIf(y * w + (w - 1));
    }

    while (queue.length) {
      const idx = queue.pop() as number;
      data[idx * 4 + 3] = 0;
      const x = idx % w;
      const y = (idx / w) | 0;
      if (x > 0) pushIf(idx - 1);
      if (x < w - 1) pushIf(idx + 1);
      if (y > 0) pushIf(idx - w);
      if (y < h - 1) pushIf(idx + w);
    }

    // Shadow-aware expansion: peel checker halos beside transparency, not drop shadows
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let idx = 0; idx < n; idx++) {
        if (data[idx * 4 + 3] >= ALPHA_CUT) continue;
        if (!hasTransparentNeighbor(data, w, h, idx)) continue;

        const x = idx % w;
        const y = (idx / w) | 0;
        const neighbors = [
          x > 0 ? idx - 1 : -1,
          x < w - 1 ? idx + 1 : -1,
          y > 0 ? idx - w : -1,
          y < h - 1 ? idx + w : -1,
        ];
        for (const nb of neighbors) {
          if (nb < 0) continue;
          if (shouldExpandCheckerPixel(data, w, h, nb, checkerColors, tolerance + 8)) {
            data[nb * 4 + 3] = 0;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  // Light pattern-based peel for obvious checker-colored fringe, then hand off
  // to the multi-pass matte solver which handles anti-aliased / shadowed edges.
  peelCheckerFringeInPlace(data, w, h, checkerColors, 2);
  refineEdgeMatteInPlace(data, w, h, { radius: 2, passes: 5, minContrast: 55 });
  defringeInPlace(data, w, h, 2);
}

export async function removeCheckerboardMatte(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.width;
  const h = img.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);

  removeCheckerboardInPlace(imageData.data, w, h);

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function defringeInPlace(data: Uint8ClampedArray, w: number, h: number, radius = 2) {
  const n = w * h;
  const rgb = new Float32Array(n * 3);

  for (let pass = 0; pass < radius; pass++) {
    for (let idx = 0; idx < n; idx++) {
      const i = idx * 4;
      if (data[i + 3] < ALPHA_CUT) continue;
      rgb[idx * 3] = data[i];
      rgb[idx * 3 + 1] = data[i + 1];
      rgb[idx * 3 + 2] = data[i + 2];
    }

    for (let idx = 0; idx < n; idx++) {
      if (data[idx * 4 + 3] >= ALPHA_CUT) continue;
      const x = idx % w;
      const y = (idx / w) | 0;

      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (data[ni * 4 + 3] < ALPHA_CUT) continue;
          r += rgb[ni * 3];
          g += rgb[ni * 3 + 1];
          b += rgb[ni * 3 + 2];
          count++;
        }
      }

      if (count > 0) {
        rgb[idx * 3] = r / count;
        rgb[idx * 3 + 1] = g / count;
        rgb[idx * 3 + 2] = b / count;
      }
    }
  }

  for (let idx = 0; idx < n; idx++) {
    const i = idx * 4;
    if (data[i + 3] >= ALPHA_CUT) continue;
    if (rgb[idx * 3] + rgb[idx * 3 + 1] + rgb[idx * 3 + 2] > 0) {
      data[i] = Math.round(rgb[idx * 3]);
      data[i + 1] = Math.round(rgb[idx * 3 + 1]);
      data[i + 2] = Math.round(rgb[idx * 3 + 2]);
    }
  }
}

export async function defringeImage(dataUrl: string, radius = 2): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.width;
  const h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  defringeInPlace(imageData.data, w, h, radius);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function cleanSpriteFrame(dataUrl: string): Promise<string> {
  return defringeImage(dataUrl, 2);
}
