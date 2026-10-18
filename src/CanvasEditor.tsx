// Core drawing/layer/selection engine ported from the user's ImageEditor.tsx.
// Workbench UI is rebuilt with the current paper design; no old app state or data.
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as PE } from "react";
import { Button, Field, Select, Slider, Toggle } from "./ui";
import {
  focusRect,
  snapFocus,
  type FocusRegion,
} from "./ported/focus-geometry";
import { loadImageEl, snapDims, MAX_BASE_PIXELS } from "./ported/image";
import { apiMaskDimensions, isPaintedMaskPixel } from "./ported/inpaint";
import {
  buildSentMask,
  maxPoolMask,
  crispDisplayMask,
  contourPathSmooth,
} from "./ported/mask-canvas";
import {
  canvas,
  cloneCanvas,
  floodFill,
  adjustHSV,
  createBlurStroke,
} from "./ported/editor-raster";
type Tool =
  | "focus"
  | "draw"
  | "erase"
  | "fill"
  | "select"
  | "lasso"
  | "picker"
  | "blur"
  | "clone";
type Point = { x: number; y: number };
type Layer = { id: number; mask: boolean; image: HTMLCanvasElement };
type Snapshot = { focus?: FocusRegion; layers: Layer[]; selected: number };
const labels: Record<Tool, string> = {
  focus: "聚焦框选",
  draw: "画笔",
  erase: "橡皮",
  fill: "填充",
  select: "矩形选区",
  lasso: "套索",
  picker: "取色",
  blur: "模糊",
  clone: "克隆",
};
const patterns = ["纯色", "斜线", "交叉线", "圆点", "网格", "棋盘格", "爱心"];
const colors = [
  "#849fd5",
  "#ff6666",
  "#ffbd66",
  "#ffff66",
  "#66dd88",
  "#66ddee",
  "#b388ff",
  "#ff88cc",
  "#ffffff",
];
const copy = (layers: Layer[]) =>
  layers.map((l) => ({ ...l, image: cloneCanvas(l.image) }));
