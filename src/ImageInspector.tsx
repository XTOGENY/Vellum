import { useEffect, useRef, useState } from "react";
import { api, fileData } from "./api";
import { LibraryDialog } from "./LibraryUI";
import { MODELS, SAMPLER_NAMES } from "../shared/novelai.mjs";
import type { ImportedImage } from "./ImageImport";
import type { Template } from "./types";
import "./image-inspector.css";

type RecordImage = ImportedImage & { raw: Record<string, unknown> };
export default function ImageInspector({
  active,
  onImport,
}: {
  active: boolean;
  onImport: (image: ImportedImage) => void;
}) {
  const [record, setRecord] = useState<RecordImage | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [tab, setTab] = useState("prompts"),
    [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null),
    request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(t);
  }, [message]);
  async function read(file: File) {
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      if (
        !/\.(png|jpe?g|webp)$/i.test(file.name) &&
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw Error("请选择 PNG、JPEG 或 WebP 图片。");
      const next = await api<RecordImage>("/image/import", {
        data: await fileData(file),
        name: file.name,
        includeRaw: true,
      });
      if (id !== request.current) return;
      setRecord(next);
      setTab("prompts");
      setMessage("");
    } catch (e: any) {
      if (id === request.current) setError(e.message);
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!active) return;
    const paste = (e: ClipboardEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest("input,textarea,[contenteditable=true],dialog")
      )
        return;
      const file = Array.from(e.clipboardData?.files || []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        e.preventDefault();
        void read(file);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [active]);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("已复制");
    } catch {
      setError("复制未完成，请选择文字后复制。");
    }
  }
  const meta = record?.metadata,
    p = (meta?.params || {}) as Record<string, any>,
    available = meta?.available || {};
  const has = (key: string) => meta?.settingsKeys?.includes(key);
  const value = (key: string, format?: (v: any) => string) =>
    has(key) ? (format ? format(p[key]) : String(p[key])) : "未记录";
  const modelName = value(
    "model",
    (v) => MODELS.find((m: any) => m.id === v)?.label || v,
  );
  const dims = record ? `${record.image.width} × ${record.image.height}` : "";
  const rows = [
    ["模型", modelName],
    [
      "尺寸",
      has("width") && has("height") ? `${p.width} × ${p.height}` : "未记录",
    ],
    ["步数", value("steps")],
    ["CFG", value("scale")],
    [
      "采样器",
      value(
        "sampler",
        (v) => (SAMPLER_NAMES as Record<string, string>)[v] || v,
      ),
    ],
    ["噪声调度", value("noiseSchedule")],
    ["种子", available.seed ? String(p?.seed) : "未记录"],
    ...(Array.isArray(p?.templates) && p.templates.length
      ? [
          [
            "模板",
            p.templates
              .map(
                (t: any) =>
                  t.name + "（" + (t.target === "negative" ? "负面" : "正面") + "）",
              )
              .join("、"),
          ] as [string, string],
        ]
      : []),
    ["CFG Rescale", value("cfgRescale")],
  ];
  const params = (entries: string[][]) => (
    <div className="params">
      {entries.map(([label, v]) => (
        <div key={label}>
          <span>{label}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
  function promptSection(
    title: string,
    text: string,
    exists: boolean,
    negative = false,
  ) {
    return (
      <section className="section">
        <div className="section-head">
          <h3>{title}</h3>
          <button
            className="text-btn"
            disabled={!exists}
            onClick={() => void copy(text)}
          >
            复制
          </button>
        </div>
        <div className={`prompt ${negative ? "negative" : ""}`}>
          {exists ? text || "（空）" : "未记录"}
        </div>
      </section>
    );
  }
  return (
    <div className="image-inspector">
      <main
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void read(f);
        }}
        aria-busy={busy}
      >
        <input
          ref={input}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void read(f);
          }}
        />
        <div className="heading">
          <div>
            <h1>图片解析</h1>
            <p>查看图片中的提示词与生成参数，带回工作台继续创作。</p>
          </div>
          {record && (
            <button className="btn" onClick={() => input.current?.click()}>
              选择其他图片
            </button>
          )}
        </div>
        {error && (
          <p className="inspector-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="note" role="status">
            正在读取图片信息…
          </p>
        )}
        {record ? (
          <div className="layout">
            <section className="source">
              <div className="source-head">
                <h2>原图</h2>
                <span>完整预览</span>
              </div>
              <div className="image">
                <img
                  src={`data:image/png;base64,${record.image.data}`}
                  alt={record.image.name}
                />
              </div>
              <div className="file">
                <div>
                  <b>{record.image.name}</b>
                  <p>
                    {record.file?.format.toUpperCase()} · {dims} ·{" "}
                    {record.file
                      ? `${(record.file.bytes / 1024 / 1024).toFixed(2)} MB`
                      : ""}
                  </p>
                </div>
              </div>
            </section>
            <section className="result">
              <div className="result-head">
                <h2>解析结果</h2>
                <span className={meta ? "good" : "note"}>
                  {meta && <i className="dot" />}
                  {meta
                    ? `已读取 ${meta.source === "nwenai" ? "Vellum" : "NovelAI"} 信息`
                    : "未识别到生成信息"}
                </span>
              </div>
              <div className="tabs" role="tablist" aria-label="解析内容">
                {[
                  ["prompts", "提示词"],
                  ["settings", "生成参数"],
                  ["raw", "原始信息"],
                ].map(([key, title], i) => (
                  <button
                    key={key}
                    id={`inspector-tab-${key}`}
                    role="tab"
                    aria-selected={tab === key}
                    aria-controls={`inspector-panel-${key}`}
                    tabIndex={tab === key ? 0 : -1}
                    onKeyDown={(e) => {
                      if (
                        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                          e.key,
                        )
                      )
                        return;
                      e.preventDefault();
                      const keys = ["prompts", "settings", "raw"];
                      const n =
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? 2
                            : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
                      setTab(keys[n]);
                      document
                        .getElementById(`inspector-tab-${keys[n]}`)
                        ?.focus();
                    }}
                    onClick={() => setTab(key)}
                  >
                    {title}
                  </button>
                ))}
              </div>
              <div className="body">
                <div
                  className="pane"
                  role="tabpanel"
                  id="inspector-panel-prompts"
                  aria-labelledby="inspector-tab-prompts"
                  hidden={tab !== "prompts"}
                >
                  {meta ? (
                    <>
                      {promptSection("正面提示词", p?.prompt, available.prompt)}
                      {promptSection(
                        "负面提示词",
                        p?.negative,
                        available.negative,
                        true,
                      )}
                      {available.characters && p.characters.length ? (
                        p.characters.map((c: any, i: number) => (
                          <section key={c.id || i} className="section">
                            <h3>{c.name || `角色 ${i + 1}`}</h3>
                            {promptSection("正面提示词", c.prompt, true)}
                            {promptSection("负面提示词", c.uc, true, true)}
                          </section>
                        ))
                      ) : (
                        <div className="hint">未读取到独立角色提示词。</div>
                      )}
                      {params([rows[0], rows[1], rows[2], rows[6]])}
                    </>
                  ) : (
                    <div className="blank">
                      <h2>未识别到生成信息</h2>
                      <p>
                        图片可能未保存生成参数，或信息已在转存时移除。可以换一张原始图片试试。
                      </p>
                      <button className="btn" onClick={() => setTab("raw")}>
                        查看原始信息
                      </button>
                    </div>
                  )}
                </div>
                <div
                  className="pane"
                  role="tabpanel"
                  id="inspector-panel-settings"
                  aria-labelledby="inspector-tab-settings"
                  hidden={tab !== "settings"}
                >
                  <h3 className="settings-title">生成参数</h3>
                  {meta ? (
                    <>
                      {params(rows)}
                      {meta.warnings?.map((s: string) => (
                        <p className="note warning" key={s}>
                          {s}
                        </p>
                      ))}
                    </>
                  ) : (
                    <p className="note">未识别到可恢复的生成参数。</p>
                  )}
                </div>
                <div
                  className="pane"
                  role="tabpanel"
                  id="inspector-panel-raw"
                  aria-labelledby="inspector-tab-raw"
                  hidden={tab !== "raw"}
                >
                  <div className="section-head">
                    <h3>图片原始信息</h3>
                    <button
                      className="text-btn"
                      onClick={() =>
                        void copy(JSON.stringify(record.raw || {}, null, 2))
                      }
                    >
                      复制 JSON
                    </button>
                  </div>
                  <pre className="raw">
                    {JSON.stringify(record.raw || {}, null, 2)}
                  </pre>
                </div>
              </div>
              <footer className="bottom">
                <span className="note">带入前可选择需要的内容</span>

                <button
                  className="btn primary"
                  disabled={!meta || busy}
                  onClick={() => onImport(record)}
                >
                  带入工作台
                </button>
              </footer>
            </section>
          </div>
        ) : (
          <section className="source empty-source">
            <div className="blank">
              <svg
                className="upload-mark"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path d="M8 30v11h32V30M24 32V7m-9 9 9-9 9 9" />
              </svg>
              <h2>{busy ? "正在读取图片信息" : "拖入一张图片"}</h2>
              <p>
                也可以选择图片，或按 Ctrl + V 粘贴。
                <br />
                读取文件中保留的生成信息。
              </p>
              <button
                className="btn primary"
                onClick={() => input.current?.click()}
              >
                选择图片
              </button>
              <p className="note">PNG、JPEG、WebP</p>
            </div>
          </section>
        )}
        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
              </main>
    </div>
  );
}
