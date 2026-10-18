import { readPendingDraft, cachePendingDraft, clearPendingDraft } from "../shared/draft-recovery.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MODELS,
  MODELS_BY_NEWEST,
  defaults,
  modelById,
  changeModel,
  RESOLUTIONS,
  SAMPLER_NAMES,
  ucPresets,
  DIRECTOR_TOOLS,
  EMOTIONS,
  validateParams,
  promptText,
} from "../shared/novelai.mjs";
import { api, download, fileData, imageToData } from "./api";
import { loadPrefs } from "./prefs";
import { Icon, Button, Field, Toggle, Slider, Empty, Select } from "./ui";
import Templates from "./TemplateLibrary";
import TemplatePicker from "./TemplatePicker";
import ArtistLibrary, { ArtistPicker } from "./ArtistLibrary";
import type { ArtistLibraryData, ArtistChoice } from "./types";
import ImageImport from "./ImageImport";
import ImageInspector from "./ImageInspector";
import CharacterEditor, { characterPosition } from "./CharacterEditor";
import CharacterPositionCanvas from "./CharacterPositionCanvas";
import {
  characterGrid,
  normalizeCharacterPositions,
  snapCharacterPosition,
} from "../shared/novelai.mjs";
import History from "./HistoryLibrary";
import Settings from "./Settings";
import { AssistantPanel } from "./AssistantPanel";
import ErrorBoundary from "./ErrorBoundary";
import ArtworkDetails from "./ArtworkDetails";
import CanvasEditor from "./CanvasEditor";
import ResolutionControl from "./ResolutionControl";
import RecentWorks from "./RecentWorks";
import { sessionBaseline, sessionWorks } from "../shared/workspace-session.mjs";
import PromptInput from "./PromptInput";
import ConnectionAccount from "./ConnectionAccount";
import { useImageActionQuote } from "./useImageActionQuote";
import { useConnectionAccount } from "./useConnectionAccount";
import { generationQuote } from "../shared/generation-cost.mjs";
import { expandedPrompts } from "../shared/prompt-tools.mjs";
import { ENHANCE_LEVELS, enhanceScales } from "../shared/image-actions.mjs";
import {
  constrainResolution,
  normalizeBaseDims,
  resolutionPreset,
  resolutionOrientation,
  orientResolution,
} from "../shared/resolution.mjs";
import { importVibes, exportVibes } from "./vibes";
import {
  GPT_BACKGROUND,
  GPT_FORMAT,
  GPT_MODERATION,
  GPT_PARTIAL,
  GPT_QUALITY,
  GPT_RATIOS,
  GPT_TIERS,
  gptSizeFor,
  OPENAI_IMAGE_MODELS,
  gptSizeIssue,
  isOpenAIImageModel,
  openAIImageModel,
  builtinImageModels,
  foreignImageModel,
} from "../shared/image-models.mjs";
import { protocolOfConnection } from "../shared/image-protocols.mjs";
import type {
  Params,
  Connection,
  HistoryItem,
  Template,
  Task,
  Reference,
  Character,
  Collection,
} from "./types";
import { isChatConnection, isImageConnection } from "./types";

