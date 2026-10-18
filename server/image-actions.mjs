import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  enhancementParams,
  variationParams,
} from "../shared/image-actions.mjs";
import { buildPayload, defaults } from "../shared/novelai.mjs";
import { normalizeImage, readMetadata } from "./images.mjs";
export async function imageActionParams(
  store,
  { kind, historyId, currentParams, scale, strength, noise },
) {
  if (!["enhance", "variation"].includes(kind)) throw Error("未知的图像动作");
  const h = store.state.history.find((h) => h.id === historyId);
  if (!h) throw Error("所选作品不存在");
  if (!currentParams || typeof currentParams.model !== "string")
    throw Error("缺少当前生成设置");
  const current = { ...defaults(currentParams.model), ...currentParams },
    bytes = await readFile(path.join(store.imagesDir, h.filename)),
    base = {
      ...(await normalizeImage(bytes.toString("base64"))),
      name: "作品.png",
    };
  if (kind === "enhance")
    return enhancementParams(current, base, scale, strength, noise);
  if (h.kind !== "generate")
    throw Error("此作品没有原始生成请求，不能生成变体");
  let request;
  const metadata = await readMetadata(bytes.toString("base64"));
  try {
    const j = JSON.parse(metadata.fields.Comment || "{}");
    if (
      typeof j.prompt === "string" &&
      typeof j.model === "string" &&
      j.width &&
      j.height &&
      j.steps &&
      j.sampler
    )
      request = { input: j.prompt, model: j.model, parameters: j };
  } catch {}
  // Compatibility: use the selected history record, never the current prompt or sampler.
  if (!request && h.params)
    request = buildPayload(
      { ...h.params, references: [], baseImage: null, mask: null, focus: null },
      { seed: h.seed ?? 0, samples: 1 },
    );
  return variationParams(current, { ...h, request }, base);
}
