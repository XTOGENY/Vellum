import { decode } from "@msgpack/msgpack";
import { buildDirectorMultipart } from "./nai-multipart.mjs";
import { unzipSync } from "fflate";
import { imageBytes } from "./images.mjs";
export function validateEndpoint(raw) {
  const u = new URL(raw || "https://image.novelai.net");
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !["https:", "http:"].includes(u.protocol)
  )
    throw new Error("API 地址格式错误");
  if (
    u.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
  )
    throw new Error("远程连接必须使用 HTTPS");
  return u.href.replace(/\/$/, "");
}
export class Provider {
  constructor(fetcher = fetch) {
    this.fetch = fetcher;
  }
  async request(c, route, body, signal, extra = {}, raw = null) {
    const response = await this.fetch(validateEndpoint(c.baseUrl) + route, {
      method: body === undefined && !raw ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${c.token}`,
        "Content-Type": raw ? raw.contentType : "application/json",
        ...extra,
      },
      ...(raw
        ? { body: raw.body }
        : body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(240000)])
        : AbortSignal.timeout(240000),
    });
    if (!response.ok) {
      let msg;
      try {
        const j = await response.json();
        msg = j.message || j.error || j.detail?.message;
      } catch {}
      const e = new Error(
        `NovelAI ${response.status}${msg ? ": " + String(msg).slice(0, 350) : ""}`.replaceAll(
          c.token,
          "[密钥已隐藏]",
        ),
      );
      e.status = response.status;
      e.correlation = response.headers.get("x-correlation-id");
      throw e;
    }
    return response;
  }
  async subscription(c) {
    const base = new URL(validateEndpoint(c.baseUrl));
    const connection =
      base.hostname === "api.novelai.net" && base.pathname === "/"
        ? { ...c, baseUrl: "https://image.novelai.net" }
        : c;
    return (
      await this.request(
        connection,
        "/user/subscription",
        undefined,
        AbortSignal.timeout(15000),
      )
    ).json();
  }
  async tags(c, model, prompt) {
    return (
      await this.request(
        c,
        "/ai/generate-image/suggest-tags?" +
          new URLSearchParams({ model, prompt, lang: "en" }),
      )
    ).json();
  }
  async encode(c, body, signal) {
    return Buffer.from(
      await (
        await this.request(c, "/ai/encode-vibe", body, signal)
      ).arrayBuffer(),
    ).toString("base64");
  }
  async images(
    c,
    body,
    {
      signal,
      stream = false,
      onPreview = () => {},
      onImage = () => {},
      onResponse = () => {},
    } = {},
  ) {
    if (stream) {
      const payload = {
        ...body,
        parameters: { ...body.parameters, stream: "msgpack" },
      };
      const director = buildDirectorMultipart(payload);
      const r = await this.request(
        c,
        "/ai/generate-image-stream",
        director ? undefined : payload,
        signal,
        {},
        director,
      );
      onResponse();
      let buffer = Buffer.alloc(0),
        seen = new Set();
      for await (const chunk of r.body) {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const len = buffer.readUInt32BE();
          if (!len || len > 64 * 1024 * 1024)
            throw new Error("生成事件长度异常");
          if (buffer.length < len + 4) break;
          const ev = decode(buffer.subarray(4, len + 4));
          buffer = buffer.subarray(len + 4);
          if (ev.event_type === "error")
            throw new Error(String(ev.message || "生成失败"));
          if (ev.image) {
            const bytes =
              typeof ev.image === "string"
                ? imageBytes(ev.image)
                : Buffer.from(ev.image);
            if (ev.event_type === "intermediate")
              onPreview({
                image: bytes.toString("base64"),
                step: ev.step_ix ?? 0,
                index: ev.samp_ix ?? 0,
              });
            if (ev.event_type === "final") {
              const index = ev.samp_ix ?? seen.size;
              if (seen.has(index)) throw new Error("重复的生成结果");
              seen.add(index);
              await onImage(bytes, index);
            }
          }
        }
      }
      if (buffer.length) throw new Error("生成事件流提前结束");
      if (!seen.size) throw new Error("没有收到最终图片");
      return seen.size;
    }
    const director = buildDirectorMultipart(body);
    const r = await this.request(
      c,
      "/ai/generate-image",
      director ? undefined : body,
      signal,
      {},
      director,
    );
    onResponse();
    return this.unpack(r, onImage);
  }
  async unpack(r, onImage) {
    const type = r.headers.get("content-type") || "";
    if (type.includes("json")) {
      const j = await r.json();
      if (!Array.isArray(j.images) || !j.images.length)
        throw new Error("接口没有返回图片");
      for (let i = 0; i < j.images.length; i++) {
        const x = j.images[i];
        await onImage(
          imageBytes(typeof x === "string" ? x : x.image),
          i,
          typeof x === "object" ? x.seed : undefined,
        );
      }
      return j.images.length;
    }
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 160 * 1024 * 1024) throw new Error("生成结果过大");
    if (b[0] === 137) {
      await onImage(b, 0);
      return 1;
    }
    const entries = unzipSync(b, {
      filter: (e) =>
        /\.png$/i.test(e.name) && e.originalSize < 64 * 1024 * 1024,
    });
    const imgs = Object.entries(entries).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    if (!imgs.length) throw new Error("压缩包没有 PNG 图片");
    if (imgs.length > 8) throw new Error("返回图片数异常");
    for (let i = 0; i < imgs.length; i++)
      await onImage(Buffer.from(imgs[i][1]), i);
    return imgs.length;
  }
  async augment(c, body, options) {
    const r = await this.request(c, "/ai/augment-image", body, options.signal);
    options.onResponse?.();
    return this.unpack(r, options.onImage);
  }
  async upscale(c, image, options) {
    const r = await this.request(
      c,
      "/ai/upscale",
      { image, model: "nai-diffusion-5-curated", declared_blur_sigma: 0 },
      options.signal,
    );
    options.onResponse?.();
    return this.unpack(r, options.onImage);
  }
}
