// OpenAI 图像适配器：Images API 的文生图（generations）与图像输入（edits）。
// 流式中间图（partial_images）也走这里；Responses API 的多轮编辑留到后面。
import sharp from "sharp";
import { validateEndpoint } from "./provider.mjs";

// 用户常直接粘贴带 /v1 的 base URL，去掉重复的版本段再加路径。
export function openAIApiRoot(raw) {
  return validateEndpoint(raw).replace(/\/(v1|v1beta)$/i, "");
}
function stripDataUrl(value) {
  const s = String(value || "");
  return s.startsWith("data:") ? s.slice(s.indexOf(",") + 1) : s;
}
// 官方给的蒙版要求：需要 alpha 通道。做法是把灰阶蒙版本身填进 alpha。
async function maskToAlpha(base64) {
  const { data, info } = await sharp(Buffer.from(stripDataUrl(base64), "base64"))
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = data[i];
  }
  return sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
// 纯数据字段：JSON 体、multipart 表单和本地 PNG 记录共用这一份，避免三处各写一遍。
export function openAIFields(params, { count }) {
  const prompt = String(params.prompt ?? "").trim();
  if (!prompt) throw new Error("请填写提示词");
  if (prompt.length > 32000) throw new Error("提示词太长，官方上限 32000 字符");
  const fields = {
    model: params.model,
    prompt,
    n: Math.max(1, Math.min(10, Number(count) || 1)),
  };
  const size =
    params.size && params.size !== "custom"
      ? params.size
      : `${params.width}x${params.height}`;
  if (size) fields.size = size;
  if (params.quality) fields.quality = params.quality;
  if (params.background) fields.background = params.background;
  if (params.outputFormat) fields.output_format = params.outputFormat;
  if (
    ["jpeg", "webp"].includes(params.outputFormat) &&
    Number.isFinite(params.outputCompression)
  )
    fields.output_compression = Math.max(
      0,
      Math.min(100, Math.round(params.outputCompression)),
    );
  if (params.moderation) fields.moderation = params.moderation;
  const partial = Math.max(0, Math.min(3, Math.round(Number(params.partialImages) || 0)));
  if (partial > 0) {
    fields.stream = true;
    fields.partial_images = partial;
  }
  const safety = String(params.safetyIdentifier || "").trim();
  if (safety) fields.safety_identifier = safety.slice(0, 128);
  return fields;
}
export function openAIImageBody(params, options) {
  return openAIFields(params, options);
}
// 官方 edits：多张图用重复的 image[] 字段，顺序就是数组顺序，蒙版作用于第一张。
// 上限 16 张（文档原文）。mask 只作用于 images[0]。
export const MAX_EDIT_IMAGES = 16;
export async function openAIEditForm(params, { count, images, mask }) {
  const list = (Array.isArray(images) ? images : [images]).filter(Boolean);
  if (!list.length) throw new Error("请先添加要编辑的图像");
  if (list.length > MAX_EDIT_IMAGES)
    throw new Error(`最多 ${MAX_EDIT_IMAGES} 张输入图像`);
  const form = new FormData();
  for (const [key, value] of Object.entries(openAIFields(params, { count })))
    if (value !== undefined && value !== null) form.set(key, String(value));
  list.forEach((item, index) => {
    const data = typeof item === "string" ? item : item?.data;
    form.append(
      "image[]",
      new Blob([Buffer.from(stripDataUrl(data), "base64")], { type: "image/png" }),
      `image-${index + 1}.png`,
    );
  });
  if (mask)
    form.set("mask", new Blob([await maskToAlpha(mask)], { type: "image/png" }), "mask.png");
  return form;
}
function describeError(status, j) {
  const e = j?.error || {};
  if (e.code === "moderation_blocked")
    return "提示词或结果被内容审核拦下；改写提示词，或把审核调成更宽松再试";
  const msg = e.message || e.code || j?.message;
  if (msg) return `图像接口返回 ${status}：${String(msg).slice(0, 300)}`;
  // 5xx 且没有 JSON 说明，通常是对端网关的问题（中转的上游挂了），不是本地请求错。
  if (status === 502 || status === 503 || status === 504)
    return `图像接口返回 ${status}：对端网关或上游异常，多半不是本地请求的问题`;
  return `图像接口返回 ${status}`;
}
export class OpenAIImageProvider {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
  }
  async request(c, route, payload, signal) {
    const isForm = payload instanceof FormData,
      limit = AbortSignal.timeout(600000);
    const response = await this.fetcher(openAIApiRoot(c.baseUrl) + route, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${c.token}`,
        ...(isForm ? {} : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : isForm ? payload : JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, limit]) : limit,
    });
    if (!response.ok) {
      let parsed = null;
      try {
        parsed = await response.json();
      } catch {}
      const e = new Error(
        describeError(response.status, parsed).replaceAll(
          c.token,
          "[密钥已隐藏]",
        ),
      );
      e.status = response.status;
      throw e;
    }
    return response;
  }
  // 直接拿 JSON：xAI 这类兼容协议复用同一套请求构造。
  async rawRequest(c, route, payload, signal) {
    const response = await this.request(c, route, payload, signal);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("接口返回的不是 JSON");
    }
  }
  // 逐条读 SSE 事件，多行 data 按规范拼接。
  async *events(response) {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (data) yield data;
      }
    }
  }
  // 只认图像模型：/v1/models 会把文本模型一起列出来。
  async models(c) {
    const response = await this.request(c, "/v1/models");
    const j = await response.json();
    const list = Array.isArray(j?.data) ? j.data : [];
    return list
      .map((m) => String(m.id || ""))
      .filter((id) => id && /image/i.test(id))
      .sort();
  }
  async images(c, body, { signal, onResponse, onImage, onPreview, stream } = {}) {
    const isForm = body instanceof FormData,
      response = await this.request(
        c,
        isForm ? "/v1/images/edits" : "/v1/images/generations",
        body,
        signal,
      );
    onResponse?.();
    const wantsStream = stream ?? !!body?.stream;
    if (!wantsStream) {
      const j = await response.json();
      const list = Array.isArray(j?.data) ? j.data : [];
      let saved = 0;
      for (const item of list) {
        if (item?.b64_json) {
          await onImage(Buffer.from(item.b64_json, "base64"), saved++);
          continue;
        }
        // 有些中转只回 url，跟着下载一次，别白白丢掉一张图。
        if (item?.url) {
          const image = await fetch(item.url);
          if (image.ok)
            await onImage(Buffer.from(await image.arrayBuffer()), saved++);
        }
      }
      if (!saved) throw new Error("接口没有返回图片数据");
      return saved;
    }
    let saved = 0;
    for await (const data of this.events(response)) {
      if (data === "[DONE]") break;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error.message || "生成失败");
      if (event.type === "image_generation.partial_image" && event.b64_json)
        onPreview?.({
          image: event.b64_json,
          step: (event.partial_image_index ?? 0) + 1,
        });
      else if (event.type === "image_generation.completed" && event.b64_json)
        await onImage(Buffer.from(event.b64_json, "base64"), saved++);
    }
    if (!saved) throw new Error("接口没有返回图片数据");
    return saved;
  }
}
