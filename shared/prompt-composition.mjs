import { appendArtists } from "./artists.mjs";

export function uniqueTemplates(stack) {
  const seen = new Set();
  return stack.filter((item) => {
    if (!item.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// Templates remain outermost; artist position is relative to the subject only.
export function composeTemplates(p) {
  const raw = String(p.prompt || "").trim();
  if (p.preparedPrompt) return { prompt: raw, templateNegative: "" };
  const prompt = appendArtists(raw, p);
  const stack = p.templateEnabled
    ? Array.isArray(p.templates)
      ? p.templates
      : p.template
        ? [{ ...p.template, target: "positive" }]
        : []
    : [];
  const text = (target) =>
    uniqueTemplates(stack)
      .filter((t) => (t.target || "positive") === target)
      .map((t) => String(t.content ?? t.prompt ?? "").trim())
      .filter(Boolean)
      .join(", ");
  const positive = text("positive"),
    base = prompt.replace(/[\s,，]+$/, "");
  return {
    prompt: positive
      ? (p.templatePosition === "start" ? [positive, base] : [base, positive])
          .filter(Boolean)
          .join(", ")
      : prompt,
    templateNegative: text("negative"),
  };
}
