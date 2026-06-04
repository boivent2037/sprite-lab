import { removeCheckerboardInPlace, defringeInPlace } from '../edgeCleanup';
import type { RgbaImage } from './types';
import { cloneRgba } from './chromaKey';

/** Remove baked-in checkerboard transparency previews (pure pixels). */
export function removeCheckerboardFromRgba(source: RgbaImage): RgbaImage {
  const img = cloneRgba(source);
  removeCheckerboardInPlace(img.data, img.width, img.height);
  return img;
}

export function defringeRgba(source: RgbaImage, radius = 2): RgbaImage {
  const img = cloneRgba(source);
  defringeInPlace(img.data, img.width, img.height, radius);
  return img;
}
