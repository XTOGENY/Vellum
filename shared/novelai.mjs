// Reimplemented from reviewed request-building ideas in the original NovelAI project.
// Wire fields verified against docs/official/image-api.json. No old UI/state copied.
import { expandedPrompts, splitCharacterPrompts } from "./prompt-tools.mjs";
import { composeTemplates } from "./prompt-composition.mjs";
const samplers = [
  "k_euler_ancestral",
  "k_euler",
  "k_dpmpp_2s_ancestral",
  "k_dpmpp_2m_sde",
  "k_dpmpp_2m",
  "k_dpmpp_sde",
];
const v3Samplers = [
  "k_euler_ancestral",
  "k_euler",
  "k_dpmpp_2s_ancestral",
  "k_dpmpp_2m",
  "k_dpmpp_2m_sde",
  "ddim_v3",
];
export const MODELS = [
  ["nai-diffusion-4-5-full", "V4.5 Full", "v45", 6, 512],
  ["nai-diffusion-4-5-curated", "V4.5 Curated", "v45", 6, 512],
  ["nai-diffusion-5-full", "V5 Full", "v5", 32, 1471],
  ["nai-diffusion-5-curated", "V5 Curated", "v5", 32, 703],
  ["nai-diffusion-4-full", "V4 Full", "v4", 6, 512],
  ["nai-diffusion-4-curated-preview", "V4 Curated", "v4", 6, 512],
  ["nai-diffusion-3", "Anime V3", "v3", 0, 225],
  ["nai-diffusion-furry-3", "Furry V3", "v3", 0, 225],
].map(([id, label, family, maxCharacters, context]) => ({
  id: String(id),
  label: String(label),
  family: String(family),
  maxCharacters: Number(maxCharacters),
  context: Number(context),
  samplers: family === "v3" ? v3Samplers : samplers,
  vibe: family !== "v5",
  precise: family === "v45",
  variety: family === "v45" || family === "v4",
  transparency: family === "v5",
  noiseSchedules:
    family === "v5"
      ? ["karras"]
      : family === "v3"
        ? ["native", "karras", "exponential", "polyexponential"]
        : ["karras", "exponential", "polyexponential"],
  inpaint:
    id === "nai-diffusion-4-curated-preview"
      ? "nai-diffusion-4-curated-inpainting"
      : id === "nai-diffusion-5-curated"
        ? "nai-diffusion-4-5-curated-inpainting"
        : id + "-inpainting",
}));
// Presentation order is independent of MODELS[0], which remains the existing default.
export const MODELS_BY_NEWEST = [...MODELS].sort((a, b) => {
  const generation = { v5: 5, v45: 4.5, v4: 4, v3: 3 };
  return (generation[b.family] || 0) - (generation[a.family] || 0);
});
export const SAMPLER_NAMES = {
  k_euler_ancestral: "Euler Ancestral",
  k_euler: "Euler",
  k_dpmpp_2s_ancestral: "DPM++ 2S Ancestral",
  k_dpmpp_2m_sde: "DPM++ 2M SDE",
  k_dpmpp_2m: "DPM++ 2M",
  k_dpmpp_sde: "DPM++ SDE",
  ddim_v3: "DDIM",
};
export const RESOLUTIONS = {
  small: [
    [512, 768],
    [640, 640],
    [768, 512],
  ],
  normal: [
    [832, 1216],
    [1024, 1024],
    [1216, 832],
  ],
  large: [
    [1024, 1536],
    [1472, 1472],
    [1536, 1024],
  ],
  wallpaper: [
    [1088, 1920],
    [1088, 1088],
    [1920, 1088],
  ],
};
export const DIRECTOR_TOOLS = [
  ["bg-removal", "去背景"],
  ["lineart", "线稿"],
  ["sketch", "草图"],
  ["colorize", "上色"],
  ["emotion", "表情"],
  ["declutter", "去杂物"],
];
export const EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "scared",
  "surprised",
  "tired",
  "excited",
  "nervous",
  "thinking",
  "confused",
  "shy",
  "disgusted",
  "smug",
  "bored",
  "laughing",
  "irritated",
  "aroused",
  "embarrassed",
  "worried",
  "love",
  "determined",
  "hurt",
  "playful",
];
export function modelById(id) {
  const m = MODELS.find((m) => m.id === id);
  if (!m) throw new Error("未知的 NovelAI 模型");
  return m;
}
const heavy =
  "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";
const light =
  "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::";
