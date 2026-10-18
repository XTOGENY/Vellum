/** NovelAI 的 infill API 使用输出尺寸 1/8 的二值蒙版。 */
export function apiMaskDimensions(outW: number, outH: number) {
  return {
    width: Math.max(1, Math.round(outW / 8)),
    height: Math.max(1, Math.round(outH / 8)),
  };
}

/**
 * 编辑器内部既可能读到透明笔刷层，也可能读到 API 使用的不透明黑白蒙版。
 * 只有亮色且不透明的像素才是重绘区；不能只看 alpha（黑底同样是 255）。
 */
export function isPaintedMaskPixel(r: number, g: number, b: number, a: number) {
  return a > 155 && Math.max(r, g, b) > 127;
}

/**
 * 最大值池化降采样核心 (纯函数): 每个目标格子取源块内最大 alpha, >thr 记为已涂。
 * 平滑降采样会让细笔画的格子 alpha 掉到阈值以下 (表现为"涂很多遍/涂很大才生效")；
 * 最大值池化保证笔画盖到的格子立即生效。返回 w8×h8 的 RGBA (白底二值 alpha)。
 */
export function maxPoolAlpha(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  w8: number,
  h8: number,
  thr = 155
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w8 * h8 * 4);
  for (let cy = 0; cy < h8; cy++) {
    const y0 = Math.floor((cy * srcH) / h8);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * srcH) / h8));
    for (let cx = 0; cx < w8; cx++) {
      const x0 = Math.floor((cx * srcW) / w8);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * srcW) / w8));
      let m = 0;
      for (let y = y0; y < y1 && m <= thr; y++) {
        const row = y * srcW;
        for (let x = x0; x < x1; x++) {
          const a = src[(row + x) * 4 + 3];
          if (a > m) m = a;
        }
      }
      const v = m > thr ? 255 : 0;
      const i = (cy * w8 + cx) * 4;
      out[i] = out[i + 1] = out[i + 2] = 255;
      out[i + 3] = v;
    }
  }
  return out;
}
