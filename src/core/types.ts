export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ExtractedFrame {
  image: RgbaImage;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BackgroundKind =
  | 'transparent'
  | 'magenta'
  | 'green'
  | 'checkerboard'
  | 'solid'
  | 'none';

export interface BackgroundAnalysis {
  kind: BackgroundKind;
  label: string;
}

/** Non-AI engines — safe for full spritesheets in CLI and browser. */
export type CoreRemovalEngine = 'auto' | 'fast';

export interface PipelineOptions {
  engine?: CoreRemovalEngine;
  /** Skip frame extraction (background remove only). */
  frames?: boolean;
}

export interface PipelineResult {
  analysis: BackgroundAnalysis;
  keyed: RgbaImage;
  frames: ExtractedFrame[];
  opaqueFraction: number;
}
