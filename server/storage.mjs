import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const CONFIG_NAME = "config.json";
export const LEGACY_DIR = ".local";
export const DEFAULT_DIR = "data";

export async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export function configPath(root) {
  return process.env.NWENAI_CONFIG
    ? path.resolve(process.env.NWENAI_CONFIG)
    : path.join(root, CONFIG_NAME);
}

export async function readConfig(root) {
  const file = configPath(root);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("not an object");
    return data;
  } catch {
    throw new Error(`配置文件格式错误，请检查或删除：${file}`);
  }
}

export async function saveConfig(root, patch) {
  const file = configPath(root);
  const next = { version: 1, ...(await readConfig(root)), ...patch };
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(tmp, file);
  } catch (e) {
    throw new Error(
      `无法写入配置文件 ${file}：${e.code === "EPERM" || e.code === "EACCES" ? "没有写入权限" : e.message}`,
    );
  }
  return next;
}

// 优先级：环境变量 > config.json > 旧版 .local > 新的默认 data/。
export async function resolveDataDir(root) {
  const env = String(process.env.NWENAI_DATA_DIR || "").trim();
  if (env) return path.resolve(env);
  const config = await readConfig(root);
  const configured =
    typeof config.dataDir === "string" ? config.dataDir.trim() : "";
  if (configured) return path.resolve(configured);
  if (await exists(path.join(root, LEGACY_DIR, "state.json")))
    return path.join(root, LEGACY_DIR);
  return path.join(root, DEFAULT_DIR);
}

export async function validateDataDir(target) {
  if (typeof target !== "string" || !target.trim())
    throw new Error("请填写保存位置");
  const raw = target.trim();
  if (!path.isAbsolute(raw))
    throw new Error("请填写完整的绝对路径，例如 D:\\Vellum");
  const resolved = path.resolve(raw);
  const current = await stat(resolved).catch(() => null);
  if (current && !current.isDirectory())
    throw new Error("这个路径已经被一个文件占用，请选择文件夹");
  try {
    await mkdir(resolved, { recursive: true });
  } catch (e) {
    throw new Error("无法创建这个文件夹：" + friendly(e));
  }
  const probe = path.join(resolved, `.nwenai-write-test-${randomUUID()}.tmp`);
  try {
    await writeFile(probe, "ok");
    await unlink(probe);
  } catch (e) {
    throw new Error("这个文件夹不可写：" + friendly(e));
  }
  return resolved;
}

function friendly(e) {
  if (e?.code === "EPERM" || e?.code === "EACCES") return "没有写入权限";
  if (e?.code === "ENOENT") return "路径所在的磁盘或文件夹不存在";
  if (e?.code === "ENOSPC") return "磁盘空间不足";
  return String(e?.message || e);
}

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function measure(dir) {
  let files = 0,
    bytes = 0;
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) {
        files++;
        bytes += (await stat(target)).size;
      }
    }
  };
  await walk(dir);
  return { files, bytes };
}

// 把旧目录整体复制到新目录，不动旧目录；复制前后都做体积校验。
export async function copyStorage(from, to) {
  const src = path.resolve(from),
    dst = path.resolve(to);
  if (src === dst) throw new Error("新旧位置相同，不需要迁移");
  if (inside(dst, src) || inside(src, dst))
    throw new Error("新旧位置不能互相包含，请换一个独立的文件夹");
  if (!(await exists(src))) return { files: 0, bytes: 0, images: 0 };
  for (const name of ["state.json", "draft.json", "history.json", "tasks.json"]) {
    if (await exists(path.join(dst, name)))
      throw new Error(
        name === "state.json"
          ? "新位置里已经有 state.json，请换一个空文件夹"
          : `新位置里已经有 ${name}，请换一个空文件夹`,
      );
  }
  const imagesDir = path.join(dst, "images");
  if (await exists(imagesDir)) {
    const images = await readdir(imagesDir).catch(() => []);
    if (images.length) throw new Error("新位置的 images 文件夹不是空的");
  }
  await mkdir(dst, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (/^state\..*\.tmp$/.test(entry.name)) continue;
    const source = path.join(src, entry.name),
      target = path.join(dst, entry.name);
    if (entry.name === "state.json" && entry.isFile()) {
      const data = await readFile(source);
      await writeFile(target, data, { mode: 0o600 });
    } else {
      await cp(source, target, { recursive: true, force: true });
    }
  }
  const sourceState = await stat(path.join(src, "state.json")).catch(() => null);
  const targetState = await stat(path.join(dst, "state.json")).catch(() => null);
  if (!!sourceState !== !!targetState || (sourceState && targetState && sourceState.size !== targetState.size))
    throw new Error("state.json 复制不完整，请检查磁盘空间后重试");
  const sourceImages = await measure(path.join(src, "images")).catch(() => ({ files: 0, bytes: 0 }));
  const targetImages = await measure(path.join(dst, "images")).catch(() => ({ files: 0, bytes: 0 }));
  if (sourceImages.files !== targetImages.files || sourceImages.bytes !== targetImages.bytes)
    throw new Error("图片复制不完整，请检查磁盘空间后重试");
  const sourceBlobs = await measure(path.join(src, "blobs")).catch(() => ({ files: 0, bytes: 0 }));
  const targetBlobs = await measure(path.join(dst, "blobs")).catch(() => ({ files: 0, bytes: 0 }));
  if (sourceBlobs.files !== targetBlobs.files || sourceBlobs.bytes !== targetBlobs.bytes)
    throw new Error("图片缓存复制不完整，请检查磁盘空间后重试");
  const total = await measure(dst);
  return { files: total.files, bytes: total.bytes, images: targetImages.files };
}

// 只能在本机弹窗；浏览器拿不到绝对路径。
export function pickFolder(initial) {
  if (process.platform !== "win32")
    return Promise.reject(new Error("当前系统不支持在设置里选择文件夹，请手动填写路径"));
  const escaped = String(initial || "").replace(/'/g, "''");
  const code = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.Description = '选择 Vellum 数据保存位置'",
    "$d.ShowNewFolderButton = $true",
    `if ('${escaped}') { $d.SelectedPath = '${escaped}' }`,
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  ].join("; ");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", code],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "",
      err = "",
      settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error("打开文件夹选择窗口超时"));
    }, 300000);
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", (e) => finish(reject, e));
    child.on("close", (n) =>
      n === 0
        ? finish(resolve, out.trim())
        : finish(
            reject,
            new Error(
              "无法打开文件夹选择窗口" + (err.trim() ? "：" + err.trim().slice(0, 200) : ""),
            ),
          ),
    );
  });
}
