import { apiMaskDimensions, isPaintedMaskPixel, maxPoolAlpha } from "./inpaint";
import { loadImageEl } from "./image";

/** Restore API black/white pixels to alpha before resampling to the requested output. */
export async function maskForOutput(b64: string, width: number, height: number) {
  const image = await loadImageEl(`data:image/png;base64,${b64}`);
  if (image.naturalWidth === width && image.naturalHeight === height) return b64;
  const c = document.createElement("canvas");
  c.width = image.naturalWidth; c.height = image.naturalHeight;
  const ctx = c.getContext("2d")!; ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, c.width, c.height), d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const alpha = isPaintedMaskPixel(d[i], d[i+1], d[i+2], d[i+3]) ? 255 : 0;
    d.set([255, 255, 255, alpha], i);
  }
  ctx.putImageData(pixels, 0, 0);
  return buildSentMask(c, width, height);
}

/** 官方蒙版覆盖色 (novelai.net 编辑器实测: 白色(252,251,251) 处呈 (192,205,232)) */
/** 蚂蚁线 (官方 Konva: stroke black, width 1, dash [5.29, 5.29]) */

/**
 * 发送蒙版 (官方管线): 笔刷层 → 降到输出尺寸 1/8 → alpha>155 二值化
 * → 最近邻放回输出尺寸。最后一步由官网请求层完成；这里直接生成最终 API 蒙版。
 * mask 源可以是全分辨率笔刷层, 也可以是已调整过的 1/8 二值蒙版 (尺寸一致时降采样为恒等)。
 * 降采样用最大值池化: 笔画盖到哪个格子哪个格子就生效 (平滑降采样会让细笔画
 * 的格子 alpha 掉到阈值以下, 表现为"涂很多遍/涂很大才生效")。
 */
export function buildSentMask(paint: HTMLCanvasElement, outW: number, outH: number): string {
  const { width: w8, height: h8 } = apiMaskDimensions(outW, outH);
  const small = maxPoolMask(paint, w8, h8);
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, outW, outH);
  return out.toDataURL("image/png").split(",")[1];
}

/**
 * 最大值池化降采样核心: 见 inpaint.ts maxPoolAlpha。
 */
export function maxPoolMask(paint: HTMLCanvasElement, w8: number, h8: number): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = w8;
  small.height = h8;
  const sctx = small.getContext("2d")!;
  const src = paint.getContext("2d")!.getImageData(0, 0, paint.width, paint.height);
  const pooled = maxPoolAlpha(src.data, paint.width, paint.height, w8, h8);
  const img = sctx.createImageData(w8, h8);
  img.data.set(pooled);
  sctx.putImageData(img, 0, 0);
  return small;
}

/** 1/8 二值蒙版形态学: cells>0 膨胀 / cells<0 收缩 (对应官方 Adjust 蒙版) */
function morph8(src: HTMLCanvasElement, cells: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  if (!cells) {
    out.getContext("2d")!.drawImage(src, 0, 0);
    return out;
  }
  const w = src.width,
    h = src.height;
  const d = src.getContext("2d")!.getImageData(0, 0, w, h).data;
  const img = out.getContext("2d")!.createImageData(w, h);
  const o = img.data;
  const r = Math.abs(cells);
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? d[(y * w + x) * 4 + 3] > 127 : cells < 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = at(x, y);
      if (cells > 0 && !v) {
        scan: for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (at(x + dx, y + dy)) {
              v = true;
              break scan;
            }
      } else if (cells < 0 && v) {
        scan2: for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (!at(x + dx, y + dy)) {
              v = false;
              break scan2;
            }
      }
      const i = (y * w + x) * 4;
      o[i] = o[i + 1] = o[i + 2] = 255;
      o[i + 3] = v ? 255 : 0;
    }
  }
  out.getContext("2d")!.putImageData(img, 0, 0);
  return out;
}

/** 官方 p0: 最近邻缩放 (floor((i+.5)*scale) 直接取源像素) */
function nearestUpscale(src: HTMLCanvasElement, W: number, H: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const s = src.getContext("2d")!.getImageData(0, 0, src.width, src.height).data;
  const img = out.getContext("2d")!.createImageData(W, H);
  const o = img.data;
  for (let y = 0; y < H; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y + 0.5) * src.height / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x + 0.5) * src.width / W));
      const si = (sy * src.width + sx) * 4;
      const di = (y * W + x) * 4;
      o[di] = s[si];
      o[di + 1] = s[si + 1];
      o[di + 2] = s[si + 2];
      o[di + 3] = s[si + 3];
    }
  }
  out.getContext("2d")!.putImageData(img, 0, 0);
  return out;
}

/** 可分离盒式模糊 (近似官方 worker stackblur radius/iterations), 只作用于白色蒙版的 alpha */
function blurAlphaWhite(cv: HTMLCanvasElement, radius: number, iterations: number) {
  const w = cv.width,
    h = cv.height;
  const img = cv.getContext("2d")!.getImageData(0, 0, w, h);
  const d = img.data;
  const a = new Float32Array(w * h);
  for (let i = 3, j = 0; i < d.length; i += 4, j++) a[j] = d[i];
  const tmp = new Float32Array(w * h);
  for (let it = 0; it < iterations; it++) {
    // 横向
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      const win = radius * 2 + 1;
      for (let x = -radius; x <= radius; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        sum += a[row + Math.min(w - 1, x + radius + 1)] - a[row + Math.max(0, x - radius)];
      }
    }
    // 纵向
    for (let x = 0; x < w; x++) {
      let sum = 0;
      const win = radius * 2 + 1;
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / win;
        sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
      }
    }
  }
  for (let i = 3, j = 0; i < d.length; i += 4, j++) d[i] = a[j];
  cv.getContext("2d")!.putImageData(img, 0, 0);
}

