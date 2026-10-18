// Cost core ported from the user's models.ts. The quote remains an estimate.
import { modelById } from "./novelai.mjs";
const caps = (m) => ({ characterReference: m.precise, vibeTransfer: m.vibe });
const focusCrop = (f, w, h) => ({
  width: Math.max(64, Math.min(w, f.width)),
  height: Math.max(64, Math.min(h, f.height)),
});
const focusResolution = (w, h) => {
  const scale = Math.sqrt(1048576 / (w * h));
  return {
    width: Math.max(64, Math.floor((w * scale) / 64) * 64),
    height: Math.max(64, Math.floor((h * scale) / 64) * 64),
  };
};
export function estimateCost(p, sub, encodingPrices) {
  if (!sub) return { kind: "unknown", anlas: 0 };
  if (p.focus && p.baseImage && p.mask) {
    try {
      const r = focusCrop(p.focus, p.baseImage.width, p.baseImage.height);
      p = { ...p, ...focusResolution(r.width, r.height) };
    } catch {
      return { kind: "unknown", anlas: 0 };
    }
  }
  const m = modelById(p.model);
  const capabilities = caps(m);
  const preciseActive =
    capabilities.characterReference &&
    p.preciseRefs.some((r) => r.enabled !== false);
  const vibeActive =
    capabilities.vibeTransfer &&
    !preciseActive &&
    (!p.mask || m.family === "v3") &&
    p.references.some((r) => r.enabled !== false);
  const vibes = vibeActive
    ? p.references.filter((r) => r.enabled !== false)
    : [];
  const cached = (r) =>
    r.vibe &&
    !r.failed &&
    r.encodedModel === p.model &&
    (r.encodingOnly ||
      (r.encodedExtraction === r.infoExtracted && r.encodedMask === r.mask));
  if (
    vibes.some(
      (r) => r.encodingOnly && !cached(r) && encodingPrices?.[r.id] !== 0,
    )
  )
    return { kind: "unknown", anlas: 0 };
  // Official public frontend: chunk 1601, module 50464 (2026-09-11).
  // Preserve the two separate rounding operations and one free sample per request.
  // Max Enhance bills the official 32-aligned enlarged output geometry.
  if (p.enhanceMax) {
    let width = Math.floor(p.width / 16) * 32,
      height = Math.floor(p.height / 16) * 32;
    const scale = Math.min(1, Math.sqrt(3145728 / (width * height)));
    let w = 32 * Math.round((width * scale) / 32),
      h = 32 * Math.round((height * scale) / 32);
    if (w * h > 3145728) {
      w = 32 * Math.floor((width * scale) / 32);
      h = 32 * Math.floor((height * scale) / 32);
    }
    p = { ...p, width: w, height: h };
  }
  if (
    ![p.width, p.height, p.steps].every((x) => Number.isFinite(x) && x > 0) ||
    p.steps > 50 ||
    p.width * p.height > 3145728
  )
    return { kind: "unknown", anlas: 0 };
  const px = p.width * p.height;
  const strength = p.mask
    ? (p.inpaintStrength ?? 1)
    : p.baseImage
      ? (p.strength ?? 1)
      : 1;
  const smea = m.family === "v3" && !p.baseImage && p.smea;
  const raw =
    Math.ceil(2951823174884865e-21 * px + 5753298233447344e-22 * px * p.steps) *
    (smea ? (p.smeaDyn ? 1.4 : 1.2) : 1) *
    (m.family === "v5" ? 1.5 : 1);
  const per = Math.max(2, Math.ceil(raw * strength));
  // Official s5 adds precise-reference surcharges after the base quote.
  const withinFree = px <= 1048576 && p.steps <= 28;
  const subscribed =
    (sub.accountType !== undefined && [1, 2, 3, 4].includes(sub.accountType)) ||
    (sub.expiresAt !== undefined
      ? sub.expiresAt > Date.now() / 1000 && sub.tier > 0
      : sub.active);
  const free =
    subscribed &&
    sub.tier >= 3 &&
    withinFree &&
    (m.family !== "v5" || !sub.usage?.isNegative);
  const requested = p.batchSize ?? p.nImages ?? 1;
  const sequential = !!p.sequentialGeneration && !p.batchSize;
  const samples = sequential ? 1 : requested,
    runs = sequential ? requested : 1;
  if (!Number.isInteger(requested) || requested < 1 || requested > 8)
    return { kind: "unknown", anlas: 0 };
  if (!Number.isInteger(samples) || samples < 1 || samples > 8 || per > 140)
    return { kind: "unknown", anlas: 0 };
  // Official 5285/s5: each precise reference costs 5 per sample; V4.5 Vibes
  // beyond the first four cost 2 each per request. Missing encodings cost 2 once.
  // Read-only cache quotes supply the encoding fee when available.
  const referenceFee = preciseActive
    ? 5 *
      p.preciseRefs.filter((r) => r.enabled !== false).length *
      samples *
      runs
    : 0;
  const vibeFee =
    m.family === "v45" ? Math.max(0, vibes.length - 4) * 2 * runs : 0;
  const encodingFee =
    m.family === "v45"
      ? vibes.reduce(
          (total, r) => total + (cached(r) ? 0 : (encodingPrices?.[r.id] ?? 2)),
          0,
        )
      : 0;
  const anlas =
    per * Math.max(0, samples - (free ? 1 : 0)) * runs +
    referenceFee +
    vibeFee +
    encodingFee;
  return {
    kind: anlas ? "anlas" : m.family === "v5" ? "allowance" : "free",
    anlas,
  };
}

