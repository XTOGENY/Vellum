export type PixelBuffer = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

/** Four-connected fill. Compare against the original pixel, including alpha. */
export function floodFill(image: PixelBuffer, x: number, y: number, color: number[], tolerance = 0) {
  const {
    width,
    height,
    data
  } = image;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const start = y * width + x,
    source = Array.from(data.slice(start * 4, start * 4 + 4));
  const threshold = Math.max(0, Math.min(255, tolerance));
  if (source.every((v, i) => v === color[i])) return;
  const seen = new Uint8Array(width * height),
    stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const p = stack.pop()!,
      i = p * 4;
    if (!source.every((v, k) => Math.abs(data[i + k] - v) <= threshold)) continue;
    data.set(color, i);
    const push = (n: number) => {
      if (!seen[n]) {
        seen[n] = 1;
        stack.push(n);
      }
    };
    if (p % width) push(p - 1);
    if (p % width < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < width * (height - 1)) push(p + width);
  }
}
export function adjustHSV(data: Uint8ClampedArray, hue: number, saturation: number, value: number) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255,
      g = data[i + 1] / 255,
      b = data[i + 2] / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    let h = delta === 0 ? 0 : max === r ? (g - b) / delta % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = ((h * 60 + hue) % 360 + 360) % 360 / 60;
    const s = Math.max(0, Math.min(1, (max === 0 ? 0 : delta / max) + saturation / 100));
    const v = Math.max(0, Math.min(1, max + value / 100));
    const c = v * s,
      x = c * (1 - Math.abs(h % 2 - 1)),
      m = v - c;
    const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    for (let k = 0; k < 3; k++) data[i + k] = (rgb[k] + m) * 255;
  }
}
export function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
export function cloneCanvas(source: HTMLCanvasElement) {
  const c = canvas(source.width, source.height);
  c.getContext("2d")!.drawImage(source, 0, 0);
  return c;
}

/** Public NovelAI editor chunk 5285: fixed snapshot, edge padding and feathered stroke. */
export function createBlurStroke(source: HTMLCanvasElement, intensity: number, brushSize: number) {
  const snapshot=cloneCanvas(source),w=source.width,h=source.height;
  const radius=Math.max(1,.3*intensity),pad=Math.ceil(3*radius);
  const padded=canvas(w+2*pad,h+2*pad),ctx=padded.getContext('2d')!;
  ctx.drawImage(snapshot,pad,pad);
  ctx.drawImage(snapshot,0,0,w,1,pad,0,w,pad);
  ctx.drawImage(snapshot,0,h-1,w,1,pad,h+pad,w,pad);
  ctx.drawImage(snapshot,0,0,1,h,0,pad,pad,h);
  ctx.drawImage(snapshot,w-1,0,1,h,w+pad,pad,pad,h);
  for(const x of [0,1])for(const y of [0,1])ctx.drawImage(snapshot,x*(w-1),y*(h-1),1,1,x*(w+pad),y*(h+pad),pad,pad);
  const blurred=canvas(w,h),bctx=blurred.getContext('2d')!;
  bctx.filter=`blur(${radius}px)`;bctx.drawImage(padded,-pad,-pad);bctx.filter='none';
  const mask=canvas(w,h),preview=canvas(w,h),points:{x:number;y:number;size:number}[]=[];
  return (x:number,y:number,size:number)=>{
    points.push({x,y,size});
    const m=mask.getContext('2d')!;
    m.clearRect(0,0,w,h);m.filter=`blur(${.15*brushSize}px)`;m.fillStyle=m.strokeStyle='white';m.lineCap=m.lineJoin='round';
    if(points.length===1){m.beginPath();m.arc(x,y,size/2,0,Math.PI*2);m.fill();}
    else if(points.every(p=>p.size===points[0].size)){
      m.lineWidth=points[0].size;m.beginPath();m.moveTo(points[0].x,points[0].y);
      for(const p of points.slice(1))m.lineTo(p.x,p.y);m.stroke();
    }else for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];m.lineWidth=(a.size+b.size)/2;m.beginPath();m.moveTo(a.x,a.y);m.lineTo(b.x,b.y);m.stroke();
    }
    m.filter='none';
    const p=preview.getContext('2d')!;
    p.globalCompositeOperation='copy';p.drawImage(blurred,0,0);
    p.globalCompositeOperation='destination-in';p.drawImage(mask,0,0);
    p.globalCompositeOperation='destination-over';p.drawImage(snapshot,0,0);
    p.globalCompositeOperation='source-over';return preview;
  };
}
