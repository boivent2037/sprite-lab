import type { RgbaImage } from './types';

/** Fraction of pixels with alpha >= threshold (0–1). */
export function opaqueFraction(img: RgbaImage, alphaThreshold = 32): number {
  const n = img.width * img.height;
  if (n === 0) return 0;
  let opaque = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] >= alphaThreshold) opaque++;
  }
  return opaque / n;
}

export function isMostlyTransparent(img: RgbaImage, minOpaqueFrac = 0.04): boolean {
  return opaqueFraction(img) < minOpaqueFrac;
}
