// Macro expansion ported from the original NovelAI project/client/src/lib/models.ts.
export function expandPromptChunks(text, chunks = [], chain = []) {
  if (chain.length > 32) throw Error("提示词片段嵌套不能超过 32 层");
  const result = String(text || "").replace(
    /!macro:([^!]+)!|⌜macro:([^⌟]+)⌟/g,
    (_, label, id) => {
      const c = chunks.find((c) =>
        id ? c.id === id : c.name === label?.trim(),
      );
      const name = c?.name ?? label ?? id;
      if (!c) throw Error(`找不到提示词片段：${name}`);
      if (chain.includes(name))
        throw Error(`提示词片段循环引用：${[...chain, name].join(" → ")}`);
      return expandPromptChunks(c.text, chunks, [...chain, name]);
    },
  );
  if (result.length > 200000) throw Error("展开后的提示词过长");
  return result;
}
export function resolveRandomizers(text, random = Math.random) {
  return text.replace(/\|\|([\s\S]*?)\|\|/g, (_, choices) => {
    const options = choices.split("|");
    return options[
      Math.min(options.length - 1, Math.floor(random() * options.length))
    ];
  });
}
export function splitCharacterPrompts(text) {
  const randoms = [];
  const hidden = text.replace(
    /\|\|[\s\S]*?\|\|/g,
    (s) => `\u0000${randoms.push(s) - 1}\u0000`,
  );
  return hidden
    .split(/(?<!\\)\|/)
    .map((s) => s.replace(/\u0000(\d+)\u0000/g, (_, n) => randoms[+n]).trim());
}
export function expandedPrompts(p) {
  return {
    ...p,
    prompt: expandPromptChunks(p.prompt, p.promptChunks),
    negative: expandPromptChunks(p.negative, p.promptChunks),
    characters: p.characters.map((c) =>
      c.enabled
        ? {
            ...c,
            prompt: expandPromptChunks(c.prompt, p.promptChunks),
            uc: expandPromptChunks(c.uc, p.promptChunks),
          }
        : c,
    ),
  };
}
export function realizePrompts(p, random = Math.random) {
  const e = expandedPrompts(p),
    reuse =
      !!p.baseImage &&
      p.randomizerSource?.prompt === p.prompt &&
      p.randomizerSource?.negative === p.negative;
  const prompt =
    reuse && typeof p.actualPrompt === "string"
      ? p.actualPrompt
      : resolveRandomizers(e.prompt, random);
  const negative =
    reuse && typeof p.actualNegative === "string"
      ? p.actualNegative
      : resolveRandomizers(e.negative, random);
  return {
    ...e,
    prompt,
    negative,
    characters: e.characters.map((c, i) => {
      const original = p.randomizerSource?.characters?.[i],
        actual = p.actualCharacters?.[i];
      const same =
        reuse &&
        actual &&
        original?.prompt === p.characters[i].prompt &&
        original?.uc === p.characters[i].uc;
      return {
        ...c,
        prompt: same ? actual.prompt : resolveRandomizers(c.prompt, random),
        uc: same ? actual.uc : resolveRandomizers(c.uc, random),
      };
    }),
  };
}
const randomTags = [
  ["1girl", "1boy", "2girls"],
  ["silver hair", "black hair", "brown hair", "blonde hair"],
  ["blue eyes", "green eyes", "brown eyes"],
  ["garden", "cafe", "beach", "forest", "city street"],
  ["morning", "sunset", "night"],
  ["portrait", "full body", "upper body"],
  ["smile", "looking away", "looking at viewer"],
];
export function randomPrompt(random = Math.random) {
  return randomTags
    .map((group) => group[Math.floor(random() * group.length)])
    .join(", ");
}
export function parseMixing(text) {
  return splitCharacterPrompts(text).map((s) => {
    const m = s.match(/^(.*?):\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/s);
    return { text: m ? m[1].trim() : s, weight: m ? +m[2] : 1 };
  });
}
