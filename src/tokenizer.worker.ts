import { Tokenizer } from "@huggingface/tokenizers";
import { tokenizerConfig, countableText } from "../shared/tokenizer-config.mjs";
const loaded = new Map<string, Promise<Tokenizer>>();
async function tokenizer(kind: string) {
  if (!loaded.has(kind))
    loaded.set(
      kind,
      (async () => {
        const r = await fetch("/tokenizers/" + kind + ".json");
        if (!r.ok) throw new Error("词表不可用");
        return new Tokenizer(tokenizerConfig(kind, await r.json()), {});
      })().catch((e) => {
        loaded.delete(kind);
        throw e;
      }),
    );
  return loaded.get(kind)!;
}
self.onmessage = async ({ data: { id, model, positive, negative } }) => {
  try {
    const kind = model.includes("-5-")
      ? "qwen"
      : model.includes("-4-")
        ? "t5"
        : "clip";
    const t = await tokenizer(kind);
    const count = (texts: string[]) =>
      texts.reduce(
        (n, s) =>
          n +
          t.encode(countableText(s), { add_special_tokens: false }).ids.length,
        0,
      );
    self.postMessage({
      id,
      positive: count(positive),
      negative: count(negative),
    });
  } catch (e: any) {
    self.postMessage({ id, error: e.message });
  }
};
