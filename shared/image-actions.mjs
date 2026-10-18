// Core ported with explicit permission from the original NovelAI project/client/src/lib/image-actions.ts.
// Adapters: b64 -> data, nImages -> total, unlocked seed -> null, and local preset IDs.
import { modelById } from "./novelai.mjs";
export const ENHANCE_LEVELS = [
  { strength: 0.2, noise: 0 },
  { strength: 0.4, noise: 0 },
  { strength: 0.5, noise: 0 },
  { strength: 0.6, noise: 0 },
  { strength: 0.7, noise: 0.1 },
];
/** @returns {Array<number | "max">} */
export function enhanceScales(width, height, model) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    return [];
  const numeric =
    (width === 832 && height === 1216) || (width === 1216 && height === 832)
      ? [1.5, 1]
      : [2, 1.5, 1].filter(
          (scale) =>
            width * height * scale * scale <= 3145728 &&
            (width * scale) % 64 === 0 &&
            (height * scale) % 64 === 0,
        );
  return model?.startsWith("nai-diffusion-5-") &&
    width * height < 2516582.4 &&
    width % 64 === 0 &&
    height % 64 === 0
    ? ["max", ...numeric]
    : numeric;
}
export function enhancementParams(p, base, scale, strength, noise) {
  if (!enhanceScales(base.width, base.height, p.model).includes(scale))
    throw Error("当前图片不支持此增强倍率");
  const multiplier = scale === "max" ? 1 : scale;
  return {
    ...p,
    baseImage: base,
    mask: null,
    focus: null,
    width:
      scale === "max"
        ? base.width
        : Math.max(
            64,
            Math.round(Math.floor(base.width * multiplier) / 64) * 64,
          ),
    height:
      scale === "max"
        ? base.height
        : Math.max(
            64,
            Math.round(Math.floor(base.height * multiplier) / 64) * 64,
          ),
    strength,
    noise,
    total: 1,
    batchSize: 1,
    seed: null,
    enhance: true,
    enhanceMax: scale === "max",
    imageAction: "enhance",
  };
}
export function variationParams(current, meta, base) {
  const request = meta.request;
  if (!request?.parameters) throw Error("无法读取所选图片的完整生成参数");
  const p = request.parameters,
    positive = p.v4_prompt?.caption?.char_captions ?? [],
    negative = p.v4_negative_prompt?.caption?.char_captions ?? [];
  let id = (request.model ?? meta.model).replace(/-inpainting$/, "");
  const effort = id.endsWith("-medium") ? "medium" : "high";
  id = id.replace(/-medium$/, "");
  if (id === "nai-diffusion-4-curated") id = "nai-diffusion-4-curated-preview";
  modelById(id);
  return {
    ...current,
    model: id,
    effort,
    prompt: request.input ?? meta.prompt,
    negative: p.uc ?? meta.negative ?? "",
    quality: false,
    ucPreset: "none",
    dataset: "",
    autoText: false,
    preparedPrompt: true,
    preserveDimensions: true,
    baseImage: base,
    mask: null,
    focus: null,
    enhance: false,
    enhanceMax: false,
    width: Math.max(64, Math.round((p.width ?? meta.width) / 64) * 64),
    height: Math.max(64, Math.round((p.height ?? meta.height) / 64) * 64),
    steps: p.steps ?? meta.steps,
    scale: p.scale ?? current.scale,
    sampler: p.sampler ?? meta.sampler,
    noiseSchedule: p.noise_schedule ?? current.noiseSchedule,
    cfgRescale: p.cfg_rescale ?? 0,
    transparent: !!p.tag_hint_transparent_background,
    decrisper: !!p.dynamic_thresholding,
    varietyPlus: p.skip_cfg_above_sigma != null,
    smea: !!p.sm,
    smeaDyn: !!p.sm_dyn,
    positionMode: p.v4_prompt?.use_coords ? "custom" : "ai",
    characters: positive.map((ch, index) => ({
      id: `variation-${index}`,
      name: `角色 ${index + 1}`,
      prompt: ch.char_caption,
      uc: negative[index]?.char_caption ?? "",
      x: ch.centers?.[0]?.x ?? 0.5,
      y: ch.centers?.[0]?.y ?? 0.5,
      enabled: true,
    })),
    strength: 0.8,
    noise: 0.1,
    inpaintStrength: 1,
    total: 3,
    batchSize: 3,
    seed: null,
    imageAction: "variation",
  };
}