/**
 * 官方显示管线 (generateInfill + mask worker):
 * 1/8 二值蒙版 → dilate(4) → 最近邻×8 (p0) → blur(20, 2) → 着色
 * 返回: display=着色用蒙版, contour=蚂蚁线轮廓源 (膨胀后的 1/8 蒙版)
 * 仅用于聚焦重绘的合成羽化 (focused-inpaint blendMask);
 * 编辑器预览已改为 crispDisplayMask (硬边所见即所发)。
 */
export function officialDisplayMask(mask8: HTMLCanvasElement, W: number, H: number) {
  const dil = morph8(mask8, 4);
  const up = nearestUpscale(dil, W, H);
  blurAlphaWhite(up, 20, 2);
  return { display: up, contour: dil };
}

/**
 * 精确预览: 1/8 二值蒙版最近邻放大回输出尺寸, 不膨胀不模糊。
 * 所见即所发 —— 涂到哪格亮到哪格, 硬边。
 */
export function crispDisplayMask(mask8: HTMLCanvasElement, W: number, H: number): HTMLCanvasElement {
  return nearestUpscale(mask8, W, H);
}

type Pt = [number, number];

/**
 * 平滑蚂蚁线轮廓: 笔刷 alpha 场降到 ~半分辨率 → marching squares 提取等值线
 * → 折线拼接 → Chaikin 平滑 → 输出画布坐标 Path2D
 */
export function contourPathSmooth(src: HTMLCanvasElement): Path2D {
  const field = 420;
  const s = Math.max(1, Math.ceil(src.width / field));
  const w = Math.max(1, Math.floor(src.width / s));
  const h = Math.max(1, Math.floor(src.height / s));
  const t = document.createElement("canvas");
  t.width = w;
  t.height = h;
  const tc = t.getContext("2d")!;
  tc.drawImage(src, 0, 0, w, h);
  const d = tc.getImageData(0, 0, w, h).data;
  const on = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 127;

  // marching squares: 每个单元格按 4 角状态生成边界中点线段
  const segs: [Pt, Pt][] = [];
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const idx =
        (on(x, y) ? 1 : 0) |
        (on(x + 1, y) ? 2 : 0) |
        (on(x + 1, y + 1) ? 4 : 0) |
        (on(x, y + 1) ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const T: Pt = [x + 1, y + 0.5];
      const B: Pt = [x + 1, y + 1.5];
      const L: Pt = [x + 0.5, y + 1];
      const R: Pt = [x + 1.5, y + 1];
      const add = (p: Pt, q: Pt) => segs.push([p, q]);
      switch (idx) {
        case 1: add(L, T); break;
        case 2: add(T, R); break;
        case 3: add(L, R); break;
        case 4: add(R, B); break;
        case 5: add(L, T); add(R, B); break;
        case 6: add(T, B); break;
        case 7: add(L, B); break;
        case 8: add(B, L); break;
        case 9: add(B, T); break;
        case 10: add(T, R); add(B, L); break;
        case 11: add(B, R); break;
        case 12: add(R, L); break;
        case 13: add(R, T); break;
        case 14: add(T, L); break;
      }
    }
  }
  if (!segs.length) return new Path2D();

  // 线段拼接成折线 (端点哈希)
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const adj = new Map<string, { i: number; end: 0 | 1 }[]>();
  segs.forEach(([p, q], i) => {
    ([
      [p, 0],
      [q, 1],
    ] as [Pt, 0 | 1][]).forEach(([pt, end]) => {
      const k = key(pt);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k)!.push({ i, end });
    });
  });
  const used = new Set<number>();
  const polys: Pt[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const line: Pt[] = [segs[i][0], segs[i][1]];
    // 向两端延伸直到没有未使用的相邻线段 (闭环自然终止)
    for (const dir of [0, 1] as const) {
      for (;;) {
        const tip = dir === 0 ? line[0] : line[line.length - 1];
        const cand = (adj.get(key(tip)) || []).filter((e) => !used.has(e.i));
        if (!cand.length) break;
        const e = cand[0];
        used.add(e.i);
        const other = segs[e.i][e.end === 0 ? 1 : 0];
        if (dir === 0) line.unshift(other);
        else line.push(other);
      }
    }
    if (line.length > 1) polys.push(line);
  }

  // Chaikin 平滑一次 + 输出 Path2D (×s 回画布坐标)
  const path = new Path2D();
  const smooth = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const out: Pt[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[i + 1];
      out.push([px * 0.75 + qx * 0.25, py * 0.75 + qy * 0.25]);
      out.push([px * 0.25 + qx * 0.75, py * 0.25 + qy * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  for (const poly of polys) {
    const sm = smooth(poly);
    sm.forEach(([x, y], i) => {
      const X = x * s,
        Y = y * s;
      if (i === 0) path.moveTo(X, Y);
      else path.lineTo(X, Y);
    });
    path.closePath();
  }
  return path;
}
