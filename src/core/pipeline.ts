import { analyzeBackgroundFromRgba } from './analyzeBackground';
import { cloneRgba, chromaKeyInPlace, GREEN_KEY } from './chromaKey';
import { floodFillRemoveBackground, removeNeutralIslandsInPlace } from './floodFill';
import { removeCheckerboardFromRgba, defringeRgba } from './checkerboard';
import { refineEdgeMatteInPlace } from './edgeMatte';
import { extractFramesSmart } from './frameExtract';
import { isMostlyTransparent, opaqueFraction } from './opaque';

/**
 * Flood-fill the backdrop, then gently clean the silhouette halo.
 *
 * The flood already stops cleanly at the subject outline, so we only need to
 * decontaminate the thin anti-aliased rim. The matte runs with a HIGH contrast
 * floor (minContrast 200) and a tiny window so it ONLY touches pixels where the
 * foreground and backdrop are strongly different — e.g. dark hair against a
 * white studio backdrop. Light subjects (skin, white clothing) sit close to a
 * light backdrop, fall below the floor, and are left fully intact. This is what
 * prevents the previous "eaten edges" where skin and trim were peeled away.
 */
function floodFillMatte(img: RgbaImage): RgbaImage {
  const keyed = floodFillRemoveBackground(img);
  // Clear leftover checker-tile speckles (a 2nd backdrop tone the single-color
  // flood couldn't reach) before matting the silhouette.
  removeNeutralIslandsInPlace(keyed.data, keyed.width, keyed.height);
  refineEdgeMatteInPlace(keyed.data, keyed.width, keyed.height, {
    radius: 1,
    passes: 2,
    minContrast: 200,
  });
  return defringeRgba(keyed, 1);
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
