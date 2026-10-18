// 图片文件读取工具
export function fileToB64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

export function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

export function imageDims(b64: string): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = rej;
    img.src = `data:image/png;base64,${b64}`;
  });
}

export function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

/** 官方约束: 边长 64 的倍数、总像素 ≤ 3145728 (官方前端同款上限) */
export const MAX_BASE_PIXELS = 3145728;

/**
 * 官网失焦量化 (2026-09-11 实测): 先取绝对值再四舍五入到 64 倍数, 最后钳到最小 64。
 * -96→128 (abs 先行), -50→64, 0→64, 2016→2048 (half-up), 10→64。
 */
export function quantizeSide(v: number): number {
  return Math.max(64, Math.round(Math.abs(Number.isFinite(v) ? v : 64) / 64) * 64);
}

/** Editing one side preserves that side and reduces the other at the pixel limit. */
export function constrainResolution(w: number, h: number, changed: "width" | "height") {
  let width = Math.min(MAX_BASE_PIXELS / 64, quantizeSide(w));
  let height = Math.min(MAX_BASE_PIXELS / 64, quantizeSide(h));
  if (width * height > MAX_BASE_PIXELS) {
    if (changed === "width") height = Math.max(64, Math.floor(MAX_BASE_PIXELS / width / 64) * 64);
    else width = Math.max(64, Math.floor(MAX_BASE_PIXELS / height / 64) * 64);
  }
  return { width, height };
}

/** Official rq import sizing (public client 5285, 2026-09-12).
 * Compare the 1216-long-side and 896-short-side candidates by aspect error;
 * retain valid dimensions, and use the official 512-square fallback if neither fits.
 */
export function normalizeBaseDims(w:number,h:number,current?:{width:number;height:number}):{width:number;height:number} {
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return {width:512,height:512};
  const landscape=w>h,short=Math.min(w,h),long=Math.max(w,h),ratio=short/long;
  if(current&&current.width/current.height===w/h&&short<=current.width&&long<=current.height)return {...current};
  if(short%64===0&&long%64===0&&short*long<=MAX_BASE_PIXELS)return {width:w,height:h};
  const candidateShort=quantizeSide(1216*ratio),candidateLong=quantizeSide(896/ratio);
  let width:number,height:number;
  if(Math.abs(candidateShort/1216-ratio)<Math.abs(896/candidateLong-ratio)&&candidateShort*1216<=MAX_BASE_PIXELS){width=candidateShort;height=1216;}
  else if(896*candidateLong<=MAX_BASE_PIXELS){width=896;height=candidateLong;}
  else {width=512;height=512;}
  return landscape?{width:height,height:width}:{width,height};
}

export function snapDims(w: number, h: number): { width: number; height: number } {
  const s = Math.min(1, Math.sqrt(MAX_BASE_PIXELS / Math.max(1, w * h)));
  const result = {
    width: Math.max(64, Math.round((w * s) / 64) * 64),
    height: Math.max(64, Math.round((h * s) / 64) * 64),
  };
  return constrainResolution(result.width, result.height, "width");
}

/** 画到指定尺寸并编码为 PNG base64 (用于底图对齐尺寸) */
export function imageToB64(img: HTMLImageElement, width: number, height: number): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return c.toDataURL("image/png").split(",")[1];
}

/**
 * 底图载入对齐 (官方导入流程, 2026-09-11 实测): 64 倍数合规图原样保留,
 * 其余按官网候选尺寸比较规则归一化, 重采样后返回 base64。已符合约束时直接原样返回, 避免重复编码。
 */
export async function normalizeBaseImage(
  b64: string, current?:{width:number;height:number}
): Promise<{ b64: string; width: number; height: number }> {
  const img = await loadImageEl(`data:image/png;base64,${b64}`);
  const { width, height } = normalizeBaseDims(img.naturalWidth, img.naturalHeight, current);
  if (width === img.naturalWidth && height === img.naturalHeight) {
    return { b64, width, height };
  }
  return { b64: imageToB64(img, width, height), width, height };
}
