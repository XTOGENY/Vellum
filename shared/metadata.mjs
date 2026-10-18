import { defaults, MODELS } from "./novelai.mjs";
import { expandedPrompts } from "./prompt-tools.mjs";
import { normalizeBaseDims } from "./resolution.mjs";
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const settingsKeys = Object.keys(defaults()).filter(
  (k) =>
    ![
      "prompt",
      "negative",
      "characters",
      "references",
      "baseImage",
      "mask",
      "focus",
      "seed",
      "promptChunks",
      "total",
      "batchSize",
    ].includes(k),
);
function describe(result, source, present, extra = {}) {
  return {
    ...result,
    source,
    available: {
      prompt: typeof present.prompt === "string",
      negative: typeof present.negative === "string",
      characters: Array.isArray(present.characters),
      settings: settingsKeys.some(
        (k) =>
          !["quality", "qualityPreset", "ucPreset"].includes(k) &&
          Object.hasOwn(present, k),
      ),
      seed:
        Number.isInteger(present.seed) &&
        present.seed >= 0 &&
        present.seed <= 4294967295,
    },
    settingsKeys: settingsKeys.filter((k) => Object.hasOwn(present, k)),
    ...extra,
  };
}
export function restoreMetadata({ fields, width, height }) {
  const projectMetadata = fields.Vellum || fields.NWENAI;
  if (projectMetadata) {
    try {
      const d =
        typeof projectMetadata === "string"
          ? JSON.parse(projectMetadata)
          : projectMetadata;
      if (
        d.version === 1 &&
        d.params &&
        (d.params.prompt === undefined ||
          typeof d.params.prompt === "string") &&
        (d.params.negative === undefined ||
          typeof d.params.negative === "string") &&
        (d.params.characters === undefined ||
          (Array.isArray(d.params.characters) &&
            d.params.characters.every(
              (c) =>
                c && typeof c.prompt === "string" && typeof c.uc === "string",
            ))) &&
        MODELS.some((m) => m.id === d.params.model)
      )
        return describe(
          {
            params: { ...defaults(d.params.model), ...d.params },
            ...(typeof d.params.actualPrompt === "string" &&
            (d.params.actualCharacters === undefined ||
              (Array.isArray(d.params.actualCharacters) &&
                d.params.actualCharacters.every(
                  (c) =>
                    c &&
                    typeof c.prompt === "string" &&
                    typeof c.uc === "string",
                )))
              ? {
                  actualParams: {
                    ...defaults(d.params.model),
                    ...d.params,
                    prompt: d.params.actualPrompt,
                    negative: d.params.actualNegative ?? d.params.negative,
                    characters:
                      d.params.actualCharacters ?? d.params.characters ?? [],
                  },
                }
              : {}),
            warnings: d.omittedImageInputs
              ? ["原始底图、蒙版与参考图片不包含在文件中，需要时请重新添加。"]
              : [],
          },
          "nwenai",
          d.params,
          { operation: d.operation, output: d.output },
        );
    } catch {}
  }
  let j = {};
  try {
    j =
      (typeof fields.Comment === "string"
        ? JSON.parse(fields.Comment || "{}")
        : fields.Comment) || {};
  } catch {}
  const caption = j.v4_prompt?.caption,
    neg = j.v4_negative_prompt?.caption;
  if (
    typeof (caption?.base_caption ?? j.prompt ?? fields.Description) !==
    "string"
  )
    return null;
  const source = fields.Source || j.source || "";
  let model = MODELS.find(
    (m) =>
      m.id ===
      (j.model || "").replace(/-inpainting$/, "").replace(/-medium$/, ""),
  )?.id;
  if (!model) {
    if (source.includes("V5"))
      model =
        source.includes("Full") || /(657484A5|0ADF9AB7)$/.test(source)
          ? "nai-diffusion-5-full"
          : "nai-diffusion-5-curated";
    else if (/(4BDE2A90|1229B44F|B9F340FD|F3D95188)$/.test(source))
      model = "nai-diffusion-4-5-full";
    else if (/V4.5|(C02D4F98|5AB81C7C|B5A2A797)$/.test(source))
      model = "nai-diffusion-4-5-curated";
    else if (/V4 Full/.test(source)) model = "nai-diffusion-4-full";
    else if (/V4 Curated/.test(source))
      model = "nai-diffusion-4-curated-preview";
    else if (/(B0BDF6C1|C1E1DE52|7BCCAA2C|1120E6A9)$/.test(source))
      model = "nai-diffusion-3";
    else if (/(4BE8C60C|C8704949|37C2B166|F306816B|9CC2F394)$/.test(source))
      model = "nai-diffusion-furry-3";
  }
  const warnings = [];
  const knownModel = !!model;
  if (!model) {
    model = MODELS[0].id;
    warnings.push("无法确认原模型，请手动核对模型。");
  }
  const p = defaults(model);
  p.prompt = caption?.base_caption ?? j.prompt ?? fields.Description;
  p.negative = neg?.base_caption ?? j.uc ?? "";
  p.quality = false;
  p.ucPreset = "none";
  for (const [a, b] of Object.entries({
    width: "width",
    height: "height",
    steps: "steps",
    scale: "scale",
    seed: "seed",
    cfgRescale: "cfg_rescale",
    strength: "strength",
    noise: "noise",
    batchSize: "n_samples",
  }))
    if (finite(j[b])) p[a] = j[b];
  p.width = j.width || width || p.width;
  p.height = j.height || height || p.height;
  if (typeof j.sampler === "string") p.sampler = j.sampler;
  if (typeof j.noise_schedule === "string") p.noiseSchedule = j.noise_schedule;
  p.positionMode = j.v4_prompt?.use_coords ? "custom" : "ai";
  p.varietyPlus = finite(j.skip_cfg_above_sigma);
  p.smea = !!j.sm;
  p.smeaDyn = !!j.sm_dyn;
  p.decrisper = !!j.dynamic_thresholding;
  p.transparent = !!j.straight_alpha;
  if (finite(j.img2img?.strength)) p.inpaintStrength = j.img2img.strength;
  const chars = caption?.char_captions || j.characterPrompts || [];
  p.characters = chars.slice(0, 64).map((c, i) => {
    const center = c.centers?.[0] || c.center || { x: 0.5, y: 0.5 };
    const negatives = neg?.char_captions || [];
    const sameCenter = negatives.find(
      (n) => n.centers?.[0]?.x === center.x && n.centers?.[0]?.y === center.y,
    );
    return {
      id: crypto.randomUUID(),
      name: `角色 ${i + 1}`,
      prompt: c.char_caption ?? c.prompt ?? "",
      uc:
        (negatives.length === chars.length
          ? negatives[i]?.char_caption
          : sameCenter?.char_caption) ??
        c.uc ??
        "",
      enabled: true,
      x: center.x,
      y: center.y,
    };
  });
  warnings.push(
    "元数据只能恢复其中保存的设置；原始底图、蒙版及参考图通常不在 PNG 中。",
  );
  const actual = j.actual_prompts;
  if (typeof actual?.prompt?.base_caption === "string") {
    const actualParams = {
      ...p,
      prompt: actual.prompt.base_caption,
      negative: actual.negative_prompt?.base_caption ?? p.negative,
      characters: p.characters.map((c, i) => ({
        ...c,
        prompt: actual.prompt.char_captions?.[i]?.char_caption ?? c.prompt,
        uc: actual.negative_prompt?.char_captions?.[i]?.char_caption ?? c.uc,
      })),
    };
    p.actualPrompt = actualParams.prompt;
    p.actualNegative = actualParams.negative;
    p.actualCharacters = actualParams.characters;
    p.randomizerSource = {
      prompt: p.prompt,
      negative: p.negative,
      characters: p.characters.map((c) => ({ prompt: c.prompt, uc: c.uc })),
    };
    return describe(
      { params: p, actualParams, warnings },
      "novelai",
      presentFields(j, fields, p, knownModel),
    );
  }
  return describe(
    { params: p, warnings },
    "novelai",
    presentFields(j, fields, p, knownModel),
  );
}

