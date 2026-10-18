// A tab session survives refresh, but a new tab starts with the current library excluded.
const KEY = "nwenai-workspace-session";
export function sessionBaseline(storage, dataDir, history, key = KEY) {
  try {
    const saved = JSON.parse(storage.getItem(key) || "null");
    if (
      saved?.dataDir === dataDir &&
      Array.isArray(saved.ids) &&
      saved.ids.every((id) => typeof id === "string")
    )
      return new Set(saved.ids);
  } catch {}
  const ids = history.map((h) => h.id);
  try {
    storage.setItem(key, JSON.stringify({ dataDir, ids }));
  } catch {}
  return new Set(ids);
}
export function sessionWorks(history, baseline) {
  return baseline
    ? history.filter((h) => !h.archivedAt && !baseline.has(h.id))
    : [];
}
