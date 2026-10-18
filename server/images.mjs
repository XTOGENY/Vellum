import sharp from "sharp";
import { apiInpaintMask, inpaintBlendAlpha } from "./inpaint-mask.mjs";
import { inflateSync, gunzipSync } from "node:zlib";
const MAX_METADATA = 16 * 1024 * 1024;
function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) {
    n ^= b;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}

export function imageBytes(data) {
  if (typeof data !== "string" || data.length > 48 * 1024 * 1024)
    throw new Error("图片过大或格式错误");
  const str = data.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str) || !str.length)
    throw new Error("无效的图片编码");
  return Buffer.from(str, "base64");
}
export const picture = (b) =>
  sharp(b, { limitInputPixels: 32 * 1024 * 1024, failOn: "error" });
export async function normalizeImage(data, width, height) {
  let input = picture(imageBytes(data)).rotate();
  if (width && height) input = input.resize(width, height, { fit: "fill" });
  const { data: png, info } = await input
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    data: png.toString("base64"),
    width: info.width,
    height: info.height,
  };
}
export async function prepareReferences(params) {
  const p = structuredClone(params);
  if (p.baseImage)
    p.baseImage = {
      ...p.baseImage,
      ...(await normalizeImage(
        p.baseImage.data,
        ...(p.enhance ? [] : [p.width, p.height]),
      )),
    };
  if (p.mask)
    p.mask = await apiInpaintMask(imageBytes(p.mask), p.width, p.height);
  for (const r of p.references.filter(
    (r) => r.enabled && r.type === "precise",
  )) {
    const b = imageBytes(r.data),
      meta = await picture(b).metadata();
    const ratio = meta.width / meta.height;
    const [w, h] =
      ratio > 1.2 ? [1536, 1024] : ratio < 0.83 ? [1024, 1536] : [1472, 1472];
    r.data = (
      await picture(b)
        .resize(w, h, { fit: "contain", background: "#000" })
        .flatten({ background: "#000" })
        .png()
        .toBuffer()
    ).toString("base64");
  }
  return p;
}
function itxt(key, text) {
  const data = Buffer.concat([
      Buffer.from(key + "\0\0\0\0\0"),
      Buffer.from(text),
    ]),
    type = Buffer.from("iTXt"),
    chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([type, data])) >>> 0,
    chunk.length - 4,
  );
  return chunk;
}
export function addMetadata(png, fields) {
  if (
    png.length < 33 ||
    !png
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.readUInt32BE(12) !== 0x49484452
  )
    throw new Error("结果格式不是 PNG");
  const chunks = [];
  for (let pos = 33; pos + 12 <= png.length;) {
    const n = png.readUInt32BE(pos),
      type = png.toString("ascii", pos + 4, pos + 8);
    if (n > png.length - pos - 12) throw new Error("PNG 元数据已损坏");
    const data = png.subarray(pos + 8, pos + 8 + n),
      end = data.indexOf(0);
    if (!(
      ["tEXt", "iTXt", "zTXt"].includes(type) &&
      end > 0 &&
      Object.hasOwn(fields, data.toString("latin1", 0, end))
    ))
      chunks.push(png.subarray(pos, pos + n + 12));
    pos += n + 12;
  }
  return Buffer.concat([
    png.subarray(0, 33),
    ...Object.entries(fields).map(([k, v]) =>
      itxt(k, typeof v === "string" ? v : JSON.stringify(v)),
    ),
    ...chunks,
  ]);
}
export async function encodeSavedImage(clean, fields, format = "png") {
  if (format !== "webp") return addMetadata(clean, fields);
  const serialized = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
  const payload = Buffer.from(JSON.stringify(serialized)).toString("base64");
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:vellum="https://github.com/XTOGENY/Vellum/metadata/1/" vellum:fields="${payload}" /></rdf:RDF></x:xmpmeta>`;
  return picture(clean).webp({ lossless: true }).withXmp(xmp).toBuffer();
}

export async function readMetadata(data) {
  const b = imageBytes(data),
    meta = await picture(b).metadata(),
    fields = {};
  if (meta.format === "webp" && meta.xmp && meta.xmp.length <= MAX_METADATA) {
    const encoded = meta.xmp.toString("utf8").match(/vellum:fields="([A-Za-z0-9+/=]+)"/)?.[1];
    if (encoded) {
      try {
        const saved = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        if (saved && typeof saved === "object" && !Array.isArray(saved)) {
          for (const key of ["Vellum", "NWENAI", "Comment", "Description", "Software", "Source"]) {
            if (typeof saved[key] === "string") fields[key] = saved[key];
          }
        }
      } catch {}
    }
  }
  if (meta.format === "png") {
    let pos = 8;
    while (pos + 12 <= b.length) {
      const n = b.readUInt32BE(pos),
        type = b.toString("ascii", pos + 4, pos + 8);
      if (n > b.length - pos - 12) throw new Error("PNG 元数据已损坏");
      const d = b.subarray(pos + 8, pos + 8 + n),
        z = d.indexOf(0);
      if (n < MAX_METADATA && z > 0)
        try {
          const key = d.toString("latin1", 0, z);
          if (type === "tEXt") fields[key] = d.subarray(z + 1).toString("utf8");
          if (type === "zTXt" && d[z + 1] === 0)
            fields[key] = inflateSync(d.subarray(z + 2), {
              maxOutputLength: MAX_METADATA,
            }).toString("utf8");
          if (type === "iTXt") {
            const lang = d.indexOf(0, z + 3),
              end = d.indexOf(0, lang + 1);
            if (lang >= 0 && end >= 0)
              fields[key] = (
                d[z + 1] === 1
                  ? inflateSync(d.subarray(end + 1), {
                      maxOutputLength: MAX_METADATA,
                    })
                  : d.subarray(end + 1)
              ).toString("utf8");
          }
        } catch {}
      pos += n + 12;
    }
  }
  if (!fields.Comment && !fields.NWENAI && !fields.Vellum && meta.hasAlpha) {
    const { data: rgba, info } = await picture(b)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let bit = 0;
    const read = () => {
      let x = 0;
      for (let i = 0; i < 8; i++, bit++)
        x =
          x * 2 +
          (rgba[
            4 *
              ((bit % info.height) * info.width +
                Math.floor(bit / info.height)) +
              3
          ] &
            1);
      return x;
    };
    try {
      let magic = "";
      for (let i = 0; i < 15; i++) magic += String.fromCharCode(read());
      if (magic === "stealth_pngcomp") {
        const bits = read() * 16777216 + read() * 65536 + read() * 256 + read();
        if (
          bits > 0 &&
          bits % 8 === 0 &&
          bits <= info.width * info.height - bit &&
          bits < 16 * 1024 * 1024
        ) {
          const hidden = JSON.parse(
            gunzipSync(Buffer.from(Array.from({ length: bits / 8 }, read)), {
              maxOutputLength: MAX_METADATA,
            }).toString("utf8"),
          );
          Object.assign(fields, hidden);
        }
      }
    } catch {}
  }
  return {
    fields,
    width: meta.width,
    height: meta.height,
    format: meta.format,
    bytes: b.length,
  };
}
export async function compositeMask(output, p) {
  if (!p.mask || !p.baseImage) return picture(output).png().toBuffer();
  return blendRegion(
    output,
    p,
    await inpaintBlendAlpha(imageBytes(p.mask), p.width, p.height),
    { left: 0, top: 0, width: p.width, height: p.height },
  );
}
async function blendRegion(output, p, alpha, region) {
  const { left, top, width, height } = region;
  const [base, generated] = await Promise.all([
    picture(imageBytes(p.baseImage.data))
      .resize(p.width, p.height)
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer(),
    picture(output)
      .resize(width, height)
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer(),
  ]);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x,
        a = (alpha[pixel] / 255) * (generated[pixel * 4 + 3] / 255);
      if (!a) continue;
      const src = pixel * 4,
        dst = ((top + y) * p.width + left + x) * 4;
      const ba = base[dst + 3] / 255,
        outAlpha = a + ba * (1 - a);
      for (let c = 0; c < 3; c++)
        base[dst + c] = outAlpha
          ? Math.round(
              (generated[src + c] * a + base[dst + c] * ba * (1 - a)) /
                outAlpha,
            )
          : 0;
      base[dst + 3] = Math.round(outAlpha * 255);
    }
  return sharp(base, { raw: { width: p.width, height: p.height, channels: 4 } })
    .png()
    .toBuffer();
}
export async function prepareDirector(
  { type, image, defry = 0, emotion = "neutral", prompt = "" },
  tools,
  emotions,
) {
  if (!tools.some(([id]) => id === type) || !emotions.includes(emotion))
    throw new Error("无效的导演工具或表情");
  if (
    !Number.isInteger(defry) ||
    defry < 0 ||
    defry > 5 ||
    typeof prompt !== "string" ||
    prompt.length > 50000
  )
    throw new Error("导演参数无效");
  const b = imageBytes(image),
    m = await picture(b).metadata();
  const scale = Math.sqrt(
    Math.min(3143728, Math.max(1048576, m.width * m.height)) /
      (m.width * m.height),
  );
  const width = Math.floor(m.width * scale),
    height = Math.floor(m.height * scale);
  return {
    req_type: type,
    image: (await picture(b).resize(width, height).png().toBuffer()).toString(
      "base64",
    ),
    width,
    height,
    ...(["colorize", "emotion"].includes(type)
      ? { defry, prompt: type === "emotion" ? `${emotion};;${prompt}` : prompt }
      : {}),
  };
}

export async function prepareFocus(p) {
  if (!p.focus) return { params: p, restore: async (b) => compositeMask(b, p) };
  if (!p.baseImage || !p.mask) throw new Error("聚焦重绘需要底图和蒙版");
  let f = p.focus;
  for (const k of ["x", "y", "width", "height", "context"])
    if (typeof f[k] !== "number" || !Number.isFinite(f[k]))
      throw new Error("聚焦选区格式错误");
  if (f.units === "px") {
    const left = Math.max(0, Math.floor(f.x)),
      top = Math.max(0, Math.floor(f.y));
    f = {
      ...f,
      x: left,
      y: top,
      width: Math.min(p.width, Math.ceil(f.x + f.width)) - left,
      height: Math.min(p.height, Math.ceil(f.y + f.height)) - top,
      context: 0,
    };
  }
  if (
    f.x < 0 ||
    f.y < 0 ||
    f.width < 16 ||
    f.height < 16 ||
    f.x + f.width > p.width ||
    f.y + f.height > p.height ||
    f.context < 0 ||
    f.context > 1
  )
    throw new Error("聚焦选区超出画布或小于 16px");
  const padding = Math.round(Math.max(f.width, f.height) * f.context),
    left = Math.max(0, Math.floor(f.x - padding)),
    top = Math.max(0, Math.floor(f.y - padding)),
    width = Math.min(p.width - left, Math.ceil(f.width + 2 * padding)),
    height = Math.min(p.height - top, Math.ceil(f.height + 2 * padding));
  const ratio = Math.sqrt(1048576 / (width * height)),
    rw = Math.max(64, Math.floor((width * ratio) / 64) * 64),
    rh = Math.max(64, Math.floor((height * ratio) / 64) * 64),
    bounds = { left, top, width, height };
  const crop = async (b, mask = false) =>
    (
      await picture(
        await picture(imageBytes(b))
          .resize(p.width, p.height, { kernel: mask ? "nearest" : "lanczos3" })
          .png()
          .toBuffer(),
      )
        .extract(bounds)
        .resize(rw, rh, { kernel: mask ? "nearest" : "lanczos3" })
        .png()
        .toBuffer()
    ).toString("base64");
  const params = {
    ...p,
    width: rw,
    height: rh,
    focus: null,
    characters: (p.characters || []).map((c) => ({
      ...c,
      x: Math.min(1, Math.max(0, (c.x * p.width - left) / width)),
      y: Math.min(1, Math.max(0, (c.y * p.height - top) / height)),
    })),
    baseImage: { ...p.baseImage, data: await crop(p.baseImage.data) },
    mask: await apiInpaintMask(imageBytes(await crop(p.mask, true)), rw, rh),
  };
  const alpha = await inpaintBlendAlpha(imageBytes(params.mask), rw, rh),
    restoredAlpha = await sharp(alpha, {
      raw: { width: rw, height: rh, channels: 1 },
    })
      .resize(width, height)
      .greyscale()
      .raw()
      .toBuffer();
  return {
    params,
    restore: async (b) => {
      return blendRegion(b, p, restoredAlpha, bounds);
    },
  };
}
