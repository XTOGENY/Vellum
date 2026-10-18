import { useRef, useState } from "react";
import { LibraryDialog, ScrollHint } from "./LibraryUI";
import { Button, Icon } from "./ui";
import { MODELS, SAMPLER_NAMES } from "../shared/novelai.mjs";
import { normalizeBaseDims } from "../shared/resolution.mjs";
import { applyMetadataImport } from "../shared/metadata.mjs";
import type { Params } from "./types";

export type ImportedImage = {
  image: { data: string; name: string; width: number; height: number };
  metadata: any;
  file?: { format: string; bytes: number };
};
export default function ImageImport({
  imported,
  current,
  onClose,
  onImport,
  onUse,
  onChoose,
  loadError,
  reading,
}: {
  imported: ImportedImage;
  current: Params;
  onClose: () => void;
  onImport: (params: Params) => void;
  onUse: (kind: "base" | "vibe" | "precise") => void;
  onChoose: () => void;
  loadError: string;
  reading: boolean;
}) {
  const { image, metadata } = imported;
  const available = metadata?.available || {};
  const [choice, setChoice] = useState({
    prompt: !!available.prompt,
    negative: !!available.negative,
    characters: !!available.characters,
    settings: !!available.settings,
    seed: !!available.seed,
    actual: false,
    append: false,
    appendCharacters: false,
  });
  const [error, setError] = useState("");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const scroll = useRef<HTMLDivElement>(null);
  const source: Params | undefined = choice.actual
    ? metadata?.actualParams
    : metadata?.params;
  // 当前草稿可能挂着 OpenAI / 中转的模型，那不是 NovelAI 模型：这里必须允许为空，
  // 否则下面 model?.vibe 一取就抛错，整个界面白屏。
  const model = MODELS.find((m) => m.id === current.model);
  const selectedModel = MODELS.find((m) => m.id === source?.model);
  const showParameter = (key: string) => {
    if (key === "normalizeVibes") return !!selectedModel?.vibe;
    if (["smea", "smeaDyn", "decrisper"].includes(key))
      return selectedModel?.family === "v3";
    if (["effort", "autoText", "dataset"].includes(key))
      return selectedModel?.family === "v5";
    if (key === "transparent") return !!selectedModel?.transparency;
    if (key === "varietyPlus")
      return !!selectedModel?.variety || selectedModel?.family === "v3";
    if (key === "positionMode") return !!selectedModel?.maxCharacters;
    return true;
  };
  const fitted = source && normalizeBaseDims(source.width, source.height);
  const selectedCount = [
    "prompt",
    "negative",
    "characters",
    "settings",
    "seed",
  ].filter((k) => choice[k as keyof typeof choice] && available[k]).length;
  const toggle = (key: keyof typeof choice, value: boolean) => {
    setChoice((c) => ({ ...c, [key]: value }));
    setError("");
  };
  const metadataRow = (
    key: "prompt" | "negative" | "characters" | "settings" | "seed",
    title: string,
    summary: string,
    body?: React.ReactNode,
  ) => (
    <section
      className={`import-setting ${choice[key] && available[key] ? "is-chosen" : ""}`}
    >
      <label className="import-check-row">
        <input
          type="checkbox"
          className="import-check"
          checked={choice[key] && !!available[key]}
          disabled={!available[key]}
          onChange={(e) => toggle(key, e.target.checked)}
        />
        <span>
          <b>{title}</b>
          <small>
            {available[key]
              ? expandedRows[key] && ["prompt", "negative"].includes(key)
                ? summary.split(" · ")[0]
                : summary
              : "文件中未记录，保留当前内容"}
          </small>
        </span>
      </label>
      {available[key] && body && (
        <details
          className="import-field-detail"
          onToggle={(e) => {
            const open = e.currentTarget.open;
            setExpandedRows((rows) => ({ ...rows, [key]: open }));
          }}
        >
          <summary>
            {expandedRows[key] ? "收起" : "查看"}
            {title === "生成参数" ? "参数" : "内容"}
          </summary>
          {body}
        </details>
      )}
    </section>
  );
  return (
    <LibraryDialog
      title="从图片继续创作"
      className="image-import-dialog"
      onClose={onClose}
    >
      <div className="image-import-layout">
        <aside className="import-image-side">
          <div className="import-image-frame">
            <img
              src={`data:image/png;base64,${image.data}`}
              alt="待导入图片的完整预览"
            />
          </div>
          <div className="import-file">
            <div>
              <h3 title={image.name}>{image.name}</h3>
              <p>
                {imported.file?.format?.toUpperCase() || "PNG"} · {image.width}{" "}
                × {image.height}
                {imported.file &&
                  ` · ${(imported.file.bytes / 1048576).toFixed(1)} MB`}
              </p>
            </div>
            <button
              type="button"
              className="text-link"
              disabled={reading}
              onClick={onChoose}
            >
              换一张
            </button>
          </div>
          <section className="import-uses" aria-label="使用图片画面">
            <h3>使用这张画面</h3>
            <button
              type="button"
              className="import-use"
              disabled={reading}
              onClick={() => onUse("base")}
            >
              <Icon name="image" />
              <span>
                <b>用作底图</b>
                <small>图生图、涂鸦与局部重绘</small>
              </span>
              <span aria-hidden="true">↗</span>
            </button>
            {(model?.vibe || model?.precise) && (
              <div className="import-reference-uses">
                {model?.vibe && (
                  <button
                    type="button"
                    className="import-use"
                    disabled={reading || current.references.length >= 16}
                    onClick={() => onUse("vibe")}
                  >
                    <Icon name="layers" />
                    <span>
                      <b>Vibe 迁移</b>
                      <small>借用氛围与视觉特征</small>
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                )}
                {model?.precise && (
                  <button
                    type="button"
                    className="import-use"
                    disabled={reading || current.references.length >= 16}
                    onClick={() => onUse("precise")}
                  >
                    <Icon name="user" />
                    <span>
                      <b>精确参考</b>
                      <small>参考角色或画风</small>
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                )}
              </div>
            )}
            {(model?.vibe || model?.precise) &&
              current.references.length >= 16 && (
                <p className="note">参考图已达 16 张，请先移除一张。</p>
              )}
          </section>
        </aside>
        <section className="import-metadata-side">
          <div className="import-metadata-scroll" ref={scroll}>
            {source ? (
              <>
                <div className="import-section-heading">
                  <div>
                    <h3>这张图，记录了什么</h3>
                  </div>
                  <span className="tag">
                    {metadata.source === "nwenai" ? "Vellum" : "NovelAI"} 元数据
                  </span>
                </div>
                <p className="import-intro">
                  勾选要带入的内容，未勾选的保持不变。
                </p>
                {metadata.actualParams && (
                  <div
                    className="import-source-tabs"
                    role="group"
                    aria-label="提示词来源"
                  >
                    <span
                      className={`import-tab-indicator ${choice.actual ? "is-actual" : ""}`}
                      aria-hidden="true"
                    />
                    {[
                      [false, "原始提示词"],
                      [true, "实际生成词"],
                    ].map(([value, label]) => (
                      <button
                        key={String(value)}
                        type="button"
                        aria-pressed={choice.actual === value}
                        onClick={() => toggle("actual", value as boolean)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="import-settings-list">
                  {metadataRow(
                    "prompt",
                    "正面提示词",
                    `${source.prompt.length.toLocaleString()} 字符 · ${source.prompt.slice(0, 64) || "空内容"}`,
                    <pre className="import-prompt">
                      {source.prompt || "未填写"}
                    </pre>,
                  )}
                  {metadataRow(
                    "negative",
                    "负面提示词",
                    `${source.negative.length.toLocaleString()} 字符 · ${source.negative.slice(0, 54) || "空内容"}`,
                    <pre className="import-prompt">
                      {source.negative || "未填写"}
                    </pre>,
                  )}
                  {metadataRow(
                    "characters",
                    "角色与位置",
                    `${source.characters.length} 个角色 · ${source.positionMode === "custom" ? "手动位置" : "AI 安排位置"}`,
                    <div className="import-characters">
                      {source.characters.length ? (
                        source.characters.map((c, i) => (
                          <div key={c.id || i}>
                            <b>
                              {String(i + 1).padStart(2, "0")} ·{" "}
                              {c.name || `角色 ${i + 1}`}
                            </b>
                            <p>{c.prompt || "未填写角色描述"}</p>
                            {c.uc && <p className="note">负面：{c.uc}</p>}
                            <small>
                              {c.enabled ? "启用" : "未启用"} · X {c.x} / Y{" "}
                              {c.y}
                            </small>
                          </div>
                        ))
                      ) : (
                        <p className="note">导入后清空当前角色列表。</p>
                      )}
                    </div>,
                  )}
                  {choice.characters &&
                    available.characters &&
                    current.characters.length > 0 && (
                      <label className="import-sub-option">
                        <input
                          type="checkbox"
                          className="import-check"
                          checked={choice.appendCharacters}
                          onChange={(e) =>
                            toggle("appendCharacters", e.target.checked)
                          }
                        />
                        追加到现有的 {current.characters.length} 个角色
                      </label>
                    )}
                  {metadataRow(
                    "settings",
                    "生成参数",
                    [
                      metadata.settingsKeys.includes("model")
                        ? selectedModel?.label
                        : "模型未记录",
                      ...(metadata.settingsKeys.includes("width") &&
                      metadata.settingsKeys.includes("height")
                        ? [`${source.width} × ${source.height}`]
                        : []),
                      ...(metadata.settingsKeys.includes("steps")
                        ? [`${source.steps} 步`]
                        : []),
                    ].join(" · "),
                    <dl className="import-parameter-list">
                      {[
                        ["model", "模型", selectedModel?.label],
                        ["width", "宽度", source.width],
                        ["height", "高度", source.height],
                        ["steps", "步骤", source.steps],
                        ["scale", "提示词引导", source.scale],
                        [
                          "sampler",
                          "采样器",
                          SAMPLER_NAMES[
                            source.sampler as keyof typeof SAMPLER_NAMES
                          ] || source.sampler,
                        ],
                        ["noiseSchedule", "噪声调度", source.noiseSchedule],
                        ["cfgRescale", "CFG Rescale", source.cfgRescale],
                        [
                          "quality",
                          "自动质量标签",
                          source.quality ? "开启" : "关闭",
                        ],
                        ["qualityPreset", "质量预设", source.qualityPreset],
                        ["ucPreset", "负面词预设", source.ucPreset],
                        [
                          "positionMode",
                          "角色位置",
                          source.positionMode === "custom" ? "手动" : "AI 安排",
                        ],
                        ["dataset", "数据集", source.dataset || "默认"],
                        ["autoText", "自动文字提示", source.autoText],
                        [
                          "effort",
                          "生成品质",
                          source.effort === "medium" ? "Medium" : "Full",
                        ],
                        ["varietyPlus", "Variety+", source.varietyPlus],
                        ["smea", "SMEA", source.smea],
                        ["smeaDyn", "动态 SMEA", source.smeaDyn],
                        ["decrisper", "动态阈值", source.decrisper],
                        ["transparent", "透明背景", source.transparent],
                        [
                          "normalizeVibes",
                          "Vibe 强度归一化",
                          source.normalizeVibes,
                        ],
                        ["strength", "图生图变化强度", source.strength],
                        ["noise", "图生图噪声", source.noise],
                        [
                          "inpaintStrength",
                          "局部重绘强度",
                          source.inpaintStrength,
                        ],
                        ["enhance", "增强", source.enhance],
                        ["enhanceMax", "Enhance Max", source.enhanceMax],
                      ]
                        .filter(
                          ([k]) =>
                            metadata.settingsKeys.includes(k) &&
                            showParameter(k as string),
                        )
                        .map(([key, label, value]) => (
                          <div key={key}>
                            <dt>{label}</dt>
                            <dd>
                              {typeof value === "boolean"
                                ? value
                                  ? "开启"
                                  : "关闭"
                                : value}
                            </dd>
                          </div>
                        ))}
                    </dl>,
                  )}
                  {metadataRow(
                    "seed",
                    "种子",
                    `${source.seed ?? "未记录"} · 便于复现和对比`,
                  )}
                </div>
                <label className="import-append-option">
                  <input
                    type="checkbox"
                    className="import-check"
                    checked={choice.append}
                    disabled={!choice.prompt && !choice.negative}
                    onChange={(e) => toggle("append", e.target.checked)}
                  />
                  <span>
                    追加提示词<small>接在当前正负词后面，保留原有内容</small>
                  </span>
                </label>
                {choice.settings &&
                  fitted &&
                  (fitted.width !== source.width ||
                    fitted.height !== source.height) && (
                    <p className="import-note">
                      导入生成尺寸将适配为 {fitted.width} × {fitted.height}
                      ，以满足 64 像素步长及生成像素上限。
                    </p>
                  )}
                {metadata.operation &&
                  metadata.operation.kind !== "generate" && (
                    <p className="import-note">
                      图像处理记录：
                      {(
                        {
                          upscale: "高清放大",
                          director: "导演工具",
                          inpaint: "局部重绘",
                          img2img: "图生图",
                          enhance: "增强",
                          variation: "变体",
                        } as Record<string, string>
                      )[metadata.operation.kind] || metadata.operation.kind}
                      。文件尺寸为实际输出尺寸。
                    </p>
                  )}
                {metadata.warnings?.map((w: string) => (
                  <p className="import-note" key={w}>
                    <Icon name="info" />
                    {w}
                  </p>
                ))}
              </>
            ) : (
              <div className="import-no-metadata">
                <Icon name="image" />
                <h3>未识别到可恢复的创作记录</h3>
                <p>
                  可以把它用作底图
                  {model?.vibe || model?.precise ? "或参考图" : ""}
                  ，从画面继续创作。
                </p>
                <span className="import-note">
                  截图、转码或社交平台保存的图片可能不含元数据。
                </span>
                <Button onClick={onChoose}>换一张图片</Button>
              </div>
            )}
          </div>
          <footer className="import-footer">
            <ScrollHint target={scroll} />
            {reading && (
              <p className="import-note" role="status">
                正在读取新图片…
              </p>
            )}
            {(error || loadError) && (
              <p className="library-error" role="alert">
                {error || loadError}
              </p>
            )}
            {source ? (
              <>
                <div className="import-footer-summary">
                  <b>带入 {selectedCount} 项</b>
                  <span>保留当前连接、底图与参考图</span>
                </div>
                <div className="actions">
                  <Button onClick={onClose}>取消</Button>
                  <Button
                    primary
                    disabled={!selectedCount || reading}
                    onClick={() => {
                      try {
                        onImport(
                          applyMetadataImport(current, metadata, choice),
                        );
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    导入选中设置
                  </Button>
                </div>
              </>
            ) : (
              <Button onClick={onClose}>返回工作台</Button>
            )}
          </footer>
        </section>
      </div>
    </LibraryDialog>
  );
}
