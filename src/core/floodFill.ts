import type { RgbaImage } from './types';
import { cloneRgba } from './chromaKey';

export interface FloodFillOptions {
  transparentSkipFraction?: number;
  maxSize?: number;
  /** Sum-abs color distance for a pixel to count as the backdrop tone. */
  tolerance?: number;
}

/** Flood-fill backdrop removal from image borders — white/grey studio exports. */
export function floodFillRemoveBackground(
  source: RgbaImage,
  opts: FloodFillOptions = {},
): RgbaImage {
  const transparentSkipFraction = opts.transparentSkipFraction ?? 0.02;
  const maxSize = opts.maxSize ?? 2048;
  const tolerance = opts.tolerance ?? 78;

  let w = source.width;
  let h = source.height;
  if (!w || !h) return cloneRgba(source);

  const scale = Math.min(1, maxSize / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));

  let data: Uint8ClampedArray;
  if (scale < 1) {
    data = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const sx = Math.min(w - 1, Math.round(x / scale));
        const sy = Math.min(h - 1, Math.round(y / scale));
        const si = (sy * w + sx) * 4;
        const di = (y * sw + x) * 4;
        data[di] = source.data[si];
        data[di + 1] = source.data[si + 1];
        data[di + 2] = source.data[si + 2];
        data[di + 3] = source.data[si + 3];
      }
    }
    w = sw;
    h = sh;
  } else {
    data = new Uint8ClampedArray(source.data);
  }

  const n = w * h;

  let transparent = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 200) transparent++;
  }
  if (transparent / n > transparentSkipFraction) {
    return cloneRgba(source);
  }

  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ].map(([x, y]) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
  });
  const avgCorner: [number, number, number] = [
    Math.round(corners.reduce((s, c) => s + c[0], 0) / corners.length),
    Math.round(corners.reduce((s, c) => s + c[1], 0) / corners.length),
    Math.round(corners.reduce((s, c) => s + c[2], 0) / corners.length),
  ];
  const cornerSpread = Math.max(
    ...corners.map((c) =>
      Math.max(
        Math.abs(c[0] - avgCorner[0]),
        Math.abs(c[1] - avgCorner[1]),
        Math.abs(c[2] - avgCorner[2]),
      ),
    ),
  );
  const solidBackdrop = cornerSpread < 24;

  // Connectivity-only flood: a pixel is backdrop when it matches the corner
  // color AND is reachable from the border without crossing the subject. The
  // subject's line-art / anti-aliased rim is a different color than the flat
  // backdrop, so the flood naturally stops at the silhouette — no gradient
  // "wall" needed. Same-colored clothing (e.g. a white dress) is protected by
  // its surrounding outline, which the flood can't pass through.
  const matchesCorner = (r: number, g: number, b: number): boolean => {
    if (!solidBackdrop) return false;
    return (
      Math.abs(r - avgCorner[0]) + Math.abs(g - avgCorner[1]) + Math.abs(b - avgCorner[2]) <
      tolerance
    );
  };
  const isBackground = (idx: number): boolean => {
    const i = idx * 4;
    if (data[i + 3] < 16) return true;
    return matchesCorner(data[i], data[i + 1], data[i + 2]);
  };

  const visited = new Uint8Array(n);
  const queue: number[] = [];
  const pushIf = (idx: number) => {
    if (idx < 0 || idx >= n) return;
    if (visited[idx]) return;
    visited[idx] = 1;
    if (isBackground(idx)) queue.push(idx);
  };
  for (let x = 0; x < w; x++) {
    pushIf(x);
    pushIf((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    pushIf(y * w);
    pushIf(y * w + (w - 1));
  }

  let removed = 0;
  while (queue.length) {
    const idx = queue.pop() as number;
    data[idx * 4 + 3] = 0;
    removed++;
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0) pushIf(idx - 1);
    if (x < w - 1) pushIf(idx + 1);
    if (y > 0) pushIf(idx - w);
    if (y < h - 1) pushIf(idx + w);
  }

  if (removed === 0) return cloneRgba(source);

  if (scale < 1) {
    const full = cloneRgba(source);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const si = (y * sw + x) * 4;
        if (data[si + 3] >= 16) continue;
        const sx = Math.min(source.width - 1, Math.round(x / scale));
        const sy = Math.min(source.height - 1, Math.round(y / scale));
        const di = (sy * source.width + sx) * 4;
        full.data[di + 3] = 0;
      }
    }
    return full;
  }

  return { data, width: w, height: h };
}

/**
 * Remove leftover background speckle islands after keying.
 *
 * A baked transparency checkerboard has two light neutral tones (e.g. white
 * ~252 and grey ~234). The flood removes the tones near the corner color, but
 * grey tiles just outside tolerance can survive — either floating free in the
 * transparent area, or fused to a sprite through its dark outline.
 *
 * Components are grown over ALL opaque pixels (any color). A component is
 * deleted only when it is BOTH small AND made entirely of neutral-light pixels
 * — i.e. a checker tile floating free in the removed backdrop, not connected
 * through any opaque pixel to a larger mass.
 *
 * This is deliberately conservative so it can NEVER eat part of the character:
 *  - the subject is one large component (a white dress, or a sprite + its body)
 *    far above the size cap;
 *  - any grey shading on the subject (e.g. a frilly sock's folds) is connected
 *    through the body's opaque pixels into that large component, and the
 *    component also contains non-neutral (warm/dark) pixels, so it fails the
 *    all-neutral test twice over.
 * The trade-off: a stray tile fused to a sprite's outline survives, but that is
 * far better than ever deleting real art.
 */
export function removeNeutralIslandsInPlace(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): void {
  const n = w * h;
  const maxIslandArea = Math.max(256, Math.round(n * 0.0015));

  const isOpaque = (idx: number): boolean => data[idx * 4 + 3] >= 16;
  const isNeutralLight = (idx: number): boolean => {
    const i = idx * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return Math.max(r, g, b) - Math.min(r, g, b) <= 24 && Math.max(r, g, b) >= 150;
  };

  const visited = new Uint8Array(n);
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    if (!isOpaque(start)) {
      visited[start] = 1;
      continue;
    }
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    const comp: number[] = [];
    let allNeutral = true;
    let tooBig = false;
    while (stack.length) {
      const idx = stack.pop() as number;
      comp.push(idx);
      if (!isNeutralLight(idx)) allNeutral = false;
      if (comp.length > maxIslandArea) tooBig = true;
      const x = idx % w;
      const y = (idx / w) | 0;
      const nbs = [
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
      ];
      for (let k = 0; k < 4; k++) {
        const nb = nbs[k];
        if (nb < 0 || visited[nb] || !isOpaque(nb)) continue;
        visited[nb] = 1;
        stack.push(nb);
      }
    }
    if (allNeutral && !tooBig) {
      for (const idx of comp) data[idx * 4 + 3] = 0;
    }
  }
}
