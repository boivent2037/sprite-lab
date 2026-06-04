import { analyzeBackgroundFromRgba } from './core/analyzeBackground';
import { dataUrlToRgba } from './rgbaAdapter';
import { removeBackgroundSmartBrowser, type ProgressFn } from './pipelineBrowser';

export type BackgroundKind =
  | 'transparent'
  | 'magenta'
  | 'green'
  | 'checkerboard'
  | 'solid'
  | 'none';

export type RemovalEngine = 'auto' | 'fast';

export interface BackgroundAnalysis {
  kind: BackgroundKind;
  label: string;
}

export interface RemoveOptions {
  engine?: RemovalEngine;
  onProgress?: ProgressFn;
}

export async function analyzeBackground(dataUrl: string): Promise<BackgroundAnalysis> {
  const rgba = await dataUrlToRgba(dataUrl);
  return analyzeBackgroundFromRgba(rgba);
}

export async function removeBackgroundSmart(
  dataUrl: string,
  opts: RemoveOptions = {},
): Promise<{ result: string; applied: BackgroundAnalysis }> {
  return removeBackgroundSmartBrowser(dataUrl, opts);
}

export { removalNote } from './pipelineBrowser';
