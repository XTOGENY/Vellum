import type { Reference } from "./types";
const keys: Record<string, string> = {
  "nai-diffusion-4-5-full": "v4-5full",
  "nai-diffusion-4-5-curated": "v4-5curated",
  "nai-diffusion-4-full": "v4full",
  "nai-diffusion-4-curated-preview": "v4curated",
};
const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
const paramKey = (info: number, mask?: string) =>
  hash(`information_extracted:${info}${mask ? `,mask:${mask}` : ""}`);
export async function importVibes(
  text: string,
  model: string,
): Promise<Reference[]> {
  if (text.length > 70 * 1024 * 1024) throw new Error("Vibe 文件过大");
  const json = JSON.parse(text);
  const items =
    json.identifier === "novelai-vibe-transfer-bundle" ? json.vibes : [json];
  if (!Array.isArray(items) || !items.length || items.length > 16)
    throw new Error("每次最多导入 16 个 Vibe");
  const refs: Reference[] = [];
  for (const item of items) {
    if (
      item.identifier !== "novelai-vibe-transfer" ||
      item.version !== 1 ||
      !["image", "encoding"].includes(item.type)
    )
      throw new Error("不支持的 Vibe 文件");
    const archive = item.encodings || {},
      bucket = archive[keys[model]],
      info = item.importInfo?.information_extracted ?? 0.7,
      mask = item.importInfo?.mask || "",
      encodingOnly = item.type === "encoding";
    const entry =
      bucket?.[encodingOnly ? "unknown" : await paramKey(info, mask)];
    const first: any = Object.values(archive).flatMap((x: any) =>
      Object.values(x),
    )[0];
    const value = encodingOnly ? first?.encoding : item.image;
    if (typeof value !== "string" || (await hash(value)) !== item.id)
      throw new Error("Vibe 文件校验失败");
    refs.push({
      id: crypto.randomUUID(),
      name: String(item.name || "Vibe"),
      type: "vibe",
      data: encodingOnly ? "" : item.image,
      width: 0,
      height: 0,
      enabled: true,
      strength: item.importInfo?.strength ?? 0.6,
      info,
      fidelity: 1,
      caption: "character",
      encoding: entry?.encoding,
      encodedModel: entry ? model : undefined,
      encodedInfo: entry ? info : undefined,
      encodedMask: entry ? mask : undefined,
      mask,
      archive,
      encodingOnly,
    });
  }
  return refs;
}
export async function exportVibes(
  refs: Reference[],
  model: string,
  only = false,
) {
  if (!keys[model]) throw new Error("当前模型不使用编码 Vibe 文件");
  const vibes = [];
  for (const r of refs) {
    let archive = r.archive || {};
    if (
      r.encoding &&
      r.encodedModel === model &&
      r.encodedInfo === r.info &&
      r.encodedMask === (r.mask || "")
    ) {
      archive = {
        ...archive,
        [keys[model]]: {
          ...archive[keys[model]],
          [r.encodingOnly ? "unknown" : await paramKey(r.info, r.mask)]: {
            encoding: r.encoding,
            params: {
              information_extracted: r.info,
              ...(r.mask ? { mask: r.mask } : {}),
            },
          },
        },
      };
    }
    const encodingOnly = only || r.encodingOnly || !r.data;
    if (encodingOnly) {
      const entry =
        archive[keys[model]]?.[
          r.encodingOnly ? "unknown" : await paramKey(r.info, r.mask)
        ];
      if (!entry) throw new Error("请先完成当前模型的编码");
      archive = { [keys[model]]: { unknown: entry } };
    }
    const value = encodingOnly ? archive[keys[model]].unknown.encoding : r.data;
    vibes.push({
      identifier: "novelai-vibe-transfer",
      version: 1,
      type: encodingOnly ? "encoding" : "image",
      id: await hash(value),
      ...(encodingOnly ? {} : { image: value }),
      encodings: archive,
      name: r.name,
      createdAt: new Date().toISOString(),
      importInfo: {
        model,
        information_extracted: r.info,
        strength: r.strength,
        ...(r.mask ? { mask: r.mask } : {}),
      },
    });
  }
  return JSON.stringify(
    { identifier: "novelai-vibe-transfer-bundle", version: 1, vibes },
    null,
    2,
  );
}
