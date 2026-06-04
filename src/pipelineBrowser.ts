import { runSpritesheetPipeline, removalNote } from './core/pipeline';
import { formatFrameDetection } from './core/frameExtract';
import { analyzeBackgroundFromRgba } from './core/analyzeBackground';
import type { CoreRemovalEngine, BackgroundAnalysis } from './core/types';
import { dataUrlToRgba, rgbaToDataUrl } from './rgbaAdapter';

export type { BackgroundAnalysis, CoreRemovalEngine };
export { removalNote, formatFrameDetection };

export type ProgressFn = (message: string, percent: number) => void;

export interface BrowserPipelineOptions {
  engine?: CoreRemovalEngine;
  onProgress?: ProgressFn;
}

export interface BrowserFrame {
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserPipelineResult {
  keyed: string;
  frames: BrowserFrame[];
  analysis: BackgroundAnalysis;
  applied: BackgroundAnalysis;
}

/**
 * Spritesheet pipeline for the Slice tab — 100% local pixel processing.
 * Auto routes by detected backdrop; Fast uses color rules only.
 */
export async function runSpritesheetPipelineBrowser(
  dataUrl: string,
  opts: Pick<BrowserPipelineOptions, 'engine'> = {},
): Promise<BrowserPipelineResult> {
  const engine: CoreRemovalEngine = opts.engine === 'fast' ? 'fast' : 'auto';

  const source = await dataUrlToRgba(dataUrl);
  const result = runSpritesheetPipeline(source, { engine, frames: true });

  return {
    keyed: rgbaToDataUrl(result.keyed),
    frames: result.frames.map((f) => ({
      dataUrl: rgbaToDataUrl(f.image),
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
    })),
    analysis: result.analysis,
    applied: result.analysis,
  };
}

/** Single-image background removal for the Remove tab — local pixel pipeline. */
export async function removeBackgroundSmartBrowser(
  dataUrl: string,
  opts: BrowserPipelineOptions = {},
): Promise<{ result: string; applied: BackgroundAnalysis }> {
  const engine: CoreRemovalEngine = opts.engine === 'fast' ? 'fast' : 'auto';
  const source = await dataUrlToRgba(dataUrl);
  const analysis = analyzeBackgroundFromRgba(source);

  if (analysis.kind === 'transparent') {
    return { result: dataUrl, applied: analysis };
  }

  const { keyed } = runSpritesheetPipeline(source, { engine, frames: false });
  return { result: rgbaToDataUrl(keyed), applied: analysis };
}