// 完成提示音：两下短音，不依赖音频文件。
function playDoneChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.18].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1174;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.18);
    });
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {}
}
function notifyDone(count: number) {
  try {
    if (!("Notification" in window)) return;
    const title = "Vellum · 生成完成";
    const body = count > 1 ? `${count} 张图片已保存` : "图片已保存";
    if (Notification.permission === "granted") new Notification(title, { body });
    else if (Notification.permission === "default")
      Notification.requestPermission().then((p) => {
        if (p === "granted") new Notification(title, { body });
      });
  } catch {}
}
type Drawer =
  | ""
  | "advanced"
  | "prompt"
  | "characters"
  | "vibe"
  | "precise"
  | "templates"
  | "artists"
  | "image"
  | "upscale"
  | "variation"
  | "enhance"
  | "director"
  | "queue";
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const r = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    r.current?.showModal();
  }, []);
  return (
    <dialog
      ref={r}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === r.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-btn" aria-label="关闭" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
function restoreWithChunks(current: Params, next: Params): Params {
  const library = [...(current.promptChunks || [])];
  for (const c of next.promptChunks || [])
    if (!library.some((x: any) => x.name === c.name)) library.push(c);
  let expanded = next;
  try {
    expanded = expandedPrompts({
      ...next,
      promptChunks: next.promptChunks?.length ? next.promptChunks : library,
    });
  } catch {}
  return {
    ...defaults(novelAIModelId(next.model)),
    ...expanded,
    promptChunks: library,
    ...(next.randomizerSource?.prompt === next.prompt
      ? {
          randomizerSource: {
            prompt: expanded.prompt,
            negative: expanded.negative,
            characters: expanded.characters.map((c) => ({
              prompt: c.prompt,
              uc: c.uc,
            })),
          },
        }
      : {}),
  };
}
export default function App() {
  const templateTrigger = useRef<HTMLButtonElement>(null);
  const artistTrigger = useRef<HTMLButtonElement>(null);
  const artistWasOpen = useRef(false);
  const [artistData, setArtistData] = useState<ArtistLibraryData>({ items: [], storage: { activeDir: "" } });
  const templateWasOpen = useRef(false);
  const [p, setP] = useState<Params>(defaults() as Params),
    [connections, setConnections] = useState<Connection[]>([]),
    [assistantConnectionId, setAssistantConnectionId] = useState(""),
    [templates, setTemplates] = useState<Template[]>([]),
    [collections, setCollections] = useState<Collection[]>([]),
    [history, setHistory] = useState<HistoryItem[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [connectionId, setConnectionId] = useState(""),
    [page, setPage] = useState("workbench"),
    [drawer, setDrawer] = useState<Drawer>(""),
    [promptTab, setPromptTab] = useState<"prompt" | "negative">("prompt"),
    [characterId, setCharacterId] = useState(""),
    [selected, setSelected] = useState<HistoryItem | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [messagePaused, setMessagePaused] = useState(false),
    [loaded, setLoaded] = useState(false),
    [saved, setSaved] = useState(""),
    [saving, setSaving] = useState(false),
    [modelChoice, setModelChoice] = useState(""),
    [refBusy, setRefBusy] = useState(""),
    [submitBusy, setSubmitBusy] = useState(false),
    [actionBusy, setActionBusy] = useState(""),
    [enhanceScale, setEnhanceScale] = useState<number | "max">(1.5),
    [enhanceLevel, setEnhanceLevel] = useState(3),
    [enhanceStrength, setEnhanceStrength] = useState(0.5),
    [enhanceNoise, setEnhanceNoise] = useState(0),
    [enhanceAdvanced, setEnhanceAdvanced] = useState(false),
    [editor, setEditor] = useState<{
      source: string | null;
      width: number;
      height: number;
      mask?: string;
      focus?: any;
      refId?: string;
    } | null>(null),
    [imported, setImported] = useState<any>(null),
    [importIssue, setImportIssue] = useState(""),
    [importBusy, setImportBusy] = useState(false),
    [tplQuery, setTplQuery] = useState(""),
    [tplSide, setTplSide] = useState<"positive" | "negative">("positive"),
    [tplPosition, setTplPosition] = useState<"start" | "end">("end"),
    [dataDir, setDataDir] = useState(""),
    [detail, setDetail] = useState<HistoryItem | null>(null);
  useEffect(() => {
    if (templateWasOpen.current && drawer !== "templates" && page === "workbench") {
      templateTrigger.current?.focus();
    }
    templateWasOpen.current = drawer === "templates";
  }, [drawer, page]);
  useEffect(() => {
    if (artistWasOpen.current && drawer !== "artists" && page === "workbench") artistTrigger.current?.focus();
    artistWasOpen.current = drawer === "artists";
  }, [drawer, page]);
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    api<ArtistLibraryData>("/artists").then(next => { if (alive) setArtistData(next); }).catch(e => { if (alive) setArtistData(old => ({ ...old, error: e.message })); });
    return () => { alive = false; };
  }, [loaded]);
  function changeArtistData(next: ArtistLibraryData) {
    setArtistData(next);
    setP(old => ({ ...old, artists: (Array.isArray(old.artists) ? old.artists : []).map((choice: ArtistChoice) => {
      const item = next.items.find(a => a.id === choice.id);
      return item ? { ...choice, name: item.name, tag: item.tag } : choice;
    }) }));
  }
  const [director, setDirector] = useState({
      type: "bg-removal",
      defry: 0,
      emotion: "neutral",
      prompt: "",
    }),
    [encOnly, setEncOnly] = useState(false);
  const sizePreset = p.resolutionCustom
    ? "custom"
    : resolutionPreset(p.width, p.height);
  const upload = useRef<HTMLInputElement>(null),
    gptRefsUpload = useRef<HTMLInputElement>(null),
    referenceUpload = useRef<HTMLInputElement>(null),
    vibeUpload = useRef<HTMLInputElement>(null),
    importJson = useRef<HTMLInputElement>(null),
    referenceKind = useRef<"vibe" | "precise">("vibe"),
    resultCount = useRef(-1),
    importVersion = useRef(0),
    saveVersion = useRef(0),
    alive = useRef(true),
    pRef = useRef(p),
    latestSave = useRef(Promise.resolve());
  const draftWorkspace = useRef("");
  const draftCached = useRef(true);
  const draftDirty = useRef(false);
  pRef.current = p;
  const fail = useCallback((s: string) => {
      setError(s);
    }, []),
    patch = (v: Partial<Params>) => setP((old) => ({ ...old, ...v }));
  const [tokenCount, setTokenCount] = useState<{
    positive: number;
    negative: number;
  } | null>(null);
  const counter = useRef<Worker | null>(null),
    counterId = useRef(0);
  const [visitedPages, setVisitedPages] = useState<Record<string, boolean>>({});
  const residentScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (drawer === "characters") residentScrollRef.current?.scrollTo({ top: 0 }); }, [drawer]);
  const [followingGeneration, setFollowingGeneration] = useState(true);
  // 角色定位：只在中央工作区临时盖一层画布，不卸载底下的作品。
  const [positioning, setPositioning] = useState(false);
  const followGenerationRef = useRef(true);
  const [initialHistoryIds, setInitialHistoryIds] =
    useState<Set<string> | null>(null);
  // 任务队列和最近作品一样，只保留这次打开之后产生的；正在跑的任务照旧显示。
  const [taskBaseline, setTaskBaseline] = useState<Set<string> | null>(null);
  const sessionTasks = (list: Task[]) =>
    !taskBaseline
      ? list
      : list.filter(
          (t) =>
            !taskBaseline.has(t.id) ||
            t.status === "queued" ||
            t.status === "running",
        );
  function followGeneration() {
    followGenerationRef.current = true;
    setFollowingGeneration(true);
  }
  function viewArtwork(image: HistoryItem) {
    followGenerationRef.current = false;
    setFollowingGeneration(false);
    setSelected(image);
    setEditor(null);
  }
  useEffect(() => {
    if (page !== "workbench")
      setVisitedPages((old) => (old[page] ? old : { ...old, [page]: true }));
  }, [page]);
  // GPT Image 不是 NovelAI 模型：这里给 hidden 分支留一个占位，可见文案一律用 modelLabel。
  // 判定按连接协议来：中转站常把模型名改掉，不能只认注册表里的两个名字。
  const connection = connections.find((c) => c.id === connectionId),
    isOpenAIProtocol = protocolOfConnection(connection).id === "openai-images",
    // 这条连接能不能吃底图；不能的话，界面不该摆出「图生图」这条路。
    canEditImages = (() => {
      const spec = protocolOfConnection(connection);
      return spec.capabilities
        ? spec.capabilities.includes("image.edit")
        : !!spec.implemented;
    })(),
    gpt =
      protocolOfConnection(connection).id === "openai-images" ||
      !MODELS.some((m) => m.id === p.model),
    model = gpt ? MODELS[0] : modelById(p.model),
    modelLabel = gpt
      ? openAIImageModel(p.model)?.label || p.model
      : model.label,
    availableModels = imageModelsFor(connection),
    connectionReady =
      !!connection && availableModels.some((m) => m.id === p.model),
    gptRefs: any[] = Array.isArray(p.gptRefs) ? p.gptRefs : [],
    gptTier = (p.gptTier as string) || "1k",
    gptRatio = (p.gptRatio as string) || "1:1",
    gptSize = (p.size as string) || gptSizeFor("1k", "1:1"),
    gptIssue =
      gpt && gptSize === "custom" ? gptSizeIssue(p.width, p.height) : null,
    medium = p.effort === "medium" && p.model === "nai-diffusion-5-full",
    active = tasks.filter((t) => ["queued", "running"].includes(t.status)),
    current = tasks.find((t) => t.status === "running"),
    preview = current?.preview;
  const account = useConnectionAccount(
    connection,
    `${history.length}:${active.length}`,
  );
  let quote;
  if (gpt) {
    // OpenAI 按张计费、价格随模型与质量变化，本机不估算，也不编一个数字。
    quote = {
      anlas: null,
      kind: "unknown",
      reason: "GPT Image 的费用以 OpenAI 账单为准，本机不估算",
    };
  } else {
    try {
      quote = generationQuote(
        p,
        account.state.error ? null : account.state.sub,
        connection?.official === true,
      );
    } catch {
      quote = { anlas: null, kind: "unknown", reason: "参数不完整" };
    }
  }
  const imageActionOpen = [
    "enhance",
    "variation",
    "upscale",
    "director",
  ].includes(drawer);
  const actionQuote = useImageActionQuote(
    imageActionOpen && connectionId && (selected || p.baseImage)
      ? {
          kind: drawer,
          connectionId,
          ...(drawer === "enhance" || drawer === "variation"
            ? {
                historyId: selected?.id,
                currentParams: p,
                scale: enhanceScale,
                strength: enhanceStrength,
                noise: enhanceNoise,
              }
            : {
                width: selected?.width ?? p.baseImage?.width,
                height: selected?.height ?? p.baseImage?.height,
                tool: director.type,
              }),
        }
      : null,
    account.state.at,
  );
  const activityLabel = submitBusy
    ? "正在提交任务…"
    : current
      ? current.phase === "preparing"
        ? "正在准备图像与请求…"
        : current.phase === "saving"
          ? "正在保存生成结果…"
          : preview
            ? `正在生成 · 步骤 ${preview.step}`
            : current.phase === "receiving"
              ? "模型已响应，正在接收图像…"
              : current.phase === "requesting"
                ? "请求已发送，等待模型响应…"
                : "正在处理任务…"
      : active.length
        ? `等待前一个任务完成 · ${active.length} 个任务排队`
        : "";
  const recentImages: HistoryItem[] = sessionWorks(history, initialHistoryIds);
  const availableEnhanceScales = selected
    ? enhanceScales(selected.width, selected.height, p.model)
    : [];
  const imageHeading = selected
    ? (selected.name || "").trim() || "当前图像"
    : p.baseImage
      ? (p.baseImage.name || "").replace(/\.[^.]+$/, "") || "当前输入图像"
      : "当前图像";
  useEffect(() => {
    setEnhanceScale(availableEnhanceScales[0] ?? 1);
  }, [selected?.id, p.model]);
  useEffect(() => {
    if (!model.vibe && drawer === "vibe") setDrawer("");
  if (!model.precise && drawer === "precise") setDrawer("");
  }, [model.vibe, model.precise, drawer]);
  useEffect(() => {
    setMessagePaused(false);
  }, [notice, error]);
  useEffect(() => {
    if (
      !notice ||
      error ||
      messagePaused ||
      notice.includes("正在") ||
      notice.includes("断开")
    )
      return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice, error, messagePaused]);
  useEffect(() => {
    if (editor) setDrawer("");
  }, [editor]);
  // 助手连接独立于图像连接，选择结果只存在本机浏览器里。
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("nwenai.assistant-connection");
      if (stored) setAssistantConnectionId(stored);
    } catch {}
  }, []);
  useEffect(() => {
    const list = connections.filter(isChatConnection);
    if (!list.some((c) => c.id === assistantConnectionId))
      setAssistantConnectionId(list[0]?.id || "");
  }, [connections, assistantConnectionId]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "nwenai.assistant-connection",
        assistantConnectionId,
      );
    } catch {}
  }, [assistantConnectionId]);
  useEffect(() => {
    alive.current = true;
    api("/bootstrap")
      .then((b) => {
        if (!alive.current) return;
        draftWorkspace.current = b.dataDir;
        const recovered = readPendingDraft(() => window.localStorage, b.dataDir);
        const draft = recovered || b.draft;
        setP(
          normalizeCharacterPositions({
            // 只把 NovelAI 认识的模型交给 defaults。OpenAI 与中转别名一律走默认值兜底，
            // 否则 modelById 会抛「未知的 NovelAI 模型」，整个工作台起不来。
            ...defaults(novelAIModelId(draft.model)),
            ...draft,
          }),
        );
        setConnections(b.connections);
        const usable = (b.connections as Connection[]).filter(
          isImageConnection,
        );
        setConnectionId(
          draft.connectionId &&
            usable.some((c: Connection) => c.id === draft.connectionId)
            ? draft.connectionId
            : usable[0]?.id || "",
        );
        let sessionStorageForWorks: Storage | null = null;
        try {
          sessionStorageForWorks = window.sessionStorage;
        } catch {}
        setInitialHistoryIds(
          sessionBaseline(sessionStorageForWorks, b.dataDir, b.history),
        );
        resultCount.current = b.tasks.reduce(
          (sum: number, task: Task) => sum + task.results.length,
          0,
        );
        setHistory(b.history);
        setCollections(b.collections || []);
        {
          const tasksBaseline = sessionBaseline(
            sessionStorage,
            b.dataDir,
            b.tasks,
            "nwenai-task-session",
          );
          setTaskBaseline(tasksBaseline);
          setTasks(
            b.tasks.filter(
              (t: Task) =>
                !tasksBaseline.has(t.id) ||
                t.status === "queued" ||
                t.status === "running",
            ),
          );
        }
        setTemplates(b.templates);
        setDataDir(b.dataDir);
        setLoaded(true);
      })
      .catch((e) => fail(e.message));
    return () => {
      alive.current = false;
    };
  }, [fail]);
  useEffect(() => {
    if (!loaded) return;
    const events = new EventSource("/api/events");
    events.onmessage = (e) => {
      const raw: Task[] = JSON.parse(e.data);
      const ts = sessionTasks(raw);
      setTasks(ts);
      const n = ts.reduce((sum, t) => sum + t.results.length, 0);
      if (resultCount.current !== n) {
        const was = resultCount.current;
        resultCount.current = n;
        api<HistoryItem[]>("/history")
          .then((items) => {
            if (alive.current) {
              setHistory(items);
              if (
                was >= 0 &&
                items[0] &&
                followGenerationRef.current &&
                loadPrefs().followOnDone
              )
                setSelected(items[0]);
            }
          })
          .catch((e) => fail(e.message));
      }
    };
    events.onerror = () => {
      setNotice("任务连接暂时中断，正在重新连接…");
    };
    events.onopen = () => setNotice("");
    return () => events.close();
  }, [loaded, fail]);
  useEffect(() => {
    if (!loaded) return;
    const version = ++saveVersion.current;
    setSaving(true);
    draftDirty.current = true;
    const snapshot = { ...p, connectionId };
    draftCached.current = cachePendingDraft(() => window.localStorage, draftWorkspace.current, snapshot);
    const timer = setTimeout(() => {
      latestSave.current = latestSave.current
        .catch(() => {})
        .then(() => api("/draft", { params: snapshot }, "PUT"))
        .then(() => {
          clearPendingDraft(() => window.localStorage, draftWorkspace.current, snapshot);
          if (alive.current && saveVersion.current === version) {
            draftDirty.current = false;
            setSaved(
              new Date().toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            );
            setSaving(false);
          }
        })
        .catch((e) => {
          if (alive.current && saveVersion.current === version) {
            setSaving(false);
            setSaved("");
            fail("草稿保存失败：" + e.message);
          }
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [p, connectionId, loaded, fail]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (draftDirty.current && !draftCached.current) {
        e.preventDefault(); e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (page === "inspector") return;
      const f = [...(e.clipboardData?.files || [])].find((f) =>
        f.type.startsWith("image/"),
      );
      if (f) {
        e.preventDefault();
        void importImage(f);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [page]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer("");
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === "Enter" &&
        page === "workbench" &&
        !editor &&
        !modelChoice &&
        !imported &&
        !detail
      ) {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    const w = new Worker(new URL("./tokenizer.worker.ts", import.meta.url), {
      type: "module",
    });
    counter.current = w;
    w.onmessage = ({ data }) => {
      if (data.id === counterId.current)
        setTokenCount(
          data.error
            ? null
            : { positive: data.positive, negative: data.negative },
        );
    };
    return () => {
      counter.current = null;
      w.terminate();
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    setTokenCount(null);
    const timer = setTimeout(() => {
      let text;
      try {
        text = promptText(p);
      } catch {
        return;
      }
      const expanded = expandedPrompts(p);
      counter.current?.postMessage({
        id: ++counterId.current,
        model: p.model,
        positive: [
          text.input,
          ...expanded.characters
            .filter((c: Character) => c.enabled)
            .map((c: Character) => c.prompt),
        ],
        negative: [
          text.negative,
          ...expanded.characters
            .filter((c: Character) => c.enabled)
            .map((c: Character) => c.uc),
        ],
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [
    p.model,
    p.prompt,
    p.negative,
    p.characters,
    p.quality,
    p.qualityPreset,
    p.ucPreset,
    p.dataset,
    p.autoText,
    p.promptChunks,
    loaded,
  ]);
  function applyResolution(
    dimensions: { width: number; height: number },
    custom = true,
  ) {
    patch({
      ...dimensions,
      resolutionCustom: custom,
      ...(dimensions.width !== dimensions.height
        ? {
            resolutionRectangle: {
              long: Math.max(dimensions.width, dimensions.height),
              short: Math.min(dimensions.width, dimensions.height),
            },
          }
        : {}),
    });
  }
  function applySizePreset(key: string) {
    if (key === "custom") {
      patch({ resolutionCustom: true });
      return;
    }
    const o = resolutionOrientation(p.width, p.height),
      index =
        key === "wallpaper" && o === "square"
          ? 0
          : { portrait: 0, square: 1, landscape: 2 }[o];
    const [width, height] = RESOLUTIONS[key as keyof typeof RESOLUTIONS][index];
    applyResolution({ width, height }, false);
  }
  useEffect(() => {
    if (drawer !== "artists") return;
    const frame = requestAnimationFrame(() => {
      const area = residentScrollRef.current;
      const section = area?.querySelector(".prompt-library-actions")?.closest(".resident-module");
      if (area && section) area.scrollTop += section.getBoundingClientRect().top - area.getBoundingClientRect().top;
    });
    return () => cancelAnimationFrame(frame);
  }, [drawer]);
  function openDrawer(d: Drawer) {
    setDrawer((old) => (old === d ? "" : d));
  }
  function updateChar(id: string, values: Partial<Character>) {
    setP(old => ({ ...old, characters: old.characters.map(c => c.id === id ? { ...c, ...values } : c) }));
  }
  function updateRef(id: string, values: Partial<Reference>) {
    setP((old) => ({
      ...old,
      references: old.references.map((r) =>
        r.id === id
          ? {
              ...r,
              ...values,
              ...("data" in values || "mask" in values
                ? {
                    encoding: undefined,
                    encodedModel: undefined,
                    encodedMask: undefined,
                  }
                : {}),
            }
          : r,
      ),
    }));
  }
  function addChar() {
    if (p.characters.length >= 64) return fail("请先删除不用的角色");
    const id = crypto.randomUUID();
    patch({
      characters: [
        ...p.characters,
        {
          id,
          name: `角色 ${p.characters.length + 1}`,
          prompt: "",
          uc: "",
          enabled:
            p.characters.filter((c) => c.enabled).length < model.maxCharacters,
          x: 0.5,
          y: 0.5,
        },
      ],
    });
    setCharacterId(id);
    setDrawer("characters");
  }
  async function importImage(file: File) {
    const version = ++importVersion.current;
    setError("");
    setImportIssue("");
    setImportBusy(true);
    try {
      setNotice("正在读取图片…");
      const r = await api("/image/import", {
        data: await fileData(file),
        name: file.name,
      });
      if (version !== importVersion.current) return;
      setImported({ ...r, importId: version });
      setEditor(null);
      setNotice("");
      setPage("workbench");
    } catch (e: any) {
      if (version !== importVersion.current) return;
      setImportIssue(e.message);
      fail(e.message);
      setNotice("");
    } finally {
      if (version === importVersion.current) setImportBusy(false);
    }
  }
  async function addReferences(files: FileList | null) {
    if (!files) return;
    try {
      if (p.references.length + files.length > 16)
        throw new Error("最多添加 16 张参考图");
      const rs: Reference[] = [];
      for (const f of files) {
        const r = await api("/image/import", {
          data: await fileData(f),
          name: f.name,
        });
        const kind = referenceKind.current;
        rs.push({
          id: crypto.randomUUID(),
          name: f.name,
          type: kind,
          data: r.image.data,
          width: r.image.width,
          height: r.image.height,
          enabled: true,
          // 精确参考：官方要求 info 正好 1.0，默认强度 1、保真 1、描述「角色与风格」
          strength: kind === "precise" ? 1 : 0.6,
          info: kind === "precise" ? 1 : 0.7,
          fidelity: 1,
          caption: kind === "precise" ? "character&style" : "character",
        });
      }
      patch({ references: [...p.references, ...rs] });
      setDrawer(referenceKind.current);
    } catch (e: any) {
      fail(e.message);
    }
  }
  async function submit() {
    if (submitBusy) return;
    setError("");
    if (!connectionReady) {
      setPage("settings");
      return;
    }
    setSubmitBusy(true);
    try {
      if (gpt) {
        if (!String(p.prompt || "").trim()) throw new Error("请填写提示词");
        if (gptIssue) throw new Error(gptIssue);
      } else validateParams(p);
      followGeneration();
      await api("/tasks", { connectionId, params: p, kind: "generate" });
      setNotice("任务已加入队列。");
    } catch (e: any) {
      fail(e.message);
    } finally {
      setSubmitBusy(false);
    }
  }
  async function encode(r: Reference) {
    setRefBusy(r.id);
    setError("");
    try {
      const data = await api("/vibe/encode", {
        connectionId,
        model: p.model,
        image: r.data,
        information_extracted: r.info,
        mask: r.mask,
      });
      setP((old) => ({
        ...old,
        references: old.references.map((cur) =>
          cur.id === r.id &&
          cur.data === r.data &&
          cur.info === r.info &&
          (cur.mask || "") === (r.mask || "")
            ? {
                ...cur,
                encoding: data.encoding,
                encodedInfo: r.info,
                encodedModel: p.model,
                encodedMask: r.mask || "",
              }
            : cur,
        ),
      }));
    } catch (e: any) {
      fail(e.message);
    } finally {
      setRefBusy("");
    }
  }
  async function useSelected() {
    if (!selected) return;
    try {
      const result = await api("/image/import", {
        data: await imageToData(selected.url),
        name: "作品.png",
      });
      patch({
        baseImage: result.image,
        mask: null,
        focus: null,
        ...normalizeBaseDims(result.image.width, result.image.height),
      });
      setDrawer("image");
    } catch (e: any) {
      fail(e.message);
    }
  }
  async function runImageAction(kind: "enhance" | "variation") {
    if (!selected || actionBusy) return;
    if (!connectionId) {
      setPage("settings");
      return;
    }
    setActionBusy(kind);
    setError("");
    followGeneration();
    try {
      await api("/image-actions", {
        kind,
        historyId: selected.id,
        connectionId,
        currentParams: p,
        ...(kind === "enhance"
          ? {
              scale: enhanceScale,
              strength: enhanceStrength,
              noise: enhanceNoise,
            }
          : {}),
      });
      setNotice(
        kind === "enhance"
          ? "增强任务已加入队列。"
          : "变体任务已加入队列，将一次生成 3 张。",
      );
      setDrawer((current) => (current === kind ? "" : current));
    } catch (e: any) {
      fail(e.message);
    } finally {
      setActionBusy("");
    }
  }
  async function toolTask(kind: "upscale" | "director") {
    if (actionBusy) return;
    if (!selected && !p.baseImage) return fail("请先选择作品或载入底图");
    if (!connectionId) {
      setPage("settings");
      return;
    }
    setActionBusy(kind);
    setError("");
    followGeneration();
    try {
      await api("/tasks", {
        connectionId,
        kind,
        params: p,
        operation: {
          ...director,
          image: selected
            ? (await imageToData(selected.url)).split(",")[1]
            : p.baseImage.data,
        },
      });
      setNotice("处理任务已加入队列。");
      setDrawer((current) => (current === kind ? "" : current));
    } catch (e: any) {
      fail(e.message);
    } finally {
      setActionBusy("");
    }
  }
  function applyTemplate(t: Template, append: boolean) {
    patch({
      prompt: append
        ? [p.prompt, t.prompt].filter(Boolean).join(", ")
        : t.prompt,
      negative: append
        ? [p.negative, t.negative].filter(Boolean).join(", ")
        : t.negative,
    });
    setPage("workbench");
    setNotice("已填入提示词。");
  }
  // GPT Image 的提示词框：与 NovelAI 同一套编辑器与展开入口，只是不做标签补全。
  const gptPromptEditor = (large = false) => (
    <>
      <div className="resident-tabs" role="tablist" aria-label="提示词">
        <button
          role="tab"
          aria-selected
          className="active"
          onClick={() => setPromptTab("prompt")}
        >
          提示词
        </button>
        <span className="grow" />
        {!large && (
          <button className="text-link" onClick={() => openDrawer("prompt")}>
            长词编辑
          </button>
        )}
      </div>
      <PromptInput
        aria-label={large ? "展开提示词" : "GPT Image 提示词"}
        className={`prompt-input ${large ? "long-editor" : ""}`}
        chunks={[]}
        connectionId=""
        model={p.model}
        value={p.prompt}
        placeholder="用自然语言描述画面：主体、环境、光线、材质、构图…"
        onChange={(value) => patch({ prompt: value })}
      />
      <div className="editor-meta">
        <span>{String(p.prompt || "").length} / 32000 字符</span>
        <span>GPT Image · 自然语言</span>
      </div>
    </>
  );
  const promptEditor = (large = false) => (
    <>
      <div className="resident-tabs" role="tablist" aria-label="全局提示词">
        <button
          role="tab"
          aria-selected={promptTab === "prompt"}
          className={promptTab === "prompt" ? "active" : ""}
          onClick={() => setPromptTab("prompt")}
        >
          正面词
        </button>
        <button
          role="tab"
          aria-selected={promptTab === "negative"}
          className={promptTab === "negative" ? "active" : ""}
          onClick={() => setPromptTab("negative")}
        >
          负面词
        </button>
        <span className="grow" />
        {!large && (
          <button className="text-link" onClick={() => openDrawer("prompt")}>
            长词编辑
          </button>
        )}
      </div>
      <PromptInput
        aria-label={
          large
            ? "展开提示词"
            : promptTab === "prompt"
              ? "正面提示词"
              : "负面提示词"
        }
        className={`prompt-input ${large ? "long-editor" : ""}`}
        chunks={p.promptChunks || []}
        connectionId={connectionId}
        model={p.model}
        value={p[promptTab]}
        disabled={promptTab === "negative" && medium}
        placeholder={
          promptTab === "prompt"
            ? "描述你想画的场景，或粘贴画师串…"
            : "不想出现的内容…"
        }
        onChange={(value) => patch({ [promptTab]: value })}
      />
      <div className="editor-meta">
        <span
          className={
            tokenCount &&
            (promptTab === "prompt"
              ? tokenCount.positive
              : tokenCount.negative) > model.context
              ? "token-overflow"
              : ""
          }
          title="按官方词表在本机计数，包含启用角色与自动标签；复杂强调语法可能有差异。超过上下文的部分可能不会被模型完整采用。"
        >
          {tokenCount
            ? `≈ ${promptTab === "prompt" ? tokenCount.positive : tokenCount.negative} / ${model.context} Tokens`
            : `${p[promptTab].length.toLocaleString()} 字符`}
        </span>
      </div>
    </>
  );
  // GPT 的参考图：按顺序跟在底图后面，最多 16 张（含底图）。
  async function addGptRefs(files: FileList | null) {
    if (!files?.length) return;
    try {
      const room = 16 - gptRefs.length - (p.baseImage ? 1 : 0);
      if (files.length > room)
        throw new Error(room > 0 ? `最多再添加 ${room} 张` : "最多 16 张输入图像");
      const added: any[] = [];
      for (const file of Array.from(files)) {
        const data = await fileData(file);
        const size = await new Promise<{ width: number; height: number }>(
          (resolve) => {
            const img = new Image();
            img.onload = () =>
              resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => resolve({ width: 0, height: 0 });
            img.src = data;
          },
        );
        added.push({
          id: crypto.randomUUID(),
          name: file.name,
          data,
          ...size,
        });
      }
      patch({ gptRefs: [...gptRefs, ...added] });
      setNotice(`已添加 ${added.length} 张参考图。`);
    } catch (e: any) {
      fail(e.message);
    }
  }
  function moveGptRef(id: string, delta: number) {
    const list = [...gptRefs];
    const i = list.findIndex((r) => r.id === id),
      j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    patch({ gptRefs: list });
  }
  // 清晰度 × 比例 → 官方 WIDTHxHEIGHT，并同步宽高供画布使用。
  function applyGptSize(tier: string, ratio: string) {
    const size = gptSizeFor(tier, ratio);
    if (!size) return;
    const [width, height] = size.split("x").map(Number);
    patch({ gptTier: tier, gptRatio: ratio, size, width, height });
  }
  const gptSizeLabel = () => {
    const size = p.size as string;
    if (!size || size === "custom")
      return `自定义 ${p.width} × ${p.height}${gptIssue ? " · " + gptIssue : ""}`;
    if (size === "auto") return "自动尺寸";
    const [w, h] = size.split("x").map(Number),
      issue = gptSizeIssue(w, h);
    return `${w} × ${h}${issue ? " · 实验性" : ""}`;
  };
  // 抽屉里的小块按钮：比一排下拉更好扫，也更像参数面板。
  function chips(
    rows: any[],
    value: any,
    onPick: (v: any) => void,
    className = "",
  ) {
    return (
      <div className={`chip-grid ${className}`}>
        {rows.map(([v, label]: any) => (
          <button
            key={String(v)}
            type="button"
            className={`format-item ${String(value) === String(v) ? "active" : ""}`}
            aria-pressed={String(value) === String(v)}
            onClick={() => onPick(v)}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }
  function renderGptAdvanced() {
    return (
      <>
        <section className="detail-section">
          <h3>画质</h3>
          {chips(GPT_QUALITY, p.quality || "auto", (quality) =>
            patch({ quality }),
          )}
          <h3>清晰度</h3>
          {chips(GPT_TIERS, gptTier, (tier) => applyGptSize(tier, gptRatio))}
          <h3>比例</h3>
          {chips(
            GPT_RATIOS.map((r) => [r, r]),
            gptRatio,
            (ratio) => applyGptSize(gptTier, ratio),
            "ratios",
          )}
          <h3>背景</h3>
          {chips(GPT_BACKGROUND, p.background || "auto", (background) =>
            patch({
              background,
              ...(background === "transparent" && p.outputFormat === "jpeg"
                ? { outputFormat: "png" }
                : {}),
            }),
          )}
        </section>
        <section className="detail-section">
          <h3>输出</h3>
          {chips(
            GPT_FORMAT.filter(
              ([value]: any) =>
                !(
                  (p.background || "auto") === "transparent" &&
                  value === "jpeg"
                ),
            ),
            p.outputFormat || "png",
            (outputFormat) => patch({ outputFormat }),
          )}
          <Field label="压缩 · JPEG / WebP">
            <input
              type="number"
              min="0"
              max="100"
              placeholder="默认 100"
              disabled={!["jpeg", "webp"].includes(p.outputFormat || "png")}
              value={p.outputCompression ?? ""}
              onChange={(e) =>
                patch({
                  outputCompression: e.target.value === "" ? null : +e.target.value,
                })
              }
            />
          </Field>
          <div className="grid2 compact">
            <Field label="自定义宽">
              <input
                type="number"
                min="16"
                step="16"
                value={p.width}
                onChange={(e) =>
                  patch({ width: +e.target.value, size: "custom" })
                }
              />
            </Field>
            <Field label="自定义高">
              <input
                type="number"
                min="16"
                step="16"
                value={p.height}
                onChange={(e) =>
                  patch({ height: +e.target.value, size: "custom" })
                }
              />
            </Field>
          </div>
          <p className="note">
            {p.size === "custom"
              ? gptIssue || "16 的倍数，比例 1:3–3:1，单边不超过 3840"
              : "改宽高会切到自定义尺寸"}
          </p>
        </section>
        <section className="detail-section">
          <h3>其他</h3>
          <span className="note">内容审核</span>
          {chips(GPT_MODERATION, p.moderation || "auto", (moderation) =>
            patch({ moderation }),
          )}
          <span className="note">流式中间图</span>
          {chips(GPT_PARTIAL, p.partialImages ?? 0, (partialImages) =>
            patch({ partialImages }),
          )}
          <Field label="安全标识 · 选填">
            <input
              value={p.safetyIdentifier ?? ""}
              placeholder="用户名或邮箱的哈希"
              onChange={(e) => patch({ safetyIdentifier: e.target.value })}
            />
          </Field>
        </section>
      </>
    );
  }
  function renderAdvanced() {
    return (
      <>
        <section className="detail-section">
          <div className="section-title">
            <h3>高级采样</h3>
            <button
              className="text-link"
              onClick={() => {
                const d = defaults(p.model);
                patch({
                  cfgRescale: d.cfgRescale,
                  noiseSchedule: d.noiseSchedule,
                  varietyPlus: false,
                  smea: false,
                  smeaDyn: false,
                  decrisper: false,
                });
              }}
            >
              恢复默认
            </button>
          </div>
          <Slider
            label="引导重缩放 · CFG Rescale"
            value={p.cfgRescale}
            disabled={medium}
            onChange={(cfgRescale) => patch({ cfgRescale })}
          />
          <Field label="噪声调度">
            <Select
              value={p.noiseSchedule}
              onChange={(e) => patch({ noiseSchedule: e.target.value })}
            >
              {model.noiseSchedules.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </Field>
          {(model.variety || model.family === "v3") && (
            <Toggle
              label="Variety+"
              hint="增加生成的变化"
              checked={p.varietyPlus}
              onChange={(varietyPlus) => patch({ varietyPlus })}
            />
          )}
          <Toggle
            label="Decrisper"
            hint="降低高引导值带来的过度锐化；V3 可用"
            checked={p.decrisper}
            disabled={model.family !== "v3"}
            onChange={(decrisper) => patch({ decrisper })}
          />
          {model.family === "v3" && (
            <>
              <Toggle
                label="SMEA"
                checked={p.smea}
                onChange={(smea) => patch({ smea })}
              />
              <Toggle
                label="SMEA DYN"
                checked={p.smeaDyn}
                disabled={!p.smea}
                onChange={(smeaDyn) => patch({ smeaDyn })}
              />
            </>
          )}
        </section>
        <section className="detail-section">
          <h3>输出尺寸</h3>
          <ResolutionControl
            width={p.width}
            height={p.height}
            onChange={applyResolution}
            sliders
          />
          <Field label="尺寸预设">
            <Select
              value={sizePreset}
              onChange={(e) => applySizePreset(e.target.value)}
            >
              <option value="small">小尺寸</option>
              <option value="normal">普通</option>
              <option value="large">大尺寸</option>
              <option value="wallpaper">壁纸</option>
              <option value="custom">自定义</option>
            </Select>
          </Field>
          <div className="format-grid">
            {(["portrait", "square", "landscape"] as const).map(
              (orientation, i) => {
                const dims = orientResolution(
                  p.width,
                  p.height,
                  orientation,
                  sizePreset === "custom",
                  p.resolutionRectangle,
                );
                return (
                  <button
                    type="button"
                    className={`format-item ${resolutionOrientation(p.width, p.height) === orientation ? "active" : ""}`}
                    key={orientation}
                    disabled={
                      sizePreset === "wallpaper" && orientation === "square"
                    }
                    onClick={() =>
                      applyResolution(dims, sizePreset === "custom")
                    }
                  >
                    <span
                      className={`format-icon ${i === 1 ? "square" : i === 2 ? "landscape" : ""}`}
                    />
                    <span>
                      <b>{["竖向", "方形", "横向"][i]}</b>
                      <small>
                        {sizePreset === "wallpaper" && orientation === "square"
                          ? "此预设不含方形"
                          : `${dims.width} × ${dims.height}`}
                      </small>
                    </span>
                  </button>
                );
              },
            )}
            <button
              type="button"
              className={`format-item ${sizePreset === "custom" ? "active" : ""}`}
              onClick={() => patch({ resolutionCustom: true })}
            >
              <span>
                <b>自定义</b>
                <small>保持当前尺寸</small>
              </span>
            </button>
          </div>
          <Button
            small
            onClick={() => patch({ width: p.height, height: p.width })}
          >
            交换宽高
          </Button>
        </section>
        <section className="detail-section">
          <h3>生成数量</h3>
          <Field label="本次任务总张数">
            <input
              type="number"
              min="1"
              max="24"
              value={p.total}
              onChange={(e) => patch({ total: +e.target.value })}
            />
          </Field>
          <Field label="每次请求张数">
            <Select
              value={p.batchSize}
              onChange={(e) => patch({ batchSize: +e.target.value })}
            >
              {Array.from(
                { length: p.width * p.height <= 640 * 640 ? 6 : 4 },
                (_, i) => i + 1,
              ).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 张 · 逐张独立请求" : `${n} 张 / 请求`}
                </option>
              ))}
            </Select>
          </Field>
          <p className="note">
            并发由连接设置决定；官方连接始终串行。多张请求与编码可能消耗 Anlas。
          </p>
        </section>
        <section className="detail-section">
          <h3>提示词处理</h3>
          <Field label="数据集">
            <Select
              value={p.dataset}
              onChange={(e) => patch({ dataset: e.target.value })}
            >
              <option value="">默认 / 动漫</option>
              <option value="fur">Furry</option>
              <option value="background">背景</option>
            </Select>
          </Field>
          {model.family === "v5" && (
            <>
              <Toggle
                label="自动 Text 块"
                hint="把引号中的文字追加到 Text: 段落"
                checked={p.autoText}
                onChange={(autoText) => patch({ autoText })}
              />
              <Toggle
                label="透明背景"
                checked={p.transparent}
                onChange={(transparent) => patch({ transparent })}
              />
            </>
          )}
        </section>
      </>
    );
  }
  function renderCharacters() {
    return (
      <CharacterEditor
        params={p}
        selectedId={characterId}
      maxCharacters={model.maxCharacters} medium={medium} connectionId={connectionId}
        onSelect={setCharacterId}
        onUpdate={updateChar}
        onAdd={addChar}
      onMode={positionMode => patch({ positionMode })}
      onCanvas={() => setPositioning(true)}
      onPosition={(id, x, y) => { const next = snapCharacterPosition(p.model, x, y); setP(old => ({ ...old, positionMode: "custom", characters: old.characters.map(c => c.id === id ? { ...c, ...next } : c) })); }}
      onMove={(id, direction) => setP(old => { const chars = [...old.characters], i = chars.findIndex(c => c.id === id), next = i + direction; if (i < 0 || next < 0 || next >= chars.length) return old; [chars[i], chars[next]] = [chars[next], chars[i]]; return { ...old, characters: chars }; })}
      onCopy={id => { if (p.characters.length >= 64) return fail("请先删除不用的角色"); const copyId = crypto.randomUUID(); setP(old => { const i = old.characters.findIndex(c => c.id === id); if (i < 0 || old.characters.length >= 64) return old; const copy = { ...old.characters[i], id: copyId, name: old.characters[i].name + " 副本", enabled: old.characters[i].enabled && old.characters.filter(c => c.enabled).length < model.maxCharacters }; const characters = [...old.characters]; characters.splice(i + 1, 0, copy); return { ...old, characters }; }); setCharacterId(copyId); }}
        onDelete={id => { const i = p.characters.findIndex(c => c.id === id); setP(old => ({ ...old, characters: old.characters.filter(c => c.id !== id) })); setCharacterId(p.characters[i + 1]?.id || p.characters[i - 1]?.id || ""); }}
      />
    );
  }
  function referenceRows(kind: "vibe" | "precise") {
    const list = p.references.filter((r) => r.type === kind);
    if (!list.length)
      return (
        <p className="note">
          {kind === "vibe"
            ? "用氛围图给画面定调，最多 16 张。"
            : "上传角色或风格的参考图。"}
          {kind === "vibe" ? "与精确参考互斥。" : "与 Vibe 互斥。"}
        </p>
      );
    return list.map((r) => (
      <div className="reference-row" key={r.id}>
        {r.data ? (
          <img src={"data:image/png;base64," + r.data} alt={r.name} />
        ) : (
          <Icon name="image" />
        )}
        <button
          className="reference-summary"
          onClick={() => setDrawer(kind)}
        >
          <b>{r.name}</b>
          <small>
            {r.enabled ? "启用" : "停用"} · 强度 {r.strength.toFixed(2)}
          </small>
        </button>
        <input
          type="checkbox"
          className="switch"
          aria-label={`启用参考${r.name}`}
          checked={r.enabled}
          onChange={(e) => updateRef(r.id, { enabled: e.target.checked })}
        />
      </div>
    ));
  }
  function renderTemplateDrawer() {
    return (
      <TemplatePicker
        params={p}
        templates={templates}
        patch={patch}
        side={tplSide}
        onSideChange={setTplSide}
        query={tplQuery}
        onQueryChange={setTplQuery}
        onManage={() => { setDrawer(""); setPage("templates"); }}
      />
    );
  }
  function renderReferences(kind: "vibe" | "precise") {
    const list = p.references.filter((r) => r.type === kind);
    const otherOn = p.references.some(
      (r) => r.type !== kind && r.enabled,
    );
    async function exportOne(r: Reference) {
      try {
        const name = r.name.replace(/\.[^.]+$/, "") || "画面参考";
        download(
          name + ".naiv4vibebundle",
          await exportVibes([r], p.model, encOnly),
        );
      } catch (e: any) {
        fail(e.message);
      }
    }
    return (
      <>
        {kind === "vibe" ? (
          <section className="detail-section">
            <div className="actions">
              <Button
                small
                icon="plus"
                onClick={() => {
                  referenceKind.current = "vibe";
                  referenceUpload.current?.click();
                }}
              >
                添加 Vibe
              </Button>
              <Button small onClick={() => vibeUpload.current?.click()}>
                导入 Vibe 文件
              </Button>
            </div>
            <Toggle
              label="仅导出编码"
              hint="不包含原图，导入后无法修改提取值或重新编码"
              checked={encOnly}
              onChange={setEncOnly}
            />
            <Toggle
              label="归一化 Vibe 强度"
              checked={p.normalizeVibes}
              onChange={(normalizeVibes) => patch({ normalizeVibes })}
            />
            {otherOn && (
              <div className="callout">
                官方不允许精确参考与 Vibe 同时使用，本次只发精确参考。
              </div>
            )}
            {p.mask && model.family !== "v3" && (
              <p className="note">局部重绘时 Vibe 也会参与请求。</p>
            )}
          </section>
        ) : (
          <section className="detail-section">
            <div className="actions">
              <Button
                small
                icon="plus"
                onClick={() => {
                  referenceKind.current = "precise";
                  referenceUpload.current?.click();
                }}
              >
                添加精确参考
              </Button>
            </div>
            {otherOn && (
              <div className="callout">
                官方不允许 Vibe 与精确参考同时使用，本次只发 Vibe。
              </div>
            )}

            <p className="note">
              参考内容可选角色、风格或两者；信息提取固定为 1。
            </p>
          </section>
        )}
        {list.map((r) => (
          <section className="detail-section reference-detail" key={r.id}>
            <div className="section-title reference-title">
              <b title={r.name}>{r.name}</b>
              <div className="reference-title-actions">
                {r.type === "vibe" && (
                  <Button
                    small
                    title={`导出 Vibe：${r.name}`}
                    disabled={!r.encoding && !r.data}
                    onClick={() => void exportOne(r)}
                  >
                    导出
                  </Button>
                )}
                <Button
                  small
                  className="reference-delete"
                  title={"删除参考：" + r.name}
                  onClick={() =>
                    patch({
                      references: p.references.filter((x) => x.id !== r.id),
                    })
                  }
                >
                  删除参考
                </Button>
              </div>
            </div>
            {r.data ? (
              <img
                className="reference-image"
                src={"data:image/png;base64," + r.data}
                alt={r.name}
              />
            ) : (
              <div className="callout">仅编码 Vibe · 不含原图</div>
            )}
            <Toggle
              label={r.type === "vibe" ? "Vibe 参考" : "精确参考"}
              checked={r.enabled}
              onChange={(enabled) => updateRef(r.id, { enabled })}
            />
            {r.type === "precise" ? (
              <>
                <Field label="参考内容">
                  <Select
                    value={r.caption}
                    onChange={(e) =>
                      updateRef(r.id, { caption: e.target.value })
                    }
                  >
                    <option value="character&style">角色与风格</option>
                    <option value="character">角色</option>
                    <option value="style">风格</option>
                  </Select>
                </Field>
                <Slider
                  label="参考强度"
                  value={r.strength}
                  onChange={(strength) => updateRef(r.id, { strength })}
                />
                <Slider
                  label="精确度 Fidelity"
                  value={r.fidelity}
                  onChange={(fidelity) => updateRef(r.id, { fidelity })}
                />
                <p className="note">信息提取固定为 1（官方要求）。</p>
              </>
            ) : (
              <>
                <Slider
                  label="参考强度"
                  value={r.strength}
                  onChange={(strength) => updateRef(r.id, { strength })}
                />
                <Slider
                  label="信息提取"
                  value={r.info}
                  disabled={r.encodingOnly}
                  onChange={(info) => updateRef(r.id, { info })}
                />
                {model.family !== "v3" && (
                  <>
                    <div className="encoding-status">
                      {r.encoding &&
                      r.encodedModel === p.model &&
                      r.encodedInfo === r.info &&
                      r.encodedMask === (r.mask || "")
                        ? "已编码 · 当前设置可用"
                        : "需要编码 · 编码可能消耗 Anlas"}
                    </div>
                    <div className="actions">
                      <Button
                        small
                        primary
                        disabled={
                          !r.data || !!refBusy || !connectionId || !model.vibe
                        }
                        onClick={() => void encode(r)}
                      >
                        {refBusy === r.id ? "编码中…" : "编码参考图"}
                      </Button>
                      <Button
                        small
                        disabled={!r.data}
                        onClick={() =>
                          setEditor({
                            source: "data:image/png;base64," + r.data,
                            width: r.width || p.width,
                            height: r.height || p.height,
                            mask: r.mask,
                            refId: r.id,
                          })
                        }
                      >
                        信息蒙版
                      </Button>
                      {r.mask && (
                        <Button
                          small
                          onClick={() => updateRef(r.id, { mask: undefined })}
                        >
                          清除蒙版
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        ))}
        {!list.length && (
          <Empty title={kind === "vibe" ? "还没有 Vibe 参考" : "还没有精确参考"}>
            {kind === "vibe"
              ? "添加一张氛围图，生成时按强度迁移它的色彩和笔触。"
              : "添加一张角色或风格图，生成时贴着它画。"}
          </Empty>
        )}
      </>
    );
  }
  function renderImage() {
    return (
      <>
        <section className="detail-section">
          <h3>输入图像</h3>
          {p.baseImage ? (
            <>
              <img
                className="reference-image"
                src={"data:image/png;base64," + p.baseImage.data}
                alt="图生图底图"
              />
              <p className="note">
                {p.baseImage.name} · {p.baseImage.width} × {p.baseImage.height}
              </p>
              <div className="image-input-actions">
                <Button
                  small
                  icon="brush"
                  onClick={() =>
                    setEditor({
                      source: "data:image/png;base64," + p.baseImage.data,
                      width: p.baseImage.width,
                      height: p.baseImage.height,
                      mask: p.mask,
                      focus: p.focus,
                    })
                  }
                >
                  涂鸦 / 绘制蒙版
                </Button>
                <Button small onClick={() => upload.current?.click()}>
                  更换底图
                </Button>
                <Button
                  small
                  onClick={() =>
                    patch({ baseImage: null, mask: null, focus: null })
                  }
                >
                  移除底图
                </Button>
              </div>
            </>
          ) : (
            <div className="image-input-actions">
              <Button icon="upload" onClick={() => upload.current?.click()}>
                上传图片
              </Button>
              <Button
                onClick={() =>
                  setEditor({ source: null, width: p.width, height: p.height })
                }
              >
                新建涂鸦
              </Button>
            </div>
          )}
        </section>
        {p.baseImage && (
          <>
            {!(gpt && !p.mask) && (
            <section className="detail-section">
              <h3>{p.mask ? "局部重绘" : "图生图"}</h3>
              {!p.mask && (
                <>
                  <Slider
                    label="变化强度"
                    min={0.01}
                    max={0.99}
                    value={p.strength}
                    onChange={(strength) => patch({ strength })}
                  />
                  <Slider
                    label="噪声"
                    max={0.99}
                    value={p.noise}
                    onChange={(noise) => patch({ noise })}
                  />
                </>
              )}
              {p.mask && (
                <>
                  {gpt ? (
                    <p className="note">蒙版只作引导，不保证只在蒙版内改动。</p>
                  ) : model.family !== "v3" ? (
                    <Slider
                      label="重绘强度"
                      min={0.01}
                      value={p.inpaintStrength}
                      onChange={(inpaintStrength) => patch({ inpaintStrength })}
                    />
                  ) : (
                    <p className="note">V3 不支持单独调节局部重绘强度。</p>
                  )}
                  <Button
                    small
                    onClick={() => patch({ mask: null, focus: null })}
                  >
                    清除重绘蒙版
                  </Button>
                  {!gpt && (
                    <p className="note inpaint-blend-note">
                      边缘自动柔化融合，融合范围以外保留原图。
                    </p>
                  )}
                </>
              )}
            </section>
            )}
            {!gpt && (
            <section className="detail-section">
              <Toggle
                label="聚焦重绘"
                hint={
                  gpt
                    ? "GPT Image 没有这套预处理，这一项对当前模型无效。"
                    : "将选区连同周围上下文放大到约 1 MP 后重绘，再合回原图。"
                }
                checked={!!p.focus}
                disabled={!p.mask || gpt}
                onChange={(value) =>
                  patch({
                    focus: value
                      ? {
                          x: 0,
                          y: 0,
                          width: Math.min(512, p.width),
                          height: Math.min(512, p.height),
                          context: 32,
                          units: "px",
                        }
                      : null,
                  })
                }
              />
              {p.focus && (
                <>
                  <Button
                    small
                    onClick={() => {
                      setEditor({
                        source: "data:image/png;base64," + p.baseImage.data,
                        width: p.width,
                        height: p.height,
                        mask: p.mask,
                        focus: p.focus,
                      });
                      setDrawer("");
                    }}
                  >
                    在画布中框选
                  </Button>
                  <div className="grid2">
                    {["x", "y", "width", "height"].map((key, i) => (
                      <Field
                        key={key}
                        label={["选区 X", "选区 Y", "选区宽度", "选区高度"][i]}
                      >
                        <input
                          type="number"
                          min={i < 2 ? 0 : 16}
                          step="1"
                          value={p.focus[key]}
                          onChange={(e) =>
                            patch({
                              focus: { ...p.focus, [key]: +e.target.value },
                            })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <Slider
                    label="上下文范围"
                    value={p.focus.context}
                    max={p.focus.units === "px" ? 96 : 1}
                    step={p.focus.units === "px" ? 8 : 0.01}
                    onChange={(context) =>
                      patch({ focus: { ...p.focus, context } })
                    }
                  />
                </>
              )}
            </section>
            )}
            <section className="detail-section">
              <h3>扩展画布</h3>
              <p className="note">
                向四周加入空白区域，新增区域自动作为重绘蒙版。
              </p>
              <div className="format-grid">
                {["上", "下", "左", "右"].map((s, i) => (
                  <Button small key={s} onClick={() => void outpaint(i)}>
                    向{s}扩展 128px
                  </Button>
                ))}
              </div>
            </section>
          </>
        )}
      </>
    );
  }
  async function outpaint(side: number) {
    try {
      const old = p.baseImage;
      if (!old) return;
      const w = p.width + (side > 1 ? 128 : 0),
        h = p.height + (side < 2 ? 128 : 0);
      if (w * h > 3145728) throw new Error("扩展后超过 3 MP");
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("底图读取失败"));
        img.src = "data:image/png;base64," + old.data;
      });
      const x = side === 2 ? 128 : 0,
        y = side === 0 ? 128 : 0;
      ctx.drawImage(img, x, y, p.width, p.height);
      // GPT 的出图尺寸来自「清晰度 × 比例」，扩展后必须切成自定义，否则尺寸和画布对不上。
      if (gpt && gptSizeIssue(w, h)) throw new Error(gptSizeIssue(w, h)!);
      const data = c.toDataURL("image/png").split(",")[1];
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, p.width, p.height);
      patch({
        width: w,
        height: h,
        ...(gpt ? { size: "custom" } : {}),
        baseImage: { data, width: w, height: h, name: old.name },
        mask: c.toDataURL("image/png").split(",")[1],
        focus: null,
      });
    } catch (e: any) {
      fail(e.message);
    }
  }
  const queueList = (
    <div className="queue-list">
      {!tasks.length && (
        <Empty icon="history" title="队列是空的">
          点击生成后可以在这里查看进度。
        </Empty>
      )}
      {tasks.map((t) => (
        <article key={t.id} className="task-item">
          <div className="section-title">
            <b>
              {
                (
                  {
                    queued: "等待中",
                    running: "处理中",
                    completed: "已完成",
                    failed: "失败",
                    cancelled: "已取消",
                    interrupted: "已中断",
                  } as any
                )[t.status]
              }
            </b>
            <span className="mono">
              {t.completed}/{t.total}
            </span>
          </div>
          <p>{t.title}</p>
          {t.phase && t.status === "running" && (
            <small>
              {
                {
                  preparing: "正在准备请求",
                  requesting: "等待模型响应",
                  receiving: "正在接收图像",
                  generating: "正在生成预览",
                  saving: "正在保存结果",
                }[t.phase]
              }
            </small>
          )}
          <small>
            {new Date(t.createdAt).toLocaleTimeString("zh-CN")}
            {t.progress ? ` · 步骤 ${t.progress}` : ""}
          </small>
          {t.error && (
            <div className="inline-error">
              {t.error}
              {t.correlation && <small>关联 ID：{t.correlation}</small>}
            </div>
          )}
          {t.timings && (
            <small className="task-timings">
              {[
                ["排队", t.timings.queueMs],
                ["准备", t.timings.prepareMs],
                ["首响应", t.timings.responseMs],
                ["总耗时", t.timings.totalMs],
              ]
                .filter(([, ms]) => typeof ms === "number")
                .map(
                  ([label, ms]) =>
                    `${label} ${((ms as number) / 1000).toFixed(2)} 秒`,
                )
                .join(" · ")}
            </small>
          )}
          <div className="actions">
            {["queued", "running"].includes(t.status) ? (
              <Button
                small
                onClick={() =>
                  api("/tasks/" + t.id + "/cancel", {}).catch((e) =>
                    fail(e.message),
                  )
                }
              >
                取消任务
              </Button>
            ) : (
              ["failed", "interrupted", "cancelled"].includes(t.status) && (
                <Button
                  small
                  onClick={() =>
                    api("/tasks/" + t.id + "/retry", {}).catch((e) =>
                      fail(e.message),
                    )
                  }
                >
                  {t.completed ? "补生成剩余图片" : "重试"}
                </Button>
              )
            )}
          </div>
        </article>
      ))}
    </div>
  );
  if (!loaded)
    return (
      <div className="boot">
        <img className="brand-mark" src="/vellum-mark.svg" alt="" aria-hidden="true" />
        <h1>Vellum</h1>
        <p>{error || "正在载入本地工作台…"}</p>
        {error && <Button onClick={() => location.reload()}>重新载入</Button>}
      </div>
    );
  const drawerNames: Record<string, string> = {
    advanced: "高级参数",
    prompt: "长提示词",
    characters: "角色编辑",
    vibe: "Vibe 参考",
    precise: "精确参考",
    templates: "模板",
    artists: "画师",
    image: "底图与涂鸦",
    upscale: "高清放大",
    variation: "图像变体",
    enhance: "增强图像",
    director: "导演工具",
    queue: "任务队列",
  };
  const changeConnections = (cs: Connection[]) => {
    setConnections(cs);
    // 出图只在图像用途的连接里选；文字对话的连接不参与生成。
    const usable = cs.filter(isImageConnection);
    if (!usable.some((c) => c.id === connectionId))
      setConnectionId(usable[0]?.id || "");
  };
  return (
    <>
      <header className="app-header">
        <button className="brand" aria-label="Vellum · 返回工作台" onClick={() => setPage("workbench")}>
          <img className="brand-mark" src="/vellum-mark.svg" alt="" aria-hidden="true" /><span className="brand-wordmark">Vellum</span>
        </button>
        <nav>
          {[
            ["workbench", "工作台"],
            ["history", "历史记录"],
            ["templates", "模板"],
            ["artists", "画师"],
            ["inspector", "图片解析"],
            ["settings", "设置"],
          ].map(([key, name]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              aria-current={page === key ? "page" : undefined}
              onClick={() => setPage(key)}
            >
              {name}
            </button>
          ))}
        </nav>
        <span className="grow" />
        <span className="local-label">
          <i />
          本地工作空间
        </span>
      </header>
      {(error || notice) && (
        <div
          className={`message-bar ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
          onMouseEnter={() => setMessagePaused(true)}
          onMouseLeave={() => setMessagePaused(false)}
          onFocusCapture={() => setMessagePaused(true)}
          onBlurCapture={() => setMessagePaused(false)}
        >
          <span>{error || notice}</span>
          <button
            className="icon-btn"
            aria-label="关闭消息"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      <input
        ref={gptRefsUpload}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void addGptRefs(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={upload}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void importImage(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={referenceUpload}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void addReferences(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={vibeUpload}
        type="file"
        accept=".naiv4vibe,.naiv4vibebundle,.json,.vibe,.vibebundle"
        hidden
        onChange={async (e) => {
          try {
            const f = e.target.files?.[0];
            if (f) {
              const refs = await importVibes(await f.text(), p.model);
              for (const ref of refs)
                if (ref.data) {
                  const checked = await api("/image/import", {
                    data: ref.data,
                    name: ref.name,
                  });
                  ref.width = checked.image.width;
                  ref.height = checked.image.height;
                }
              if (p.references.length + refs.length > 16)
                throw new Error("参考图超过 16 张");
              patch({ references: [...p.references, ...refs] });
            }
          } catch (err: any) {
            fail(err.message);
          }
          e.target.value = "";
        }}
      />
      <input
        ref={importJson}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          try {
            const f = e.target.files?.[0];
            if (f) {
              const t = JSON.parse(await f.text());
              if (typeof t.name !== "string" || typeof t.prompt !== "string")
                throw new Error("模板格式无效");
              setTemplates(
                await api("/templates", {
                  name: t.name,
                  prompt: t.prompt,
                  negative: t.negative || "",
                  category: t.category,
                  favorite: t.favorite,
                }),
              );
              setPage("templates");
            }
          } catch (err: any) {
            fail(err.message);
          }
          e.target.value = "";
        }}
      />
      {page === "workbench" ? (
        <main className="workbench">
          <div className={`workspace ${drawer === "characters" ? "character-workspace" : ""} ${positioning ? "positioning" : ""}`}>
            <ErrorBoundary label="创作助手" hint="其余部分还能用；点重试或重新载入即可。">
            <AssistantPanel
              connections={connections.filter(isChatConnection)}
              connectionId={assistantConnectionId}
              onConnectionChange={setAssistantConnectionId}
              attachment={
                selected
                  ? {
                      id: selected.id,
                      url: selected.url,
                      label: (selected.name || "").trim() || "当前图像",
                      width: selected.width,
                      height: selected.height,
                      model: modelByIdSafe(selected.model),
                      seed: selected.seed,
                      prompt: selected.prompt,
                    }
                  : null
              }
              params={p}
              modelLabel={modelLabel}
              imageConnectionName={connection?.name || ""}
              onAdoptPrompt={(text) => {
                patch({ prompt: text });
                setNotice("已把助手的提示词填入正面提示词。");
              }}
              onEditPrompt={() => setDrawer("prompt")}
              onError={fail}
            />
            </ErrorBoundary>
            <ErrorBoundary label="工作台" hint="生成设置和助手仍可用。">
            <section
              className="card image-workspace"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) void importImage(f);
              }}
            >
              {positioning && (
                <CharacterPositionCanvas
                  params={p}
                  selectedId={characterId}
                  grid={characterGrid(p.model)}
                  onSelect={setCharacterId}
                  onPosition={(id, x, y) => {
                    const next = snapCharacterPosition(p.model, x, y);
                    setP(old => ({ ...old, positionMode: "custom", characters: old.characters.map(c => c.id === id ? { ...c, ...next } : c) }));
                  }}
                  onDone={() => setPositioning(false)}
                />
              )}
              <header className="card-head workhead">
                <div className="work-identity">
                  <h2 title={imageHeading}>
                    {editor ? "画布编辑" : imageHeading}
                  </h2>
                  <small className="work-meta">
                    {editor ? (
                      <span>
                        {editor.width} × {editor.height}
                      </span>
                    ) : selected ? (
                      <>
                        <span>
                          {selected.width} × {selected.height}
                        </span>
                        <span>{modelByIdSafe(selected.model)}</span>
                        {selected.seed != null && (
                          <span>Seed {selected.seed}</span>
                        )}
                      </>
                    ) : p.baseImage ? (
                      <>
                        <span>
                          {p.baseImage.width} × {p.baseImage.height}
                        </span>
                        <span>当前输入图像</span>
                      </>
                    ) : (
                      <span>留一点空间，给下一张好作品。</span>
                    )}
                  </small>
                </div>
                <div className="work-head-actions">
                  <Button
                    small
                    icon="upload"
                    onClick={() => upload.current?.click()}
                  >
                    导入
                  </Button>
                </div>
              </header>
              {editor ? (
                <CanvasEditor
                  source={editor.source}
                  width={editor.width}
                  height={editor.height}
                  mask={editor.mask}
                  focus={editor.refId ? undefined : editor.focus}
                  onError={fail}
                  onClose={() => setEditor(null)}
                  onApply={(data, mask, meta) => {
                    if (editor.refId)
                      updateRef(editor.refId, {
                        data,
                        mask: mask || undefined,
                        width: meta?.width || editor.width,
                        height: meta?.height || editor.height,
                      });
                    else
                      patch({
                        baseImage: {
                          data,
                          width: meta?.width || editor.width,
                          height: meta?.height || editor.height,
                          name: "画布输入.png",
                        },
                        mask,
                        focus: meta?.focus || null,
                        ...normalizeBaseDims(
                          meta?.width || editor.width,
                          meta?.height || editor.height,
                        ),
                      });
                    setEditor(null);
                  }}
                />
              ) : (
                <>
                  <div className="image-stage">
                    {preview && followingGeneration ? (
                      <img
                        src={"data:image/jpeg;base64," + preview.image}
                        alt="生成中的预览"
                      />
                    ) : selected ? (
                      <img
                        src={selected.url}
                        alt={selected.prompt || "生成作品"}
                        onDoubleClick={() => setDetail(selected)}
                      />
                    ) : p.baseImage ? (
                      <img
                        src={"data:image/png;base64," + p.baseImage.data}
                        alt="当前底图"
                      />
                    ) : (
                      <div className="empty-canvas">
                        <span className="canvas-registration tl" />
                        <span className="canvas-registration tr" />
                        <span className="canvas-registration bl" />
                        <span className="canvas-registration br" />
                        <span className="empty-number">01 / 下一张作品</span>
                        <div className="empty-glyph">
                          <Icon name="image" />
                        </div>
                        <h1>从一段想象开始。</h1>
                        <p>
                          写下提示词，或将图片拖到这里。
                          <br />
                        </p>
                        <div className="actions">
                          <Button
                            icon="upload"
                            onClick={() => upload.current?.click()}
                          >
                            导入图片
                          </Button>
                          <Button
                            icon="brush"
                            onClick={() =>
                              setEditor({
                                source: null,
                                width: p.width,
                                height: p.height,
                              })
                            }
                          >
                            新建涂鸦
                          </Button>
                        </div>
                        <span className="empty-footnote">
                          NOVELAI · 个人创作空间
                        </span>
                      </div>
                    )}
                    {(activityLabel ||
                      (!selected && p.baseImage) ||
                      !followingGeneration) && (
                      <span
                        className="stage-chip"
                        role="status"
                        aria-live="polite"
                      >
                        <span>
                          {activityLabel ||
                            (followingGeneration
                              ? "当前输入图像"
                              : "正在查看作品")}
                        </span>
                        {!followingGeneration && (
                          <button
                            className="return-to-generation"
                            onClick={() => {
                              followGeneration();
                              if (recentImages[0]) setSelected(recentImages[0]);
                            }}
                          >
                            {active.length ? "返回生成画面" : "查看最新结果"}
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  <div
                    className="image-toolbar"
                    role="toolbar"
                    aria-label="图片操作"
                  >
                    <div className="image-actions">
                      {canEditImages && (
                        <Button
                          small
                          disabled={!selected}
                          onClick={() => void useSelected()}
                        >
                          用作底图
                        </Button>
                      )}
                      {canEditImages && (
                      <Button
                        small
                        icon="brush"
                        disabled={!selected && !p.baseImage}
                        onClick={async () => {
                          try {
                            const source = selected
                              ? await imageToData(selected.url)
                              : "data:image/png;base64," + p.baseImage.data;
                            setEditor({
                              source,
                              width: selected?.width ?? p.baseImage.width,
                              height: selected?.height ?? p.baseImage.height,
                              mask: selected ? undefined : p.mask,
                              focus: selected ? undefined : p.focus,
                            });
                          } catch (e: any) {
                            fail(e.message);
                          }
                        }}
                      >
                        涂鸦 / 重绘
                      </Button>
                      )}
                      {/* 导演工具 / 增强 / 变体 / 高清放大都是 NovelAI 专有接口，
                          GPT 与其它协议下直接不显示，别让人点了才报错。 */}
                      {!gpt && (
                        <>
                          <Button
                            small
                            aria-pressed={drawer === "director"}
                            disabled={!selected && !p.baseImage}
                            onClick={() => openDrawer("director")}
                          >
                            导演工具
                          </Button>
                          <span className="action-divider" aria-hidden="true" />
                        </>
                      )}
                      {!gpt && (
                      <>
                      <Button
                        small
                        aria-pressed={drawer === "enhance"}
                        disabled={
                          !selected ||
                          !availableEnhanceScales.length ||
                          !!actionBusy
                        }
                        title={
                          availableEnhanceScales.length
                            ? "设置增强倍率和幅度"
                            : "当前图片尺寸没有可用的增强倍率"
                        }
                        onClick={() => openDrawer("enhance")}
                      >
                        增强
                      </Button>
                      <Button
                        small
                        disabled={
                          !selected ||
                          selected.kind !== "generate" ||
                          !!actionBusy
                        }
                        title="沿用所选图片的原始生成参数，一次生成 3 张变体"
                        aria-pressed={drawer === "variation"}
                        onClick={() => openDrawer("variation")}
                      >
                        {actionBusy === "variation" ? "提交中…" : "变体"}
                      </Button>
                      <Button
                        small
                        aria-pressed={drawer === "upscale"}
                        disabled={!selected && !p.baseImage}
                        onClick={() => openDrawer("upscale")}
                      >
                        高清放大
                      </Button>
                      </>
                      )}
                      {selected ? (
                        <a
                          className="btn small download-action"
                          href={selected.url}
                          download={`Vellum-${selected.id}.png`}
                        >
                          <Icon name="download" />
                          下载
                        </a>
                      ) : (
                        <Button small disabled className="download-action">
                          下载
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              )}
              {!editor && (
                <RecentWorks
                  items={recentImages}
                  selectedId={selected?.id}
                  onSelect={viewArtwork}
                />
              )}
            </section>
            </ErrorBoundary>
            <ErrorBoundary label="生成设置" hint="换一条连接或重新载入通常就能恢复。">
            <aside className={`card resident-input ${drawer === "characters" ? "character-context" : ""}`}>
              <header className="card-head">
                <h2>生成设置</h2>
                {protocolOfConnection(connection).id === "novelai-native" && (
                  <ConnectionAccount connection={connection} account={account} />
                )}
              </header>
              <div className="resident-scroll" ref={residentScrollRef}>
                <section className="resident-module model-module">
                  <Field label="连接 · 供应商">
                    <Select
                      value={connectionId}
                      onChange={(e) => {
                        const id = e.target.value,
                          target = connections.find((c) => c.id === id),
                          models = imageModelsFor(target);
                        setConnectionId(id);
                        // 换了供应商，当前模型不一定还在：切到它的第一个模型。
                        if (
                          models.length &&
                          !models.some((m) => m.id === p.model)
                        ) {
                          const first = models[0].id,
                            asOpenAI =
                              protocolOfConnection(target).id ===
                                "openai-images" || isOpenAIImageModel(first);
                          patch(
                            normalizeCharacterPositions(
                              asOpenAI
                                ? ({ ...p, model: first } as Params)
                                : (changeModel(p, first, true) as Params),
                            ),
                          );
                          setNotice(
                            `已切到「${target?.name || "该连接"}」的模型。`,
                          );
                        }
                      }}
                    >
                      {!connections.some(isImageConnection) && (
                        <option value="">请先添加连接</option>
                      )}
                      {connections.filter(isImageConnection).map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name} · {protocolOfConnection(c).label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="图像模型">
                    <Select
                      value={p.model}
                      onChange={(e) => setModelChoice(e.target.value)}
                    >
                      {!availableModels.length && (
                        <option value="">这条连接还没有模型</option>
                      )}
                      {availableModels.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {p.model === "nai-diffusion-5-full" && (
                    <Field label="Effort">
                      <Select
                        value={p.effort}
                        onChange={(e) => patch({ effort: e.target.value })}
                      >
                        <option value="high">High · 完整设置</option>
                        <option value="medium">Medium · 14 步</option>
                      </Select>
                    </Field>
                  )}
                </section>
                {gpt ? (
                  <>
                    <section className="resident-module">
                      <div className="section-title">
                        <h3>全局提示词</h3>
                      </div>
                      {gptPromptEditor()}
                    </section>
                    {canEditImages && (
                    <section className="resident-module">
                      <div className="section-title">
                        <h3>输入图像</h3>
                        <button
                          className="text-link"
                          onClick={() => openDrawer("image")}
                        >
                          底图 / 涂鸦
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={p.baseImage ? "更换底图" : "添加底图"}
                          title={p.baseImage ? "更换底图" : "添加底图"}
                          onClick={() => upload.current?.click()}
                        >
                          <Icon name="plus" />
                        </button>
                      </div>
                      {p.baseImage ? (
                        <div className="reference-row">
                          <span className="gpt-ref-order">1</span>
                          <img
                            src={"data:image/png;base64," + p.baseImage.data}
                            alt="底图缩略图"
                          />
                          <button
                            className="reference-summary"
                            onClick={() => setDrawer("image")}
                          >
                            <b>{p.baseImage.name}</b>
                            <small>
                              底图 · {p.mask ? "带蒙版" : "图生图"} ·{" "}
                              {p.baseImage.width} × {p.baseImage.height}
                            </small>
                          </button>
                          <button
                            className="icon-btn"
                            aria-label="移除底图"
                            onClick={() =>
                              patch({ baseImage: null, mask: null, focus: null })
                            }
                          >
                            <Icon name="close" />
                          </button>
                        </div>
                      ) : (
                        <p className="note">
                          加一张底图就走图像输入（edits）：改局部、换材质、扩场景都行。
                        </p>
                      )}
                      <div className="gpt-refs-head">
                        <span>参考图 · 按顺序跟在底图后面</span>
                        <button
                          className="text-link"
                          onClick={() => gptRefsUpload.current?.click()}
                        >
                          添加
                        </button>
                      </div>
                      {gptRefs.length ? (
                        <div className="gpt-refs">
                          {gptRefs.map((r, i) => (
                            <div className="gpt-ref" key={r.id}>
                              <span className="gpt-ref-order">
                                {i + (p.baseImage ? 2 : 1)}
                              </span>
                              <img
                                src={
                                  String(r.data).startsWith("data:")
                                    ? r.data
                                    : "data:image/png;base64," + r.data
                                }
                                alt={r.name}
                              />
                              <span className="gpt-ref-name">{r.name}</span>
                              <button
                                className="icon-btn"
                                aria-label="上移"
                                disabled={i === 0}
                                onClick={() => moveGptRef(r.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                className="icon-btn"
                                aria-label="下移"
                                disabled={i === gptRefs.length - 1}
                                onClick={() => moveGptRef(r.id, 1)}
                              >
                                ↓
                              </button>
                              <button
                                className="icon-btn"
                                aria-label={"移除 " + r.name}
                                onClick={() =>
                                  patch({
                                    gptRefs: gptRefs.filter(
                                      (x) => x.id !== r.id,
                                    ),
                                  })
                                }
                              >
                                <Icon name="close" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <p className="note">底图第 1 张接收蒙版 · 最多 16 张</p>
                    </section>
                    )}
                  </>
                ) : (
                  <>
                <section className="resident-module">
                  <div className="section-title">
                    <h3>全局提示词</h3>

                  </div>
                  <div className="prompt-library-actions" role="group" aria-label="提示词工具">
                    <button ref={templateTrigger} type="button" aria-expanded={drawer === "templates"} aria-pressed={drawer === "templates"} onClick={() => { setTplQuery(''); openDrawer('templates'); }}><Icon name="layers" /><span>模板</span>{!!p.templates?.length && <small>{p.templates.length}</small>}{!!p.templates?.length && !p.templateEnabled && <small>暂停</small>}</button>
                    <button ref={artistTrigger} type="button" aria-expanded={drawer === "artists"} aria-pressed={drawer === "artists"} onClick={() => openDrawer('artists')}><Icon name="brush" /><span>画师</span>{!!p.artists?.length && <small>{p.artists.length}</small>}{!!p.artists?.length && p.artistEnabled === false && <small>暂停</small>}</button>
                  </div>
                  {drawer === "characters" ? <button className="role-global-summary" onClick={() => { setPromptTab("prompt"); setDrawer("prompt"); }}>{p.prompt || "点击填写全局场景描述"}</button> : promptEditor()}
                </section>
                <section className="resident-module">
                  <div className="section-title">
                    <h3>
                      角色 · {p.characters.filter((c) => c.enabled).length} /{" "}
                      {model.maxCharacters}
                    </h3>
                    <button
                      className="icon-btn"
                      aria-label="添加角色"
                      disabled={!model.maxCharacters}
                      onClick={addChar}
                    >
                      <Icon name="plus" />
                    </button>
                  </div>
                  {p.characters.map((c, i) => (
                    <button type="button" className={`role-summary ${drawer === "characters" && (characterId || p.characters[0]?.id) === c.id ? "active" : ""} ${!c.enabled ? "paused" : ""}`}
                      key={c.id} aria-label={`编辑角色 ${c.name || i + 1}`} aria-expanded={drawer === "characters" && (characterId || p.characters[0]?.id) === c.id}
                      onClick={() => { setCharacterId(c.id); setDrawer("characters"); }}>
                      <span className="role-summary-title"><span className="role-number">{String(i + 1).padStart(2, "0")}</span><b>{c.name || `角色 ${i + 1}`}</b></span>
                      <span className="role-summary-prompt">{c.prompt || "点击编辑角色描述"}</span>
                      <span className="role-summary-meta"><span>{characterPosition(c, p.positionMode, characterGrid(p.model))}</span><span>{!c.enabled ? "已停用" : drawer === "characters" && (characterId || p.characters[0]?.id) === c.id ? "正在编辑" : "参与生成"}</span></span>
                    </button>
                  ))}
                  {!p.characters.length && (
                    <p className="note">
                      {model.maxCharacters
                        ? "为不同人物分别填写描述。"
                        : "此模型使用全局提示词描述人物。"}
                    </p>
                  )}
                </section>
                {model.vibe && (
                  <section className="resident-module">
                    <div className="section-title">
                      <h3>
                        Vibe 参考 ·{" "}
                        {p.references.filter((r) => r.type === "vibe").length}
                      </h3>
                      <div className="section-actions">
                        <button
                          className="text-link"
                          onClick={() => openDrawer("vibe")}
                        >
                          详细设置
                        </button>
                        <button
                          className="icon-btn"
                          title={
                            p.references.some(
                              (r) => r.type === "precise" && r.enabled,
                            )
                              ? "精确参考与 Vibe 互斥，请先停用精确参考"
                              : "添加 Vibe 参考"
                          }
                          aria-label="添加 Vibe 参考"
                          disabled={p.references.some(
                            (r) => r.type === "precise" && r.enabled,
                          )}
                          onClick={() => {
                            referenceKind.current = "vibe";
                            referenceUpload.current?.click();
                          }}
                        >
                          <Icon name="plus" />
                        </button>
                      </div>
                    </div>
                    {referenceRows("vibe")}
                  </section>
                )}
                {model.precise && (
                  <section className="resident-module">
                    <div className="section-title">
                      <h3>
                        精确参考 ·{" "}
                        {p.references.filter((r) => r.type === "precise").length}
                      </h3>
                      <div className="section-actions">
                        <button
                          className="text-link"
                          onClick={() => openDrawer("precise")}
                        >
                          详细设置
                        </button>
                        <button
                          className="icon-btn"
                          title={
                            p.references.some(
                              (r) => r.type === "vibe" && r.enabled,
                            )
                              ? "Vibe 与精确参考互斥，请先停用 Vibe"
                              : "添加精确参考"
                          }
                          aria-label="添加精确参考"
                          disabled={p.references.some(
                            (r) => r.type === "vibe" && r.enabled,
                          )}
                          onClick={() => {
                            referenceKind.current = "precise";
                            referenceUpload.current?.click();
                          }}
                        >
                          <Icon name="plus" />
                        </button>
                      </div>
                    </div>
                    {referenceRows("precise")}
                  </section>
                )}
                <section className="resident-module">
                  <div className="section-title">
                    <h3>输入图像</h3>
                    <button
                      className="text-link"
                      onClick={() => openDrawer("image")}
                    >
                      底图 / 涂鸦
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={p.baseImage ? "更换底图" : "添加底图"}
                      title={p.baseImage ? "更换底图" : "添加底图"}
                      onClick={() => upload.current?.click()}
                    >
                      <Icon name="plus" />
                    </button>
                  </div>
                  {p.baseImage ? (
                    <div className="reference-row">
                      <img
                        src={"data:image/png;base64," + p.baseImage.data}
                        alt="底图缩略图"
                      />
                      <button
                        className="reference-summary"
                        onClick={() => setDrawer("image")}
                      >
                        <b>{p.baseImage.name}</b>
                        <small>
                          {p.mask ? "蒙版已就绪" : "图生图"} · {p.width} ×{" "}
                          {p.height}
                        </small>
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="移除底图"
                        onClick={() =>
                          patch({ baseImage: null, mask: null, focus: null })
                        }
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  ) : null}
                  {p.baseImage && (
                    <>
                      {p.mask ? (
                        model.family !== "v3" && (
                          <Slider
                            label="重绘强度"
                            value={p.inpaintStrength}
                            min={0.01}
                            max={1}
                            onChange={(inpaintStrength) =>
                              patch({ inpaintStrength })
                            }
                          />
                        )
                      ) : (
                        <>
                          <Slider
                            label="变化强度"
                            value={p.strength}
                            min={0.01}
                            max={0.99}
                            onChange={(strength) => patch({ strength })}
                          />
                          <Slider
                            label="噪声"
                            value={p.noise}
                            max={0.99}
                            onChange={(noise) => patch({ noise })}
                          />
                        </>
                      )}
                    </>
                  )}
                </section>
                  </>
                )}
              </div>
              {gpt ? (
                <section className="resident-parameters">
                  <div className="section-title">
                    <h3>生成参数</h3>
                    <button
                      className="text-link"
                      onClick={() => openDrawer("advanced")}
                    >
                      高级设置
                    </button>
                  </div>
                  {/* 画质 / 背景 / 格式 / 审核 / 中间图这些都是 OpenAI Images 的参数；
                      其它协议认不了，直接不显示。 */}
                  {isOpenAIProtocol && (
                  <>
                  <div className="grid2 compact">
                    <Field label="画质">
                      <Select
                        value={p.quality || "auto"}
                        onChange={(e) => patch({ quality: e.target.value })}
                      >
                        {GPT_QUALITY.map(([value, label]: any) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="背景">
                      <Select
                        value={p.background || "auto"}
                        onChange={(e) =>
                          patch({
                            background: e.target.value,
                            ...(e.target.value === "transparent" &&
                            p.outputFormat === "jpeg"
                              ? { outputFormat: "png" }
                              : {}),
                          })
                        }
                      >
                        {GPT_BACKGROUND.map(([value, label]: any) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  </>
                  )}
                  <div className="grid2 compact">
                    <Field label="清晰度">
                      <Select
                        value={gptTier}
                        onChange={(e) => applyGptSize(e.target.value, gptRatio)}
                      >
                        {GPT_TIERS.map(([value, label]: any) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="比例">
                      <Select
                        value={gptRatio}
                        onChange={(e) => applyGptSize(gptTier, e.target.value)}
                      >
                        {GPT_RATIOS.map((r) => (
                          <option value={r} key={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <p className="note">{gptSizeLabel()}</p>
                </section>
              ) : (
              <section className="resident-parameters">
                <div className="section-title">
                  <h3>生成参数</h3>
                  <button
                    className="text-link"
                    onClick={() => openDrawer("advanced")}
                  >
                    高级设置
                  </button>
                </div>
                <ResolutionControl
                  width={p.width}
                  height={p.height}
                  onChange={applyResolution}
                />
                <div className="grid2 compact">
                  <Slider
                    label="步骤"
                    value={medium ? 14 : p.steps}
                    min={1}
                    max={50}
                    step={1}
                    disabled={medium}
                    onChange={(steps) => patch({ steps })}
                  />
                  <Slider
                    label="提示词引导"
                    value={p.scale}
                    max={10}
                    step={0.1}
                    onChange={(scale) => patch({ scale })}
                  />
                </div>
                <div className="grid2 compact">
                  <Field label="采样器">
                    <Select
                      value={medium ? "k_euler_ancestral" : p.sampler}
                      disabled={medium}
                      onChange={(e) => patch({ sampler: e.target.value })}
                    >
                      {model.samplers.map((s) => (
                        <option key={s} value={s}>
                          {(SAMPLER_NAMES as any)[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="种子 Seed">
                    <input
                      aria-label="种子 Seed"
                      type="number"
                      min="0"
                      max="4294967295"
                      placeholder="每次随机"
                      value={p.seed ?? ""}
                      onChange={(e) =>
                        patch({
                          seed: e.target.value === "" ? null : +e.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
              </section>
              )}
              <footer className="resident-submit">
                <Button
                  primary
                  className="generate-button"
                  disabled={submitBusy}
                  onClick={() => void submit()}
                >
                  <span>
                    {submitBusy
                      ? "正在提交…"
                      : !connectionReady
                        ? `配置 ${protocolOfConnection(connection).label} 连接`
                        : p.mask && canEditImages
                          ? "重绘选中区域"
                          : p.baseImage && canEditImages
                            ? "根据底图生成"
                            : "生成图像"}
                  </span>
                  {connectionReady && quote.anlas !== null && quote.anlas > 0 && (
                    <span
                      className="generate-cost"
                      aria-label="本次生成预计费用"
                      title={quote.reason}
                    >
                      预计 {quote.anlas} 积分
                    </span>
                  )}
                </Button>
                <Select
                  aria-label="生成张数"
                  value={p.total}
                  onChange={(e) => patch({ total: +e.target.value })}
                >
                  {(gpt ? [1, 2, 3, 4] : [1, 2, 3, 4, 6, 8, 12, 16, 24]).map(
                    (n) => (
                    <option value={n} key={n}>
                      {n} 张
                    </option>
                  ),
                  )}
                </Select>
              </footer>
            </aside>
            </ErrorBoundary>
            {drawer && !positioning && (
              <aside
                className={`resident-detail card ${drawer === "characters" ? "character-detail" : ""}`}
                aria-label={drawerNames[drawer]}
              >
                <header className="detail-head">
                  <div>
                    <h2>{drawerNames[drawer]}</h2>
                    <small>
                      {drawer === "variation" && selected
                        ? `所选作品 · ${modelByIdSafe(selected.model)}`
                        : `当前工作台 · ${modelLabel}`}
                    </small>
                  </div>
                  <span className="grow" />
                  <button
                    className="icon-btn"
                    aria-label="收起详情"
                    onClick={() => setDrawer("")}
                  >
                    <Icon name="close" />
                  </button>
                </header>
                <div className={`detail-body ${drawer === "characters" ? "role-detail-body" : drawer === "templates" ? "tpl-detail-body" : drawer === "artists" ? "artist-detail-body" : ""}`}>
                  {drawer === "advanced" ? (
                    gpt ? renderGptAdvanced() : renderAdvanced()
                  ) : drawer === "prompt" ? (
                    gpt ? (
                      <section className="detail-section">
                        {gptPromptEditor(true)}
                      </section>
                    ) : (
                    <>
                      <section className="detail-section">
                        {promptEditor(true)}
                      </section>
                      <section className="detail-section">
                        {/* 质量标签只作用于正面词；负面词那边一直由 UC 预设追加，不需要开关。 */}
                        {promptTab === "prompt" && !gpt && (
                          <Toggle
                            label="自动追加质量标签"
                            checked={p.quality}
                            onChange={(quality) => patch({ quality })}
                          />
                        )}
                        {promptTab === "prompt" && !gpt && (
                          <Select
                            className="quality-preset"
                            aria-label="质量提示词预设"
                            value={
                              model.family === "v5" &&
                              p.qualityPreset === "light"
                                ? "light"
                                : "standard"
                            }
                            disabled={!p.quality}
                            onChange={(e) =>
                              patch({ qualityPreset: e.target.value })
                            }
                          >
                            <option value="standard">质量标签：Standard</option>
                            {model.family === "v5" && (
                              <option value="light">质量标签：Light</option>
                            )}
                          </Select>
                        )}
                        {promptTab === "negative" && !gpt && (
                          <Field label="负面词预设">
                            <Select
                              value={p.ucPreset}
                              disabled={medium}
                              onChange={(e) =>
                                patch({ ucPreset: e.target.value })
                              }
                            >
                              {Object.keys(ucPresets(p.model)).map((k) => (
                                <option key={k} value={k}>
                                  {k === "none" ? "无" : k}
                                </option>
                              ))}
                            </Select>
                            <p className="note">
                              预设会自动拼在你写的负面词前面，选「无」就是不追加。
                              {medium ? " Medium 模型不支持自定义负面词。" : ""}
                            </p>
                          </Field>
                        )}
                        {(() => {
                          // 非 NovelAI 模型没有质量标签 / UC 这一套，不显示展开后的词。
                          if (gpt) return null;
                          // 按当前标签页给对应的那一份；和上面输入框一模一样时不重复显示。
                          const positive = promptTab === "prompt";
                          let text = "",
                            same = false;
                          try {
                            const t = promptText(p);
                            text = positive ? t.input : t.negative;
                            same =
                              text.trim() ===
                              String(positive ? p.prompt : p.negative).trim();
                          } catch (e: any) {
                            text = e.message;
                          }
                          if (same) return null;
                          return (
                            <>
                              <h3>
                                {positive ? "展开后的正面提示词" : "展开后的负面提示词"}
                              </h3>
                              {p.prompt.includes("||") && (
                                <p className="note">
                                  随机候选在每次生成前抽取；实际词会随作品保存。
                                </p>
                              )}
                              <pre className="wire-prompt">{text}</pre>
                            </>
                          );
                        })()}
                      </section>
                    </>
                    )
                  ) : drawer === "characters" ? (
                    renderCharacters()
                  ) : drawer === "artists" ? (
                    <ArtistPicker data={artistData} params={p} patch={patch} />
                  ) : drawer === "templates" ? (
                    renderTemplateDrawer()
                  ) : drawer === "vibe" ? (
                    renderReferences("vibe")
                  ) : drawer === "precise" ? (
                    renderReferences("precise")
                  ) : drawer === "image" ? (
                    renderImage()
                  ) : drawer === "queue" ? (
                    queueList
                  ) : drawer === "enhance" ? (
                    <>
                      <section className="detail-section">
                        <h3>所选图像</h3>
                        {selected && (
                          <>
                            <img
                              className="reference-image"
                              src={selected.url}
                              alt="增强输入图像"
                            />
                            <p className="note">
                              {selected.width} × {selected.height} ·
                              {model.vibe || model.precise
                                ? "使用当前提示词与参考图"
                                : "使用当前提示词"}
                            </p>
                          </>
                        )}
                      </section>
                      <section className="detail-section">
                        <h3>增强倍率</h3>
                        <div className="format-grid enhance-scales">
                          {[...availableEnhanceScales]
                            .reverse()
                            .map((scale) => (
                              <button
                                key={scale}
                                className={`format-item ${enhanceScale === scale ? "active" : ""}`}
                                aria-pressed={enhanceScale === scale}
                                onClick={() => setEnhanceScale(scale)}
                              >
                                {scale === "max" ? "Max" : `${scale}×`}
                              </button>
                            ))}
                        </div>
                        {!availableEnhanceScales.length && (
                          <p className="note">当前尺寸没有可用的增强倍率。</p>
                        )}
                        {enhanceAdvanced ? (
                          <>
                            <Slider
                              label="增强强度"
                              min={0.01}
                              max={0.99}
                              value={enhanceStrength}
                              onChange={setEnhanceStrength}
                            />
                            <Slider
                              label="增强噪声"
                              min={0}
                              max={0.99}
                              value={enhanceNoise}
                              onChange={setEnhanceNoise}
                            />
                          </>
                        ) : (
                          <Slider
                            label="增强幅度"
                            min={1}
                            max={5}
                            step={1}
                            value={enhanceLevel}
                            onChange={(level) => {
                              setEnhanceLevel(level);
                              setEnhanceStrength(
                                ENHANCE_LEVELS[level - 1].strength,
                              );
                              setEnhanceNoise(ENHANCE_LEVELS[level - 1].noise);
                            }}
                          />
                        )}
                        <button
                          className="text-link"
                          onClick={() => {
                            if (enhanceAdvanced) {
                              setEnhanceStrength(
                                ENHANCE_LEVELS[enhanceLevel - 1].strength,
                              );
                              setEnhanceNoise(
                                ENHANCE_LEVELS[enhanceLevel - 1].noise,
                              );
                            }
                            setEnhanceAdvanced(!enhanceAdvanced);
                          }}
                        >
                          {enhanceAdvanced
                            ? "使用幅度档位"
                            : "单独调节强度和噪声"}
                        </button>
                      </section>
                    </>
                  ) : drawer === "upscale" || drawer === "variation" ? (
                    <div className="image-action-card">
                      {selected || p.baseImage ? (
                        <>
                          <figure className="action-source">
                            <div className="action-source-stage">
                              <img
                                src={
                                  selected?.url ||
                                  "data:image/png;base64," + p.baseImage.data
                                }
                                alt={
                                  drawer === "variation"
                                    ? "变体原图"
                                    : "待放大原图"
                                }
                              />
                            </div>
                            <figcaption>
                              <span>原图</span>
                              <b>
                                {(selected
                                  ? selected.name || "当前图像"
                                  : p.baseImage?.name || "当前输入图像"
                                ).trim()}
                              </b>
                            </figcaption>
                          </figure>
                          <dl className="action-facts">
                            <div>
                              <dt>输入尺寸</dt>
                              <dd>
                                {selected?.width ?? p.baseImage.width} ×{" "}
                                {selected?.height ?? p.baseImage.height}
                              </dd>
                            </div>
                            {drawer === "variation" ? (
                              <>
                                <div>
                                  <dt>图像模型</dt>
                                  <dd>
                                    {modelByIdSafe(selected?.model || p.model)}
                                  </dd>
                                </div>
                                <div>
                                  <dt>生成设置</dt>
                                  <dd>沿用原图</dd>
                                </div>
                                <div>
                                  <dt>输出数量</dt>
                                  <dd>3 张</dd>
                                </div>
                              </>
                            ) : (
                              <>
                                <div>
                                  <dt>处理方式</dt>
                                  <dd>高清放大</dd>
                                </div>
                                <div>
                                  <dt>输出尺寸</dt>
                                  <dd>由放大服务返回</dd>
                                </div>
                              </>
                            )}
                          </dl>
                          <section className="action-explanation">
                            <h3>
                              {drawer === "variation"
                                ? "保留灵感，探索变化"
                                : "放大细节，保留原图"}
                            </h3>
                            <p>
                              {drawer === "variation"
                                ? "沿用原图的提示词和生成设置，一次生成 3 张变体。不会改写当前工作台。"
                                : "将原图交给当前连接的放大服务处理，不修改原图，也不改动工作台的生成尺寸。"}
                            </p>
                          </section>
                          {drawer === "variation" && selected?.prompt && (
                            <details className="action-prompt">
                              <summary>查看原图提示词</summary>
                              <p>{selected.prompt}</p>
                            </details>
                          )}
                        </>
                      ) : (
                        <p className="note">请先选择作品或添加底图。</p>
                      )}
                    </div>
                  ) : drawer === "director" ? (
                    <>
                      <section className="detail-section">
                        <h3>选中图片</h3>
                        {selected || p.baseImage ? (
                          <img
                            className="reference-image"
                            src={
                              selected?.url ||
                              "data:image/png;base64," + p.baseImage.data
                            }
                            alt="图像处理输入"
                          />
                        ) : (
                          <p className="note">请先选择作品或添加底图。</p>
                        )}
                        <div className="format-grid">
                          {DIRECTOR_TOOLS.map(([id, name]) => (
                            <button
                              key={id}
                              className={`format-item ${director.type === id ? "active" : ""}`}
                              onClick={() =>
                                setDirector({ ...director, type: id })
                              }
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                        {["emotion", "colorize"].includes(director.type) && (
                          <>
                            <Slider
                              label="Defry"
                              min={0}
                              max={5}
                              step={1}
                              value={director.defry}
                              onChange={(defry) =>
                                setDirector({ ...director, defry })
                              }
                            />
                            {director.type === "emotion" && (
                              <Field label="表情">
                                <Select
                                  value={director.emotion}
                                  onChange={(e) =>
                                    setDirector({
                                      ...director,
                                      emotion: e.target.value,
                                    })
                                  }
                                >
                                  {EMOTIONS.map((e) => (
                                    <option key={e}>{e}</option>
                                  ))}
                                </Select>
                              </Field>
                            )}
                            <Field label="修改要求">
                              <textarea
                                rows={4}
                                value={director.prompt}
                                onChange={(e) =>
                                  setDirector({
                                    ...director,
                                    prompt: e.target.value,
                                  })
                                }
                              />
                            </Field>
                          </>
                        )}
                      </section>
                    </>
                  ) : null}
                </div>
                <footer
                  className={`detail-foot ${imageActionOpen ? "image-action-footer" : ""}`}
                >
                  <small>
                    {drawer === "enhance"
                      ? "独立生成 1 张"
                      : drawer === "variation"
                        ? "沿用原图设置 · 生成 3 张"
                        : drawer === "upscale"
                          ? "通过当前连接放大"
                          : drawer === "director"
                            ? "通过当前连接处理"
                            : drawer === "artists" ? `已选 ${p.artists?.length || 0} 位 · ${p.artistEnabled === false ? "已暂停" : "当前工作台"}` : drawer === "templates" ? `${p.templateEnabled ? "" : "已暂停 · "}正面 ${p.templates?.filter((t: any) => t.target !== "negative").length || 0} 条 · 负面 ${p.templates?.filter((t: any) => t.target === "negative").length || 0} 条` : drawer === "characters" ? "" : "修改即时写入当前草稿"}
                    {imageActionOpen &&
                      actionQuote.anlas === null &&
                      actionQuote.reason &&
                      ` · ${actionQuote.reason}`}
                  </small>
                  <span className="grow" />
                  {imageActionOpen ? (
                    <Button
                      primary
                      disabled={
                        !!actionBusy ||
                        (drawer === "enhance"
                          ? !selected ||
                            !availableEnhanceScales.includes(enhanceScale)
                          : drawer === "variation"
                            ? !selected || selected.kind !== "generate"
                            : !selected && !p.baseImage)
                      }
                      onClick={() =>
                        drawer === "enhance" || drawer === "variation"
                          ? void runImageAction(drawer)
                          : void toolTask(drawer as "director" | "upscale")
                      }
                    >
                      <span>
                        {actionBusy === drawer
                          ? "提交中…"
                          : !connectionId
                            ? "配置连接"
                            : drawer === "enhance"
                              ? "增强图像"
                              : drawer === "variation"
                                ? "生成 3 张变体"
                                : drawer === "upscale"
                                  ? "加入放大队列"
                                  : "执行处理"}
                      </span>
                      {connectionId &&
                        actionQuote.anlas !== null &&
                        actionQuote.anlas > 0 && (
                          <span
                            className="generate-cost"
                            aria-label="本次处理预计费用"
                            title={actionQuote.reason}
                          >
                            预计 {actionQuote.anlas} 积分
                          </span>
                        )}
                    </Button>
                  ) : (
                    <Button small primary={drawer === "templates" || drawer === "artists"} onClick={() => setDrawer("")}>
                      完成
                    </Button>
                  )}
                </footer>
              </aside>
            )}
          </div>
        </main>
      ) : null}
      {(page === "artists" || visitedPages.artists) && (
        <div hidden={page !== "artists"}>
          <ArtistLibrary data={artistData} onChange={changeArtistData} params={p} patch={patch} onError={fail} onRemove={id => setP(old => ({ ...old, artists: (old.artists || []).filter((a: ArtistChoice) => a.id !== id) }))} />
        </div>
      )}
      {(page === "inspector" || visitedPages.inspector) && (
        <div hidden={page !== "inspector"}>
          <ImageInspector active={page === "inspector"} onImport={(image) => { setImportIssue(""); setImported({ ...image, importId: ++importVersion.current }); }} />
        </div>
      )}
      {(page === "settings" || visitedPages.settings) && (
        <div hidden={page !== "settings"}>
          <Settings
            items={connections}
            onChange={changeConnections}
            onError={fail}
            dataDir={dataDir}
            historyCount={history.length}
            templateCount={templates.length}
          />
        </div>
      )}
      {(page === "templates" || visitedPages.templates) && (
        <div hidden={page !== "templates"}>
          <Templates
            onImport={() => importJson.current?.click()}
            items={templates}
            onChange={setTemplates}
            onApply={applyTemplate}
            onError={fail}
            params={p}
          />
        </div>
      )}
      {(page === "history" || visitedPages.history) && (
        <div hidden={page !== "history"}>
          <History
            items={history}
            collections={collections}
            onCollectionsChange={setCollections}
            onTemplatesChange={setTemplates}
            onUpdate={setHistory}
            onError={fail}
            onUse={(params) => {
              setP((old) => restoreWithChunks(old, params));
              setPage("workbench");
              setNotice("已恢复历史生成设置。");
            }}
          />
        </div>
      )}
      <footer className="taskbar">
        <button
          onClick={() => {
            setPage("workbench");
            openDrawer("queue");
          }}
        >
          <span className={`status-dot ${active.length ? "busy" : ""}`} />
          {active.length
            ? `${active.length} 个任务 · ${current ? "正在处理" : "等待中"}`
            : "就绪"}
          <span className="status-divider" />
          任务队列 <b>{tasks.length}</b>
        </button>
        <span className="grow" />
        <small title={dataDir}>
          {saving
            ? "正在保存草稿…"
            : saved
              ? "草稿已保存 · " + saved
              : "本地工作空间"}
        </small>
        <span className="status-divider" />
        <small>{connection?.name || "尚未配置连接"}</small>
      </footer>
      {modelChoice && (
        <Modal title="切换图像模型" onClose={() => setModelChoice("")}>
          {/* 只有 NovelAI 注册表里的模型才走 NovelAI 那套；其余都按当前协议处理。 */}
          {!MODELS.some((m) => m.id === modelChoice) ? (
            <>
              <p>
                切换到 {modelByIdSafe(modelChoice)}（
                {protocolOfConnection(connection).label}）。
              </p>
              <p className="note">
                {isOpenAIProtocol
                  ? "GPT Image 用自然语言提示词，没有步骤、引导、采样器和种子；"
                  : "这条协议只认提示词、尺寸和它自己的输入图参数，没有采样参数；"}
                NovelAI 的角色与参考图会留在草稿里，但不参与请求。
              </p>
              <div className="actions">
                <Button
                  onClick={() => {
                    setP({ ...p, model: modelChoice, prompt: "" } as Params);
                    setModelChoice("");
                  }}
                >
                  使用空白草稿
                </Button>
                <Button
                  primary
                  onClick={() => {
                    setP({ ...p, model: modelChoice } as Params);
                    setModelChoice("");
                  }}
                >
                  带入当前内容
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>切换到 NovelAI · {modelByIdSafe(modelChoice)}。</p>
              <p className="note">
                不支持的角色与参考会停用，内容保留；采样参数使用新模型默认值。
              </p>
              <div className="actions">
                <Button
                  onClick={() => {
                    setP({
                      ...changeModel(p, modelChoice, false),
                      promptChunks: p.promptChunks,
                    } as Params);
                    setModelChoice("");
                  }}
                >
                  使用空白草稿
                </Button>
                <Button
                  primary
                  onClick={() => {
                    setP(changeModel(p, modelChoice, true) as Params);
                    setModelChoice("");
                  }}
                >
                  带入当前内容
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
      {imported && (
        <ImageImport
          key={imported.importId}
          imported={imported}
          current={p}
          loadError={importIssue}
          reading={importBusy}
          onClose={() => {
            importVersion.current++;
            setImportBusy(false);
            setImported(null);
            setNotice("");
          }}
          onChoose={() => upload.current?.click()}
          onImport={(next) => {
            setP(next);
            setImported(null);
            setPage("workbench");
            setNotice("已导入选中的生成设置。");
          }}
          onUse={(kind) => {
            setPage("workbench");
            const img = imported.image;
            if (kind === "base") {
              setSelected(null);
              patch({
                baseImage: img,
                mask: null,
                focus: null,
                ...normalizeBaseDims(img.width, img.height),
              });
              setDrawer("image");
            } else {
              if (p.references.length >= 16)
                return fail("最多添加 16 张参考图");
              patch({
                references: [
                  ...p.references,
                  {
                    ...img,
                    id: crypto.randomUUID(),
                    type: kind,
                    enabled: true,
                    strength: 0.6,
                    info: 0.7,
                    fidelity: 1,
                    caption: "character",
                  },
                ],
              });
              setDrawer("vibe");
            }
            setImported(null);
            setNotice(
              kind === "base"
                ? "已载入底图，提示词和采样设置保持不变。"
                : "已添加参考图。",
            );
          }}
        />
      )}
      {detail && (
        <ArtworkDetails
          item={detail}
          onClose={() => setDetail(null)}
          onTemplatesChange={setTemplates}
          onUse={(params) => {
            setP((old) => restoreWithChunks(old, params));
            setPage("workbench");
            viewArtwork(detail);
            setDetail(null);
            setNotice("已恢复历史生成设置。");
          }}
        />
      )}
    </>
  );
}
// 一条连接能出哪些模型：优先用读到的清单，否则回落到内置清单。
function imageModelsFor(connection?: Connection): { id: string; label: string }[] {
  if (!connection) return [];
  const saved = Array.isArray(connection.models) ? connection.models : [];
  if (saved.length)
    return saved.map((id) => ({
      id,
      label:
        MODELS.find((m) => m.id === id)?.label ||
        openAIImageModel(id)?.label ||
        foreignImageModel(id)?.label ||
        id,
    }));
  const spec = protocolOfConnection(connection);
  if (spec.id === "novelai-native")
    return MODELS_BY_NEWEST.map((m) => ({ id: m.id, label: m.label }));
  return builtinImageModels(spec.id) as any;
}
// 这个 id 是不是 NovelAI 注册表里的模型；不是就返回 undefined，交给 defaults 兜底。
function novelAIModelId(id?: string) {
  return MODELS.some((m) => m.id === id) ? id : undefined;
}
function modelByIdSafe(id: string) {
  return (
    MODELS.find((m) => m.id === id)?.label ||
    openAIImageModel(id)?.label ||
    foreignImageModel(id)?.label ||
    "未知模型"
  );
}
