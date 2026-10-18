// Adapted from the user's mask-canvas.ts / inpaint.ts core. The blend uses the
// reference project's approximation (dilate four 1/8 cells, two radius-20 box blurs).
// API selection and the local blending alpha are separate; never send the blur as selection.
import sharp from "sharp";

async function smallMask(data, width, height) {
  const { data: rgba, info } = await sharp(data, {
    limitInputPixels: 32 * 1024 * 1024,
  })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = Math.max(1, Math.round(width / 8)),
    h = Math.max(1, Math.round(height / 8)),
    small = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * info.width) / w),
        x1 = Math.min(
          info.width,
          Math.max(x0 + 1, Math.floor(((x + 1) * info.width) / w)),
        ),
        y0 = Math.floor((y * info.height) / h),
        y1 = Math.min(
          info.height,
          Math.max(y0 + 1, Math.floor(((y + 1) * info.height) / h)),
        );
      search: for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * info.width + sx) * 4;
          if (
            rgba[i + 3] > 155 &&
            Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 155
          ) {
            small[y * w + x] = 255;
            break search;
          }
        }
    }
  return { small, w, h };
}
function upscale(small, w, h, width, height) {
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      out[y * width + x] =
        small[
          Math.min(h - 1, Math.floor(((y + 0.5) * h) / height)) * w +
            Math.min(w - 1, Math.floor(((x + 0.5) * w) / width))
        ];
  return out;
}
export async function apiInpaintMask(data, width, height) {
  const { small, w, h } = await smallMask(data, width, height);
  if (!small.some(Boolean)) throw Error("蒙版没有可重绘区域");
  // Request preprocessing restores the 1/8 editing grid to full image dimensions.
  // The wire mask must be opaque black/white, not the intermediate alpha mask.
  return (
    await sharp(Buffer.from(upscale(small, w, h, width, height)), {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer()
  ).toString("base64");
}
export async function inpaintBlendAlpha(data, width, height) {
  const { small, w, h } = await smallMask(data, width, height),
    dilated = new Uint8Array(small.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      search: for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const sx = x + dx,
            sy = y + dy;
          if (sx >= 0 && sy >= 0 && sx < w && sy < h && small[sy * w + sx]) {
            dilated[y * w + x] = 255;
            break search;
          }
        }
    }
  const a = Float32Array.from(upscale(dilated, w, h, width, height)),
    tmp = new Float32Array(a.length),
    radius = 20,
    win = 41;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x++)
        sum += a[row + Math.min(width - 1, Math.max(0, x))];
      for (let x = 0; x < width; x++) {
        tmp[row + x] = sum / win;
        sum +=
          a[row + Math.min(width - 1, x + radius + 1)] -
          a[row + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++)
        sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
      for (let y = 0; y < height; y++) {
        a[y * width + x] = sum / win;
        sum +=
          tmp[Math.min(height - 1, y + radius + 1) * width + x] -
          tmp[Math.max(0, y - radius) * width + x];
      }
    }
  }
  return Buffer.from(Uint8ClampedArray.from(a));
}
