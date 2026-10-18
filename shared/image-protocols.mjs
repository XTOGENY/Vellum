// 图像生成的协议表。客户端与服务端共用这一份，避免两边标签和默认地址对不上。
// implemented 表示这一版是否已经接了真正的生图适配器；没接的可以保存连接，
// 但出图前会明确报错，不会悄悄按 NovelAI 的请求发出去。
export const IMAGE_PROTOCOLS = [
  {
    id: "novelai-native",
    label: "NovelAI 原生",
    base: "https://image.novelai.net",
    keyHint: "Persistent API Token",
    endpoint: "POST /ai/generate-image",
    implemented: true,
    docs: "https://docs.novelai.net/en/image/",
  },
  {
    id: "openai-images",
    label: "OpenAI · GPT Image",
    base: "https://api.openai.com",
    keyHint: "API Key（sk-…）",
    endpoint: "POST /v1/images/generations · /v1/images/edits",
    implemented: true,
    // 文生图与图像输入（edits）都接了；放大、导演、Vibe 编码仍是 NovelAI 专有。
    capabilities: ["image.generate", "image.edit"],
    docs: "https://developers.openai.com/api/docs/guides/image-generation",
  },
  {
    id: "gemini-image",
    label: "Google · Nano Banana",
    base: "https://generativelanguage.googleapis.com",
    keyHint: "API Key（AIza…）",
    endpoint: "POST /v1beta/models/{model}:generateContent",
    implemented: true,
    // 吃输入图，但没有蒙版这个概念。
    capabilities: ["image.generate", "image.edit"],
    docs: "https://ai.google.dev/gemini-api/docs/image-generation",
  },
  {
    id: "xai-imagine",
    label: "xAI · Grok Imagine",
    base: "https://api.x.ai",
    keyHint: "API Key（xai-…）",
    endpoint: "POST /v1/images/generations",
    implemented: true,
    capabilities: ["image.generate"],
    docs: "https://docs.x.ai/developers/models",
  },
];
export function imageProtocol(id) {
  const spec = IMAGE_PROTOCOLS.find((p) => p.id === id);
  if (!spec) throw new Error("请选择图像生成协议");
  return spec;
}
// 旧数据没有协议字段，按 NovelAI 原生对待。
export function protocolOfConnection(connection) {
  return imageProtocol(connection?.protocol || "novelai-native");
}
// 出图前统一挡一道：协议没有这项能力就明确报错，不按错的协议发请求。
export function assertImageProtocol(connection, capability = "image.generate") {
  const spec = protocolOfConnection(connection);
  const has = spec.capabilities
    ? spec.capabilities.includes(capability)
    : spec.implemented;
  if (!has)
    throw new Error(
      capability === "image.generate"
        ? `${spec.label} 的连接可以保存，但这一版还没接入它的生图适配器；要出图请改用 NovelAI 原生的连接`
        : `${spec.label} 还没有这项能力的适配器（${capability}），请改用 NovelAI 原生的连接`,
    );
  return spec;
}
