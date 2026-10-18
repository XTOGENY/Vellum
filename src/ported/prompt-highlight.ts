export type PromptHighlight = { text: string; kind: "plain" | "high" | "low" | "reset"; opacity: number };

/** Display-only emphasis parsing; the original prompt is never rewritten. */
export function highlightPrompt(text: string): PromptHighlight[] {
  const parts: PromptHighlight[] = [];
  let weight = 1;
  const append = (value: string, marker = false) => {
    const neutral = Math.abs(weight - 1) < 1e-9;
    const kind = neutral ? "plain" : weight > 1 ? "high" : "low";
    const opacity = kind === "plain" ? 0
      : .08 + .62 * (1 - Math.exp(-Math.abs(weight - 1) / 3));
    const last = parts[parts.length - 1];
    if (last?.kind === kind && last.opacity === opacity) last.text += value;
    else parts.push({ text: value, kind, opacity });
  };
  const tokens = /\\[\s\S]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)::|::|[{}\[\]]/g;
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    append(text.slice(end, match.index));
    const token = match[0];
    if (token.startsWith("\\")) append(token);
    else {
      if (token === "::") weight = 1;
      else if (token === "{" || token === "]") weight *= 1.05;
      else if (token === "}" || token === "[") weight /= 1.05;
      else {
        const value = Number(token.slice(0, -2));
        weight = Number.isFinite(value) ? value : 1;
      }
      append(token, true);
    }
    end = match.index! + token.length;
  }
  append(text.slice(end));
  return parts.filter(part => part.text.length > 0);
}
