import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { protocolOfConnection } from "../shared/image-protocols.mjs";
import type { Connection } from "./types";
type Snapshot = {
  key: string;
  sub: any;
  at: number;
  error: string;
  busy: boolean;
};
export function useConnectionAccount(
  connection: Connection | undefined,
  refreshKey = "",
) {
  const key = connection
    ? `${connection.id}|${connection.baseUrl}|${connection.official}`
    : "";
  const cache = useRef(new Map<string, { sub: any; at: number }>());
  const request = useRef(0),
    activeKey = useRef(key);
  activeKey.current = key;
  const [snapshot, setSnapshot] = useState<Snapshot>({
    key: "",
    sub: null,
    at: 0,
    error: "",
    busy: false,
  });
  const load = useCallback(
    async (force = false) => {
      if (!connection || !key) return;
      // 只有 NovelAI 有 Anlas 余额这套；OpenAI 与中转没有，别去问（会 404）。
      if (protocolOfConnection(connection).id !== "novelai-native") return;
      const sequence = ++request.current,
        cached = cache.current.get(key);
      setSnapshot({
        key,
        sub: cached?.sub || null,
        at: cached?.at || 0,
        error: "",
        busy: true,
      });
      try {
        const result = await api(
          `/connections/${encodeURIComponent(connection.id)}/subscription${force ? "?refresh=1" : ""}`,
        );
        if (activeKey.current !== key || sequence !== request.current) return;
        const entry = {
          sub: result.subscription,
          at: result.fetchedAt || Date.now(),
        };
        cache.current.set(key, entry);
        setSnapshot({ key, ...entry, error: "", busy: false });
      } catch (error: any) {
        if (activeKey.current !== key || sequence !== request.current) return;
        setSnapshot({
          key,
          sub: cached?.sub || null,
          at: cached?.at || 0,
          error: error.message || "暂时无法读取账户信息",
          busy: false,
        });
      }
    },
    [key, connection],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(true), 300);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [load, refreshKey]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const state =
    snapshot.key === key
      ? snapshot
      : { key, sub: null, at: 0, error: "", busy: !!key };
  return { state, load };
}
