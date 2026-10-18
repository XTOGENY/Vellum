import { useEffect, useState } from "react";
import { api } from "./api";

type Quote = { anlas: number | null; kind: string; reason: string };
export function useImageActionQuote(
  payload: Record<string, unknown> | null,
  accountUpdatedAt: number,
) {
  const key = payload ? JSON.stringify(payload) : "";
  const [result, setResult] = useState<{ key: string; quote: Quote } | null>(
    null,
  );
  useEffect(() => {
    if (!key) return;
    let live = true;
    const timer = setTimeout(() => {
      void api<Quote>("/image-actions/quote", JSON.parse(key))
        .then((quote) => {
          if (live) setResult({ key, quote });
        })
        .catch(() => {
          if (live)
            setResult({
              key,
              quote: { anlas: null, kind: "unknown", reason: "费用暂无法估算" },
            });
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, accountUpdatedAt]);
  return result?.key === key
    ? result.quote
    : { anlas: null, kind: "unknown", reason: key ? "正在估算费用…" : "" };
}
