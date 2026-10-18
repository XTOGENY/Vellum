import { defaults, MODELS, promptText } from "../shared/novelai.mjs";
const extras = [
  "actualPrompt",
  "actualNegative",
  "actualCharacters",
  "randomizerSource",
  "preparedPrompt",
  "imageAction",
  "templateEnabled",
  "templatePosition",
  "templates",
];
// OpenAI Images 的记录：只写真实发出去的请求字段，不套 NovelAI 的 steps/sampler/uc。
export function openAIGenerationMetadata(
  params,
  payload,
  { width, height, protocol = "openai-images" },
) {
  const prompt = payload?.prompt ?? params.prompt ?? "";
  return {
    Software: "Vellum",
    Source: `${protocol === "openai-images" ? "OpenAI" : protocol} ${params.model}`,
    Description: prompt,
    Comment: {
      protocol,
      model: params.model,
      prompt,
      size: payload?.size ?? `${width}x${height}`,
      quality: payload?.quality ?? null,
      background: payload?.background ?? null,
      output_format: payload?.output_format ?? null,
      output_compression: payload?.output_compression ?? null,
      moderation: payload?.moderation ?? null,
      safety_identifier: payload?.safety_identifier ?? null,
      partial_images: payload?.partial_images ?? 0,
      mode: payload?.mode ?? "generate",
      input_images: payload?.inputs ?? 0,
      width,
      height,
      seed: null,
    },
    Vellum: {
      version: 1,
      protocol: "openai-images",
      params: { model: params.model, prompt, width, height },
      output: { width, height },
      operation: { kind: payload?.mode ?? "generate" },
      omittedImageInputs: (payload?.mode ?? "generate") !== "generate",
    },
  };
}
export function generationMetadata(
  params,
  payload,
  { width, height, kind = "generate", operation = {} },
) {
  const model = MODELS.find((m) => m.id === params.model) || MODELS[0];
  const safe = Object.fromEntries(
    [...Object.keys(defaults(model.id)), ...extras]
      .filter((k) => Object.hasOwn(params, k))
      .map((k) => [k, structuredClone(params[k])]),
  );
  Object.assign(safe, {
    model: model.id,
    baseImage: null,
    mask: null,
    references: [],
    focus: null,
    width,
    height,
  });
  delete safe.notes;
  const wire = payload?.parameters || {};
  const resolved = promptText({
    ...defaults(model.id),
    ...safe,
    prompt: safe.actualPrompt ?? safe.prompt ?? "",
    negative: safe.actualNegative ?? safe.negative ?? "",
  });
  const characters = (safe.actualCharacters || safe.characters || []).filter(
    (c) => c.enabled,
  );
  const caption = (negative = false) => ({
    base_caption: negative
      ? (wire.uc ?? resolved.negative)
      : (payload?.input ?? resolved.input),
    char_captions: characters.map((c) => ({
      char_caption: negative ? c.uc : c.prompt,
      centers: [{ x: c.x, y: c.y }],
    })),
  });
  const comment = {
    ...Object.fromEntries(
      Object.entries(wire).filter(([k]) => !/(image|mask|reference)/.test(k)),
    ),
    model: model.id,
    prompt: payload?.input ?? resolved.input,
    uc: wire.uc ?? resolved.negative,
    width,
    height,
    steps: safe.steps,
    scale: safe.scale,
    seed: safe.seed ?? null,
    sampler: safe.sampler,
    noise_schedule: safe.noiseSchedule,
    cfg_rescale: safe.cfgRescale,
    v4_prompt: wire.v4_prompt || {
      caption: caption(),
      use_coords: safe.positionMode === "custom",
    },
    v4_negative_prompt: wire.v4_negative_prompt || { caption: caption(true) },
  };
  const action =
    kind !== "generate"
      ? kind
      : params.imageAction ||
        (params.mask ? "inpaint" : params.baseImage ? "img2img" : kind);
  return {
    Software: "Vellum",
    Source: `NovelAI ${model.label}`,
    Description: comment.prompt,
    Comment: comment,
    Vellum: {
      version: 1,
      params: safe,
      output: { width, height },
      operation: {
        kind: action,
        ...(kind === "director"
          ? {
              type: operation.type,
              emotion: operation.emotion,
              defry: operation.defry,
              prompt: operation.prompt,
            }
          : {}),
      },
      sourceSize: { width: params.width, height: params.height },
      omittedImageInputs: !!(
        params.baseImage ||
        params.mask ||
        params.references?.length
      ),
    },
  };
}