export function generationQuote(params, subscription, official = true) {
  const p = {
    ...params,
    model:
      params.mask && params.model === "nai-diffusion-5-curated"
        ? "nai-diffusion-4-5-curated"
        : params.model,
    enhanceMax: !!params.enhance && !!params.enhanceMax && !params.mask,
    steps:
      params.effort === "medium" && params.model === "nai-diffusion-5-full"
        ? 14
        : params.steps,
    references: params.references
      .filter((r) => r.type === "vibe")
      .map((r) => ({
        ...r,
        vibe: r.encoding,
        encodedExtraction: r.encodedInfo,
        infoExtracted: r.info,
        mask: r.mask || "",
        encodedMask: r.encodedMask || "",
      })),
    preciseRefs: params.references.filter((r) => r.type === "precise"),
  };
  const unknown = {
    kind: "unknown",
    anlas: null,
    reason: !official ? "中转价格由服务商决定" : "先读取订阅以估算费用",
  };
  if (!official || !subscription) return unknown;
  if (
    !Number.isInteger(p.total) ||
    p.total < 1 ||
    p.total > 24 ||
    !Number.isInteger(p.batchSize) ||
    p.batchSize < 1 ||
    p.batchSize > (p.width * p.height <= 640 * 640 ? 6 : 4)
  )
    return { ...unknown, reason: "生成数量无效" };
  const usageUnknown = p.model.includes("-5-") && !subscription.usage;
  if (usageUnknown)
    subscription = { ...subscription, usage: { isNegative: true } };
  let total = 0,
    kind = "free";
  for (let remaining = p.total || 1; remaining > 0;) {
    const n = Math.min(p.batchSize || 1, remaining);
    const q = estimateCost({ ...p, batchSize: n }, subscription);
    if (q.kind === "unknown") return unknown;
    total += q.anlas;
    kind = q.kind;
    remaining -= n;
  }
  // Missing Vibe encodings are paid once, not once per individual generation request.
  const vibes = p.references.filter(
    (r) =>
      r.enabled &&
      (!r.vibe ||
        r.encodedModel !== p.model ||
        r.encodedExtraction !== r.infoExtracted ||
        r.encodedMask !== (r.mask || "")),
  );
  const runs = Math.ceil((p.total || 1) / (p.batchSize || 1));
  if (
    modelById(p.model).family === "v45" &&
    !p.mask &&
    !p.preciseRefs.some((r) => r.enabled)
  )
    total -= Math.max(0, runs - 1) * vibes.length * 2;
  return {
    kind: total ? "anlas" : kind,
    anlas: total,
    reason: usageUnknown
      ? "未取得 V5 额度信息，按扣费估算；最终以服务端为准"
      : "按原项目计价规则估算，最终以服务端扣费为准",
  };
}

// Independent tool price rules ported from the original project; estimates only.
export function upscaleCost(width, height) {
  const pixels = width * height;
  if (!Number.isFinite(pixels) || width <= 0 || height <= 0) return null;
  for (const [limit, price] of [
    [1048576, 1],
    [1747627, 2],
    [2446678, 3],
    [3145728, 4],
  ])
    if (pixels <= limit) return price;
  return null;
}

/** Official tools-266 price geometry, distinct from preprocessing geometry. */
export function directorCost(tool, width, height, sub) {
  if (!sub || width <= 0 || height <= 0) return null;
  let scale = Math.min(1, Math.sqrt(3145728 / (width * height)));
  width = Math.floor(width * scale);
  height = Math.floor(height * scale);
  if (width * height < 1048576) {
    scale = Math.sqrt(1048576 / (width * height));
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
  }
  const cost = estimateCost(
    {
      model: "nai-diffusion-3",
      width,
      height,
      steps: 28,
      nImages: 1,
      references: [],
      preciseRefs: [],
      sampler: "k_euler_ancestral",
    },
    tool === "bg-removal" ? { ...sub, tier: 0 } : sub,
  );
  return cost.kind === "unknown"
    ? null
    : tool === "bg-removal"
      ? cost.anlas * 3 + 5
      : cost.anlas;
}
