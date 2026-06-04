import type { RgbaImage } from './types';
import { cloneRgba } from './chromaKey';

export interface FloodFillOptions {
  transparentSkipFraction?: number;
  maxSize?: number;
}

/** Flood-fill backdrop removal from image borders — white/grey studio exports. */
export function floodFillRemoveBackground(
  source: RgbaImage,
  opts: FloodFillOptions = {},
): RgbaImage {
  const transparentSkipFraction = opts.transparentSkipFraction ?? 0.02;
  const maxSize = opts.maxSize ?? 2048;

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

  const isCheckerLike = (r: number, g: number, b: number): boolean => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max > 175 && max - min < 38;
  };
  const matchesCorner = (r: number, g: number, b: number): boolean => {
    if (!solidBackdrop) return false;
    return (
      Math.abs(r - avgCorner[0]) + Math.abs(g - avgCorner[1]) + Math.abs(b - avgCorner[2]) < 60
    );
  };
  const isBackground = (idx: number): boolean => {
    const i = idx * 4;
    if (data[i + 3] < 16) return true;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return isCheckerLike(r, g, b) || matchesCorner(r, g, b);
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
