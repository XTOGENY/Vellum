// 助手的系统提示与工作台上下文。服务端生成，客户端只负责收集现状。
export const ASSISTANT_RULES = [
  "你是 Vellum里的创作助手，用户在本机用 NovelAI 画图。",
  "用中文回答，直接、简短，不要客套话。",
  "只依据下面给出的工作台上下文回答；上下文里没有的信息就说不知道，不要编造模型能力、参数或价格。",
  "不要声称你已经生成或修改了图片。你只给建议，生成由用户在工作台里单独提交。",
  "需要给出一条可直接使用的提示词时，用 ```prompt 代码块包住，块里只放提示词本身。",
  "需要说明改动了哪些地方时，用 ```changes 代码块，每行写「名称 | 值」，最多六行。",
].join("\n");

function line(label, value) {
  const text = String(value ?? "").trim();
  return text ? `${label}：${text}` : "";
}
// 只写工作台真实持有的值；缺的就不写，不留"未知"占位。
export function contextText(ctx = {}, { includePrompt = false, readRecentMetadata = false } = {}) {
  const rows = [];
  if (ctx.modelLabel) rows.push(line("当前模型", ctx.modelLabel));
  if (ctx.connectionName) rows.push(line("当前连接", ctx.connectionName));
  if (Number(ctx.width) && Number(ctx.height))
    rows.push(line("尺寸", `${ctx.width} × ${ctx.height}`));
  rows.push(line("步骤", ctx.steps));
  rows.push(line("提示词引导", ctx.scale));
  rows.push(line("采样器", ctx.sampler));
  // 只有工作台真的带了这个字段才写；空上下文不留"随机"这种假信息。
  if ("seed" in ctx) rows.push(line("种子", ctx.seed === null ? "随机" : ctx.seed));
  if (includePrompt) {
    rows.push(line("当前正面提示词", ctx.prompt));
    rows.push(line("当前负面提示词", ctx.negative));
  }
  const characters = (ctx.characters || []).filter((c) => c && c.prompt);
  if (characters.length)
    rows.push(
      "角色：\n" +
        characters
          .map(
            (c, i) =>
              `  ${i + 1}. ${c.name || "未命名"}：${c.prompt}${c.uc ? `（负面：${c.uc}）` : ""}`,
          )
          .join("\n"),
    );
  const references = ctx.references || [];
  if (references.length)
    rows.push(
      line(
        "参考图",
        `${references.length} 张（${[...new Set(references.map((r) => r.type))].join(" / ")}）`,
      ),
    );
  if (ctx.attachment)
    rows.push(
      "讨论附件：\n" +
        [
          line("  名称", ctx.attachment.label),
          Number(ctx.attachment.width) && Number(ctx.attachment.height)
            ? line("  尺寸", `${ctx.attachment.width} × ${ctx.attachment.height}`)
            : "",
          line("  模型", ctx.attachment.model),
          ctx.attachment.seed === null || ctx.attachment.seed === undefined
            ? ""
            : line("  种子", ctx.attachment.seed),
          includePrompt ? line("  生成提示词", ctx.attachment.prompt) : "",
        ]
          .filter(Boolean)
          .join("\n"),
    );
  if (readRecentMetadata && (ctx.recentWorks || []).length)
    rows.push(
      "最近作品：\n" +
        ctx.recentWorks
          .slice(0, 5)
          .map((w) => `  ${w.name || "未命名"}｜${w.model || "未知模型"}｜种子 ${w.seed ?? "—"}`)
          .join("\n"),
    );
  return rows.filter(Boolean).join("\n");
}
export function systemPrompt(ctx, flags) {
  const text = contextText(ctx, flags);
  return text
    ? `${ASSISTANT_RULES}\n\n工作台上下文：\n${text}`
    : `${ASSISTANT_RULES}\n\n本次没有附带工作台上下文。`;
}
