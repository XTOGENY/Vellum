// 文字对话协议。客户端和服务端共用这一份，避免两边标签对不上。
// 协议属于用途：这份只管文字对话，图像生成的协议在 provider.mjs。
export const CHAT_PROTOCOLS = [
  { id: "openai-chat", label: "OpenAI Chat Completions", path: "/v1/chat/completions" },
  { id: "openai-responses", label: "OpenAI Responses", path: "/v1/responses" },
  { id: "anthropic-messages", label: "Anthropic Messages", path: "/v1/messages" },
  { id: "google-gemini", label: "Google Gemini", path: "/v1beta/models/{model}:generateContent" },
];
export function chatProtocol(id) {
  const p = CHAT_PROTOCOLS.find((p) => p.id === id);
  if (!p) throw new Error("请选择文字对话协议");
  return p;
}
