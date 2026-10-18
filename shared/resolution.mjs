// Calculation core migrated with explicit user permission from:
// the original NovelAI project/client/src/lib/image.ts and lib/resolution.ts.
// The preset table adapter only maps this application's orientation array order.
import { RESOLUTIONS } from "./novelai.mjs";
export const MAX_BASE_PIXELS = 3145728;
export function quantizeSide(v) {
  return Math.max(
    64,
    Math.round(Math.abs(Number.isFinite(v) ? v : 64) / 64) * 64,
  );
}
export function constrainResolution(w, h, changed) {
  let width = Math.min(MAX_BASE_PIXELS / 64, quantizeSide(w));
  let height = Math.min(MAX_BASE_PIXELS / 64, quantizeSide(h));
  if (width * height > MAX_BASE_PIXELS) {
    if (changed === "width")
      height = Math.max(64, Math.floor(MAX_BASE_PIXELS / width / 64) * 64);
    else width = Math.max(64, Math.floor(MAX_BASE_PIXELS / height / 64) * 64);
  }
  return { width, height };
}
const orientationIndex = { portrait: 0, square: 1, landscape: 2 };
export function resolutionPreset(width, height) {
  return (
    Object.keys(RESOLUTIONS).find((key) =>
      RESOLUTIONS[key].some(
        ([w, h], i) =>
          !(key === "wallpaper" && i === 1) && w === width && h === height,
      ),
    ) ?? "custom"
  );
}
export function resolutionOrientation(width, height) {
  return width === height
    ? "square"
    : width > height
      ? "landscape"
      : "portrait";
}
export function orientResolution(width, height, orientation, custom, last) {
  const preset = resolutionPreset(width, height);
  if (!custom && preset !== "custom") {
    if (preset === "wallpaper" && orientation === "square")
      return { width, height };
    const [w, h] = RESOLUTIONS[preset][orientationIndex[orientation]];
    return { width: w, height: h };
  }
  if (!Number.isFinite(width * height) || width <= 0 || height <= 0)
    return { width, height };
  if (orientation === "square") {
    const side = Math.min(
      Math.floor(Math.sqrt(MAX_BASE_PIXELS) / 64) * 64,
      Math.max(64, Math.round(Math.sqrt(width * height) / 64) * 64),
    );
    return { width: side, height: side };
  }
  const sides =
    width === height
      ? (last ?? { long: 1216, short: 832 })
      : { long: Math.max(width, height), short: Math.min(width, height) };
  return orientation === "landscape"
    ? { width: sides.long, height: sides.short }
    : { width: sides.short, height: sides.long };
}
export function normalizeBaseDims(w, h, current) {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return { width: 512, height: 512 };
  const landscape = w > h,
    short = Math.min(w, h),
    long = Math.max(w, h),
    ratio = short / long;
  if (
    current &&
    current.width / current.height === w / h &&
    short <= current.width &&
    long <= current.height
  )
    return { ...current };
  if (short % 64 === 0 && long % 64 === 0 && short * long <= MAX_BASE_PIXELS)
    return { width: w, height: h };
  const candidateShort = quantizeSide(1216 * ratio),
    candidateLong = quantizeSide(896 / ratio);
  let width, height;
  if (
    Math.abs(candidateShort / 1216 - ratio) <
      Math.abs(896 / candidateLong - ratio) &&
    candidateShort * 1216 <= MAX_BASE_PIXELS
  ) {
    width = candidateShort;
    height = 1216;
  } else if (896 * candidateLong <= MAX_BASE_PIXELS) {
    width = 896;
    height = candidateLong;
  } else {
    width = 512;
    height = 512;
  }
  return landscape ? { width: height, height: width } : { width, height };
}
