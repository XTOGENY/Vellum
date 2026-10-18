import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Button, Field, Icon, Select } from "./ui";
import {
  LibraryDialog,
  ScrollHint,
  TEMPLATE_CATEGORIES,
  dateLabel,
  clockLabel,
} from "./LibraryUI";
import { MODELS, SAMPLER_NAMES } from "../shared/novelai.mjs";
import { expandedPrompts } from "../shared/prompt-tools.mjs";
import type { HistoryItem, Params, Template } from "./types";

export default function ArtworkDetails({
  item,
  onClose,
  onUse,
  onOrganize,
  onTemplatesChange,
  neighbors,
  onNavigate,
  operationError,
}: {
  item: HistoryItem;
  onClose: () => void;
  onUse: (params: Params) => void;
  onOrganize?: (
    action: string,
    ids: string[],
    name?: string,
  ) => Promise<boolean>;
  onTemplatesChange?: (items: Template[]) => void;
  neighbors?: HistoryItem[];
  onNavigate?: (item: HistoryItem) => void;
  operationError?: string;
}) {
  const infoBody = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState<HistoryItem | null>(
      item.params ? item : null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const [actual, setActual] = useState(false),
    [tab, setTab] = useState<"prompt" | "negative">("prompt"),
    [rename, setRename] = useState(false),
    [name, setName] = useState(item.name || "");
  const [savingTemplate, setSavingTemplate] = useState(false),
    [templateName, setTemplateName] = useState(""),
    [category, setCategory] = useState("artist"),
    [templateSaved, setTemplateSaved] = useState(false);
  const index = neighbors?.findIndex((h) => h.id === item.id) ?? -1;
  useEffect(() => setCopied(false), [tab, actual]);
  useEffect(() => {
    let active = true;
    setFull(item.params ? item : null);
    setError("");
    setActual(false);
    setRename(false);
    setName(item.name || "");
    setSavingTemplate(false);
    setTemplateSaved(false);
    setCopied(false);
    api<HistoryItem>("/history/" + item.id)
      .then((h) => {
        if (active) setFull(h);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [item.id]);
  const params = full?.params;
  let prompt = full?.prompt ?? item.prompt,
    negative = params?.negative || "";
  if (params) {
    try {
      const resolved = expandedPrompts(params);
      prompt = resolved.prompt;
      negative = resolved.negative;
    } catch {
      prompt = params.prompt;
    }
  }
  if (actual && typeof params?.actualPrompt === "string") {
    prompt = params.actualPrompt;
    negative = params.actualNegative ?? negative;
  }
  const title =
    item.name ||
    `${MODELS.find((m) => m.id === item.model)?.label || "图像作品"} · ${clockLabel(item.createdAt)}`;
  return (
    <LibraryDialog title={title} onClose={onClose} className="artwork-dialog">
      <div className="artwork-dialog-layout">
        <div className="artwork-viewer">
          <img src={item.url} alt={item.name || "生成作品"} />
          {neighbors && neighbors.length > 1 && (
            <div className="artwork-navigation">
              <button
                type="button"
                className="btn"
                aria-label="上一张作品"
                disabled={index <= 0}
                onClick={() => onNavigate?.(neighbors[index - 1])}
              >
                ←
              </button>
              <span>
                {index + 1} / {neighbors.length}
              </span>
              <button
                type="button"
                className="btn"
                aria-label="下一张作品"
                disabled={index < 0 || index >= neighbors.length - 1}
                onClick={() => onNavigate?.(neighbors[index + 1])}
              >
                →
              </button>
            </div>
          )}
        </div>
        <section className="artwork-info">
          <div className="artwork-info-scroll" ref={infoBody}>
            <div className="artwork-identity">
              <span>
                {MODELS.find((m) => m.id === item.model)?.label || "图像处理"}
              </span>
              <p>
                {dateLabel(item.createdAt)} · {clockLabel(item.createdAt)}
              </p>
            </div>
            <dl className="artwork-parameters">
              <div>
                <dt>尺寸</dt>
                <dd>
                  {item.width} × {item.height}
                </dd>
              </div>
              <div>
                <dt>种子</dt>
                <dd>{item.seed ?? "未记录"}</dd>
              </div>
              {params && (
                <>
                  <div>
                    <dt>步骤</dt>
                    <dd>{params.steps}</dd>
                  </div>
                  <div>
                    <dt>提示词引导</dt>
                    <dd>{params.scale}</dd>
                  </div>
                  <div>
                    <dt>采样器</dt>
                    <dd>
                      {SAMPLER_NAMES[
                        params.sampler as keyof typeof SAMPLER_NAMES
                      ] || params.sampler}
                    </dd>
                  </div>
                </>
              )}
            </dl>
            {typeof params?.actualPrompt === "string" && (
              <div
                className="resident-tabs"
                role="tablist"
                aria-label="还原词来源"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={!actual}
                  className={!actual ? "active" : ""}
                  onClick={() => setActual(false)}
                >
                  原始设置
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={actual}
                  className={actual ? "active" : ""}
                  onClick={() => setActual(true)}
                >
                  实际生成词
                </button>
              </div>
            )}
            <div className="section-title">
              <div
                className="resident-tabs"
                role="tablist"
                aria-label="作品提示词"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "prompt"}
                  className={tab === "prompt" ? "active" : ""}
                  onClick={() => setTab("prompt")}
                >
                  正面词
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "negative"}
                  className={tab === "negative" ? "active" : ""}
                  onClick={() => setTab("negative")}
                >
                  负面词
                </button>
              </div>
              <button
                type="button"
                className="text-link"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      tab === "prompt" ? prompt : negative,
                    );
                    setCopied(true);
                  } catch {
                    setError("复制失败，请选择文字后复制");
                  }
                }}
              >
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <pre className="library-prompt artwork-prompt">
              {(tab === "prompt" ? prompt : negative) || "未记录"}
            </pre>
            {Array.isArray(params?.templates) && params.templates.length > 0 && (
              <p className="artwork-template-note">
                模板 ·{" "}
                {params.templates
                  .map(
                    (t: any) =>
                      t.name + "（" + (t.target === "negative" ? "负面" : "正面") + "）",
                  )
                  .join("、")}
              </p>
            )}
            {onTemplatesChange && params && (
              <>
                {!savingTemplate ? (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setSavingTemplate(true);
                      setTemplateName(item.name || "新画师模板");
                    }}
                  >
                    {templateSaved ? "再次存为模板" : "存为提示词模板"}
                  </button>
                ) : (
                  <div className="inline-template-form">
                    <p className="inline-template-preview">
                      将保存{tab === "prompt" ? "正面" : "负面"}内容：
                      {((tab === "prompt" ? prompt : negative) || "").slice(0, 80) ||
                        "（这段是空的，换一个标签页再存）"}
                    </p>
                    <Field label="模板名称">
                      <input
                        aria-label="从作品保存的模板名称"
                        maxLength={100}
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                      />
                    </Field>
                    <Field label="用途分类">
                      <Select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        {Object.entries(TEMPLATE_CATEGORIES).map(
                          ([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ),
                        )}
                      </Select>
                    </Field>
                    <div className="actions">
                      <Button
                        small
                        disabled={busy}
                        onClick={() => setSavingTemplate(false)}
                      >
                        取消
                      </Button>
                      <Button
                        small
                        primary
                        disabled={
                          busy ||
                          !templateName.trim() ||
                          !(tab === "prompt" ? prompt : negative).trim()
                        }
                        onClick={async () => {
                          setBusy(true);
                          setError("");
                          try {
                            onTemplatesChange(
                              await api("/templates", {
                                name: templateName,
                                prompt: tab === "negative" ? negative : prompt,
                                negative: "",
                                category,
                              }),
                            );
                            setSavingTemplate(false);
                            setTemplateSaved(true);
                          } catch (e: any) {
                            setError(e.message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {busy ? "保存中…" : "保存模板"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
            {onOrganize && (
              <div className="artwork-organize">
                {rename ? (
                  <div className="inline-rename">
                    <input
                      aria-label="作品名称"
                      maxLength={100}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <div className="actions">
                      <Button small onClick={() => setRename(false)}>
                        取消
                      </Button>
                      <Button
                        small
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          if (await onOrganize("rename", [item.id], name))
                            setRename(false);
                          setBusy(false);
                        }}
                      >
                        保存名称
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setRename(true)}
                  >
                    重命名作品
                  </button>
                )}
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    if (
                      await onOrganize(
                        item.archivedAt ? "restore" : "archive",
                        [item.id],
                      )
                    )
                      onClose();
                    setBusy(false);
                  }}
                >
                  {item.archivedAt ? "恢复到作品库" : "归档作品"}
                </button>
              </div>
            )}
            {!full && !error && (
              <p role="status" className="inspector-note">
                正在读取完整生成设置…
              </p>
            )}
            {(error || operationError) && (
              <p className="library-error" role="alert">
                {error || operationError}
              </p>
            )}
          </div>
          <footer className="artwork-actions">
            <ScrollHint target={infoBody} />
            <Button
              primary
              disabled={!params || busy}
              onClick={() => {
                if (!params) return;
                onUse(
                  actual
                    ? {
                        ...params,
                        prompt: params.actualPrompt,
                        negative: params.actualNegative ?? params.negative,
                        characters:
                          params.actualCharacters ?? params.characters,
                      }
                    : params,
                );
              }}
            >
              还原到工作台
            </Button>
            <a
              className="btn"
              href={item.url}
              download={`Vellum-${item.filename}`}
            >
              <Icon name="download" />
              下载 {item.filename.endsWith(".webp") ? "WebP" : "PNG"}
            </a>
          </footer>
        </section>
      </div>
    </LibraryDialog>
  );
}
