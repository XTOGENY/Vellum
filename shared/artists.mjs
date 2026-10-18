export const ARTIST_FORMATS = ["normal", "nai"];

export function artistSelection(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((item) => {
    const tag = typeof item?.tag === "string" ? item.tag.trim() : "";
    const id = typeof item?.id === "string" ? item.id : tag;
    const weight = Number(item?.weight ?? 1);
    if (
      !tag ||
      !id ||
      seen.has(id) ||
      !Number.isFinite(weight) ||
      weight < 0.1 ||
      weight > 3
    )
      throw new Error("画师串格式无效，权重应在 0.1–3 之间");
    seen.add(id);
    return {
      id,
      name: String(item.name || tag).slice(0, 100),
      tag,
      weight: Math.round(weight * 10) / 10,
    };
  });
}

export function artistPrompt(params) {
  if (params.artistEnabled === false) return "";
  return artistSelection(params.artists)
    .map(({ tag, weight }) => {
      if (weight === 1) return tag;
      return params.artistFormat === "normal"
        ? `(${tag}:${weight.toFixed(1)})`
        : `${weight.toFixed(1)}::${tag}::`;
    })
    .join(", ");
}

// Position relative to the subject; template composition wraps this afterwards.
export function appendArtists(input, params) {
  if (params.preparedPrompt) return input;
  const suffix = artistPrompt(params);
  const base = String(input || "").replace(/^[\s,，]+|[\s,，]+$/g, "");
  return suffix
    ? (params.artistPosition === "start" ? [suffix, base] : [base, suffix])
        .filter(Boolean)
        .join(", ")
    : input;
}
