// 图像模型注册表：把"哪个模型属于哪个协议、能调什么"集中在一处。
// NovelAI 的模型表仍在 shared/novelai.mjs（历史原因），这里只登记其他厂商。
export const OPENAI_IMAGE_MODELS = [
      {
        id: "gpt-image-2.5-sunburst",
        label: "GPT Image 2.5 Sunburst",
        hint: "编辑精度优先",
      },
  {
    id: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    hint: "快速、日常出图",
  },
];
export const IMAGE_PROVIDERS = [
  { id: "novelai", label: "NovelAI", protocol: "novelai-native" },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-images",
    models: OPENAI_IMAGE_MODELS,
  },
];
export function openAIImageModel(id) {
  return OPENAI_IMAGE_MODELS.find((m) => m.id === id) || null;
}
export function isOpenAIImageModel(id) {
  return !!openAIImageModel(id);
}
// 尺寸规则来自官方文档：16 的倍数、比例 1:3～3:1、单边不超过 3840、
// 总像素 655,360～8,294,400。返回 null 表示合法。
export function gptSizeIssue(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return "请填写宽高";
  if (width % 16 || height % 16) return "宽高都必须是 16 的倍数";
  if (Math.max(width, height) > 3840) return "单边不能超过 3840";
  const ratio = width / height;
  if (ratio > 3 || ratio < 1 / 3) return "宽高比需要在 1:3 到 3:1 之间";
  const pixels = width * height;
  if (pixels < 655360) return "总像素太小，至少 655,360（例如 1024×640）";
  if (pixels > 8294400) return "总像素太大，最多 8,294,400（4K）";
  if (Math.max(width, height) > 2560)
    return "超过 2560 的边长属于官方标注的实验性分辨率";
  return null;
}
export const GPT_SIZES = [
  ["auto", "自动"],
  ["1024x1024", "1024 × 1024 方形"],
  ["1536x1024", "1536 × 1024 横向"],
  ["1024x1536", "1024 × 1536 纵向"],
  ["custom", "自定义宽高"],
];
export const GPT_QUALITY = [
  ["auto", "自动"],
  ["low", "低"],
  ["medium", "标准"],
  ["high", "高"],
  ["xhigh", "超高"],
  ["max", "极致"],
];
export const GPT_BACKGROUND = [
  ["auto", "自动"],
  ["opaque", "保留"],
  ["transparent", "透明"],
];
export const GPT_FORMAT = [
  ["png", "PNG"],
  ["jpeg", "JPEG"],
  ["webp", "WebP"],
];
export const GPT_MODERATION = [
  ["auto", "标准"],
  ["low", "宽松"],
];
export const GPT_PARTIAL = [
  [0, "关"],
  [1, "1 张"],
  [2, "2 张"],
  [3, "3 张"],
];
// 清晰度按"短边"定义：1K 正好覆盖官方推荐的 1024×1024 / 1536×1024 / 1024×1536。
export const GPT_TIERS = [
  ["1k", "1K"],
  ["2k", "2K"],
  ["4k", "4K"],
];
export const GPT_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "5:4",
  "4:5",
  "21:9",
  "9:21",
];
const TIER_EDGE = { "1k": 1024, "2k": 2048, "4k": 3840 };
// 清晰度 × 比例 → 官方的 WIDTHxHEIGHT。始终满足：16 的倍数、比例 1:3–3:1、
// 单边不超过 3840、总像素 655,360–8,294,400。
export function gptSizeFor(tier, ratio) {
  const [rw, rh] = String(ratio || "1:1").split(":").map(Number);
  if (!rw || !rh) return null;
  const edge = TIER_EDGE[tier] || 1024,
    round16 = (v) => Math.max(16, Math.round(v / 16) * 16);
  let w = rw >= rh ? (edge * rw) / rh : edge;
  let h = rw >= rh ? edge : (edge * rh) / rw;
  w = round16(w);
  h = round16(h);
  if (Math.max(w, h) > 3840) {
    const k = 3840 / Math.max(w, h);
    w = round16(w * k);
    h = round16(h * k);
  }
  if (w * h > 8294400) {
    const k = Math.sqrt(8294400 / (w * h));
    w = round16(w * k);
    h = round16(h * k);
  }
  // 取整后可能刚过上限，按 16 步微调较大的一边，保持比例大致不变。
  let guard = 0;
  while (Math.max(w, h) > 3840 && guard++ < 300) {
    if (w >= h) w -= 16;
    else h -= 16;
  }
  guard = 0;
  while (w * h > 8294400 && guard++ < 300) {
    if (w >= h) w -= 16;
    else h -= 16;
  }
  guard = 0;
  while (w * h < 655360 && guard++ < 300) {
    if (w >= h) w += 16;
    else h += 16;
  }
  if (w % 16 || h % 16) return null;
  if (Math.max(w, h) > 3840 || w * h > 8294400 || w * h < 655360) return null;
  if (w / h > 3 || h / w > 3) return null;
  return `${w}x${h}`;
}

// ---- 非 OpenAI 的闭源图像模型 ----
export const GEMINI_IMAGE_MODELS = [
  { id: "gemini-3-pro-image", label: "Nano Banana Pro · Gemini 3 Pro Image", protocol: "gemini-image" },
  { id: "gemini-3.1-flash-image", label: "Nano Banana · Gemini 3.1 Flash Image", protocol: "gemini-image" },
  { id: "gemini-nano-banana-2.1", label: "Nano Banana 2.1", protocol: "gemini-image" },
];
export const XAI_IMAGE_MODELS = [
  { id: "grok-2-image", label: "Grok Imagine", protocol: "xai-imagine" },
  { id: "grok-2-image-1212", label: "Grok Imagine 1212", protocol: "xai-imagine" },
];
export const FOREIGN_MODELS = [
  ...GEMINI_IMAGE_MODELS,
  ...XAI_IMAGE_MODELS,
];
export function foreignImageModel(id) {
  return FOREIGN_MODELS.find((m) => m.id === id);
}
// 这条协议内置的模型清单（中转读到清单时会被它覆盖）。
export function builtinImageModels(protocolId) {
  if (protocolId === "openai-images") return OPENAI_IMAGE_MODELS;
  if (protocolId === "gemini-image") return GEMINI_IMAGE_MODELS;
  if (protocolId === "xai-imagine") return XAI_IMAGE_MODELS;
  return [];
}
