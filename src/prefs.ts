import { useEffect, useState } from "react";
// 通用设置的本地偏好：只存在这台电脑的浏览器里，不进 .local 数据。
export type Prefs = {
  uiScale: number;
  newChatOnLaunch: boolean;
  soundOnDone: boolean;
  notifyOnDone: boolean;
  followOnDone: boolean;
  novelaiTagAutocomplete: boolean;
  novelaiSaveFormat: "png" | "webp";
};

export const DEFAULT_PREFS: Prefs = {
  uiScale: 100,
  // 用户要求：每次打开软件都从新对话开始，旧对话仍留在会话列表里。
  newChatOnLaunch: true,
  soundOnDone: false,
  notifyOnDone: false,
  followOnDone: true,
  novelaiTagAutocomplete: true,
  novelaiSaveFormat: "png",
};

const KEY = "nwenai.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFS, ...parsed,
      novelaiTagAutocomplete: parsed.novelaiTagAutocomplete !== false,
      novelaiSaveFormat: parsed.novelaiSaveFormat === "webp" ? "webp" : "png",
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
    window.dispatchEvent(new Event("vellum-prefs-change"));
    return true;
  } catch { return false; }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    const refresh = () => setPrefs(loadPrefs());
    const storage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) refresh(); };
    window.addEventListener("vellum-prefs-change", refresh);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("vellum-prefs-change", refresh);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return prefs;
}

// 整页缩放：Chromium 支持 zoom，比逐个改字号安全。
export function applyUiScale(scale: number) {
  const value = Math.max(80, Math.min(150, Number(scale) || 100));
  const root = document.documentElement;
  // zoom 会把 100dvh 也一起放大：先让 CSS 用 --ui-scale 把视口高度除回去，
  // 否则 125% 时整页比窗口高，只能滚动整个页面才能看到底部。
  root.style.setProperty("--ui-scale", String(value / 100));
  if (value === 100) root.style.removeProperty("zoom");
  else root.style.zoom = String(value / 100);
}
