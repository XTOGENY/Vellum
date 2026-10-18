const key = (workspace) => `nwenai.pending-draft:${workspace}`;

export function readPendingDraft(storage, workspace) {
  try {
    const value = JSON.parse(storage().getItem(key(workspace)) || "null");
    return value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.model === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
export function cachePendingDraft(storage, workspace, params) {
  try {
    storage().setItem(key(workspace), JSON.stringify(params));
    return true;
  } catch {
    return false;
  }
}
export function clearPendingDraft(storage, workspace, params) {
  try {
    const s = storage();
    if (s.getItem(key(workspace)) === JSON.stringify(params))
      s.removeItem(key(workspace));
  } catch {}
}
