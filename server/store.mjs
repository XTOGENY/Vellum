import {
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { historySearchText } from "../shared/history-index.mjs";

// 超过这个长度的 base64 字段不再写进 JSON，改存 blobs/<sha256>。
const BLOB_THRESHOLD = 64 * 1024;
const LAYOUT = "split";

// Only CurrentUser DPAPI encrypted credentials are persisted on Windows.
export function protectSecret(value, decrypt = false) {
  if (process.platform !== "win32")
    throw new Error("持久密钥存储当前需要 Windows DPAPI");
  const code = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", code],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("close", (n) =>
      n === 0
        ? resolve(
            decrypt
              ? Buffer.from(out.trim(), "base64").toString("utf8")
              : out.trim(),
          )
        : reject(new Error("无法访问 Windows 密钥存储")),
    );
    child.stdin.end(decrypt ? value : Buffer.from(value).toString("base64"));
  });
}

const isRef = (value) =>
  !!value && typeof value === "object" && typeof value.blob === "string";

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export class Store {
  constructor(root) {
    this.root = root;
    this.state = {
      version: 2,
      layout: LAYOUT,
      connections: [],
      draft: null,
      templates: [],
      collections: [],
      history: [],
      tasks: [],
      assistant: { conversations: [] },
    };
    this.pending = Promise.resolve();
    this.written = new Map();
  }
  get imagesDir() {
    return path.join(this.root, "images");
  }
  get vibeDir() {
    return path.join(this.root, "vibe-cache");
  }
  get blobsDir() {
    return path.join(this.root, "blobs");
  }
  get thumbsDir() {
    return path.join(this.root, "thumbs");
  }
  async init() {
    await mkdir(this.imagesDir, { recursive: true });
    await mkdir(this.blobsDir, { recursive: true });
    await mkdir(this.thumbsDir, { recursive: true });
    const manifest = await this.#readJson("state.json", null);
    if (manifest && manifest.version === 2) {
      await this.#loadSplit(manifest);
    } else if (manifest) {
      await this.#migrate(manifest, "state.json");
    } else if (await exists(path.join(this.root, "state.v1.json"))) {
      await this.#migrate(
        await this.#readJson("state.v1.json", {}),
        "state.v1.json",
      );
    } else {
      await this.#loadSplit({});
    }
    if (!this.state.assistant || !Array.isArray(this.state.assistant.conversations))
      this.state.assistant = { conversations: [] };
    if (!Array.isArray(this.state.collections)) this.state.collections = [];
    // 旧作品没有 searchText / collections：启动时补一次，之后保存直接带。
    let indexDirty = false;
    for (const item of this.state.history) {
      if (!item || typeof item !== "object") continue;
      if (!Array.isArray(item.collections)) {
        item.collections = [];
        indexDirty = true;
      }
      const text = historySearchText(
        item,
        this.state.collections,
        this.state.connections,
      );
      if (item.searchText !== text) {
        item.searchText = text;
        indexDirty = true;
      }
    }
    if (indexDirty) await this.save();
    // 旧数据没有用途字段：按图像连接对待。
    for (const c of this.state.connections) {
      if (!Array.isArray(c.uses) || !c.uses.length) c.uses = ["image"];
      // 只给图像连接补协议；文字对话的协议在 chat.protocol 里。
      if (c.uses.includes("image")) {
        if (typeof c.protocol !== "string") c.protocol = "novelai-native";
      } else if (c.chat && "protocol" in c) delete c.protocol;
      if (c.uses.includes("chat") && !c.chat)
        c.chat = {
          protocol: "openai-chat",
          model: "",
          streaming: true,
          includeContext: true,
          includePrompt: false,
          readRecentMetadata: false,
          sendImages: true,
        };
    }
    await this.#collectBlobs();
    return this;
  }
  async #readJson(name, fallback) {
    let text;
    try {
      text = await readFile(path.join(this.root, name), "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return fallback;
      throw e;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`数据文件损坏：${path.join(this.root, name)}`);
    }
  }
  async #writeJson(name, value) {
    const text = JSON.stringify(value);
    if (this.written.get(name) === text) return;
    const file = path.join(this.root, name),
      tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, text, { mode: 0o600 });
      await rename(tmp, file);
      this.written.set(name, text);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }
  async #loadSplit(manifest) {
    this.state.version = 2;
    this.state.layout = LAYOUT;
    this.state.connections = Array.isArray(manifest.connections)
      ? manifest.connections
      : [];
    this.state.templates = Array.isArray(manifest.templates)
      ? manifest.templates
      : [];
    this.state.collections = Array.isArray(manifest.collections)
      ? manifest.collections
      : [];
    this.state.assistant =
      manifest.assistant && typeof manifest.assistant === "object"
        ? manifest.assistant
        : { conversations: [] };
    const draft = await this.#readJson("draft.json", null);
    this.state.draft = draft && draft.draft ? draft.draft : null;
    if (this.state.draft) await this.hydrateParams(this.state.draft);
    const history = await this.#readJson("history.json", null);
    this.state.history =
      history && Array.isArray(history.history) ? history.history : [];
    const tasks = await this.#readJson("tasks.json", null);
    this.state.tasks = tasks && Array.isArray(tasks.tasks) ? tasks.tasks : [];
  }
  // 旧版单一 state.json：先备份，再把大字段搬进 blobs，最后才写新版清单。
  async #migrate(legacy, sourceName) {
    if (!legacy || typeof legacy !== "object")
      throw new Error("旧数据格式无法识别");
    console.log(`[store] 检测到旧版 ${sourceName}，正在拆分为 draft/history/tasks…`);
    if (sourceName === "state.json") await this.#backupLegacy();
    const draft = legacy.draft ?? null;
    const history = Array.isArray(legacy.history) ? legacy.history : [];
    const tasks = Array.isArray(legacy.tasks) ? legacy.tasks : [];
    const draftForDisk = draft ? structuredClone(draft) : null;
    if (draftForDisk) await this.externalizeParams(draftForDisk);
    for (const item of history)
      if (item && item.params) await this.externalizeParams(item.params);
    for (const task of tasks) {
      if (task && task.params) await this.externalizeParams(task.params);
      if (task && task.operation) await this.externalizeOperation(task.operation);
    }
    await this.#writeJson("draft.json", { draft: draftForDisk });
    await this.#writeJson("history.json", { history });
    await this.#writeJson("tasks.json", { tasks });
    this.state = {
      version: 2,
      layout: LAYOUT,
      connections: Array.isArray(legacy.connections) ? legacy.connections : [],
      draft,
      templates: Array.isArray(legacy.templates) ? legacy.templates : [],
      collections: Array.isArray(legacy.collections) ? legacy.collections : [],
      history,
      tasks,
      assistant:
        legacy.assistant && typeof legacy.assistant === "object"
          ? legacy.assistant
          : { conversations: [] },
    };
    await this.#saveManifest();
    console.log(
      `[store] 已把 ${sourceName} 拆分为 draft/history/tasks：` +
        `history ${history.length} 条，tasks ${tasks.length} 条`,
    );
  }
  async #backupLegacy() {
    const source = path.join(this.root, "state.json"),
      backup = path.join(this.root, "state.v1.json");
    if (await exists(backup)) return;
    try {
      await link(source, backup);
    } catch {
      await copyFile(source, backup);
    }
  }
  // 只清理没有任何记录引用的 blob；启动时执行，此时还没有写入进行中。
  async #collectBlobs() {
    const used = new Set();
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 8) return;
      if (typeof value.blob === "string") {
        used.add(value.blob);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      for (const item of Object.values(value)) visit(item, depth + 1);
    };
    visit(this.state.draft);
    for (const item of this.state.history) visit(item);
    for (const item of this.state.tasks) visit(item);
    let removed = 0;
    for (const name of await readdir(this.blobsDir)) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      if (used.has(name)) continue;
      await unlink(path.join(this.blobsDir, name)).catch(() => {});
      removed++;
    }
    if (removed) console.log(`[store] 清理 ${removed} 个未引用的图片缓存`);
  }
  async #storeString(value) {
    if (typeof value !== "string" || value.length < BLOB_THRESHOLD) return value;
    const wrapped = /^(data:[^,]*;base64,)([\s\S]*)$/.exec(value);
    const prefix = wrapped ? wrapped[1] : "",
      base64 = wrapped ? wrapped[2] : value;
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length) return value;
    const hash = createHash("sha256").update(bytes).digest("hex"),
      file = path.join(this.blobsDir, hash);
    if (!(await exists(file))) {
      const tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, bytes);
      try {
        await rename(tmp, file);
      } catch (e) {
        await unlink(tmp).catch(() => {});
        if (!(await exists(file))) throw e;
      }
    }
    return { blob: hash, bytes: bytes.length, ...(prefix ? { prefix } : {}) };
  }
  async #readBlob(ref) {
    const bytes = await readFile(path.join(this.blobsDir, ref.blob));
    return String(ref.prefix || "") + bytes.toString("base64");
  }
  async externalizeParams(params) {
    if (!params || typeof params !== "object") return params;
    if (params.baseImage && typeof params.baseImage.data === "string")
      params.baseImage.data = await this.#storeString(params.baseImage.data);
    if (typeof params.mask === "string")
      params.mask = await this.#storeString(params.mask);
    if (Array.isArray(params.references))
      for (const reference of params.references) {
        if (!reference || typeof reference !== "object") continue;
        if (typeof reference.data === "string")
          reference.data = await this.#storeString(reference.data);
        if (typeof reference.mask === "string")
          reference.mask = await this.#storeString(reference.mask);
      }
    // OpenAI 协议的多张参考图（跟在底图后面）。
    if (Array.isArray(params.gptRefs))
      for (const reference of params.gptRefs)
        if (reference && typeof reference.data === "string")
          reference.data = await this.#storeString(reference.data);
    return params;
  }
  async externalizeOperation(operation) {
    if (operation && typeof operation.image === "string")
      operation.image = await this.#storeString(operation.image);
    return operation;
  }
  async hydrateParams(params) {
    if (!params || typeof params !== "object") return params;
    if (params.baseImage && isRef(params.baseImage.data))
      params.baseImage.data = await this.#readBlob(params.baseImage.data);
    if (isRef(params.mask)) params.mask = await this.#readBlob(params.mask);
    if (Array.isArray(params.references))
      for (const reference of params.references) {
        if (!reference || typeof reference !== "object") continue;
        if (isRef(reference.data))
          reference.data = await this.#readBlob(reference.data);
        if (isRef(reference.mask))
          reference.mask = await this.#readBlob(reference.mask);
      }
    if (Array.isArray(params.gptRefs))
      for (const reference of params.gptRefs)
        if (reference && isRef(reference.data))
          reference.data = await this.#readBlob(reference.data);
    return params;
  }
  async hydrateOperation(operation) {
    if (operation && isRef(operation.image))
      operation.image = await this.#readBlob(operation.image);
    return operation;
  }
  async hydrateTask(task) {
    if (!task) return task;
    await this.hydrateParams(task.params);
    await this.hydrateOperation(task.operation);
    return task;
  }
  save() {
    const job = this.pending
      .catch(() => {})
      .then(() => this.#writeAll());
    this.pending = job;
    return job;
  }
  async #writeAll() {
    // 先写数据分片，最后写清单：中途崩溃时 state.json 仍是上一版，
    // 不会出现"清单说已拆分、分片却缺一半"的状态。
    await this.#saveDraft();
    await this.#saveHistory();
    await this.#saveTasks();
    await this.#saveManifest();
  }
  async #saveManifest() {
    await this.#writeJson("state.json", {
      version: 2,
      layout: LAYOUT,
      connections: this.state.connections,
      templates: this.state.templates,
      collections: this.state.collections,
      assistant: this.state.assistant,
    });
  }
  async #saveDraft() {
    // 内存里的草稿保留 base64，磁盘上只存 blob 引用。
    const draft = this.state.draft ? structuredClone(this.state.draft) : null;
    if (draft) await this.externalizeParams(draft);
    await this.#writeJson("draft.json", { draft });
  }
  async #saveHistory() {
    for (const item of this.state.history)
      if (item && item.params) await this.externalizeParams(item.params);
    await this.#writeJson("history.json", { history: this.state.history });
  }
  async #saveTasks() {
    // 正在跑的任务还要用 base64，等结束（或下次启动标记中断）后再抽离。
    for (const task of this.state.tasks) {
      if (!task || task.status === "running") continue;
      if (task.params) await this.externalizeParams(task.params);
      if (task.operation) await this.externalizeOperation(task.operation);
    }
    await this.#writeJson("tasks.json", { tasks: this.state.tasks });
  }
  connections() {
    return this.state.connections.map(({ secret, ...rest }) => ({
      ...rest,
      hasKey: !!secret,
    }));
  }
  async connection(id) {
    const c = this.state.connections.find((c) => c.id === id);
    if (!c) throw new Error("请先配置并选择连接");
    return { ...c, token: await protectSecret(c.secret, true) };
  }
}
