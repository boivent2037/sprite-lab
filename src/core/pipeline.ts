import { analyzeBackgroundFromRgba } from './analyzeBackground';
import { cloneRgba, chromaKeyInPlace, GREEN_KEY } from './chromaKey';
import { floodFillRemoveBackground } from './floodFill';
import { removeCheckerboardFromRgba, defringeRgba } from './checkerboard';
import { refineEdgeMatteInPlace } from './edgeMatte';
import { extractFramesSmart } from './frameExtract';
import { isMostlyTransparent, opaqueFraction } from './opaque';

/** Flood-fill the backdrop, then matte + decontaminate the silhouette halo. */
function floodFillMatte(img: RgbaImage): RgbaImage {
  const keyed = floodFillRemoveBackground(img);
  refineEdgeMatteInPlace(keyed.data, keyed.width, keyed.height, {
    radius: 2,
    passes: 5,
    minContrast: 55,
  });
  refineEdgeMatteInPlace(keyed.data, keyed.width, keyed.height, { radius: 1, passes: 1 });
  return defringeRgba(keyed, 2);
}
import type {
  BackgroundAnalysis,
  BackgroundKind,
  CoreRemovalEngine,
  PipelineOptions,
  PipelineResult,
  RgbaImage,
} from './types';

function removeByKind(img: RgbaImage, kind: BackgroundKind): RgbaImage {
  switch (kind) {
    case 'magenta': {
      const out = cloneRgba(img);
      chromaKeyInPlace(out);
      return defringeRgba(out, 2);
    }
    case 'green': {
      const out = cloneRgba(img);
      chromaKeyInPlace(out, GREEN_KEY);
      return defringeRgba(out, 2);
    }
    case 'checkerboard':
      return removeCheckerboardFromRgba(img);
    case 'solid':
      return floodFillMatte(img);
    default:
      return cloneRgba(img);
  }
}

function removeAuto(img: RgbaImage, analysis: BackgroundAnalysis): RgbaImage {
  switch (analysis.kind) {
    case 'magenta':
    case 'green':
    case 'solid':
      return removeByKind(img, analysis.kind);

    case 'checkerboard':
      return removeCheckerboardFromRgba(img);

    default:
      return floodFillMatte(img);
  }
}

/**
 * Core spritesheet pipeline — no AI, runs identically in CLI and browser.
 * Auto: route by detected backdrop · Fast: color rules only
 */
export function runSpritesheetPipeline(
  source: RgbaImage,
  opts: PipelineOptions = {},
): PipelineResult {
  const engine = opts.engine ?? 'auto';
  const analysis = analyzeBackgroundFromRgba(source);

  if (analysis.kind === 'transparent') {
    const frames = opts.frames === false ? [] : extractFramesSmart(source, source);
    return {
      analysis,
      keyed: cloneRgba(source),
      frames,
      opaqueFraction: opaqueFraction(source),
    };
  }

  let keyed: RgbaImage;

  if (engine === 'fast') {
    if (analysis.kind === 'none') {
      keyed = floodFillMatte(source);
    } else {
      keyed = removeByKind(source, analysis.kind);
    }
  } else {
    keyed = removeAuto(source, analysis);
  }

  if (isMostlyTransparent(keyed)) {
    throw new Error(
      `Background removal produced an empty image (detected: ${analysis.label}). ` +
        'Try a different backdrop or slice individual frames first.',
    );
  }

  const frames = opts.frames === false ? [] : extractFramesSmart(keyed, source);

  if (opts.frames !== false && frames.length === 0) {
    throw new Error('No frames found — try a sheet with clear gaps between sprites');
  }

  return {
    analysis,
    keyed,
    frames,
    opaqueFraction: opaqueFraction(keyed),
  };
}

export function removalNote(analysis: BackgroundAnalysis): string {
  if (analysis.kind === 'transparent' || analysis.kind === 'none') return '';
  return `${analysis.label} removed`;
}
