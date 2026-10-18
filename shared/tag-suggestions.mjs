// Normalize inline completion responses; never render unknown objects as tags.
export function normalizeTags(response) {
  const rows = Array.isArray(response) ? response : response?.tags;
  if (!Array.isArray(rows)) throw new Error("接口返回的标签格式无效");
  return [
    ...new Set(
      rows
        .map((row) => (typeof row === "string" ? row : row?.tag || row?.name))
        .filter((tag) => typeof tag === "string" && tag.trim())
        .map((tag) => tag.trim()),
    ),
  ].slice(0, 40);
}
