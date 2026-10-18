import crypto from "node:crypto";

// NovelAI 的精确参考（director reference）要求把参考图作为独立分块上传，
// JSON 里用 *_cached + cache_secret_key 引用分块名。依据：
//   Aaalice233/Aaalice_NAI_Launcher
//     lib/core/network/browser_multipart_body.dart
//     lib/data/datasources/remote/nai_generation_transport.dart
// 关键格式：Chrome 风格边界（----WebKitFormBoundary + 16 位）、每个分块都带
// filename="blob"、director_ref_0 用 image/png、request 用 application/json。

// 与 launcher 一致：每次启动随机 32 字节，key = HMAC-SHA256(key, base64 字符串)。
const hmacKey = crypto.randomBytes(32);

const boundaryAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function boundary() {
  let suffix = "";
  for (let i = 0; i < 16; i++)
    suffix += boundaryAlphabet[crypto.randomInt(boundaryAlphabet.length)];
  return "----WebKitFormBoundary" + suffix;
}

function cacheKey(base64) {
  return crypto.createHmac("sha256", hmacKey).update(base64, "utf8").digest("hex");
}

/**
 * 把带 director_reference_images 的请求改写成 multipart。
 * 没有精确参考时返回 null，调用方继续走普通 JSON。
 */
export function buildDirectorMultipart(body) {
  const params = body && body.parameters;
  if (!params || !Array.isArray(params.director_reference_images))
    return null;
  const images = params.director_reference_images.filter(
    (v) => typeof v === "string" && v.length > 0,
  );
  if (!images.length) return null;

  const nextParams = { ...params };
  delete nextParams.director_reference_images;

  const parts = [];
  const cached = [];
  images.forEach((base64, index) => {
    const partName = "director_ref_" + index;
    parts.push({
      name: partName,
      bytes: Buffer.from(base64, "base64"),
      filename: "blob",
      contentType: "image/png",
    });
    cached.push({ cache_secret_key: cacheKey(base64), data: partName });
  });
  nextParams.director_reference_images_cached = cached;

  const payload = { ...body, parameters: nextParams };
  parts.push({
    name: "request",
    bytes: Buffer.from(JSON.stringify(payload), "utf8"),
    filename: "blob",
    contentType: "application/json",
  });

  const line = boundary();
  const chunks = [];
  for (const part of parts) {
    let head =
      "--" + line + "\r\n" +
      'Content-Disposition: form-data; name="' + part.name + '"';
    if (part.filename) head += '; filename="' + part.filename + '"';
    head += "\r\n";
    if (part.contentType) head += "Content-Type: " + part.contentType + "\r\n";
    head += "\r\n";
    chunks.push(Buffer.from(head, "utf8"), part.bytes, Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from("--" + line + "--\r\n", "utf8"));

  return {
    body: Buffer.concat(chunks),
    contentType: "multipart/form-data; boundary=" + line,
  };
}
