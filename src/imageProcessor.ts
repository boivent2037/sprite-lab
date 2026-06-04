/** Client-side image processing — extracted from Echo Jump image-extender-web. */

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return loadImage(dataUrl).then((img) => ({ width: img.width, height: img.height }));
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export interface ChromaKeyOptions {
  keyR?: number;
  keyG?: number;
  keyB?: number;
  castThreshold?: number;
  castSoftness?: number;
  despill?: number;
  despillGreenBoost?: number;
}

export function chromaKeyToAlpha(imageDataUrl: string, opts: ChromaKeyOptions = {}): Promise<string> {
  const {
    keyR = 255,
    keyG = 0,
    keyB = 255,
    castThreshold = 80,
    castSoftness = 30,
    despill = 1,
    despillGreenBoost = 0.5,
  } = opts;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imageData.data;
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

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

export interface UploadBackgroundOptions {
  transparentSkipFraction?: number;
  maxSize?: number;
}

export async function removeUploadedBackground(
  dataUrl: string,
  opts: UploadBackgroundOptions = {},
): Promise<string> {
  const transparentSkipFraction = opts.transparentSkipFraction ?? 0.02;
  const maxSize = opts.maxSize ?? 2048;

  const img = await loadImage(dataUrl);
  let w = img.width;
  let h = img.height;
  if (!w || !h) return dataUrl;

  const scale = Math.min(1, maxSize / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const { data } = imageData;
  const n = w * h;

  let transparent = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 200) transparent++;
  }
  if (transparent / n > transparentSkipFraction) return dataUrl;

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

  if (removed === 0) return dataUrl;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export interface SliceImageGridOptions {
  cols: number;
  rows: number;
  cellSize: number;
}

export async function sliceImageGrid(
  imageDataUrl: string,
  options: SliceImageGridOptions,
): Promise<string[]> {
  const { cols, rows, cellSize } = options;
  const sheetW = cols * cellSize;
  const sheetH = rows * cellSize;

  const img = await loadImage(imageDataUrl);
  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = sheetW;
  sheetCanvas.height = sheetH;
  const sheetCtx = sheetCanvas.getContext('2d');
  if (!sheetCtx) throw new Error('Failed to get sheet canvas context');
  sheetCtx.imageSmoothingEnabled = true;
  sheetCtx.imageSmoothingQuality = 'high';
  sheetCtx.drawImage(img, 0, 0, sheetW, sheetH);

  const cells: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellCanvas = document.createElement('canvas');
      cellCanvas.width = cellSize;
      cellCanvas.height = cellSize;
      const cellCtx = cellCanvas.getContext('2d');
      if (!cellCtx) throw new Error('Failed to get cell canvas context');
      cellCtx.drawImage(
        sheetCanvas,
        c * cellSize,
        r * cellSize,
        cellSize,
        cellSize,
        0,
        0,
        cellSize,
        cellSize,
      );
      cells.push(cellCanvas.toDataURL('image/png'));
    }
  }
  return cells;
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.click();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function dataUrlByteSize(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.round((base64.length * 3) / 4);
}
