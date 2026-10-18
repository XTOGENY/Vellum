import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Button, Field, Toggle, Empty, Icon, Select } from "./ui";
import type { Connection } from "./types";
import { isImageConnection } from "./types";
import { LibraryDialog } from "./LibraryUI";
import { IMAGE_PROTOCOLS } from "../shared/image-protocols.mjs";

const protocolOf = (id?: string) =>
  IMAGE_PROTOCOLS.find((p: any) => p.id === id) || IMAGE_PROTOCOLS[0];

export function Connections({
  items,
  onChange,
  onError,
  embedded = false,
}: {
  items: Connection[];
  onChange: (c: Connection[]) => void;
  onError: (s: string) => void;
  embedded?: boolean;
}) {
  // 图像侧只看图像用途的连接；文字对话的那一份在设置里单独一页。
  const list = items.filter(isImageConnection),
    [selected, setSelected] = useState<string | null>(
      list[0]?.id || null,
    ),
    [form, setForm] = useState({
      name: list[0]?.name || "",
      protocol: protocolOf(list[0]?.protocol).id,
      baseUrl: list[0]?.baseUrl || protocolOf(list[0]?.protocol).base,
      token: "",
      concurrency: list[0]?.concurrency || 1,
      streaming: list[0]?.streaming ?? true,
    }),
    [modelList, setModelList] = useState<string[]>([]),
    [modelsNote, setModelsNote] = useState(""),
    [busy, setBusy] = useState(false),
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
  useEffect(() => {
    const current = list.find((c) => c.id === selected);
    setModelList(Array.isArray(current?.models) ? current!.models! : []);
    setModelsNote("");
  }, [selected, items]);
  const dirty =
    JSON.stringify(form) !==
    JSON.stringify({
      name: source?.name || "",
      protocol: protocolOf(source?.protocol).id,
      baseUrl: source?.baseUrl || protocolOf(source?.protocol).base,
      token: "",
      concurrency: source?.concurrency || 1,
      streaming: source?.streaming ?? true,
    });
  function choose(c?: Connection, force = false) {
    if (dirty && !force) {
      pendingChoice.current = c;
      setDiscard(true);
      return;
    }
    setSelected(c?.id || null);
    setForm({
      name: c?.name || "",
      protocol: protocolOf(c?.protocol).id,
      baseUrl: c?.baseUrl || protocolOf(c?.protocol).base,
      token: "",
      concurrency: c?.concurrency || 1,
      streaming: c?.streaming ?? true,
    });
    setResult(null);
  }
  async function loadModels() {
    if (!selected) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{
        models: string[];
        note?: string;
        connections?: Connection[];
      }>("/connections/" + selected + "/models");
      setModelList(r.models || []);
      setModelsNote(r.note || "");
      if (r.connections) onChange(r.connections);
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const cs = await api<Connection[]>("/connections", {
        id: selected || undefined,
        ...form,
        token: form.token || undefined,
      });
      onChange(cs);
      const saved =
        cs.find((c) => c.id === selected) ||
        cs.filter(isImageConnection).slice(-1)[0];
      if (saved) choose(saved, true);
      setResult({ message: "连接已保存，密钥由 Windows 加密存储。" });
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
      const r = await api("/connections/" + selected + "/test", {});
      setResult(r);
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={embedded ? "connections-panel" : "management"}>
      <div className="page-heading">
        <div>
          <h2>图像连接</h2>
          <p>出图用的连接，只列图像用途。生成时按连接分配任务。</p>
        </div>
        <Button icon="plus" onClick={() => choose()}>
          新增连接
        </Button>
      </div>
      <div className="connection-layout">
        <div className="card connection-list">
          <div className="section-header">
            <h2>我的连接</h2>
            <span>{list.length}</span>
          </div>
          {list.length ? (
            list.map((c) => (
              <button
                key={c.id}
                className={`connection-item ${selected === c.id ? "selected" : ""}`}
                onClick={() => choose(c)}
              >
                <Icon name="link" />
                <div>
                  <b>{c.name}</b>
                  <small>{protocolOf(c.protocol).label}</small>
                  <small className="conn-model">
                    {c.official ? "官方" : "中转"} · 并发 {c.concurrency}
                  </small>
                </div>
                <span className="tag">{c.hasKey ? "已配置" : "无密钥"}</span>
              </button>
            ))
          ) : (
            <Empty icon="link" title="添加第一个连接">
              使用 NovelAI 的 Persistent API Token。
            </Empty>
          )}
        </div>
        <section className="card connection-form">
          <div className="section-header">
            <h2>{selected ? "编辑连接" : "新建连接"}</h2>
            <span className="tag">{protocolOf(form.protocol).label}</span>
          </div>
          <div className="form-content">
            <Field label="连接名称">
              <input
                value={form.name}
                placeholder="例如：官方主连接"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="协议">
              <Select
                value={form.protocol}
                onChange={(e) => {
                  const next = protocolOf(e.target.value),
                    wasDefault =
                      !form.baseUrl ||
                      IMAGE_PROTOCOLS.some(
                        (p: any) => p.base === form.baseUrl,
                      );
                  setForm({
                    ...form,
                    protocol: next.id,
                    baseUrl: wasDefault ? next.base : form.baseUrl,
                  });
                  setResult(null);
                }}
              >
                {IMAGE_PROTOCOLS.map((p: any) => (
                  <option value={p.id} key={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="note">
              {protocolOf(form.protocol).endpoint}
              {protocolOf(form.protocol).implemented
                ? " · 已接入"
                : " · 这一版还没接入这个协议的生成适配器，连接可以先存下来"}
              {" · "}
              <a
                className="text-link"
                href={protocolOf(form.protocol).docs}
                target="_blank"
                rel="noreferrer"
              >
                官方文档
              </a>
            </p>
            <Field label="API 根地址">
              <input
                value={form.baseUrl}
                placeholder={protocolOf(form.protocol).base}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </Field>
            <p className="note">
              {protocolOf(form.protocol).id === "novelai-native"
                ? "中转需兼容 NovelAI 原生协议。填写根地址，不带 /ai/generate-image。"
                : "填写根地址。是否被中转转发要实测，不能默认它支持。"}
            </p>
            <Field
              label={`${protocolOf(form.protocol).keyHint}${
                selected ? " · 留空保留原密钥" : ""
              }`}
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
              <h3>模型清单</h3>
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
            {modelList.length ? (
              <div className="model-tags">
                {modelList.map((id) => (
                  <span className="tag" key={id}>
                    {id}
                  </span>
                ))}
              </div>
            ) : (
              <p className="note">
                {modelsNote || "还没读取。没读到时，生成设置里用内置清单。"}
              </p>
            )}
            <details
              className="connection-advanced"
              onToggle={(e) => {
                if (e.currentTarget.open)
                  e.currentTarget.scrollIntoView({
                    block: "nearest",
                    behavior: "instant",
                  });
              }}
            >
              <summary>并发与流式预览</summary>
              <div className="grid2">
                <Field label="最大并发 · 官方固定 1">
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value={form.concurrency}
                    onChange={(e) =>
                      setForm({ ...form, concurrency: +e.target.value })
                    }
                  />
                </Field>
                <Field label="接入类型">
                  <input
                    readOnly
                    value={
                      form.baseUrl.startsWith("https://image.novelai.net")
                        ? "官方连接"
                        : "自定义中转"
                    }
                  />
                </Field>
              </div>
              <Toggle
                label="流式预览"
                hint="兼容 MessagePack 的连接可显示生成进度；V3 使用普通请求。"
                checked={form.streaming}
                onChange={(streaming) => setForm({ ...form, streaming })}
              />
            </details>
            {result && (
              <div
                ref={resultRef}
                className={result.error ? "library-error" : "success"}
                role={result.error ? "alert" : "status"}
              >
                {result.error || result.message || "认证成功，已读取订阅信息。"}
                {result.subscription && (
                  <div className="subscription-summary">
                    <span>
                      套餐：
                      {(
                        {
                          0: "未订阅",
                          1: "Tablet",
                          2: "Scroll",
                          3: "Opus",
                        } as any
                      )[result.subscription.tier] || "已订阅"}
                    </span>
                    <span>
                      订阅余额：
                      {result.subscription.trainingStepsLeft
                        ?.fixedTrainingStepsLeft ?? "—"}{" "}
                      Anlas
                    </span>
                    <span>
                      购买余额：
                      {result.subscription.trainingStepsLeft
                        ?.purchasedTrainingSteps ?? "—"}{" "}
                      Anlas
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="actions connection-form-actions">
            <Button primary disabled={busy} onClick={() => void save()}>
              保存连接
            </Button>
            <Button
              disabled={
                !selected ||
                busy ||
                dirty ||
                !protocolOf(form.protocol).implemented
              }
              title={
                dirty
                  ? "请先保存修改，再验证连接"
                  : protocolOf(form.protocol).implemented
                    ? undefined
                    : "这个协议的验证适配器还没接入"
              }
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
          title="删除连接"
          onClose={() => !busy && setDeleteOpen(false)}
        >
          <div className="library-dialog-body">
            <p>删除“{source?.name}”及其保存的密钥？已保存的作品不受影响。</p>
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
                      "/connections/" + selected,
                      undefined,
                      "DELETE",
                    );
                    onChange(cs);
                    choose(cs.filter(isImageConnection)[0], true);
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
