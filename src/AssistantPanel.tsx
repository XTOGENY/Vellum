import { useEffect, useMemo, useRef, useState } from "react";
import { loadPrefs } from "./prefs";
import { api, download } from "./api";
import { Button, Icon, Select } from "./ui";
import type { Connection, Params } from "./types";

export type AssistantArt = {
  id: string;
  url: string;
  label: string;
  // 本地上传的图带 data（base64 data URL），直接随请求发；工作台里的图用 id。
  data?: string;
  // 标记这一张是不是从工作台当前图像同步进来的（只用于本地判断，不发给服务端）。
  fromCanvas?: boolean;
  width?: number;
  height?: number;
  model?: string;
  seed?: number | null;
  prompt?: string;
};
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachment?: AssistantArt;
  // 一条消息可以带多张图；attachment 是早期单张的字段，读旧会话时还要认。
  attachments?: AssistantArt[];
  pending?: boolean;
  error?: string;
};
type StoredMessage = Omit<Message, "pending">;
type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  messages: StoredMessage[];
};
type Block =
  | { kind: "prompt"; code: string }
  | { kind: "changes"; rows: { label: string; value: string }[] };

const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
// 提示词与建议修改用固定代码块表达，块外文字照常显示。
export function parseBlocks(text: string) {
  const blocks: Block[] = [];
  const prose = text
    .replace(/\`\`\`(prompt|changes)\r?\n([\s\S]*?)\`\`\`/g, (_all, kind, body) => {
      const inner = String(body).trim();
      if (kind === "prompt") blocks.push({ kind: "prompt", code: inner });
      else
        blocks.push({
          kind: "changes",
          rows: inner
            .split("\n")
            .map((row) => row.split("|"))
            .filter((parts) => parts.length >= 2)
            .map((parts) => ({
              label: parts[0].trim(),
              value: parts.slice(1).join("|").trim(),
            })),
        });
      return "";
    })
    .trim();
  return { prose, blocks };
}

export function AssistantPanel({
  connections,
  connectionId,
  onConnectionChange,
  attachment,
  params,
  modelLabel,
  imageConnectionName,
  onAdoptPrompt,
  onEditPrompt,
  onError,
}: {
  connections: Connection[];
  connectionId: string;
  onConnectionChange: (id: string) => void;
  attachment: AssistantArt | null;
  params: Params;
  modelLabel: string;
  imageConnectionName: string;
  onAdoptPrompt: (text: string) => void;
  onEditPrompt: () => void;
  onError: (message: string) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [activeId, setActiveId] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sessionsOpen, setSessionsOpen] = useState(false),
    [models, setModels] = useState<string[]>([]),
    // 会话自己记的模型；没记就用连接里的默认值。分开存，避免异步加载把选择清掉。
    [sessionModel, setSessionModel] = useState(""),
    [expanded, setExpanded] = useState<string[]>([]),
    [arts, setArts] = useState<AssistantArt[]>([]),
    [dragging, setDragging] = useState(false),
    [editingId, setEditingId] = useState(""),
    [editText, setEditText] = useState(""),
    [copiedId, setCopiedId] = useState(""),
    [sessionSearch, setSessionSearch] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null),
    dragArt = useRef<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null),
    scrollRef = useRef<HTMLDivElement>(null);
  const connection = connections.find((c) => c.id === connectionId);
  // 附件就是一个有序列表。工作台当前图像不再自动塞进来，要的话点一下加。
  const shown: AssistantArt[] = arts;
  const canvasAttached = !!attachment && arts.some((x) => x.id === attachment.id);
  function addCanvasArt() {
    if (!attachment || canvasAttached) return;
    setArts((old) => [{ ...attachment, fromCanvas: true }, ...old]);
  }
  function moveArt(from: string, to: string) {
    if (!from || from === to) return;
    setArts((list) => {
      const a = list.findIndex((x) => x.id === from),
        b = list.findIndex((x) => x.id === to);
      if (a < 0 || b < 0) return list;
      const next = [...list],
        [moved] = next.splice(a, 1);
      next.splice(b, 0, moved);
      return next;
    });
  }
  // 输入框跟着内容长，长到上限就停。
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }, [draft]);
  const fallbackModel = connection?.chat?.model || "";
  const model = sessionModel || fallbackModel;
  const active = conversations.find((c) => c.id === activeId);
  const sessionKeyword = sessionSearch.trim().toLowerCase();
  const filteredConversations = conversations.filter(
    (c) =>
      !sessionKeyword ||
      c.title.toLowerCase().includes(sessionKeyword) ||
      (c.messages || []).some((m) =>
        String(m.content || "")
          .toLowerCase()
          .includes(sessionKeyword),
      ),
  );

  useEffect(() => {
    let alive = true;
    api<{ conversations: Conversation[] }>("/assistant/conversations")
      .then((r) => {
        if (!alive) return;
        setConversations(r.conversations);
        // 打开软件时默认开新对话；旧对话仍在「新对话」旁边的会话列表里。
        if (loadPrefs().newChatOnLaunch) return;
        const first = r.conversations[0];
        if (first) {
          setActiveId(first.id);
          setMessages(first.messages || []);
          setSessionModel(first.model || "");
        }
      })
      .catch((e: any) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  // 面板里就能换模型：读当前连接提供的列表，不必再去设置页。
  useEffect(() => {
    if (!connectionId) {
      setModels([]);
      return;
    }
    let alive = true;
    api<{ models: { id: string }[] }>(
      "/assistant-connections/" + connectionId + "/models",
    )
      .then((r) => alive && setModels(r.models.map((m) => m.id)))
      .catch(() => alive && setModels([]));
    return () => {
      alive = false;
    };
  }, [connectionId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const options = useMemo(() => {
    const list = [model, fallbackModel, ...models].filter(Boolean);
    return [...new Set(list)];
  }, [model, fallbackModel, models]);
  // 模型按提供商（id 里 / 前面那段）分组。
  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const id of options) {
      const at = id.indexOf("/"),
        provider = at > 0 ? id.slice(0, at) : "其他";
      if (!map.has(provider)) map.set(provider, []);
      map.get(provider)!.push(id);
    }
    return [...map.entries()];
  }, [options]);

  const context = useMemo(
    () => ({
      modelLabel,
      connectionName: imageConnectionName,
      width: params.width,
      height: params.height,
      steps: params.steps,
      scale: params.scale,
      sampler: params.sampler,
      seed: params.seed,
      prompt: params.prompt,
      negative: params.negative,
      characters: (params.characters || []).map((c) => ({
        name: c.name,
        prompt: c.prompt,
        uc: c.uc,
      })),
      references: (params.references || []).map((r) => ({ type: r.type })),
      attachment: shown.length
        ? {
            label: shown[0].label,
            width: shown[0].width,
            height: shown[0].height,
            model: shown[0].model,
            seed: shown[0].seed,
            prompt: shown[0].prompt,
            count: shown.length,
          }
        : null,
    }),
    [params, modelLabel, imageConnectionName, shown],
  );

  async function attachFiles(files: FileList | File[] | null) {
    const picked = Array.from(files || []);
    if (!picked.length) return;
    const room = 6 - shown.length;
    if (room <= 0) {
      setError("一条消息最多带 6 张图");
      return;
    }
    const list = picked.slice(0, room);
    try {
      const added: AssistantArt[] = [];
      for (const file of list) {
        if (!file.type.startsWith("image/")) throw new Error("只能附加图片");
        if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超过 8 MB`);
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(`读不出 ${file.name}`));
          reader.readAsDataURL(file);
        });
        const size = await new Promise<{ width: number; height: number }>(
          (resolve) => {
            const img = new Image();
            img.onload = () =>
              resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => resolve({ width: 0, height: 0 });
            img.src = url;
          },
        );
        added.push({ id: uid(), url, label: file.name, data: url, ...size });
      }
      setArts((old) => [...old, ...added]);
      setError(picked.length > room ? `最多 6 张，只加了前 ${room} 张` : "");
    } catch (e: any) {
      setError(e.message);
    }
  }
  function removeArt(item: AssistantArt) {
    setArts((old) => old.filter((x) => x.id !== item.id));
  }
  async function persist(final: Message[], conversationId: string) {
    const clean = (list: Message[]): StoredMessage[] =>
      list
        .filter((m) => m.content.trim())
        .map(({ pending, error, ...rest }) => rest);
    const known = conversations.find((c) => c.id === conversationId);
    const id = conversationId || uid(),
      first = final.find((m) => m.role === "user")?.content || "新会话";
    try {
      const r = await api<{ conversation: Conversation }>(
        "/assistant/conversations",
        {
          conversation: {
            id,
            title:
              known?.title && known.title !== "新会话"
                ? known.title
                : first.replace(/\s+/g, " ").slice(0, 24),
            createdAt: known?.createdAt || new Date().toISOString(),
            model,
            messages: clean(final),
          },
        },
        "PUT",
      );
      setActiveId(id);
      setConversations((old) => [
        r.conversation,
        ...old.filter((c) => c.id !== r.conversation.id),
      ]);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function ensureReady() {
    if (!connectionId) {
      setError("请先在「设置 → 助手连接」里添加一条连接");
      return false;
    }
    if (!model) {
      setError("请先选择模型");
      return false;
    }
    return true;
  }
  const requestAttachments = (list: AssistantArt[]) =>
    list.map((item) => (item.data ? { data: item.data } : { id: item.id }));

  async function runReply(base: Message[], attachments: AssistantArt[]) {
    if (busy || !ensureReady()) return;
    const replyId = uid();
    setEditingId("");
    setMessages([
      ...base,
      {
        id: replyId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        pending: true,
      },
    ]);
    setError("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-NWENAI-Request": "1" },
        body: JSON.stringify({
          connectionId,
          model,
          attachments: requestAttachments(attachments),
          messages: base.map((m) => ({ role: m.role, content: m.content })),
          context,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body)
        throw new Error(
          (await res.json().catch(() => ({}))).error || `请求失败 ${res.status}`,
        );
      const reader = res.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          if (!data) continue;
          const event = JSON.parse(data);
          if (event.error) throw new Error(event.error);
          if (event.delta) {
            acc += event.delta;
            const streamed = acc;
            setMessages((old) =>
              old.map((m) =>
                m.id === replyId ? { ...m, content: streamed, pending: true } : m,
              ),
            );
          }
        }
      }
      const finished: Message[] = [
        ...base,
        {
          id: replyId,
          role: "assistant",
          content: acc,
          createdAt: new Date().toISOString(),
        },
      ];
      setMessages(finished);
      await persist(finished, activeId);
    } catch (e: any) {
      const stopped = controller.signal.aborted;
      // 报错只留在聊天里那一条，输入框上方不再重复。
      setMessages((old) =>
        old.map((m) =>
          m.id === replyId
            ? {
                ...m,
                pending: false,
                content: m.content || (stopped ? "（已停止）" : ""),
                ...(stopped ? {} : { error: e.message }),
              }
            : m,
        ),
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy || !ensureReady()) return;
    const user: Message = {
      id: uid(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      ...(shown.length ? { attachments: shown } : {}),
    };
    setDraft("");
    await runReply([...messages, user], shown);
  }

  async function regenerate(messageId: string) {
    if (busy) return;
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0 || messages[index].role !== "assistant") return;
    let base = messages.slice(0, index);
    while (base.length && base[base.length - 1].role !== "user")
      base = base.slice(0, -1);
    if (!base.length) return;
    const last = base[base.length - 1];
    await runReply(
      base,
      last.attachments || (last.attachment ? [last.attachment] : []),
    );
  }

  async function deleteMessage(messageId: string) {
    if (busy) return;
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;
    if (!window.confirm("删除这条消息？删除后无法恢复。")) return;
    const next = messages.filter((m) => m.id !== messageId);
    setMessages(next);
    if (activeId) await persist(next, activeId);
  }

  function startEdit(message: Message) {
    setEditingId(message.id);
    setEditText(message.content);
  }
  async function saveEdit(resend: boolean) {
    const text = editText.trim();
    if (!text || busy) return;
    const index = messages.findIndex((m) => m.id === editingId);
    if (index < 0) return;
    const next = messages.map((m) =>
      m.id === editingId ? { ...m, content: text } : m,
    );
    setEditingId("");
    setEditText("");
    if (resend) {
      const upTo = next.slice(0, index + 1);
      const last = upTo[upTo.length - 1];
      await runReply(
        upTo,
        last.attachments || (last.attachment ? [last.attachment] : []),
      );
    } else {
      setMessages(next);
      if (activeId) await persist(next, activeId);
    }
  }
  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(""), 1200);
    } catch {
      setError("无法复制，请手动选中文字。");
    }
  }
  function exportConversation() {
    const title =
      active?.title ||
      messages.find((m) => m.role === "user")?.content.slice(0, 24) ||
      "未命名对话";
    const body = messages
      .map((m) => {
        const who = m.role === "user" ? "你" : "创作助手";
        const time = new Date(m.createdAt).toLocaleString("zh-CN");
        return `## ${who} · ${time}\n\n${m.content}\n`;
      })
      .join("\n");
    download(
      `${title.replace(/[\\/:*?"<>|]/g, "_")}.md`,
      `# ${title}\n\n${body}`,
      "text/markdown",
    );
  }

  function newSession() {
    setActiveId("");
    setMessages([]);
    setDraft("");
    setError("");
    setSessionsOpen(false);
  }
  function openSession(c: Conversation) {
    setActiveId(c.id);
    setMessages(c.messages || []);
    setSessionModel(c.model || "");
    setError("");
    setSessionsOpen(false);
  }

  return (
    <>
      <aside
        className={`card work-assistant${dragging ? " dragover" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          // 只在真的离开面板时才取消高亮，避免掠过子元素时闪。
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files?.length) return;
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          void attachFiles(e.dataTransfer.files);
        }}
      >
      <div className="card-head">
        <span className="dot-avatar">✧</span>
        <h2>创作助手</h2>
        <span className="grow" />
        <button
          type="button"
          className="btn small ghost"
          title="新对话"
          onClick={newSession}
        >
          <Icon name="plus" />
          新对话
        </button>
        <button
          type="button"
          className="btn small ghost"
          title="会话历史"
          aria-expanded={sessionsOpen}
          onClick={() => setSessionsOpen((old) => !old)}
        >
          <Icon name="history" />
          {conversations.length > 0 && (
            <span className="count">{conversations.length}</span>
          )}
        </button>
      </div>
      <div className="work-chat" ref={scrollRef}>
        {!messages.length && (
          <div className="chat-empty">
            <span className="dot-avatar">✧</span>
            <b>把想法说给助手</b>
            <p>
              它按当前模型、尺寸和提示词给建议。采用后仍由你在工作台里单独提交生成。
            </p>
          </div>
        )}
        {messages.map((m) => {
          const { prose, blocks } =
            m.role === "assistant"
              ? parseBlocks(m.content)
              : { prose: m.content, blocks: [] as Block[] };
          const open = expanded.includes(m.id);
          return (
            <div className="message" key={m.id}>
              <div className="message-role">
                {m.role === "user" ? (
                  <>
                    <span className="dot-avatar me">你</span>
                    <b>你</b>
                    <small>{clock(m.createdAt)}</small>
                  </>
                ) : (
                  <>
                    <span className="dot-avatar">n</span>
                    <b>创作助手</b>
                    <small>{clock(m.createdAt)}</small>
                  </>
                )}
              </div>
              {!!(m.attachments?.length || m.attachment) && (
                <div className="message-attachments">
                  {(m.attachments || (m.attachment ? [m.attachment] : [])).map(
                    (item) => (
                      <figure className="message-attachment" key={item.id}>
                        <img src={item.url} alt={item.label} />
                        <figcaption>{item.label}</figcaption>
                      </figure>
                    ),
                  )}
                </div>
              )}
              {m.role === "user" ? (
                editingId === m.id ? (
                  <div className="message-edit">
                    <textarea
                      autoFocus
                      aria-label="编辑这条消息"
                      value={editText}
                      rows={3}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setEditingId("");
                          setEditText("");
                        }
                      }}
                    />
                    <div className="message-edit-actions">
                      <Button
                        small
                        onClick={() => {
                          setEditingId("");
                          setEditText("");
                        }}
                      >
                        取消
                      </Button>
                      <Button
                        small
                        disabled={!editText.trim() || busy}
                        onClick={() => void saveEdit(false)}
                      >
                        保存
                      </Button>
                      <Button
                        small
                        primary
                        disabled={!editText.trim() || busy}
                        onClick={() => void saveEdit(true)}
                      >
                        保存并重发
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="message-user">{prose}</div>
                )
              ) : (
                <>
                  {prose && (
                    <p className="message-assistant">
                      {prose}
                      {m.pending && <span className="stream-caret" />}
                    </p>
                  )}
                  {!prose && m.pending && (
                    <p className="message-assistant thinking">
                      正在回答<span className="stream-caret" />
                    </p>
                  )}
                  {blocks.map((b, i) =>
                    b.kind === "prompt" ? (
                      <div className="suggestion-card" key={i}>
                        <div className="suggestion-head">
                          <span>生成提示词</span>
                          <span className="grow" />
                          <button
                            type="button"
                            className="text-link"
                            onClick={() =>
                              setExpanded((old) =>
                                old.includes(m.id)
                                  ? old.filter((x) => x !== m.id)
                                  : [...old, m.id],
                              )
                            }
                          >
                            {open ? "收起" : "展开全文"}
                          </button>
                        </div>
                        <div
                          className={`suggestion-code ${open ? "is-open" : ""}`}
                        >
                          {b.code}
                        </div>
                        <div className="suggestion-actions">
                          <Button
                            small
                            primary
                            icon="arrow"
                            onClick={() => onAdoptPrompt(b.code)}
                          >
                            填入提示词
                          </Button>
                          <button
                            type="button"
                            className="text-link"
                            onClick={onEditPrompt}
                          >
                            先编辑
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="suggestion-card" key={i}>
                        <div className="suggestion-head">
                          <span>建议修改</span>
                        </div>
                        <div className="change-list">
                          {b.rows.map((row, j) => (
                            <div className="change-row" key={j}>
                              <span>{row.label}</span>
                              <div>{row.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ),
                  )}
                </>
              )}
              {m.error && (
                <p className="library-error" role="alert">
                  {m.error}
                </p>
              )}
              {!m.pending && editingId !== m.id && (
                <div className="message-actions">
                  <button
                    type="button"
                    onClick={() => void copyMessage(m)}
                  >
                    {copiedId === m.id ? "已复制" : "复制"}
                  </button>
                  {m.role === "user" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => startEdit(m)}
                    >
                      编辑
                    </button>
                  )}
                  {m.role === "assistant" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void regenerate(m.id)}
                    >
                      重新生成
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteMessage(m.id)}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p className="library-error assistant-problem" role="status">
          {error}
        </p>
      )}
      {!connections.length && (
        <p className="library-error assistant-problem" role="status">
          还没有助手连接。到「设置 → 助手连接」添加一条文字模型连接。
        </p>
      )}
      {attachment && !canvasAttached && (
        <button
          type="button"
          className="text-link assistant-reattach"
          onClick={addCanvasArt}
        >
          附加工作台当前图像
        </button>
      )}
      <div className="composer">
        {shown.length > 0 && (
          <div className="chat-attachment">
            {shown.map((item) => (
              <div
                className="attachment"
                key={item.id}
                draggable
                title={item.label + " · 拖动可换顺序"}
                onDragStart={(e) => {
                  dragArt.current = item.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragArt.current = "";
                }}
                onDragOver={(e) => {
                  if (!dragArt.current) return;
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  if (!dragArt.current) return;
                  e.preventDefault();
                  e.stopPropagation();
                  moveArt(dragArt.current, item.id);
                  dragArt.current = "";
                }}
              >
                <img src={item.url} alt={item.label} draggable={false} />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={"移除 " + item.label}
                  title="移除"
                  onClick={() => removeArt(item)}
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={composerRef}
          aria-label="给创作助手发消息"
          placeholder="描述想法，或告诉我哪里要改…"
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-row">
          <button
            type="button"
            className="icon-btn"
            title="上传图片给助手看（也可以直接拖进来）"
            aria-label="上传图片"
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="plus" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(e) => {
              void attachFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Select
            className="composer-model"
            value={model}
            title={`${connection?.name || "未选择助手连接"} · 换模型不会改动设置里的默认值`}
            onChange={(e) => setSessionModel(e.target.value)}
          >
            {!options.length && <option value="">未读取到模型</option>}
            {grouped.map(([provider, list]) => (
              <optgroup label={provider} key={provider}>
                {list.map((m) => (
                  <option value={m} key={m}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {busy ? (
            <Button small onClick={() => abortRef.current?.abort()}>
              停止
            </Button>
          ) : (
            <Button
              small
              primary
              disabled={!draft.trim() || !model}
              onClick={() => void send()}
            >
              发送
            </Button>
          )}
        </div>
        <p className="composer-footer">
          {connection?.name ? `${connection.name} · ` : ""}Enter 发送 · Shift Enter
          换行
        </p>
      </div>
      {sessionsOpen && (
        <aside
          className="resident-detail card assistant-sessions"
          aria-label="会话历史"
        >
          <header className="detail-head">
            <div>
              <h2>会话历史</h2>
              <small>{conversations.length} 个会话 · 保存在本机</small>
            </div>
            <span className="grow" />
            <button
              type="button"
              className="btn small ghost"
              title="导出当前会话为 Markdown"
              disabled={!messages.length || busy}
              onClick={exportConversation}
            >
              <Icon name="download" />
              导出
            </button>
            <button
              className="icon-btn"
              aria-label="收起会话"
              onClick={() => setSessionsOpen(false)}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="detail-body">
            <section className="detail-section">
              <button type="button" className="btn small" onClick={newSession}>
                <Icon name="plus" />
                新对话
              </button>
            </section>
            <div className="library-search session-search">
              <Icon name="search" />
              <input
                aria-label="搜索会话"
                placeholder="搜索标题或消息…"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
              />
              {sessionSearch && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="清除会话搜索"
                  onClick={() => setSessionSearch("")}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
            <section className="detail-section sessions-list">
              {filteredConversations.length ? (
                filteredConversations.map((c) => (
                  <div
                    className={"session-row " + (c.id === activeId ? "is-active" : "")}
                    key={c.id}
                  >
                    <button
                      type="button"
                      className="session-open"
                      onClick={() => openSession(c)}
                    >
                      <b>{c.title}</b>
                      <small>
                        {c.model ? c.model + " · " : ""}
                        {new Date(c.updatedAt).toLocaleString("zh-CN")}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={"删除会话 " + c.title}
                      onClick={async () => {
                        try {
                          const r = await api<{ conversations: Conversation[] }>(
                            "/assistant/conversations/" + c.id,
                            undefined,
                            "DELETE",
                          );
                          setConversations(r.conversations);
                          if (c.id === activeId) {
                            const next = r.conversations[0];
                            setActiveId(next?.id || "");
                            setMessages(next?.messages || []);
                            setSessionModel(next?.model || "");
                          }
                        } catch (e: any) {
                          onError(e.message);
                        }
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="note">
                  {sessionKeyword
                    ? "没有匹配的会话，换个关键词试试。"
                    : "还没有会话。发送第一条消息就会自动保存。"}
                </p>
              )}
            </section>
          </div>
        </aside>
      )}
    </aside>
    </>
  );
}
