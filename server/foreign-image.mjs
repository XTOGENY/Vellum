// 非 NovelAI 的图像协议适配器。每个适配器只做两件事：
//   body(params, { count, images, mask })  → 这次请求真正要发的 body
//   images(c, body, hooks)                 → 发出去、把图交回给队列
// 这样队列不用关心是哪一家，只按 protocol 拿适配器。
import {
  openAIFields,
  openAIEditForm,
  OpenAIImageProvider,
} from "./openai-image.mjs";

const strip = (value) =>
  String(value || "").replace(/^data:[^,]*,/, "");

function base(url) {
  return String(url || "").replace(/\/+$/, "");
}

// 画布比例 → 各家认的宽高比字符串
export function aspectFor(width, height) {
  const r = Number(width) > 0 && Number(height) > 0 ? width / height : 1;
  const table = [
    ["1:1", 1],
    ["2:3", 2 / 3],
    ["3:2", 3 / 2],
    ["3:4", 3 / 4],
    ["4:3", 4 / 3],
    ["4:5", 4 / 5],
    ["5:4", 5 / 4],
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
    ["21:9", 21 / 9],
  ];
  let best = table[0];
  for (const item of table)
    if (Math.abs(Math.log(item[1] / r)) < Math.abs(Math.log(best[1] / r)))
      best = item;
  return best[0];
}

async function jsonRequest(fetcher, url, headers, body, signal, timeout) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!response.ok) {
    const message =
      parsed?.error?.message || parsed?.error || parsed?.message || text.slice(0, 200);
    throw Object.assign(
      new Error(`图像接口返回 ${response.status}${message ? "：" + String(message).slice(0, 300) : ""}`),
      { status: response.status },
    );
  }
  if (!parsed) throw new Error("接口返回的不是 JSON");
  return parsed;
}

// ---- Google · Nano Banana ----
export const geminiAdapter = {
  id: "gemini-image",
  fields(params, { images = [] } = {}) {
    return {
      aspect_ratio: aspectFor(params.width, params.height),
      prompt: String(params.prompt || "").trim(),
      inputs: images.length,
    };
  },
  body(params, { images = [], mask } = {}) {
    const prompt = String(params.prompt || "").trim();
    if (!prompt) throw new Error("请填写提示词");
    const parts = [{ text: prompt }];
    // 蒙版在 Gemini 这边没有对应的官方参数，明确不接受而不是静默丢弃。
    if (mask) throw new Error("Nano Banana 不支持蒙版局部重绘，请改用 GPT Image 或 NovelAI");
    for (const item of images)
      parts.push({
        inline_data: { mime_type: "image/png", data: strip(item?.data || item) },
      });
    return {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: aspectFor(params.width, params.height) },
      },
    };
  },
  async images(c, body, { signal, onResponse, onImage } = {}) {
    const model = body?.model || c.model || "gemini-2.5-flash-image";
    const url = `${base(c.baseUrl).replace(/\/v1beta$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const j = await jsonRequest(
      fetch,
      url,
      { "x-goog-api-key": c.token },
      body,
      signal,
      300000,
    );
    onResponse?.();
    const parts = j?.candidates?.[0]?.content?.parts || [];
    let saved = 0;
    for (const part of parts) {
      // 两种回法都见过：内联 base64，或者给一个 fileUri 让我们自己下载。
      const data = part?.inlineData?.data || part?.inline_data?.data;
      if (data) {
        await onImage(Buffer.from(data, "base64"), saved++);
        continue;
      }
      const uri = part?.fileData?.fileUri || part?.file_data?.file_uri;
      if (uri) {
        const image = await fetch(uri);
        if (image.ok)
          await onImage(Buffer.from(await image.arrayBuffer()), saved++);
      }
    }
    if (!saved) {
      const reason = j?.candidates?.[0]?.finishReason || j?.promptFeedback?.blockReason;
      throw new Error(
        reason ? `没有返回图片（${reason}）` : "接口没有返回图片数据",
      );
    }
    return saved;
  },
  async models(c) {
    const response = await fetch(
      `${base(c.baseUrl).replace(/\/v1beta$/, "")}/v1beta/models`,
      { headers: { "x-goog-api-key": c.token } },
    );
    if (!response.ok) throw new Error(`接口返回 ${response.status}`);
    const j = await response.json();
    const list = Array.isArray(j?.models) ? j.models : [];
    return list
      .filter((m) =>
        (m?.supportedGenerationMethods || []).includes("generateContent"),
      )
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((id) => /image|banana/i.test(id))
      .sort();
  },
};

// ---- xAI · Grok Imagine（OpenAI 兼容）----
export const xaiAdapter = {
  id: "xai-imagine",
  fields(params, { count } = {}) {
    return openAIFields(params, { count });
  },
  body(params, { count } = {}) {
    // xAI 默认回 url，必须显式要 b64_json，否则拿不到图。
    return { ...openAIFields(params, { count }), response_format: "b64_json" };
  },
  async images(c, body, hooks = {}) {
    const provider = new OpenAIImageProvider();
    const j = await provider.rawRequest(c, "/v1/images/generations", body, hooks.signal);
    hooks.onResponse?.();
    const list = Array.isArray(j?.data) ? j.data : [];
    let saved = 0;
    for (const item of list) {
      if (item?.b64_json) {
        await hooks.onImage?.(Buffer.from(item.b64_json, "base64"), saved++);
        continue;
      }
      if (item?.url) {
        const response = await fetch(item.url);
        if (response.ok)
          await hooks.onImage?.(Buffer.from(await response.arrayBuffer()), saved++);
      }
    }
    if (!saved) throw new Error("接口没有返回图片数据");
    return saved;
  },
  async models(c) {
    const provider = new OpenAIImageProvider();
    return provider.models(c);
  },
};

const ADAPTERS = {
  "openai-images": null, // 走原来的 openai 适配器，这里不重复
  "gemini-image": geminiAdapter,
  "xai-imagine": xaiAdapter,
};

export function imageAdapter(protocolId) {
  const adapter = ADAPTERS[protocolId];
  if (adapter === undefined)
    throw new Error(`${protocolId} 还没有图像适配器`);
  return adapter;
}
