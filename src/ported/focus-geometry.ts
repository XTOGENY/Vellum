export interface FocusRegion { x: number; y: number; width: number; height: number; context: number }
export const snapFocus = (n: number) => Math.round(n / 8) * 8;
export function focusRect(a: {x:number;y:number}, b: {x:number;y:number}, context = 96): FocusRegion {
  let dx = snapFocus(b.x - a.x), dy = snapFocus(b.y - a.y);
  const ratio = Math.min(1, Math.sqrt(589824 / Math.max(1, Math.abs(dx * dy))));
  dx = Math.sign(dx) * Math.floor(Math.abs(dx) * ratio / 8) * 8;
  dy = Math.sign(dy) * Math.floor(Math.abs(dy) * ratio / 8) * 8;
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), width: Math.abs(dx), height: Math.abs(dy), context };
}
export function focusCrop(r: FocusRegion, width: number, height: number) {
  const x = Math.max(0, r.x), y = Math.max(0, r.y);
  return { x, y, width: Math.min(width, r.x + r.width) - x, height: Math.min(height, r.y + r.height) - y };
}
// Official rei helper: upscale to 1 MP, round down to the model's 64 px grid.
export function focusResolution(width: number, height: number) {
  const scale = Math.sqrt(1048576 / (width * height));
  const result = width * height >= .8 * 1048576 ? {width, height} : {
    width: Math.floor(Math.floor(width * scale) / 64) * 64,
    height: Math.floor(Math.floor(height * scale) / 64) * 64,
  };
  if (result.width < 64 || result.height < 64) throw new Error("聚焦选区过于狭长，请扩大短边。");
  return result;
}
export function focusCenter(x: number, y: number, width: number, height: number, r: {x:number;y:number;width:number;height:number}) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return {x: clamp((x * width - r.x) / r.width), y: clamp((y * height - r.y) / r.height)};
}
