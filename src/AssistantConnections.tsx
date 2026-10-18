import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Button, Field, Toggle, Empty, Icon, Select } from "./ui";
import { LibraryDialog } from "./LibraryUI";
import type { AssistantSettings, Connection } from "./types";
import { isChatConnection } from "./types";
import { CHAT_PROTOCOLS } from "../shared/chat-protocols.mjs";

const EMPTY_BASE: Record<string, string> = {
  "openai-chat": "https://api.openai.com",
  "openai-responses": "https://api.openai.com",
  "anthropic-messages": "https://api.anthropic.com",
  "google-gemini": "https://generativelanguage.googleapis.com",
};
const BEHAVIOR: AssistantSettings = {
  protocol: "openai-chat",
  model: "",
  streaming: true,
  includeContext: true,
  includePrompt: false,
  readRecentMetadata: false,
  sendImages: true,
};
// 与 server/chat-provider.mjs 的 apiRoot 同一条规则：末尾已带 /v1 或 /v1beta 就不再重复。
function apiRoot(base: string) {
  return (base || "").replace(/\/+$/, "").replace(/\/(v1|v1beta)$/i, "");
}
function protocolOf(id?: string) {
  return CHAT_PROTOCOLS.find((p: any) => p.id === id);
}
function protocolLabel(id?: string) {
  return protocolOf(id)?.label || "未选择协议";
}
function chatOf(c?: Connection): AssistantSettings {
  return { ...BEHAVIOR, ...(c?.chat || {}) };
}
type ModelRow = { id: string; label: string; context: number };

