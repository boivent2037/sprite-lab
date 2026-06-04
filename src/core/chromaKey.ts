import type { RgbaImage } from './types';

export interface ChromaKeyOptions {
  keyR?: number;
  keyG?: number;
  keyB?: number;
  castThreshold?: number;
  castSoftness?: number;
  despill?: number;
  despillGreenBoost?: number;
}

export function cloneRgba(img: RgbaImage): RgbaImage {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

export function chromaKeyInPlace(img: RgbaImage, opts: ChromaKeyOptions = {}): RgbaImage {
  const {
    keyR = 255,
    keyG = 0,
    keyB = 255,
    castThreshold = 80,
    castSoftness = 30,
    despill = 1,
    despillGreenBoost = 0.5,
  } = opts;

  const data = img.data;
  const isMagentaKey = keyR === 255 && keyG === 0 && keyB === 255;
  const isGreenKey = keyG >= 150 && keyR <= 80 && keyB <= 80;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (isMagentaKey || isGreenKey) {
      const cast = isMagentaKey
        ? Math.max(0, Math.min(r, b) - g)
        : Math.max(0, g - Math.max(r, b));
      let alpha: number;
      if (cast >= castThreshold) {
        alpha = 0;
      } else if (cast <= 0) {
        alpha = 255;
      } else {
        const softFloor = Math.max(0, castThreshold - castSoftness);
        if (cast <= softFloor) {
          alpha = 255;
        } else {
          const t = (cast - softFloor) / (castThreshold - softFloor);
          alpha = Math.round(255 * (1 - t));
        }
      }
      data[i + 3] = alpha;

      if (cast > 0 && despill > 0) {
        const reduction = cast * despill;
        if (isMagentaKey) {
          r = Math.max(0, Math.round(r - reduction));
          b = Math.max(0, Math.round(b - reduction));
          if (despillGreenBoost > 0) {
            g = Math.min(255, Math.round(g + reduction * despillGreenBoost));
          }
        } else {
          g = Math.max(0, Math.round(g - reduction));
          r = Math.min(255, Math.round(r + reduction * 0.35));
          b = Math.min(255, Math.round(b + reduction * 0.35));
        }
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    } else {
      const dr = r - keyR;
      const dg = g - keyG;
      const db = b - keyB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      const fallbackThreshold = 90;
      const fallbackSoftness = 60;
      let alpha: number;
      if (dist <= fallbackThreshold) {
        alpha = 0;
      } else if (dist >= fallbackThreshold + fallbackSoftness) {
        alpha = 255;
      } else {
        alpha = Math.round(((dist - fallbackThreshold) / fallbackSoftness) * 255);
      }
      data[i + 3] = alpha;
    }
  }

  return img;
}

export const GREEN_KEY = { keyR: 0, keyG: 177, keyB: 64 };
