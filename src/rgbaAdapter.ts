import type { RgbaImage } from './core/types';

export async function dataUrlToRgba(dataUrl: string): Promise<RgbaImage> {
  const img = await loadImageElement(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to read image');
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { data: new Uint8ClampedArray(data), width: w, height: h };
}

export function rgbaToDataUrl(img: RgbaImage): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to encode image');
  const imageData = new ImageData(img.data, img.width, img.height);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}