const path = (points: Point[]) => {
  const p = new Path2D();
  points.forEach((v, i) => (i ? p.lineTo(v.x, v.y) : p.moveTo(v.x, v.y)));
  p.closePath();
  return p;
};
let id = 1;
export default function CanvasEditor({
  source,
  width: initialWidth,
  height: initialHeight,
  mask: initialMask,
  focus: initialFocus,
  onApply,
  onClose,
  onError,
}: {
  source: string | null;
  width: number;
  height: number;
  mask?: string;
  focus?: any;
  onApply: (
    image: string,
    mask: string | null,
    meta?: { width: number; height: number; focus?: any },
  ) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"mask" | "draw">(source ? "mask" : "draw");
  const src = useMemo(() => {
    if (source) return source;
    const b = canvas(initialWidth, initialHeight);
    const c = b.getContext("2d")!;
    c.fillStyle = "white";
    c.fillRect(0, 0, b.width, b.height);
    return b.toDataURL();
  }, [source]);
  const params = {
    mask: initialMask,
    focus: initialFocus,
    baseImage: {
      width: initialWidth,
      height: initialHeight,
      b64: (source || "").split(",")[1],
    },
  };
  const patch = (next: any) =>
    onApply(next.baseImage.b64, next.mask || null, {
      width: next.width,
      height: next.height,
      focus: next.focus,
    });
  const dialog = useRef<HTMLElement>(null),
    stage = useRef<HTMLDivElement>(null),
    view = useRef<HTMLCanvasElement>(null);
  const layers = useRef<Layer[]>([]),
    selected = useRef(0),
    undo = useRef<Snapshot[]>([]),
    redo = useRef<Snapshot[]>([]);
  const gesture = useRef<{
    start: Point;
    last: Point;
    source: HTMLCanvasElement;
    pan?: Point;
    focusMove?: FocusRegion;
    selection?: Point[];
    points?: Point[];
    blurStroke?: ReturnType<typeof createBlurStroke>;
  } | null>(null);
  const clone = useRef<Point | null>(null),
    cloneDelta = useRef<Point | null>(null),
    space = useRef(false),
    frame = useRef(0);
  const [version, bump] = useState(0),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [size, setSize] = useState({
      width: 1,
      height: 1,
    }),
    [area, setArea] = useState({
      width: 1,
      height: 1,
    });
  const [focus, setFocus] = useState<FocusRegion | undefined>(
    initialFocus?.units === "px" ? initialFocus : undefined,
  );
  const [contextSize, setContextSize] = useState(
    initialFocus?.units === "px" ? initialFocus.context : 32,
  );
  const [tool, setTool] = useState<Tool>("draw"),
    [brush, setBrush] = useState(mode === "mask" ? 4 : 20);
  const [color, setColor] = useState("#000000"),
    [tip, setTip] = useState("round"),
    [pressure, setPressure] = useState(true),
    [square, setSquare] = useState(false);
  const [tolerance, setTolerance] = useState(15),
    [intensity, setIntensity] = useState(50);
  const [maskColor, setMaskColor] = useState(colors[0]),
    [opacity, setOpacity] = useState(50),
    [pattern, setPattern] = useState(0),
    [border, setBorder] = useState(true);
  const [palette, setPalette] = useState(false),
    [showLayers, setShowLayers] = useState(false),
    [resizeOpen, setResizeOpen] = useState(false),
    [edges, setEdges] = useState([0, 0, 0, 0]);
  const [hsv, setHsv] = useState([0, 0, 0]),
    [hsvOpen, setHsvOpen] = useState(false),
    hsvSource = useRef<HTMLCanvasElement | null>(null);
  const [selection, setSelection] = useState<Point[] | null>(null),
    [cursor, setCursor] = useState<Point | null>(null);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({
      x: 0,
      y: 0,
    });
  const thumbnails = useMemo(
    () => (showLayers ? layers.current.map((l) => l.image.toDataURL()) : []),
    [version, showLayers],
  );
  const active = layers.current[selected.current],
    isMask = active?.mask,
    fit = Math.max(
      0.001,
      Math.min(
        1,
        (area.width - 32) / size.width,
        (area.height - 32) / size.height,
      ),
    );
  const touch = () => bump((v) => v + 1);
  const checkpoint = () => {
    undo.current.push({
      layers: copy(layers.current),
      selected: selected.current,
      focus,
    });
    redo.current = [];
    let bytes = undo.current.reduce(
      (n, s) =>
        n +
        s.layers.reduce((a, l) => a + l.image.width * l.image.height * 4, 0),
      0,
    );
    while (
      undo.current.length > 1 &&
      (undo.current.length > 30 || bytes > 128 * 1024 * 1024)
    ) {
      const old = undo.current.shift()!;
      bytes -= old.layers.reduce(
        (a, l) => a + l.image.width * l.image.height * 4,
        0,
      );
    }
  };
  const merged = (mask: boolean) => {
    const c = canvas(size.width, size.height);
    for (const l of layers.current)
      if (l.mask === mask) c.getContext("2d")!.drawImage(l.image, 0, 0);
    return c;
  };
  const focusedMask = () => {
    const c = merged(true),
      ctx = c.getContext("2d")!;
    if (focus) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "white";
      ctx.fillRect(
        focus.x + focus.context,
        focus.y + focus.context,
        Math.max(0, focus.width - 2 * focus.context),
        Math.max(0, focus.height - 2 * focus.context),
      );
      if (focus.width <= 2 * focus.context || focus.height <= 2 * focus.context)
        ctx.clearRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "source-over";
    }
    return c;
  };
  const repaint = () => {
    const c = view.current;
    if (!c || !layers.current.length) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(merged(false), 0, 0);
    if (mode !== "mask") return;
    // 最大值池化降采样: 笔画盖到的格子立即生效 (原平滑降采样+阈值会丢细笔画);
    // 预览用硬边最近邻放大 (不膨胀不模糊), 所见即所发; 蚂蚁线直接贴二值格子。
    const d = apiMaskDimensions(size.width, size.height),
      small = maxPoolMask(focusedMask(), d.width, d.height),
      display = crispDisplayMask(small, size.width, size.height),
      contour = small,
      dc = display.getContext("2d")!;
    dc.globalCompositeOperation = "source-in";
    dc.fillStyle = maskColor;
    dc.fillRect(0, 0, size.width, size.height);
    if (pattern) {
      const tile = canvas(24, 24),
        tc = tile.getContext("2d")!;
      tc.fillStyle = maskColor;
      tc.strokeStyle = maskColor;
      tc.lineWidth = 5;
      if (pattern === 1 || pattern === 2) {
        tc.beginPath();
        tc.moveTo(-12, 24);
        tc.lineTo(24, -12);
        tc.moveTo(0, 36);
        tc.lineTo(36, 0);
        tc.stroke();
      }
      if (pattern === 2) {
        tc.beginPath();
        tc.moveTo(-12, 0);
        tc.lineTo(24, 36);
        tc.moveTo(0, -12);
        tc.lineTo(36, 24);
        tc.stroke();
      }
      if (pattern === 3) {
        tc.beginPath();
        tc.arc(12, 12, 4, 0, Math.PI * 2);
        tc.fill();
      }
      if (pattern === 4) {
        tc.fillRect(0, 0, 24, 3);
        tc.fillRect(0, 0, 3, 24);
      }
      if (pattern === 5) {
        tc.fillRect(0, 0, 12, 12);
        tc.fillRect(12, 12, 12, 12);
      }
      if (pattern === 6) {
        tc.beginPath();
        tc.moveTo(12, 20);
        tc.bezierCurveTo(-5, 9, 5, 0, 12, 7);
        tc.bezierCurveTo(19, 0, 29, 9, 12, 20);
        tc.fill();
      }
      dc.globalCompositeOperation = "destination-in";
      dc.fillStyle = dc.createPattern(tile, "repeat")!;
      dc.fillRect(0, 0, size.width, size.height);
    }
    ctx.globalAlpha = opacity / 100;
    ctx.drawImage(display, 0, 0);
    ctx.globalAlpha = 1;
    if (border) {
      ctx.save();
      const sx = size.width / contour.width,
        sy = size.height / contour.height;
      ctx.scale(sx, sy);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1 / Math.max(0.01, fit * zoom * sx);
      ctx.setLineDash(
        [5.29, 5.29].map((n) => n / Math.max(0.01, fit * zoom * sx)),
      );
      ctx.stroke(contourPathSmooth(contour));
      ctx.restore();
    }
  };
  const schedule = () => {
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        repaint();
      });
  };
  useEffect(() => {
    const previous = document.activeElement;

    let cancelled = false;
    void (async () => {
      try {
        const img = await loadImageEl(src);
        if (cancelled) return;
        const width = img.naturalWidth,
          height = img.naturalHeight,
          base = canvas(width, height);
        base.getContext("2d")!.drawImage(img, 0, 0);
        const initial: Layer[] = [
          {
            id: id++,
            mask: false,
            image: base,
          },
        ];
        {
          const mask = canvas(width, height);
          if (params.mask) {
            const img = await loadImageEl(
              `data:image/png;base64,${params.mask}`,
            );
            if (cancelled) return;
            const ctx = mask.getContext("2d")!;
            ctx.drawImage(img, 0, 0, width, height);
            const image = ctx.getImageData(0, 0, width, height),
              d = image.data;
            for (let i = 0; i < d.length; i += 4) {
              const v = isPaintedMaskPixel(d[i], d[i + 1], d[i + 2], d[i + 3])
                ? 255
                : 0;
              d.set([255, 255, 255, v], i);
            }
            ctx.putImageData(image, 0, 0);
          }
          initial.push({
            id: id++,
            mask: true,
            image: mask,
          });
        }
        layers.current = initial;
        selected.current = mode === "mask" ? initial.length - 1 : 0;
        setSize({
          width,
          height,
        });
        setReady(true);
        touch();
      } catch {
        setError("底图加载失败，请关闭后重新载入图片。");
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setArea({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      }),
    );
    observer.observe(stage.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (ready) repaint();
  }, [
    ready,
    version,
    size,
    fit,
    zoom,
    maskColor,
    opacity,
    pattern,
    border,
    focus,
  ]);
  const restore = (from: Snapshot[], to: Snapshot[]) => {
    if (!from.length) return;
    to.push({
      layers: copy(layers.current),
      selected: selected.current,
      focus,
    });
    const next = from.pop()!;
    layers.current = next.layers;
    selected.current = next.selected;
    setFocus(next.focus);
    if (next.focus) setContextSize(next.focus.context);
    setSize({
      width: next.layers[0].image.width,
      height: next.layers[0].image.height,
    });
    setSelection(null);
    touch();
  };
  const clip = (ctx: CanvasRenderingContext2D) => {
    if (selection?.length) ctx.clip(path(selection));
    if (isMask && focus) {
      ctx.beginPath();
      ctx.rect(
        focus.x + focus.context,
        focus.y + focus.context,
        Math.max(0, focus.width - 2 * focus.context),
        Math.max(0, focus.height - 2 * focus.context),
      );
      ctx.clip();
    }
  };
  const clear = () => {
    if (!active) return;
    checkpoint();
    const ctx = active.image.getContext("2d")!;
    ctx.save();
    clip(ctx);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.restore();
    touch();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        space.current = true;
      }
      if (hsvOpen) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.shiftKey
            ? restore(redo.current, undo.current)
            : restore(undo.current, redo.current);
        }
        if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          restore(redo.current, undo.current);
        }
        if (e.key.toLowerCase() === "d") {
          e.preventDefault();
          setSelection(null);
          if (focus) {
            checkpoint();
            setFocus(undefined);
          }
        }
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        if (tool === "focus") {
          checkpoint();
          setFocus(undefined);
        } else clear();
      }
      const keys: Record<string, Tool> = {
        b: "draw",
        e: "erase",
        g: "fill",
        m: "select",
        l: "lasso",
        i: "picker",
      };
      if (
        keys[e.key] &&
        (!isMask || ["draw", "erase", "fill"].includes(keys[e.key]))
      )
        setTool(keys[e.key]);
      if (e.key === "[") setBrush((v) => Math.max(1, v - 1));
      if (e.key === "]") setBrush((v) => Math.min(1000, v + 1));
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    const node = dialog.current!;
    node.addEventListener("keydown", key);
    window.addEventListener("keyup", up);
    return () => {
      node.removeEventListener("keydown", key);
      window.removeEventListener("keyup", up);
    };
  });
  const point = (e: PE) => {
    const r = view.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * size.width) / r.width,
      y: ((e.clientY - r.top) * size.height) / r.height,
    };
  };
  const stroke = (p: Point, e: PE) => {
    const g = gesture.current;
    if (!active || !g) return;
    const ctx = active.image.getContext("2d")!,
      diameter =
        brush *
        (isMask ? 8 : 1) *
        (pressure && e.pointerType === "pen" ? Math.max(0.05, e.pressure) : 1),
      r = diameter / 2;
    ctx.save();
    clip(ctx);
    if (tool === "blur") {
      g.blurStroke ??= createBlurStroke(g.source, intensity, brush);
      const preview = g.blurStroke(p.x, p.y, diameter);
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.drawImage(preview, 0, 0);
    } else if (tool === "clone") {
      if (cloneDelta.current) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(g.source, cloneDelta.current.x, cloneDelta.current.y);
      }
    } else {
      ctx.globalCompositeOperation =
        tool === "erase" ? "destination-out" : "source-over";
      ctx.fillStyle = isMask ? "#fff" : color;
      const steps = Math.max(
        1,
        Math.ceil(
          Math.hypot(p.x - g.last.x, p.y - g.last.y) / Math.max(1, r / 3),
        ),
      );
      for (let i = 1; i <= steps; i++) {
        const x = g.last.x + ((p.x - g.last.x) * i) / steps,
          y = g.last.y + ((p.y - g.last.y) * i) / steps;
        if (isMask ? square : tip === "square")
          ctx.fillRect(x - r, y - r, diameter, diameter);
        else if (!isMask && tip === "soft") {
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r),
            ink = tool === "erase" ? "#000000" : color;
          grad.addColorStop(0, ink);
          grad.addColorStop(1, ink + "00");
          ctx.fillStyle = grad;
          ctx.fillRect(x - r, y - r, diameter, diameter);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
    g.last = p;
    schedule();
  };
  const down = (e: PE<HTMLCanvasElement>) => {
    if (!ready || !active || hsvOpen || ![0, 1].includes(e.button)) return;
    dialog.current?.focus();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    setError("");
    if (e.button === 1 || space.current) {
      gesture.current = {
        start: {
          x: e.clientX,
          y: e.clientY,
        },
        last: p,
        source: active.image,
        pan,
      };
      return;
    }
    if (tool === "focus") {
      checkpoint();
      const q = { x: snapFocus(p.x), y: snapFocus(p.y) };
      const corners = focus
        ? [
            { x: focus.x, y: focus.y },
            { x: focus.x + focus.width, y: focus.y },
            { x: focus.x, y: focus.y + focus.height },
            { x: focus.x + focus.width, y: focus.y + focus.height },
          ]
        : [];
      const corner = corners.findIndex(
        (c) => Math.abs(c.x - p.x) <= 32 && Math.abs(c.y - p.y) <= 32,
      );
      const inside =
        focus &&
        p.x >= focus.x &&
        p.x <= focus.x + focus.width &&
        p.y >= focus.y &&
        p.y <= focus.y + focus.height;
      gesture.current = {
        start: corner >= 0 ? corners[3 - corner] : q,
        last: q,
        source: active.image,
        focusMove: corner < 0 && inside ? { ...focus } : undefined,
      };
      if (corner < 0 && !inside)
        setFocus({ ...q, width: 0, height: 0, context: contextSize });
      return;
    }
    if (tool === "picker") {
      const d = merged(false)
        .getContext("2d")!
        .getImageData(
          Math.max(0, Math.min(size.width - 1, p.x)),
          Math.max(0, Math.min(size.height - 1, p.y)),
          1,
          1,
        ).data;
      setColor(
        "#" +
          Array.from(d.slice(0, 3))
            .map((n) => n.toString(16).padStart(2, "0"))
            .join(""),
      );
      setTool("draw");
      return;
    }
    if (tool === "clone" && e.altKey) {
      clone.current = p;
      cloneDelta.current = null;
      return;
    }
    if (tool === "clone" && !clone.current) {
      setError("Alt + 点击图片设置克隆源。");
      return;
    }
    if (tool === "select" || tool === "lasso") {
      const moving =
        selection &&
        active.image.getContext("2d")!.isPointInPath(path(selection), p.x, p.y);
      if (moving) checkpoint();
      else setSelection(null);
      gesture.current = {
        start: p,
        last: p,
        source: cloneCanvas(active.image),
        selection: moving ? selection! : undefined,
        points: [p],
      };
      return;
    }
    checkpoint();
    gesture.current = {
      start: p,
      last: p,
      source: cloneCanvas(active.image),
    };
    if (tool === "fill") {
      const ctx = active.image.getContext("2d")!,
        image = ctx.getImageData(0, 0, size.width, size.height);
      floodFill(
        image,
        p.x,
        p.y,
        isMask
          ? [255, 255, 255, 255]
          : [
              parseInt(color.slice(1, 3), 16),
              parseInt(color.slice(3, 5), 16),
              parseInt(color.slice(5, 7), 16),
              255,
            ],
        isMask ? 0 : tolerance,
      );
      const filled = canvas(size.width, size.height);
      filled.getContext("2d")!.putImageData(image, 0, 0);
      ctx.save();
      clip(ctx);
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.drawImage(filled, 0, 0);
      ctx.restore();
      gesture.current = null;
      touch();
      return;
    }
    if (tool === "clone" && !cloneDelta.current)
      cloneDelta.current = {
        x: p.x - clone.current!.x,
        y: p.y - clone.current!.y,
      };
    stroke(p, e);
  };
  const move = (e: PE<HTMLCanvasElement>) => {
    const p = point(e);
    setCursor(p);
    const g = gesture.current;
    if (!g) return;
    if (g.pan) {
      setPan({
        x: g.pan.x + e.clientX - g.start.x,
        y: g.pan.y + e.clientY - g.start.y,
      });
      return;
    }
    if (tool === "focus") {
      if (g.focusMove) {
        const r = g.focusMove;
        setFocus({
          ...r,
          x: Math.max(
            -r.context,
            Math.min(
              size.width + r.context - r.width,
              r.x + snapFocus(p.x - g.start.x),
            ),
          ),
          y: Math.max(
            -r.context,
            Math.min(
              size.height + r.context - r.height,
              r.y + snapFocus(p.y - g.start.y),
            ),
          ),
        });
      } else
        setFocus(
          focusRect(
            g.start,
            {
              x: snapFocus(Math.max(0, Math.min(size.width, p.x))),
              y: snapFocus(Math.max(0, Math.min(size.height, p.y))),
            },
            contextSize,
          ),
        );
      g.last = p;
      return;
    }
    if (tool === "select" || tool === "lasso") {
      if (g.selection) {
        const dx = p.x - g.start.x,
          dy = p.y - g.start.y,
          ctx = active.image.getContext("2d")!;
        ctx.clearRect(0, 0, size.width, size.height);
        ctx.drawImage(g.source, 0, 0);
        ctx.save();
        ctx.clip(path(g.selection));
        ctx.clearRect(0, 0, size.width, size.height);
        ctx.restore();
        ctx.save();
        ctx.translate(dx, dy);
        ctx.clip(path(g.selection));
        ctx.drawImage(g.source, 0, 0);
        ctx.restore();
        setSelection(
          g.selection.map((v) => ({
            x: v.x + dx,
            y: v.y + dy,
          })),
        );
        schedule();
      } else if (tool === "select")
        setSelection([
          g.start,
          {
            x: p.x,
            y: g.start.y,
          },
          p,
          {
            x: g.start.x,
            y: p.y,
          },
        ]);
      else {
        g.points!.push(p);
        setSelection([...g.points!]);
      }
      g.last = p;
      return;
    }
    stroke(p, e);
  };
  const end = (e: PE<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (tool === "focus" && g && !g.focusMove) {
      const next = focusRect(g.start, g.last, contextSize);
      if (next.width < 32 || next.height < 32) setFocus(undefined);
      else
        setFocus({
          ...next,
          context: Math.min(
            contextSize,
            Math.floor(Math.min(next.width, next.height) / 32) * 8,
          ),
        });
    }
    if (
      g &&
      (tool === "select" || tool === "lasso") &&
      !g.selection &&
      Math.hypot(g.last.x - g.start.x, g.last.y - g.start.y) < 2
    )
      setSelection(null);
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    touch();
  };
  const chooseLayer = (index: number) => {
    selected.current = index;
    setMode(layers.current[index].mask ? "mask" : "draw");
    setTool("draw");
    setBrush(layers.current[index].mask ? 4 : 20);
    setSelection(null);
    touch();
  };
  const shift = (i: number, delta: number) => {
    checkpoint();
    const to = i + delta;
    [layers.current[i], layers.current[to]] = [
      layers.current[to],
      layers.current[i],
    ];
    chooseLayer(to);
  };
  const resize = () => {
    const [top, left, bottom, right] = edges.map(Math.round),
      width = size.width + left + right,
      height = size.height + top + bottom;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 64 ||
      height < 64 ||
      width * height > MAX_BASE_PIXELS
    ) {
      setError("边长至少为 64，总像素不能超过 3,145,728。");
      return;
    }
    checkpoint();
    layers.current = layers.current.map((l) => {
      const image = canvas(width, height),
        ctx = image.getContext("2d")!;
      if (l.mask) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.clearRect(left, top, size.width, size.height);
      }
      ctx.drawImage(l.image, left, top);
      return {
        ...l,
        image,
      };
    });
    setSize({
      width,
      height,
    });
    setFocus(undefined);
    setResizeOpen(false);
    setSelection(null);
    setZoom(1);
    setPan({
      x: 0,
      y: 0,
    });
    setError("");
    touch();
  };
  const previewHSV = (values: number[]) => {
    setHsv(values);
    if (!hsvSource.current) return;
    const source = hsvSource.current,
      ctx = active.image.getContext("2d")!,
      pixels = source
        .getContext("2d")!
        .getImageData(0, 0, size.width, size.height);
    adjustHSV(pixels.data, ...(values as [number, number, number]));
    const c = canvas(size.width, size.height);
    c.getContext("2d")!.putImageData(pixels, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(source, 0, 0);
    ctx.save();
    clip(ctx);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(c, 0, 0);
    ctx.restore();
    touch();
  };
  const finishHSV = (apply: boolean) => {
    if (hsvSource.current) {
      const current = cloneCanvas(active.image),
        ctx = active.image.getContext("2d")!;
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.drawImage(hsvSource.current, 0, 0);
      if (apply) {
        checkpoint();
        ctx.clearRect(0, 0, size.width, size.height);
        ctx.drawImage(current, 0, 0);
      }
    }
    hsvSource.current = null;
    setHsvOpen(false);
    touch();
  };
  const save = () => {
    const target = snapDims(size.width, size.height),
      base = canvas(target.width, target.height);
    base
      .getContext("2d")!
      .drawImage(merged(false), 0, 0, target.width, target.height);
    const b64 = base.toDataURL("image/png").split(",")[1],
      mask = focusedMask(),
      hasMask = mask
        ?.getContext("2d")!
        .getImageData(0, 0, size.width, size.height)
        .data.some((v, i) => i % 4 === 3 && v > 155);
    if (focus && !hasMask && mask) {
      const c = Math.min(
        focus.context,
        Math.floor(Math.min(focus.width, focus.height) / 4),
      );
      const ctx = mask.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(
        focus.x + c,
        focus.y + c,
        Math.max(1, focus.width - 2 * c),
        Math.max(1, focus.height - 2 * c),
      );
    }
    const effectiveMask = !!mask && (hasMask || !!focus);
    patch({
      baseImage: {
        b64,
        width: target.width,
        height: target.height,
      },
      mask: effectiveMask
        ? buildSentMask(mask, target.width, target.height)
        : undefined,
      focus:
        effectiveMask && focus
          ? {
              ...focus,
              units: "px",
              x: snapFocus((focus.x * target.width) / size.width),
              y: snapFocus((focus.y * target.height) / size.height),
              width: snapFocus((focus.width * target.width) / size.width),
              height: snapFocus((focus.height * target.height) / size.height),
              context:
                Math.floor(
                  (Math.min(
                    focus.context,
                    Math.min(focus.width, focus.height) / 4,
                  ) *
                    Math.min(
                      target.width / size.width,
                      target.height / size.height,
                    )) /
                    8,
                ) * 8,
            }
          : undefined,
      width: target.width,
      height: target.height,
      action: mask && hasMask ? "infill" : "img2img",
    });
  };

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(),
        x = e.clientX - r.left - r.width / 2,
        y = e.clientY - r.top - r.height / 2;
      const next = Math.min(
        16,
        Math.max(
          0.05,
          zoom * Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.002),
        ),
      );
      setPan({
        x: x - ((x - pan.x) * next) / zoom,
        y: y - ((y - pan.y) * next) / zoom,
      });
      setZoom(next);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoom, pan]);
  const changeMode = (next: "mask" | "draw") => {
    setMode(next);
    const i = layers.current.findIndex((l) => l.mask === (next === "mask"));
    if (i >= 0) chooseLayer(i);
  };
  const fitView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const tools: Tool[] = isMask
    ? ["draw", "erase", "fill", "focus", "select", "lasso"]
    : ["draw", "erase", "fill", "select", "lasso", "picker", "blur", "clone"];
  return (
    <section
      ref={dialog}
      className="canvas-editor ported-editor"
      tabIndex={-1}
      aria-label="画布编辑器"
    >
      <div className="editor-tools" role="toolbar" aria-label="画布工具">
        <div className="seg">
          <button
            className={mode === "draw" ? "active" : ""}
            onClick={() => changeMode("draw")}
          >
            涂鸦
          </button>
          <button
            className={mode === "mask" ? "active" : ""}
            onClick={() => changeMode("mask")}
          >
            重绘蒙版
          </button>
        </div>
        <Select
          aria-label="绘图工具"
          value={tool}
          onChange={(e) => setTool(e.target.value as Tool)}
        >
          {tools.map((t) => (
            <option key={t} value={t}>
              {labels[t]}
            </option>
          ))}
        </Select>
        <Button
          small
          title="撤销"
          disabled={!undo.current.length}
          onClick={() => restore(undo.current, redo.current)}
        >
          撤销
        </Button>
        <Button
          small
          disabled={!redo.current.length}
          onClick={() => restore(redo.current, undo.current)}
        >
          重做
        </Button>
        <Button small onClick={() => setShowLayers(!showLayers)}>
          图层
        </Button>
        <Button
          small
          onClick={() => {
            setEdges([0, 0, 0, 0]);
            setResizeOpen(!resizeOpen);
          }}
        >
          尺寸 / 扩图
        </Button>
        {!isMask && (
          <Button
            small
            disabled={!active}
            onClick={() => {
              hsvSource.current = cloneCanvas(active.image);
              setHsv([0, 0, 0]);
              setHsvOpen(!hsvOpen);
            }}
          >
            HSV
          </Button>
        )}
        {mode === "mask" && (
          <Button small onClick={() => setPalette(!palette)}>
            蒙版显示
          </Button>
        )}
      </div>
      <div className="paint-options ported-options">
        {tool === "focus" ? (
          <Slider
            label="上下文边距"
            value={contextSize}
            min={0}
            max={96}
            step={8}
            onChange={(n) => {
              setContextSize(n);
              if (focus) setFocus({ ...focus, context: n });
            }}
          />
        ) : (
          <Slider
            label="画笔大小"
            value={brush}
            min={1}
            max={128}
            step={1}
            onChange={setBrush}
          />
        )}
        {!isMask && (
          <input
            type="color"
            aria-label="画笔颜色"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        )}
        {!isMask && (
          <Select
            aria-label="笔刷形状"
            value={tip}
            onChange={(e) => setTip(e.target.value)}
          >
            <option value="round">圆形</option>
            <option value="soft">柔边</option>
            <option value="square">方形</option>
          </Select>
        )}
        {isMask && (
          <Toggle label="方形笔刷" checked={square} onChange={setSquare} />
        )}
        <Toggle label="压感" checked={pressure} onChange={setPressure} />
        <Button small onClick={fitView}>
          适应窗口
        </Button>
        <span className="mono">{Math.round(fit * zoom * 100)}%</span>
        <Button small disabled={!active} onClick={clear}>
          {isMask ? "清空蒙版" : "清空图层"}
        </Button>
        {selection && (
          <Button small onClick={() => setSelection(null)}>
            取消选区
          </Button>
        )}
        {focus && (
          <Button
            small
            onClick={() => {
              checkpoint();
              setFocus(undefined);
            }}
          >
            清除聚焦框
          </Button>
        )}
      </div>
      {tool === "fill" && (
        <Slider
          label="填充容差"
          value={tolerance}
          min={0}
          max={255}
          step={1}
          onChange={setTolerance}
        />
      )}
      {tool === "blur" && (
        <Slider
          label="模糊强度"
          value={intensity}
          min={1}
          max={100}
          step={1}
          onChange={setIntensity}
        />
      )}
      {tool === "clone" && (
        <p className="note">Alt＋点击设置克隆源，再拖动绘制。</p>
      )}
      {palette && (
        <div className="editor-inline">
          <Field label="蒙版颜色">
            <input
              type="color"
              value={maskColor}
              onChange={(e) => setMaskColor(e.target.value)}
            />
          </Field>
          <Slider
            label="蒙版透明度"
            min={10}
            max={100}
            step={5}
            value={opacity}
            onChange={setOpacity}
          />
          <Select
            aria-label="蒙版图案"
            value={pattern}
            onChange={(e) => setPattern(+e.target.value)}
          >
            {patterns.map((p, i) => (
              <option key={p} value={i}>
                {p}
              </option>
            ))}
          </Select>
          <Toggle label="显示边界" checked={border} onChange={setBorder} />
          <Button small onClick={() => setPalette(false)}>
            收起
          </Button>
        </div>
      )}
      {hsvOpen && (
        <div className="editor-inline">
          {["色相", "饱和度", "亮度"].map((n, i) => (
            <Slider
              key={n}
              label={n}
              value={hsv[i]}
              min={i === 0 ? -180 : -100}
              max={i === 0 ? 180 : 100}
              step={1}
              onChange={(n) => previewHSV(hsv.map((v, k) => (k === i ? n : v)))}
            />
          ))}
          <Button small onClick={() => finishHSV(false)}>
            取消调整
          </Button>
          <Button small primary onClick={() => finishHSV(true)}>
            应用调整
          </Button>
        </div>
      )}
      {resizeOpen && (
        <div className="editor-inline">
          {["上边缘", "左边缘", "下边缘", "右边缘"].map((n, i) => (
            <Field label={n} key={n}>
              <input
                type="number"
                step={8}
                value={edges[i]}
                onChange={(e) =>
                  setEdges(edges.map((v, k) => (k === i ? +e.target.value : v)))
                }
              />
            </Field>
          ))}
          <Button
            small
            onClick={() => {
              setEdges([
                0,
                0,
                Math.floor(size.height / 64) * 64 - size.height,
                Math.floor(size.width / 64) * 64 - size.width,
              ]);
            }}
          >
            裁到有效尺寸
          </Button>
          <Button small primary onClick={resize}>
            应用尺寸
          </Button>
          <Button small onClick={() => setResizeOpen(false)}>
            收起
          </Button>
        </div>
      )}
      <div className="ported-canvas-workspace">
        <div
          ref={stage}
          className="ported-canvas-stage"
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) fitView();
          }}
        >
          <div
            className="ported-canvas-stack"
            style={{
              width: size.width * fit,
              height: size.height * fit,
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
          >
            <canvas
              ref={view}
              width={size.width}
              height={size.height}
              aria-label="编辑画布"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onLostPointerCapture={() => {
                gesture.current = null;
              }}
            />
            {selection && (
              <svg
                className="ported-selection"
                viewBox={`0 0 ${size.width} ${size.height}`}
              >
                <path
                  d={
                    selection
                      .map((v, i) => `${i ? "L" : "M"}${v.x} ${v.y}`)
                      .join(" ") + "Z"
                  }
                  fill="none"
                  stroke="white"
                  strokeWidth={1 / (fit * zoom)}
                  strokeDasharray={`${5 / (fit * zoom)} ${5 / (fit * zoom)}`}
                />
              </svg>
            )}
            {focus && mode === "mask" && (
              <svg
                className="ported-selection"
                viewBox={`0 0 ${size.width} ${size.height}`}
                aria-label="聚焦选区"
              >
                <rect
                  x={focus.x}
                  y={focus.y}
                  width={focus.width}
                  height={focus.height}
                  fill="none"
                  stroke="#52643a"
                  strokeWidth={2 / (fit * zoom)}
                />
                <rect
                  x={focus.x + focus.context}
                  y={focus.y + focus.context}
                  width={Math.max(0, focus.width - focus.context * 2)}
                  height={Math.max(0, focus.height - focus.context * 2)}
                  fill="none"
                  stroke="white"
                  strokeDasharray="8 8"
                  strokeWidth={2 / (fit * zoom)}
                />
              </svg>
            )}
          </div>
        </div>
        {showLayers && (
          <aside className="ported-layers" aria-label="图层">
            <Button
              small
              onClick={() => {
                checkpoint();
                layers.current.push({
                  id: id++,
                  mask: mode === "mask",
                  image: canvas(size.width, size.height),
                });
                chooseLayer(layers.current.length - 1);
              }}
            >
              添加图层
            </Button>
            {layers.current.map((l, i) => (
              <div className="ported-layer" key={l.id}>
                <button
                  aria-pressed={selected.current === i}
                  onClick={() => chooseLayer(i)}
                >
                  <img src={thumbnails[i]} alt="图层缩略图" />
                  {l.mask ? "蒙版" : "底图"} {i + 1}
                </button>
                <div>
                  <button disabled={i === 0} onClick={() => shift(i, -1)}>
                    ↓
                  </button>
                  <button
                    disabled={i === layers.current.length - 1}
                    onClick={() => shift(i, 1)}
                  >
                    ↑
                  </button>
                  <button
                    disabled={
                      layers.current.filter((x) => x.mask === l.mask).length <=
                      1
                    }
                    onClick={() => {
                      checkpoint();
                      layers.current.splice(i, 1);
                      chooseLayer(Math.max(0, i - 1));
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </aside>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="canvas-foot">
        <small>
          {size.width} × {size.height} ·{" "}
          {isMask ? "蒙版不写入底图" : "当前编辑底图"}
          <span>Ctrl＋滚轮缩放 · 中键或空格拖动</span>
        </small>
        <span className="grow" />
        <Button small onClick={onClose}>
          取消
        </Button>
        <Button small primary disabled={!ready || hsvOpen} onClick={save}>
          应用到工作台
        </Button>
      </footer>
    </section>
  );
}