function presentFields(j, fields, p, knownModel) {
  const present = {};
  if (
    typeof (
      j.v4_prompt?.caption?.base_caption ??
      j.prompt ??
      fields.Description
    ) === "string"
  )
    present.prompt = p.prompt;
  if (typeof (j.v4_negative_prompt?.caption?.base_caption ?? j.uc) === "string")
    present.negative = p.negative;
  if (
    Array.isArray(j.v4_prompt?.caption?.char_captions) ||
    Array.isArray(j.characterPrompts)
  )
    present.characters = p.characters;
  if (Number.isInteger(j.seed)) present.seed = j.seed;
  const map = {
    width: "width",
    height: "height",
    steps: "steps",
    scale: "scale",
    cfgRescale: "cfg_rescale",
    sampler: "sampler",
    noiseSchedule: "noise_schedule",
    strength: "strength",
    noise: "noise",
    smea: "sm",
    smeaDyn: "sm_dyn",
    decrisper: "dynamic_thresholding",
    transparent: "straight_alpha",
  };
  for (const [to, from] of Object.entries(map))
    if (Object.hasOwn(j, from)) present[to] = p[to];
  if (knownModel) present.model = p.model;
  if (j.v4_prompt) present.positionMode = p.positionMode;
  if (Object.hasOwn(j, "skip_cfg_above_sigma"))
    present.varietyPlus = p.varietyPlus;
  if (finite(j.img2img?.strength)) present.inpaintStrength = p.inpaintStrength;
  // Standard captions already contain quality / UC tags; never add them twice.
  if (Object.hasOwn(present, "prompt")) present.quality = false;
  if (Object.hasOwn(present, "negative")) present.ucPreset = "none";
  return present;
}