export function ucPresets(model) {
  const m = MODELS.find((item) => item.id === model);
  // 非 NovelAI 模型没有 UC 预设；返回空集，界面最多只显示「无」。
  if (!m) return { none: "" };
  return m.family === "v3"
    ? {
        none: "",
        heavy:
          "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
        light:
          "lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing",
      }
    : {
        none: "",
        heavy,
        light,
        human: heavy + ", @_@, mismatched pupils, glowing eyes, bad anatomy",
        furry:
          "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic",
      };
}
export function defaults(model = MODELS[0].id) {
  // 未知模型只用于非 NovelAI 协议：拿第一套默认值占位，model 仍保留传入值。
  const m = MODELS.find((item) => item.id === model) || MODELS[0];
  return {
    model,
    prompt: "",
    negative: "",
    quality: true,
    qualityPreset: "standard",
    ucPreset: "heavy",
    dataset: "",
    autoText: false,
    positionMode: "ai",
    characters: [],
    references: [],
    normalizeVibes: true,
    baseImage: null,
    mask: null,
    focus: null,
    width: 832,
    height: 1216,
    steps: m.family === "v3" ? 28 : 23,
    scale: m.family === "v5" ? 7 : 5,
    seed: null,
    sampler: "k_euler_ancestral",
    noiseSchedule: m.noiseSchedules[0],
    cfgRescale: 0,
    varietyPlus: false,
    decrisper: false,
    smea: false,
    smeaDyn: false,
    transparent: false,
    strength: 0.7,
    noise: 0,
    inpaintStrength: 1,
    batchSize: 1,
    total: 1,
    enhanceMax: false,
    enhance: false,
    effort: "high",
    promptChunks: [],
    artists: [],
    artistEnabled: true,
    artistFormat: "nai",
    artistPosition: "end",
  };
}
// ---- 多角色定位 ----
// 依据：
// 1) 官方文档 docs.novelai.net/en/image/multiplecharacters 写明 V4 / V4.5 的自定义
//    角色定位限制在 5×5 网格；docs.novelai.net/en/image/models 写明 V5 是重做过的
//    定位方式（freeform）。
// 2) 客户端实测证据（novelai.net/image 的 _next chunk，2026-10-18 抓取）：
//      let rK=[.1,.3,.5,.7,.9];
//      function rJ(W){ return rK[Math.min(4, Math.max(0, Math.floor(5*W)))] }
//      function rq(W){ return { x: rJ(W.x), y: rJ(W.y) } }   // 导出名 snapCenterToGrid
//      applyV4Prompts 里：freeformCharacterPosition ? {x,y} : snapCenterToGrid(center)
//    也就是说 25 个落点是 0.1/0.3/0.5/0.7/0.9，吸附方式是 floor(5x) 夹到 0..4，
//    不是四舍五入到最近格心。V5 走 freeform，原样发连续坐标。
export const CHARACTER_GRID_CELLS = [0.1, 0.3, 0.5, 0.7, 0.9];
export function characterGrid(model) {
  // 这里只决定"要不要 5×5 网格"：未知模型（GPT / Gemini / 中转别名）按连续坐标处理，
  // 不能让布局辅助函数抛「未知的 NovelAI 模型」，否则刷新时整个工作台会停在启动页。
  const m =
    typeof model === "string"
      ? MODELS.find((item) => item.id === model)
      : model;
  return m && (m.family === "v4" || m.family === "v45") ? 5 : 0;
}
// 与官网 snapCenterToGrid 一致：先 floor(5x) 夹到 0..4，再取格心。
export function nearestCell(value) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  return CHARACTER_GRID_CELLS[Math.min(4, Math.max(0, Math.floor(5 * v)))];
}
// 同一份规则给界面、草稿和请求用，避免三处各算一套。
// 网格模型的方向键：沿一个轴走一格，越界停在边上（供界面和测试共用）。
export function stepCharacterCell(value, direction) {
  if (!direction) return value;
  const index = (v) =>
    CHARACTER_GRID_CELLS.reduce(
      (best, cell, i) =>
        Math.abs(cell - v) < Math.abs(CHARACTER_GRID_CELLS[best] - v) ? i : best,
      0,
    );
  const next = Math.max(
    0,
    Math.min(CHARACTER_GRID_CELLS.length - 1, index(value) + direction),
  );
  return CHARACTER_GRID_CELLS[next];
}
export function snapCharacterPosition(model, x, y) {
  const value = (v) =>
    +Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5)).toFixed(3);
  if (characterGrid(model) === 5)
    return { x: nearestCell(x), y: nearestCell(y) };
  return { x: value(x), y: value(y) };
}
// 草稿里的旧坐标可能是连续值：模型是 5×5 网格时就吸附到格心，
// 保证「界面显示 / 保存 / 实际发送」三处一致。
export function normalizeCharacterPositions(params) {
  if (!Array.isArray(params?.characters) || !characterGrid(params.model))
    return params;
  return {
    ...params,
    characters: params.characters.map((c) => {
      const next = snapCharacterPosition(params.model, c.x, c.y);
      return c.x === next.x && c.y === next.y ? c : { ...c, ...next };
    }),
  };
}
export function promptText(p) {
  p = expandedPrompts(p);
  const m = modelById(p.model);
  let { prompt, templateNegative } = composeTemplates(p);
  if (
    !p.preparedPrompt &&
    p.autoText &&
    m.family === "v5" &&
    !/(^|\n)\s*Text:/i.test(prompt)
  ) {
    const quoted = [...prompt.matchAll(/"([^"\n]+)"|「([^」\n]+)」/g)].map(
      (x) => x[1] || x[2],
    );
    if (quoted.length) prompt += "\nText: " + quoted.join(", ");
  }
  let quality =
    m.family === "v3"
      ? p.model.includes("furry")
        ? "{best quality}, {amazing quality}"
        : "best quality, amazing quality, very aesthetic, absurdres"
      : p.qualityPreset === "light" && m.family === "v5"
        ? "very aesthetic, amazing quality, no text"
        : "very aesthetic, masterpiece, no text";
  if (p.model === "nai-diffusion-4-5-curated")
    quality += ", -0.8::feet::, rating:general";
  let input = p.preparedPrompt
    ? p.prompt
    : [
        p.dataset && p.dataset !== "anime" ? p.dataset + " dataset" : "",
        prompt,
        p.quality ? quality : "",
      ]
        .filter(Boolean)
        .join(", ");
  if (
    p.enhance &&
    !p.mask &&
    !p.enhanceMax &&
    m.family !== "v3" &&
    !input.includes("upscaled, blurry")
  ) {
    const at =
      input.match(/(?:^|\s|[,.:[\]{}、。])text:(?!:)/i)?.index ?? input.length;
    input = input.slice(0, at) + ", -2::upscaled, blurry::," + input.slice(at);
  }
  return {
    input,
    negative: p.preparedPrompt
      ? p.negative
      : [
          ucPresets(p.model)[p.ucPreset] || "",
          String(p.negative || "").trim(),
          templateNegative,
        ]
          .filter(Boolean)
          .join(", "),
  };
}
function number(value, min, max, label, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(`${label}必须为 ${min}–${max}${integer ? " 的整数" : ""}`);
  return value;
}
export function validateParams(p) {
  const m = modelById(p.model);
  if (
    typeof p.prompt !== "string" ||
    p.prompt.length > 50000 ||
    typeof p.negative !== "string" ||
    p.negative.length > 50000
  )
    throw new Error("提示词格式错误或超过 50000 字符");
  for (const k of ["width", "height"]) {
    number(p[k], 64, 3145728 / 64, k === "width" ? "宽度" : "高度", true);
    if (p[k] % 64) throw new Error("图像宽高必须是 64 的倍数");
  }
  if (p.width * p.height > 3145728) throw new Error("输出不能超过 3 MP");
  number(p.steps, 1, 50, "步骤", true);
  number(p.scale, 0, 100, "提示词引导");
  number(p.cfgRescale, 0, 1, "引导重缩放");
  if (!m.samplers.includes(p.sampler))
    throw new Error("当前模型不支持此采样器");
  if (!m.noiseSchedules.includes(p.noiseSchedule))
    throw new Error("当前模型不支持此噪声调度");
  if (p.seed !== null) number(p.seed, 0, 4294967295, "种子", true);
  number(
    p.batchSize,
    1,
    p.width * p.height <= 640 * 640 ? 6 : 4,
    "每次请求张数",
    true,
  );
  number(p.total, 1, 24, "任务张数", true);
  if (!Array.isArray(p.characters) || p.characters.length > 64)
    throw new Error("角色格式错误");
  const chars = p.characters.filter((c) => c.enabled && c.prompt?.trim());
  if (chars.length > m.maxCharacters)
    throw new Error(`此模型最多支持 ${m.maxCharacters} 个角色，请停用多余角色`);
  for (const c of chars) {
    if (
      typeof c.prompt !== "string" ||
      c.prompt.length > 50000 ||
      typeof c.uc !== "string" ||
      c.uc.length > 50000
    )
      throw new Error("角色提示词格式错误");
    number(c.x, 0, 1, "角色 X");
    number(c.y, 0, 1, "角色 Y");
  }
  if (!Array.isArray(p.references) || p.references.length > 16)
    throw new Error("最多添加 16 张参考图");
  for (const r of p.references.filter((r) => r.enabled)) {
    if (!["vibe", "precise"].includes(r.type)) throw new Error("参考类型错误");
    number(r.strength, 0, 1, "参考强度");
    number(r.info, 0, 1, "信息提取");
    if (r.type === "precise") {
      number(r.fidelity, 0, 1, "精确度");
      if (!["character", "style", "character&style"].includes(r.caption))
        throw new Error("精确参考描述错误");
    }
  }
  if (p.baseImage) {
    number(p.strength, 0.01, 0.99, "图生图强度");
    number(p.noise, 0, 0.99, "图生图噪声");
    if (p.mask && m.family !== "v3")
      number(p.inpaintStrength, 0.01, 1, "重绘强度");
  } else if (p.mask) throw new Error("局部重绘需要底图");
  if (p.transparent && !m.transparency)
    throw new Error("当前模型不支持透明输出");
  return p;
}
export function buildPayload(p, { seed = p.seed, samples = p.batchSize } = {}) {
  p = expandedPrompts(p);
  if (!p.preparedPrompt && !p.characters.some((c) => c.enabled)) {
    const parts = splitCharacterPrompts(p.prompt);
    if (parts.length > 1 && modelById(p.model).family !== "v3") {
      const uc = splitCharacterPrompts(p.negative);
      p = {
        ...p,
        prompt: parts[0],
        negative: uc[0],
        characters: parts.slice(1).map((prompt, i) => ({
          id: `pipe-${i}`,
          prompt,
          uc: uc[i + 1] || "",
          enabled: true,
          x: 0.5,
          y: 0.5,
        })),
      };
    }
  }
  validateParams(p);
  const m = modelById(p.model),
    { input, negative } = promptText(p);
  number(seed, 0, 4294967295, "请求种子", true);
  const action = p.baseImage ? (p.mask ? "infill" : "img2img") : "generate";
  const wireFamily =
    action === "infill" && p.model === "nai-diffusion-5-curated"
      ? "v45"
      : m.family;
  const medium = p.effort === "medium" && p.model === "nai-diffusion-5-full";
  const chars = p.characters.filter((c) => c.enabled && c.prompt.trim());
  const precise = p.references.filter((r) => r.enabled && r.type === "precise");
  const vibes = p.references.filter((r) => r.enabled && r.type === "vibe");
  if (precise.length && !m.precise)
    throw new Error("此模型不支持精确参考，请停用或切换模型");
  if (vibes.length && !m.vibe)
    throw new Error("此模型不支持 Vibe，请停用或切换模型");
  // 官方 API 实测（2026-10-18）：image + mask + reference_image_multiple 返回 200，
  // 所以局部重绘时 Vibe 照发；但 director_reference_* 与 reference_* 不能混用：
  //   400 cannot mix reference and director_reference at the same time
  const useVibes = vibes.length > 0 && precise.length === 0;
  if (useVibes && m.family !== "v3")
    for (const r of vibes) {
      if (
        !r.encoding ||
        r.encodedModel !== p.model ||
        r.encodedInfo !== r.info ||
        r.encodedMask !== (r.mask || "")
      )
        throw new Error("Vibe 尚未编码或编码已过期，请重新编码");
    }
  const parameters = {
    params_version: wireFamily === "v5" ? 4 : wireFamily === "v3" ? 1 : 3,
    width: p.width,
    height: p.height,
    steps: p.steps,
    scale: p.scale,
    sampler:
      action === "infill" && p.sampler === "ddim_v3"
        ? "k_euler_ancestral"
        : p.sampler,
    seed,
    n_samples: samples,
    noise_schedule: m.noiseSchedules.includes(p.noiseSchedule)
      ? p.noiseSchedule
      : m.noiseSchedules[0],
    uc: negative,
    cfg_rescale: p.cfgRescale,
    dynamic_thresholding: !!p.decrisper,
    ...(m.family === "v3"
      ? {
          sm: !p.baseImage && !!p.smea,
          sm_dyn: !p.baseImage && !!p.smea && !!p.smeaDyn,
        }
      : { sm: false, sm_dyn: false }),
    ...(m.variety || m.family === "v3"
      ? {
          skip_cfg_above_sigma: p.varietyPlus
            ? m.family === "v45"
              ? 58
              : 19
            : null,
        }
      : {}),
    ...(p.sampler === "k_euler_ancestral" &&
    (m.family === "v5" || p.noiseSchedule !== "native")
      ? { deliberate_euler_ancestral_bug: false, prefer_brownian: true }
      : {}),
    ...(m.family !== "v3"
      ? {
          v4_prompt: {
            caption: {
              base_caption: input,
              char_captions: chars.map((c) => ({
                char_caption: c.prompt,
                centers: [{ x: c.x, y: c.y }],
              })),
            },
            use_coords: p.positionMode === "custom" && chars.length > 0,
            use_order: true,
          },
          v4_negative_prompt: {
            caption: {
              base_caption: negative,
              char_captions: chars.map((c) => ({
                char_caption: c.uc,
                centers: [{ x: c.x, y: c.y }],
              })),
            },
          },
        }
      : {}),
    ...(p.transparent
      ? { straight_alpha: true, tag_hint_transparent_background: true }
      : {}),
    ...(p.baseImage
      ? {
          image: p.baseImage.data,
          strength: p.strength,
          noise: p.noise,
          ...(p.mask
            ? {
                mask: p.mask,
                add_original_image: false,
                ...(m.family !== "v3" && p.inpaintStrength !== 1
                  ? {
                      img2img: {
                        strength: p.inpaintStrength,
                        color_correct: true,
                      },
                    }
                  : {}),
              }
            : {
                extra_noise_seed: (seed + 4294967295) % 4294967296,
                color_correct: false,
                add_original_image: true,
              }),
        }
      : {}),
    ...(useVibes
      ? {
          reference_image_multiple: vibes.map((r) =>
            m.family === "v3" ? r.data : r.encoding,
          ),
          reference_strength_multiple: vibes.map(
            (r) =>
              r.strength /
              (p.normalizeVibes && m.family !== "v3"
                ? Math.max(
                    1,
                    vibes.reduce((s, r) => s + r.strength, 0),
                  )
                : 1),
          ),
          reference_information_extracted_multiple: vibes.map((r) => r.info),
        }
      : {}),
    ...(precise.length
      ? {
          normalize_reference_strength_multiple: true,
          director_reference_images: precise.map((r) => r.data),
          director_reference_descriptions: precise.map((r) => ({
            caption: { base_caption: r.caption, char_captions: [] },
            legacy_uc: false,
          })),
          director_reference_strength_values: precise.map((r) => r.strength),
          director_reference_secondary_strength_values: precise.map(
            (r) => 1 - r.fidelity,
          ),
          // 官方要求必须正好 1.0：400 ... must be EXACTLY 1.0 for each entry at this time
          director_reference_information_extracted: precise.map(() => 1),
        }
      : {}),
    ...(p.enhance && p.enhanceMax && m.family === "v5" && p.baseImage && !p.mask
      ? { upscaled_enhance: true }
      : {}),
  };
  if (medium) {
    parameters.steps = 14;
    parameters.sampler = "k_euler_ancestral";
    parameters.cfg_rescale = 0;
    parameters.uc = ucPresets(p.model).heavy;
    parameters.v4_negative_prompt.caption = {
      base_caption: parameters.uc,
      char_captions: chars.map((c) => ({
        char_caption: "",
        centers: [{ x: c.x, y: c.y }],
      })),
    };
  }
  return {
    input,
    model: medium
      ? "nai-diffusion-5-full-medium" +
        (action === "infill" ? "-inpainting" : "")
      : action === "infill"
        ? m.inpaint
        : p.model,
    action,
    parameters,
  };
}
export function changeModel(p, id, carry = true) {
  // 非 NovelAI 模型没有角色 / 参考 / 采样参数：只换模型 id，或退回空白默认值。
  if (!MODELS.some((item) => item.id === id))
    return carry ? { ...p, model: id } : { ...defaults(), model: id };
  const base = defaults(id);
  if (!carry) return base;
  const m = modelById(id);
  return {
    ...base,
    ...p,
    model: id,
    steps: base.steps,
    scale: base.scale,
    sampler: base.sampler,
    noiseSchedule: base.noiseSchedule,
    effort: "high",
    transparent: m.transparency && p.transparent,
    characters: p.characters.map((c, i) => ({
      ...c,
      enabled: i < m.maxCharacters && c.enabled,
    })),
    references: p.references.map((r) => ({
      ...r,
      enabled: r.enabled && (r.type === "vibe" ? m.vibe : m.precise),
    })),
  };
}