export function AssistantConnections({
  items,
  onChange,
  onError,
}: {
  items: Connection[];
  onChange: (c: Connection[]) => void;
  onError: (s: string) => void;
}) {
  const list = items.filter(isChatConnection);
  const [selected, setSelected] = useState<string | null>(list[0]?.id || null),
    [form, setForm] = useState(() => formOf(list[0])),
    [busy, setBusy] = useState(false),
    [models, setModels] = useState<ModelRow[]>([]),
    [result, setResult] = useState<any>(null),
    [discard, setDiscard] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false);
  const pendingChoice = useRef<Connection | undefined>();
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result)
      resultRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
  }, [result]);
  const source = list.find((c) => c.id === selected);
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(source));
  function formOf(c?: Connection) {
    return {
      name: c?.name || "",
      baseUrl: c?.baseUrl || EMPTY_BASE["openai-chat"],
      token: "",
      protocol: (c ? chatOf(c).protocol : BEHAVIOR.protocol) as string,
      model: c ? chatOf(c).model : "",
      streaming: c ? chatOf(c).streaming : BEHAVIOR.streaming,
      includeContext: c ? chatOf(c).includeContext : BEHAVIOR.includeContext,
      includePrompt: c ? chatOf(c).includePrompt : BEHAVIOR.includePrompt,
      readRecentMetadata: c
        ? chatOf(c).readRecentMetadata
        : BEHAVIOR.readRecentMetadata,
      sendImages: c ? chatOf(c).sendImages !== false : BEHAVIOR.sendImages,
    };
  }
  function choose(c?: Connection, force = false) {
    if (dirty && !force) {
      pendingChoice.current = c;
      setDiscard(true);
      return;
    }
    setSelected(c?.id || null);
    setForm(formOf(c));
    setModels([]);
    setResult(null);
  }
  function changeProtocol(protocol: string) {
    const wasEmpty = !form.baseUrl || form.baseUrl === EMPTY_BASE[form.protocol];
    setForm({
      ...form,
      protocol,
      baseUrl: wasEmpty ? EMPTY_BASE[protocol] || form.baseUrl : form.baseUrl,
    });
    setModels([]);
    setResult(null);
  }
  async function save() {
    setBusy(true);
    try {
      const cs = await api<Connection[]>("/assistant-connections", {
        id: selected || undefined,
        name: form.name,
        baseUrl: form.baseUrl,
        token: form.token || undefined,
        protocol: form.protocol,
        model: form.model,
        streaming: form.streaming,
        includeContext: form.includeContext,
        includePrompt: form.includePrompt,
        readRecentMetadata: form.readRecentMetadata,
        sendImages: form.sendImages,
      });
      onChange(cs);
      const saved =
        cs.find((c) => c.id === selected) ||
        cs.filter(isChatConnection).slice(-1)[0];
      if (saved) choose(saved, true);
      setResult({ message: "连接已保存，密钥由 Windows 加密存储。" });
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  }
  async function loadModels() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api<{ models: ModelRow[] }>(
        "/assistant-connections/" + selected + "/models",
      );
      setModels(r.models);
      setResult(
        r.models.length
          ? { message: `已读取 ${r.models.length} 个模型。` }
          : { message: "连接可用，但接口没有返回可选模型。" },
      );
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; protocol: string; models: ModelRow[] }>(
        "/assistant-connections/" + selected + "/test",
        {},
      );
      setModels(r.models);
      setResult({
        message: `连接可用 · ${r.protocol} · 读到 ${r.models.length} 个模型。`,
      });
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="connections-panel assistant-panel">
      <div className="page-heading">
        <div>
          <h2>助手连接</h2>
          <p>
            给对话助手单独选一个文字模型。图像模型在「图像连接」里配置，两边分开保存，也各有自己的协议列表。
          </p>
        </div>
        <Button icon="plus" onClick={() => choose()}>
          新增助手连接
        </Button>
      </div>
      <div className="connection-layout">
        <div className="card connection-list">
          <div className="section-header">
            <h2>助手连接</h2>
            <span>{list.length}</span>
          </div>
          {list.length ? (
            list.map((c) => (
              <button
                key={c.id}
                className={`connection-item ${selected === c.id ? "selected" : ""}`}
                onClick={() => choose(c)}
              >
                <Icon name="chat" />
                <div>
                  <b>{c.name}</b>
                  <small>{protocolLabel(c.chat?.protocol)}</small>
                  <small className="conn-model">
                    {c.chat?.model || "未选择模型"}
                  </small>
                </div>
                <span className="tag">{c.hasKey ? "已配置" : "无密钥"}</span>
              </button>
            ))
          ) : (
            <Empty icon="chat" title="添加第一个助手连接">
              给对话助手单独选一个文字模型。它和图像连接互不影响。
            </Empty>
          )}
        </div>
        <section className="card connection-form">
          <div className="section-header">
            <h2>{selected ? "编辑助手连接" : "新建助手连接"}</h2>
            <span className="tag">文字对话</span>
          </div>
          <div className="form-content">
            <Field label="连接名称">
              <input
                value={form.name}
                placeholder="例如：常用中转"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="协议">
              <Select
                value={form.protocol}
                onChange={(e) => changeProtocol(e.target.value)}
              >
                {CHAT_PROTOCOLS.map((p: any) => (
                  <option value={p.id} key={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="note">
              这里只列文字对话协议。图像生成的协议在「图像连接」里单独选，两边不共用一份列表。
            </p>
            <Field label="服务地址">
              <input
                value={form.baseUrl}
                placeholder={EMPTY_BASE[form.protocol]}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </Field>
            <p className="note">
              末尾带不带 /v1 都可以。助手会访问{" "}
              <span className="mono">
                {apiRoot(form.baseUrl)}
                {protocolOf(form.protocol)?.path}
              </span>
              ；中转是否转发这个路径要实测，不能默认它支持。
            </p>
            <Field
              label={selected ? "API 密钥 · 留空保留原密钥" : "API 密钥"}
            >
              <input
                type="password"
                autoComplete="new-password"
                value={form.token}
                placeholder={selected ? "已保存，输入可替换" : "粘贴密钥"}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
              />
            </Field>
            <p className="note">
              密钥由 Windows 当前用户加密保存，页面不会回显完整内容。
            </p>
            <div className="form-divider" />
            <div className="section-title">
              <h3>默认模型</h3>
              <button
                type="button"
                className="text-link"
                disabled={!selected || busy}
                title={selected ? undefined : "先保存连接，再读取模型列表"}
                onClick={() => void loadModels()}
              >
                读取模型列表
              </button>
            </div>
            {models.length ? (
              <div className="assistant-model-list">
                {models.map((m) => (
                  <label
                    className={`assistant-model ${form.model === m.id ? "is-selected" : ""}`}
                    key={m.id}
                  >
                    <input
                      type="radio"
                      name="assistant-model"
                      checked={form.model === m.id}
                      onChange={() => setForm({ ...form, model: m.id })}
                    />
                    <span className="assistant-model-name">
                      <b>{m.id}</b>
                      {(m.label || m.context > 0) && (
                        <small>
                          {[
                            m.label,
                            m.context > 0
                              ? `${m.context.toLocaleString()} 上下文`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      )}
                    </span>
                    {form.model === m.id && <span className="tag">当前</span>}
                  </label>
                ))}
              </div>
            ) : form.model ? (
              <div className="assistant-model-list">
                <label className="assistant-model is-selected">
                  <input type="radio" name="assistant-model" checked readOnly />
                  <span className="assistant-model-name">
                    <b>{form.model}</b>
                    <small>已保存的默认模型</small>
                  </span>
                  <span className="tag">当前</span>
                </label>
              </div>
            ) : (
              <p className="note">
                还没有读取模型。填好地址与密钥后点「读取模型列表」，或直接填入模型名。
              </p>
            )}
            <details className="connection-advanced">
              <summary>助手行为</summary>
              <Toggle
                label="流式输出"
                hint="边生成边显示，中途可以停止。"
                checked={form.streaming}
                onChange={(streaming) => setForm({ ...form, streaming })}
              />
              <Toggle
                label="带上当前工作台上下文"
                hint="发送当前模型、尺寸与参数，让建议贴着正在画的这张。"
                checked={form.includeContext}
                onChange={(includeContext) =>
                  setForm({ ...form, includeContext })
                }
              />
              <Toggle
                label="每次附带当前提示词"
                hint="提示词很长时更贵，也更容易超出上下文。"
                checked={form.includePrompt}
                onChange={(includePrompt) =>
                  setForm({ ...form, includePrompt })
                }
              />
              <Toggle
                label="读取最近作品的元数据"
                hint="只发送标题、模型与种子，不发送图片。"
                checked={form.readRecentMetadata}
                onChange={(readRecentMetadata) =>
                  setForm({ ...form, readRecentMetadata })
                }
              />
              <Toggle
                label="把当前图像发给模型（看图）"
                hint="发送当前讨论的那张图，过大时先压到 1024 以内。模型不支持看图时会报错，关掉即可。"
                checked={form.sendImages}
                onChange={(sendImages) => setForm({ ...form, sendImages })}
              />
            </details>
            <div className="callout">
              助手不会替你发起生成。它给出的提示词要点击“采用”才会进入草稿，付费动作仍然由你点击触发。
            </div>
            {result && (
              <div
                ref={resultRef}
                className={result.error ? "library-error" : "success"}
                role={result.error ? "alert" : "status"}
              >
                {result.error || result.message}
              </div>
            )}
          </div>
          <div className="actions connection-form-actions">
            <Button primary disabled={busy} onClick={() => void save()}>
              保存连接
            </Button>
            <Button
              disabled={!selected || busy || dirty}
              title={dirty ? "请先保存修改，再验证连接" : undefined}
              onClick={() => void test()}
            >
              验证连接
            </Button>
            <span className="grow" />
            {selected && (
              <Button
                icon="trash"
                disabled={busy}
                onClick={() => setDeleteOpen(true)}
              >
                删除
              </Button>
            )}
          </div>
        </section>
      </div>
      {discard && (
        <LibraryDialog
          title="连接有未保存的修改"
          onClose={() => setDiscard(false)}
        >
          <div className="library-dialog-body">
            <p>切换连接会放弃当前输入。你也可以继续编辑并先保存。</p>
            <div className="actions">
              <Button onClick={() => setDiscard(false)}>继续编辑</Button>
              <Button
                primary
                onClick={() => {
                  setDiscard(false);
                  choose(pendingChoice.current, true);
                }}
              >
                放弃修改
              </Button>
            </div>
          </div>
        </LibraryDialog>
      )}
      {deleteOpen && (
        <LibraryDialog
          title="删除助手连接"
          onClose={() => !busy && setDeleteOpen(false)}
        >
          <div className="library-dialog-body">
            <p>
              删除「{source?.name}」及其保存的密钥？已保存的作品不受影响。
            </p>
            {result?.error && (
              <p className="library-error" role="alert">
                {result.error}
              </p>
            )}
            <div className="actions">
              <Button disabled={busy} onClick={() => setDeleteOpen(false)}>
                保留连接
              </Button>
              <Button
                primary
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setResult(null);
                  try {
                    const cs = await api<Connection[]>(
                      "/assistant-connections/" + selected,
                      undefined,
                      "DELETE",
                    );
                    onChange(cs);
                    choose(cs.filter(isChatConnection)[0], true);
                    setDeleteOpen(false);
                  } catch (e: any) {
                    setResult({ error: e.message });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "删除中…" : "删除连接"}
              </Button>
            </div>
          </div>
        </LibraryDialog>
      )}
    </div>
  );
}