export function applyMetadataImport(current, metadata, choice) {
  if (!metadata?.params) throw Error("没有可导入的生成设置");
  const source =
    choice.actual && metadata.actualParams
      ? metadata.actualParams
      : metadata.params;
  const next = structuredClone(current);
  const available = metadata.available || {};
  if (choice.settings && available.settings) {
    for (const k of metadata.settingsKeys || [])
      if (settingsKeys.includes(k)) next[k] = source[k];
    if (
      metadata.settingsKeys.includes("width") ||
      metadata.settingsKeys.includes("height")
    )
      Object.assign(next, normalizeBaseDims(next.width, next.height));
  }
  let expanded = source;
  try {
    if (choice.prompt || choice.negative || choice.characters)
      expanded = expandedPrompts(source);
  } catch {
    throw Error("图片中的提示词片段不完整，无法还原；可尝试实际提示词。");
  }
  const join = (a, b) => [a, b].filter(Boolean).join(", ");
  if (choice.prompt && available.prompt) {
    next.prompt = choice.append
      ? join(current.prompt, expanded.prompt)
      : expanded.prompt;
    if (!choice.append) {
      next.quality = source.quality;
      next.qualityPreset = source.qualityPreset;
    }
  }
  if (choice.negative && available.negative) {
    next.negative = choice.append
      ? join(current.negative, expanded.negative)
      : expanded.negative;
    if (!choice.append) next.ucPreset = source.ucPreset;
  }
  if (choice.characters && available.characters) {
    const chars = expanded.characters.map((c) => ({
      ...c,
      id: crypto.randomUUID(),
    }));
    next.characters = choice.appendCharacters
      ? [...current.characters, ...chars]
      : chars;
    next.positionMode = source.positionMode;
  }
  if (
    next.characters.filter((c) => c.enabled).length >
    (MODELS.find((m) => m.id === next.model)?.maxCharacters || 0)
  )
    throw Error("角色数量超过目标模型的上限，请调整导入项或模型。");
  if (
    next.prompt.length > 50000 ||
    next.negative.length > 50000 ||
    next.characters.length > 64
  )
    throw Error("导入后的提示词或角色数量超过工作台上限，请减少导入内容。");
  if (choice.seed && available.seed) next.seed = source.seed;
  if (choice.prompt || choice.negative || choice.characters) {
    delete next.actualPrompt;
    delete next.actualNegative;
    delete next.actualCharacters;
    delete next.randomizerSource;
  }
  // Current connection, notes, source images, masks and references belong to the workbench.
  return next;
}
