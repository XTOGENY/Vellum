export type Params = Record<string, any> & {
  model: string;
  prompt: string;
  negative: string;
  characters: Character[];
  references: Reference[];
};
export type Artist = {
  id: string;
  name: string;
  tag: string;
  categories: string[];
  favorite: boolean;
  coverUrl?: string;
  updatedAt?: string;
};
export type ArtistChoice = { id: string; name: string; tag: string; weight: number };
export type ArtistLibraryData = { items: Artist[]; storage: { activeDir: string }; error?: string; added?: number };
export type Character = {
  id: string;
  name: string;
  prompt: string;
  uc: string;
  enabled: boolean;
  x: number;
  y: number;
};
export type Reference = {
  id: string;
  name: string;
  type: "vibe" | "precise";
  data: string;
  width: number;
  height: number;
  enabled: boolean;
  strength: number;
  info: number;
  fidelity: number;
  caption: string;
  encoding?: string;
  encodedModel?: string;
  encodedInfo?: number;
  mask?: string;
  encodedMask?: string;
  archive?: any;
  encodingOnly?: boolean;
};
export type ChatProtocolId =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages"
  | "google-gemini";
// 协议属于用途：一条连接可以同时供图像生成和文字对话，各自带自己的协议与设置。
export type ConnectionUse = "image" | "chat";
export type AssistantSettings = {
  protocol: ChatProtocolId;
  model: string;
  streaming: boolean;
  includeContext: boolean;
  includePrompt: boolean;
  readRecentMetadata: boolean;
  sendImages: boolean;
  // 用户在「通用」里给助手加的默认提示词，接在系统规则后面。
  systemPrompt?: string;
};
export type Connection = {
  id: string;
  name: string;
  baseUrl: string;
  hasKey: boolean;
  official: boolean;
  concurrency: number;
  streaming: boolean;
  uses?: ConnectionUse[];
  // 图像生成的协议；旧数据没有这个字段时按 NovelAI 原生对待。
  protocol?: string;
  // 从服务商接口读到的图像模型清单；为空时用内置清单。
  models?: string[];
  chat?: AssistantSettings;
};
export function usesOf(c: Connection): ConnectionUse[] {
  return c.uses && c.uses.length ? c.uses : ["image"];
}
export function isImageConnection(c: Connection) {
  return usesOf(c).includes("image");
}
export function isChatConnection(c: Connection) {
  return usesOf(c).includes("chat");
}
export type HistoryItem = {
  id: string;
  url: string;
  createdAt: string;
  kind: string;
  model: string;
  prompt: string;
  width: number;
  height: number;
  seed: number | null;
  params?: Params;
  archivedAt?: string;
  favorite?: boolean;
  name?: string;
  connection?: string;
  collections?: string[];
  searchText?: string;
};
export type Collection = {
  id: string;
  name: string;
  createdAt: string;
  count?: number;
};
export type Task = {
  phase?: "preparing" | "requesting" | "receiving" | "generating" | "saving";
  timings?: {
    queueMs?: number;
    prepareMs?: number;
    responseMs?: number;
    firstPreviewMs?: number;
    firstImageMs?: number;
    totalMs?: number;
  };
  id: string;
  status: string;
  kind: string;
  title: string;
  completed: number;
  total: number;
  error?: string;
  results: string[];
  progress: number;
  createdAt: string;
  correlation?: string;
  preview?: { image: string; step: number };
};
export type Template = {
  id: string;
  name: string;
  prompt: string;
  negative: string;
  category?: string;
  favorite?: boolean;
  // 模板是否带负面提示词；关掉时应用模板不会动负面框。
  includeNegative?: boolean;
  updatedAt?: string;
};
