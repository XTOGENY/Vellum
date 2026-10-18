// 文字对话连接的协议适配：目前只做"读取模型列表"这一件事。
// 不发起生成，不替用户扣费；每个请求都由用户点击触发。
import { validateEndpoint } from "./provider.mjs";
import { CHAT_PROTOCOLS, chatProtocol } from "../shared/chat-protocols.mjs";
export { CHAT_PROTOCOLS, chatProtocol };

// 协议 → 读取模型列表时的地址与鉴权方式。路径属于连接，不属于协议标签。
const ROUTES = {
  "openai-chat": { models: "/v1/models", auth: "bearer" },
  "openai-responses": { models: "/v1/models", auth: "bearer" },
  "anthropic-messages": { models: "/v1/models?limit=100", auth: "anthropic" },
  "google-gemini": { models: "/v1beta/models", auth: "query" },
};
// 用户常直接粘贴 OpenAI SDK 的 base URL，末尾往往已经带 /v1 或 /v1beta。
// 先去掉重复的版本段，再拼协议自己的路径，避免出现 /v1/v1/models。
export function apiRoot(raw) {
  return validateEndpoint(raw).replace(/\/(v1|v1beta)$/i, "");
}
function messageOf(j) {
  const raw = j && (j.error?.message || j.error || j.message || j.detail);
  if (!raw) return "";
  return String(typeof raw === "object" ? JSON.stringify(raw) : raw).slice(0, 300);
}
export class ChatProvider {
  constructor(fetcher = fetch) {
    this.fetch = fetcher;
  }
  async request(c, url, init, timeout = 20000, outer) {
    const limit = AbortSignal.timeout(timeout);
    const response = await this.fetch(url, {
      ...init,
      signal: outer ? AbortSignal.any([outer, limit]) : limit,
    });
    if (!response.ok) {
      let msg = "";
      try {
        msg = messageOf(await response.json());
      } catch {}
      const e = new Error(
        `连接返回 ${response.status}${msg ? ": " + msg : ""}`.replaceAll(
          c.token,
          "[密钥已隐藏]",
        ),
      );
      e.status = response.status;
      throw e;
    }
    return response;
  }
  // 只返回接口真实给出的字段。拿不到上下文长度就不显示，不猜。
  async models(c) {
    const base = apiRoot(c.baseUrl),
      spec = chatProtocol(c.chat?.protocol),
      route = ROUTES[spec.id];
    if (route.auth === "query") {
      const url =
        base +
        route.models +
        "?key=" +
        encodeURIComponent(c.token) +
        "&pageSize=200";
      const j = await (await this.request(c, url, { method: "GET" })).json();
      return (j.models || [])
        .filter((m) =>
          (m.supportedGenerationMethods || []).includes("generateContent"),
        )
        .map((m) => ({
          id: String(m.name || "").replace(/^models\//, ""),
          label: m.displayName ? String(m.displayName) : "",
          context: Number(m.inputTokenLimit) || 0,
        }))
        .filter((m) => m.id)
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    const headers =
      route.auth === "anthropic"
        ? { "x-api-key": c.token, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${c.token}` };
    const j = await (
      await this.request(c, base + route.models, { method: "GET", headers })
    ).json();
    const list = Array.isArray(j.data)
      ? j.data
      : Array.isArray(j.models)
        ? j.models
        : [];
    return list
      .map((m) => ({
        id: String(m.id || m.name || ""),
        label: m.display_name ? String(m.display_name) : "",
        context: Number(m.input_token_limit || m.context_length) || 0,
      }))
      .filter((m) => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  // 读取 SSE：只把 data: 之后的载荷交给上层，多行 data 按规范用换行拼接。
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
  // 逐段返回模型输出。四种协议最终都归到"一段文字"上。
  async *stream(
    c,
    { model, messages, system, temperature = 0.7, signal, image, images },
  ) {
    if (!model) throw new Error("请先在助手连接里选择默认模型");
    const base = apiRoot(c.baseUrl),
      spec = chatProtocol(c.chat?.protocol),
      STREAM = 600000,
      last = (list, i) => i === list.length - 1 && list[i].role === "user",
      // 一次可以带多张；老调用方传单张 image 也认。
      pics = images || (image ? [image] : []),
      hasPics = pics.length > 0,
      b64 = (im) => im.data.toString("base64"),
      dataUrl = (im) => `data:${im.mediaType};base64,${b64(im)}`,
      // 看图：四个协议各有各的写法，图片只挂在最后一条用户消息上。
      chatTurn = (m, i) =>
        hasPics && last(messages, i)
          ? {
              role: "user",
              content: [
                { type: "text", text: m.content },
                ...pics.map((im) => ({
                  type: "image_url",
                  image_url: { url: dataUrl(im) },
                })),
              ],
            }
          : { role: m.role, content: m.content },
      openaiTurn = (m, i) =>
        hasPics && last(messages, i)
          ? {
              role: "user",
              content: [
                { type: "input_text", text: m.content },
                ...pics.map((im) => ({
                  type: "input_image",
                  image_url: dataUrl(im),
                })),
              ],
            }
          : { role: m.role, content: m.content },
      anthropicTurn = (m, i) =>
        hasPics && last(messages, i)
          ? {
              role: "user",
              content: [
                { type: "text", text: m.content },
                ...pics.map((im) => ({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: im.mediaType,
                    data: b64(im),
                  },
                })),
              ],
            }
          : { role: m.role, content: m.content };
    if (spec.id === "anthropic-messages") {
      const r = await this.request(
        c,
        base + "/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": c.token,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            temperature,
            ...(system ? { system } : {}),
            stream: true,
            messages: messages.map(anthropicTurn),
          }),
        },
        STREAM,
        signal,
      );
      for await (const data of this.events(r)) {
        if (data === "[DONE]") return;
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.type === "content_block_delta" && j.delta?.text)
          yield j.delta.text;
        else if (j.type === "error")
          throw new Error(j.error?.message || "对话失败");
      }
      return;
    }
    if (spec.id === "google-gemini") {
      const url =
        base +
        "/v1beta/models/" +
        encodeURIComponent(model) +
        ":streamGenerateContent?alt=sse&key=" +
        encodeURIComponent(c.token);
      const r = await this.request(
        c,
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(system
              ? { systemInstruction: { parts: [{ text: system }] } }
              : {}),
            contents: messages.map((m, i) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [
                { text: m.content },
                ...(hasPics && last(messages, i)
                  ? pics.map((im) => ({
                      inline_data: {
                        mime_type: im.mediaType,
                        data: b64(im),
                      },
                    }))
                  : []),
              ],
            })),
            generationConfig: { temperature },
          }),
        },
        STREAM,
        signal,
      );
      for await (const data of this.events(r)) {
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw new Error(j.error.message || "对话失败");
        const text = (j.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text)
          .filter(Boolean)
          .join("");
        if (text) yield text;
      }
      return;
    }
    const headers = {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json",
    };
    if (spec.id === "openai-responses") {
      const r = await this.request(
        c,
        base + "/v1/responses",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            stream: true,
            temperature,
            ...(system ? { instructions: system } : {}),
            input: messages.map(openaiTurn),
          }),
        },
        STREAM,
        signal,
      );
      for await (const data of this.events(r)) {
        if (data === "[DONE]") return;
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.type === "response.output_text.delta" && j.delta) yield j.delta;
        else if (j.type === "response.completed") return;
        else if (j.type === "error" || j.error)
          throw new Error(j.error?.message || j.message || "对话失败");
      }
      return;
    }
    const r = await this.request(
      c,
      base + "/v1/chat/completions",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          stream: true,
          temperature,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            ...messages.map(chatTurn),
          ],
        }),
      },
      STREAM,
      signal,
    );
    for await (const data of this.events(r)) {
      if (data === "[DONE]") return;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new Error(j.error.message || "对话失败");
      const text = j.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  }
}
