import type { RgbaImage } from './types';

const ALPHA_CUT = 16;

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export interface EdgeMatteOptions {
  /** Neighborhood half-window for sampling F/B (px). */
  radius?: number;
  /** Number of inward peeling passes. */
  passes?: number;
  /**
   * Minimum |F − B| (sum-abs) for a confident matte. Below this, foreground and
   * background are too similar (e.g. white sprite on white bg) — skip to avoid eating art.
   */
  minContrast?: number;
}

/**
 * Multi-pass closed-form alpha matting along the silhouette.
 *
 * Treats every edge pixel as a blend  C = α·F + (1−α)·B  and recovers α from
 * locally estimated foreground (F) and background (B), then decontaminates the
 * RGB so background spill (white/grey halo) is removed instead of left behind.
 *
 * Runs after the background is keyed to alpha 0 but BEFORE defringe, so the
 * transparent pixels still carry their original background RGB — that's our B.
 *
 * Alpha is only ever reduced, so the pass is monotonic and converges; each
 * iteration peels one ring of halo and exposes the next, stopping when it
 * reaches true sprite color (where ‖C−B‖ ≈ ‖F−B‖ → α ≈ 1).
 */
export function refineEdgeMatteInPlace(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  opts: EdgeMatteOptions = {},
): void {
  const R = opts.radius ?? 2;
  const passes = opts.passes ?? 4;
  const minContrast = opts.minContrast ?? 60;
  const n = w * h;

  for (let pass = 0; pass < passes; pass++) {
    // Buffer updates so neighbor reads within a pass stay consistent.
    const idxs: number[] = [];
    const newAlpha: number[] = [];
    const newR: number[] = [];
    const newG: number[] = [];
    const newB: number[] = [];

    for (let idx = 0; idx < n; idx++) {
      const i = idx * 4;
      const A = data[i + 3];
      if (A < ALPHA_CUT) continue;

      const x = idx % w;
      const y = (idx / w) | 0;

      let bR = 0;
      let bG = 0;
      let bB = 0;
      let bCount = 0;

      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = (ny * w + nx) * 4;
          if (data[ni + 3] < ALPHA_CUT) {
            bR += data[ni];
            bG += data[ni + 1];
            bB += data[ni + 2];
            bCount++;
          }
        }
      }

      // Not on the silhouette — leave interior untouched.
      if (bCount === 0) continue;

      const Bx = bR / bCount;
      const By = bG / bCount;
      const Bz = bB / bCount;

      // Estimate F from opaque neighbors, weighted toward those far from B
      // (true sprite color dominates over other halo pixels).
      let fR = 0;
      let fG = 0;
      let fB = 0;
      let fW = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = (ny * w + nx) * 4;
          if (data[ni + 3] >= ALPHA_CUT) {
            const d =
              Math.abs(data[ni] - Bx) +
              Math.abs(data[ni + 1] - By) +
              Math.abs(data[ni + 2] - Bz);
            const wgt = d * d;
            fR += data[ni] * wgt;
            fG += data[ni + 1] * wgt;
            fB += data[ni + 2] * wgt;
            fW += wgt;
          }
        }
      }

      const Cr = data[i];
      const Cg = data[i + 1];
      const Cb = data[i + 2];

      const Fx = fW > 0 ? fR / fW : Cr;
      const Fy = fW > 0 ? fG / fW : Cg;
      const Fz = fW > 0 ? fB / fW : Cb;

      const denom = Math.abs(Fx - Bx) + Math.abs(Fy - By) + Math.abs(Fz - Bz);
      if (denom < minContrast) continue; // F ≈ B → ambiguous, don't risk the art

      const dCB = Math.abs(Cr - Bx) + Math.abs(Cg - By) + Math.abs(Cb - Bz);
      let a = dCB / denom;
      if (a > 1) a = 1;
      if (a < 0) a = 0;

      const alphaByte = Math.round(a * 255);
      if (alphaByte >= A) continue; // only ever reduce coverage

      idxs.push(idx);
      newAlpha.push(alphaByte);

      if (alphaByte < ALPHA_CUT) {
        // Becomes a background sample next pass — store the background color
        // so subsequent rings matte against clean B, not leftover spill.
        newR.push(clampByte(Bx));
        newG.push(clampByte(By));
        newB.push(clampByte(Bz));
      } else {
        // Decontaminate: recover spill-free foreground color.
        newR.push(clampByte((Cr - (1 - a) * Bx) / a));
        newG.push(clampByte((Cg - (1 - a) * By) / a));
        newB.push(clampByte((Cb - (1 - a) * Bz) / a));
      }
    }

    if (idxs.length === 0) break;

    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k] * 4;
      data[i] = newR[k];
      data[i + 1] = newG[k];
      data[i + 2] = newB[k];
      data[i + 3] = newAlpha[k];
    }
  }
}

export function refineEdgeMatteRgba(source: RgbaImage, opts: EdgeMatteOptions = {}): RgbaImage {
  const out = {
    data: new Uint8ClampedArray(source.data),
    width: source.width,
    height: source.height,
  };
  refineEdgeMatteInPlace(out.data, out.width, out.height, opts);
  return out;
}
