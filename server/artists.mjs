import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  copyFile,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  readConfig,
  saveConfig,
  validateDataDir,
  pickFolder,
} from "./storage.mjs";

const FILE = "artists.json";
const coverName = /^[a-f0-9-]{36}\.webp$/;
async function readLibrary(dir) {
  let raw;
  try {
    raw = JSON.parse(await readFile(path.join(dir, FILE), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw new Error("画师库文件无法读取，请检查 artists.json，原文件未改动");
  }
  if (raw?.version !== 1 || !Array.isArray(raw.artists))
    throw new Error("画师库文件格式无效");
  const ids = new Set(),
    tags = new Set();
  return raw.artists.map((item) => {
    const value = normalize(item);
    if (
      typeof item.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(item.id) ||
      ids.has(item.id) ||
      tags.has(value.tag.toLowerCase()) ||
      (item.cover && !coverName.test(item.cover))
    )
      throw new Error("画师库记录格式无效");
    ids.add(item.id);
    tags.add(value.tag.toLowerCase());
    return {
      ...value,
      id: item.id,
      cover: item.cover || "",
      updatedAt: item.updatedAt || "",
    };
  });
}
function normalize(item) {
  if (
    !item ||
    typeof item.tag !== "string" ||
    !item.tag.trim() ||
    item.tag.length > 500 ||
    /[\r\n]/.test(item.tag)
  )
    throw new Error("请填写有效的画师标签（最多 500 字，不含换行）");
  const name = String(item.name || item.tag).trim();
  if (!name || name.length > 100) throw new Error("画师名称最多 100 字");
  const categories = Array.isArray(item.categories)
    ? item.categories
    : [item.category || "未分类"];
  if (
    categories.length > 20 ||
    categories.some((c) => typeof c !== "string" || c.length > 50)
  )
    throw new Error("画师分类格式无效");
  return {
    name,
    tag: item.tag.trim(),
    categories: [...new Set(categories.map((c) => c.trim()).filter(Boolean))],
    favorite: !!item.favorite,
  };
}
async function atomic(dir, artists) {
  await mkdir(dir, { recursive: true });
  const temp = path.join(dir, `artists.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify({ version: 1, artists }, null, 2));
    await rename(temp, path.join(dir, FILE));
  } catch (e) {
    await unlink(temp).catch(() => {});
    throw e;
  }
}

export async function mountArtists(app, { root, dataDir, wrap }) {
  const config = await readConfig(root);
  let dir = config.artistDir
    ? path.resolve(config.artistDir)
    : path.join(dataDir, "artists");
  // A damaged optional library must not prevent the workbench from starting.
  let items = [],
    loadError = "";
  try {
    items = await readLibrary(dir);
  } catch (e) {
    loadError = e.message;
  }
  let pending = Promise.resolve();
  const serialized = (fn) => {
    const job = pending.then(fn);
    pending = job.catch(() => {});
    return job;
  };
  const check = () => {
    if (loadError) throw new Error(loadError);
  };
  const view = () => ({
    items: items.map((a) => ({
      ...a,
      coverUrl: a.cover ? `/api/artists/covers/${a.cover}` : "",
    })),
    storage: { activeDir: dir },
    ...(loadError ? { error: loadError } : {}),
  });
  async function cover(data) {
    if (!data) return "";
    if (
      typeof data !== "string" ||
      data.length > 45 * 1024 * 1024 ||
      !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(data)
    )
      throw new Error("封面需为 PNG、JPEG 或 WebP 图片，最多 32 MB");
    const bytes = Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
    const output = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({
        width: 640,
        height: 640,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
    await mkdir(path.join(dir, "covers"), { recursive: true });
    const name = `${randomUUID()}.webp`;
    await writeFile(path.join(dir, "covers", name), output);
    return name;
  }
  async function removeCovers(names) {
    for (const name of new Set(names.filter(Boolean))) {
      if (coverName.test(name) && !items.some((a) => a.cover === name))
        await unlink(path.join(dir, "covers", name)).catch((e) => {
          if (e.code !== "ENOENT")
            console.warn("[artists] 封面清理失败", e.code);
        });
    }
  }
  async function commit(next, created = []) {
    const previous = items;
    try {
      await atomic(dir, next);
    } catch (e) {
      await removeCovers(created);
      throw e;
    }
    items = next;
    await removeCovers(previous.map((a) => a.cover));
  }
  if (!loadError) {
    const files = await readdir(path.join(dir, "covers")).catch((e) => {
      if (e.code === "ENOENT") return [];
      console.warn("[artists] 无法检查旧封面", e.code);
      return [];
    });
    await removeCovers(files);
  }
  app.get(
    "/api/artists",
    wrap(async (_req, res) => {
      await pending;
      res.json(view());
    }),
  );
  app.get(
    "/api/artists/covers/:name",
    wrap(async (req, res) => {
      if (
        !coverName.test(req.params.name) ||
        !items.some((a) => a.cover === req.params.name)
      )
        return res.sendStatus(404);
      res
        .type("webp")
        .send(await readFile(path.join(dir, "covers", req.params.name)));
    }),
  );
  app.post(
    "/api/artists",
    wrap(async (req, res) =>
      serialized(async () => {
        check();
        const old = req.body.id
          ? items.find((a) => a.id === req.body.id)
          : null;
        if (req.body.id && !old) throw new Error("画师已不存在，请刷新后重试");
        const value = normalize(req.body);
        if (
          items.some(
            (a) =>
              a.id !== old?.id &&
              a.tag.toLowerCase() === value.tag.toLowerCase(),
          )
        )
          throw new Error("这个画师标签已存在");
        const image = req.body.image;
        const name =
          image === null ? "" : image ? await cover(image) : old?.cover || "";
        const artist = {
          ...value,
          id: old?.id || randomUUID(),
          cover: name,
          updatedAt: new Date().toISOString(),
        };
        const next = old
          ? items.map((a) => (a.id === old.id ? artist : a))
          : [artist, ...items];
        await commit(next, name && name !== old?.cover ? [name] : []);
        res.json(view());
      }),
    ),
  );
  app.delete(
    "/api/artists/:id",
    wrap(async (req, res) =>
      serialized(async () => {
        check();
        const next = items.filter((a) => a.id !== req.params.id);
        await commit(next);
        res.json(view());
      }),
    ),
  );
  app.get(
    "/api/artists/export",
    wrap(async (_req, res) =>
      serialized(async () => {
        check();
        const artists = await Promise.all(
          items.map(async (a) => ({
            ...a,
            imageUrl: a.cover
              ? `data:image/webp;base64,${(await readFile(path.join(dir, "covers", a.cover))).toString("base64")}`
              : "",
          })),
        );
        res.json({ version: 1, artists });
      }),
    ),
  );
  app.post(
    "/api/artists/import",
    wrap(async (req, res) =>
      serialized(async () => {
        check();
        const list = Array.isArray(req.body) ? req.body : req.body.artists;
        if (!Array.isArray(list) || list.length > 5000)
          throw new Error("请选择画师库 JSON（最多 5000 位）");
        // Validate the complete batch before writing; presets are intentionally ignored.
        const values = list.map((a) => ({
          ...normalize({ ...a, tag: a.tag || a.prompt || a.name }),
          image: a.imageUrl || a.image || "",
        }));
        const next = [...items];
        let added = 0;
        const created = [];
        try {
          for (const value of values) {
            const index = next.findIndex(
              (a) => a.tag.toLowerCase() === value.tag.toLowerCase(),
            );
            const old = next[index];
            const { image, ...meta } = value;
            const merged = normalize({
              ...meta,
              categories: [
                ...new Set([...(old?.categories || []), ...meta.categories]),
              ],
            });
            const newCover = old?.cover || (image ? await cover(image) : "");
            if (newCover && !old?.cover) created.push(newCover);
            const record = {
              ...merged,
              id: old?.id || randomUUID(),
              favorite: old?.favorite || meta.favorite,
              cover: newCover,
              updatedAt: new Date().toISOString(),
            };
            if (old) next[index] = record;
            else {
              next.push(record);
              added++;
            }
          }
          await commit(next, created);
        } catch (e) {
          await removeCovers(created);
          throw e;
        }
        res.json({ ...view(), added });
      }),
    ),
  );
  app.post(
    "/api/artists/storage/pick",
    wrap(async (_req, res) => res.json({ path: await pickFolder(dir) })),
  );
  app.post(
    "/api/artists/storage",
    wrap(async (req, res) =>
      serialized(async () => {
        const target = await validateDataDir(req.body.dataDir);
        if (
          path.resolve(target).toLowerCase() === path.resolve(dir).toLowerCase()
        )
          return res.json(view());
        const rel = (a, b) => {
          const r = path.relative(a, b);
          return !r || (!r.startsWith("..") && !path.isAbsolute(r));
        };
        if (rel(dir, target) || rel(target, dir))
          throw new Error("新旧位置不能互相包含，请选择独立文件夹");
        let next;
        if (req.body.mode === "copy") {
          check();
          if ((await readdir(target)).length)
            throw new Error("复制时请选择空文件夹，避免覆盖已有资料");
          await mkdir(path.join(target, "covers"), { recursive: true });
          for (const name of new Set(
            items.map((a) => a.cover).filter(Boolean),
          )) {
            const source = path.join(dir, "covers", name),
              destination = path.join(target, "covers", name);
            await copyFile(source, destination);
            const hash = async (file) =>
              createHash("sha256")
                .update(await readFile(file))
                .digest("hex");
            if ((await hash(source)) !== (await hash(destination)))
              throw new Error("封面复制校验失败，原目录未改动");
          }
          await atomic(target, items);
          next = await readLibrary(target);
        } else next = await readLibrary(target);
        await saveConfig(root, { artistDir: target });
        dir = target;
        items = next;
        loadError = "";
        res.json(view());
      }),
    ),
  );
}
