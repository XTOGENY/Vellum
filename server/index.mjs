import express from "express";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { zipSync } from "fflate";
import { mkdir, writeFile, readFile, rename, stat, unlink } from "node:fs/promises";
import { Store, protectSecret } from "./store.mjs";
import { mountArtists } from "./artists.mjs";
import {
  configPath,
  copyStorage,
  pickFolder,
  readConfig,
  resolveDataDir,
  saveConfig,
  validateDataDir,
} from "./storage.mjs";
import { Provider, validateEndpoint } from "./provider.mjs";
import { OpenAIImageProvider } from "./openai-image.mjs";
import { imageAdapter } from "./foreign-image.mjs";
import { ChatProvider, CHAT_PROTOCOLS, chatProtocol } from "./chat-provider.mjs";
import { systemPrompt } from "../shared/assistant-prompt.mjs";
import { historySearchText } from "../shared/history-index.mjs";
import {
  IMAGE_PROTOCOLS,
  imageProtocol,
  protocolOfConnection,
  assertImageProtocol,
} from "../shared/image-protocols.mjs";
import {
  isOpenAIImageModel,
  foreignImageModel,
} from "../shared/image-models.mjs";
import { TaskQueue } from "./queue.mjs";
import {
  readMetadata,
  normalizeImage,
  picture,
  imageBytes,
} from "./images.mjs";
import { defaults, modelById } from "../shared/novelai.mjs";
import { restoreMetadata } from "../shared/metadata.mjs";
import { imageActionParams } from "./image-actions.mjs";
import { subscriptionReader } from "./subscriptions.mjs";
import {
  generationQuote,
  upscaleCost,
  directorCost,
} from "../shared/generation-cost.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function createApp({
  dataDir,
  root = ROOT,
  provider = new Provider(),
  chat = new ChatProvider(),
  openai = new OpenAIImageProvider(),
} = {}) {
  const activeDir = dataDir || (await resolveDataDir(root));
  let store;
  try {
    store = await new Store(activeDir).init();
  } catch (e) {
    throw new Error(
      `无法打开数据保存位置 ${activeDir}：${e.message}（可在 ${configPath(root)} 中修改）`,
    );
  }
  // 出图按连接的协议分发：OpenAI Images 自己一套，其余仍走 NovelAI。
  const queue = new TaskQueue(store, {
      subscription: (...a) => provider.subscription(...a),
      tags: (...a) => provider.tags(...a),
      encode: (...a) => provider.encode(...a),
      upscale: (...a) => provider.upscale(...a),
      augment: (...a) => provider.augment(...a),
      images: (c, body, options) => {
        const id = protocolOfConnection(c).id;
        if (id === "novelai-native") return provider.images(c, body, options);
        if (id === "openai-images") return openai.images(c, body, options);
        return imageAdapter(id).images(c, body, options);
      },
    });
  await queue.recover();
  await mkdir(store.vibeDir, { recursive: true });
  const app = express();
  const subscriptions = subscriptionReader(store, provider);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const hostname = req.hostname;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname))
      return res.status(403).json({ error: "仅允许本机访问" });
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    if (req.path.startsWith("/api")) {
      res.set("Cache-Control", "no-store");
      const origin = req.get("origin");
      if (
        origin &&
        origin !== `http://${req.get("host")}` &&
        origin !== "http://127.0.0.1:8781" &&
        origin !== "http://localhost:8781"
      )
        return res.status(403).json({ error: "请求来源不受信任" });
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.get("x-nwenai-request") !== "1"
      )
        return res.status(403).json({ error: "请求校验失败" });
    }
    next();
  });
  app.use(express.json({ limit: "100mb" }));
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);
  await mountArtists(app, { root, dataDir: store.root, wrap });
  app.get(
    "/api/bootstrap",
    wrap(async (req, res) =>
      res.json({
        connections: store.connections(),
        draft: store.state.draft || defaults(),
        templates: store.state.templates,
        collections: collectionSummary(),
        history: store.state.history.map(({ params, ...h }) => h),
        tasks: queue.publicTasks(),
        dataDir: store.root,
      }),
    ),
  );
  function collectionSummary() {
    return store.state.collections.map((collection) => ({
      ...collection,
      count: store.state.history.filter((h) =>
        (h.collections || []).includes(collection.id),
      ).length,
    }));
  }
  app.get(
    "/api/collections",
    wrap(async (req, res) => res.json({ collections: collectionSummary() })),
  );
  app.post(
    "/api/collections",
    wrap(async (req, res) => {
      const name = String(req.body.name || "").trim();
      if (!name || name.length > 40) throw new Error("集合名称需要 1–40 个字符");
      if (
        store.state.collections.some(
          (c) => c.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw new Error("已经有同名集合");
      const collection = {
        id: randomUUID(),
        name,
        createdAt: new Date().toISOString(),
      };
      store.state.collections.push(collection);
      await store.save();
      res.json({ collections: collectionSummary(), collection });
    }),
  );
  app.post(
    "/api/collections/:id",
    wrap(async (req, res) => {
      const collection = store.state.collections.find(
        (c) => c.id === req.params.id,
      );
      if (!collection) return res.status(404).json({ error: "集合不存在" });
      const name = String(req.body.name || "").trim();
      if (!name || name.length > 40) throw new Error("集合名称需要 1–40 个字符");
      if (
        store.state.collections.some(
          (c) => c.id !== collection.id && c.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw new Error("已经有同名集合");
      collection.name = name;
      for (const h of store.state.history)
        if ((h.collections || []).includes(collection.id))
          h.searchText = historySearchText(
            h,
            store.state.collections,
            store.state.connections,
          );
      await store.save();
      res.json({
        collections: collectionSummary(),
        history: store.state.history.map(({ params, ...h }) => h),
      });
    }),
  );
  app.delete(
    "/api/collections/:id",
    wrap(async (req, res) => {
      const id = req.params.id;
      if (!store.state.collections.some((c) => c.id === id))
        return res.status(404).json({ error: "集合不存在" });
      store.state.collections = store.state.collections.filter(
        (c) => c.id !== id,
      );
      for (const h of store.state.history) {
        if (!(h.collections || []).includes(id)) continue;
        h.collections = h.collections.filter((value) => value !== id);
        h.searchText = historySearchText(
          h,
          store.state.collections,
          store.state.connections,
        );
      }
      await store.save();
      res.json({
        collections: collectionSummary(),
        history: store.state.history.map(({ params, ...h }) => h),
      });
    }),
  );
  app.get(
    "/api/settings/storage",
    wrap(async (req, res) => {
      const next = await resolveDataDir(root).catch(() => store.root);
      const config = await readConfig(root).catch(() => ({}));
      res.json({
        activeDir: store.root,
        nextDir: next,
        defaultDir: path.join(root, "data"),
        legacyDir: path.join(root, ".local"),
        configFile: configPath(root),
        custom: typeof config.dataDir === "string" && !!config.dataDir.trim(),
        restartRequired: path.resolve(next) !== path.resolve(store.root),
      });
    }),
  );
  app.post(
    "/api/settings/storage",
    wrap(async (req, res) => {
      const mode = req.body.mode === "copy" ? "copy" : "switch";
      const target = await validateDataDir(req.body.dataDir);
      if (path.resolve(target) === path.resolve(store.root)) {
        await saveConfig(root, { version: 1, dataDir: target });
        return res.json({
          dataDir: target,
          activeDir: store.root,
          restartRequired: false,
          copied: null,
        });
      }
      if (
        store.state.tasks.some((t) =>
          ["queued", "running"].includes(t.status),
        )
      )
        throw new Error("还有任务在排队或运行，请先等待完成或取消");
      let copyWarning = null;
      if (mode === "copy") {
        // 先把内存里的状态刷到磁盘；失败也继续复制最后一次成功保存的文件。
        try {
          await store.save();
        } catch (e) {
          copyWarning = String(e.message || e);
        }
      }
      const copied =
        mode === "copy" ? await copyStorage(store.root, target) : null;
      await saveConfig(root, { version: 1, dataDir: target });
      res.json({
        dataDir: target,
        activeDir: store.root,
        restartRequired: true,
        copied,
        copyWarning,
      });
    }),
  );
  app.post(
    "/api/settings/storage/pick",
    wrap(async (req, res) => {
      res.json({ path: await pickFolder(store.root) });
    }),
  );
  app.put(
    "/api/draft",
    wrap(async (req, res) => {
      const p = req.body.params;
      if (!p || typeof p !== "object") throw new Error("草稿格式错误");
      // 中转站可以给模型起任意名字：这条连接只要是 OpenAI 协议就放过。
      const draftConnection = p.connectionId
        ? store.state.connections.find((c) => c.id === p.connectionId)
        : null;
      // 只要不是 NovelAI 协议，模型名就交给对应适配器自己认；只有 NovelAI 才查注册表。
      if (
        protocolOfConnection(draftConnection || {}).id === "novelai-native" &&
        !isOpenAIImageModel(p.model) &&
        !foreignImageModel(p.model)
      )
        modelById(p.model);
      store.state.draft = p;
      await store.save();
      res.json({ saved: true });
    }),
  );
  app.post(
    "/api/connections",
    wrap(async (req, res) => {
      const { id, name, baseUrl, token, concurrency, streaming, protocol } =
        req.body;
      if (typeof name !== "string" || !name.trim() || name.length > 80)
        throw new Error("请填写连接名称");
      const spec = imageProtocol(protocol || "novelai-native");
      const endpoint = validateEndpoint(baseUrl),
        official = new URL(endpoint).hostname === "image.novelai.net";
      const old = id ? store.state.connections.find((c) => c.id === id) : null;
      if (id && !old) throw new Error("连接不存在");
      if (old && [...queue.running.values()].some((t) => t.connectionId === id))
        throw new Error("连接正在运行任务，请稍后修改");
      if (
        token !== undefined &&
        (typeof token !== "string" ||
          token.length < 10 ||
          token.length > 4096 ||
          /[\r\n]/.test(token))
      )
        throw new Error("密钥格式无效");
      const secret = token
        ? await protectSecret(token.trim().replace(/^Bearer\s+/i, ""))
        : old?.secret;
      if (!secret) throw new Error("请填写 Persistent API Token");
      const c = {
        id: old?.id || randomUUID(),
        name: name.trim(),
        baseUrl: endpoint,
        secret,
        official,
        concurrency: official
          ? 1
          : Math.max(1, Math.min(4, Number(concurrency) || 1)),
        streaming: !!streaming,
        // 图像与文字各自独立：这里只登记图像生成这一种用途。
        uses: ["image"],
        protocol: spec.id,
      };
      if (old)
        store.state.connections[store.state.connections.indexOf(old)] = c;
      else store.state.connections.push(c);
      subscriptions.invalidate(c.id);
      await store.save();
      res.json(store.connections());
    }),
  );
  app.delete(
    "/api/connections/:id",
    wrap(async (req, res) => {
      if (
        store.state.tasks.some(
          (t) =>
            t.connectionId === req.params.id &&
            ["queued", "running"].includes(t.status),
        )
      )
        throw new Error("请先取消该连接的未完成任务");
      store.state.connections = store.state.connections.filter(
        (c) => c.id !== req.params.id,
      );
      subscriptions.invalidate(req.params.id);
      await store.save();
      res.json(store.connections());
    }),
  );
  // 读图像连接的模型清单：能读就读，读不到让客户端用内置清单。
  app.get(
    "/api/connections/:id/models",
    wrap(async (req, res) => {
      const connection = await store.connection(req.params.id);
      const spec = protocolOfConnection(connection);
      if (spec.id === "novelai-native")
        return res.json({
          models: [],
          note: "NovelAI 没有模型列表接口，生成时用内置清单",
          connections: store.connections(),
        });
      const models =
        spec.id === "openai-images"
          ? await openai.models(connection)
          : await imageAdapter(spec.id).models(connection);
      const target = store.state.connections.find((c) => c.id === connection.id);
      if (target) {
        target.models = models;
        await store.save();
      }
      res.json({ models, connections: store.connections() });
    }),
  );
  app.post(
    "/api/connections/:id/test",
    wrap(async (req, res) => {
      const connection = await store.connection(req.params.id);
      const spec = protocolOfConnection(connection);
      if (!spec.implemented)
        throw new Error(
          `${spec.label} 的验证适配器还没接入；连接可以保存，出图前会明确提示`,
        );
      // OpenAI 协议没有 /user/subscription 这种东西：查订阅只会误报。
      // 这里用它自己的 /v1/models 验证地址与密钥，顺带把模型数报出来。
      if (spec.id !== "novelai-native") {
        const models =
          spec.id === "openai-images"
            ? await openai.models(connection)
            : await imageAdapter(spec.id).models(connection);
        if (!models.length && spec.id !== "openai-images")
          return res.json({
            ok: true,
            message: `${spec.label} 没有免费的验证接口，请直接生成一张图确认`,
          });
        return res.json({
          ok: true,
          message:
            models.length > 0
              ? `连接可用，读到 ${models.length} 个图像模型：${models.slice(0, 3).join("、")}${models.length > 3 ? " …" : ""}`
              : "连接可用，但服务端没有列出图像模型（可能不支持 /v1/models）",
        });
      }
      const subscription = await queue.exclusive(req.params.id, async () =>
        provider.subscription(connection),
      );
      res.json({ ok: true, subscription });
    }),
  );
  app.get(
    "/api/connections/:id/subscription",
    wrap(async (req, res) => {
      const subscription = await subscriptions.read(
        req.params.id,
        req.query.refresh === "1",
      );
      res.json({ subscription, fetchedAt: Date.now() });
    }),
  );
  // 助手连接：文字对话用的一套地址与密钥。与图像连接共用 state.connections，
  // 用 uses 区分用途，各自编辑自己那一侧的字段。
  app.post(
    "/api/assistant-connections",
    wrap(async (req, res) => {
      const {
        id,
        name,
        baseUrl,
        token,
        protocol,
        model,
        streaming,
        includeContext,
        includePrompt,
        readRecentMetadata,
        sendImages,
      } = req.body;
      if (typeof name !== "string" || !name.trim() || name.length > 80)
        throw new Error("请填写连接名称");
      const spec = chatProtocol(protocol);
      const endpoint = validateEndpoint(baseUrl);
      const old = id ? store.state.connections.find((c) => c.id === id) : null;
      if (id && !old) throw new Error("连接不存在");
      // 本机网关常常接受任意占位密钥，这里不设长度下限，只挡空值与换行。
      if (
        token !== undefined &&
        token !== "" &&
        (typeof token !== "string" ||
          !token.trim() ||
          token.length > 4096 ||
          /[\r\n]/.test(token))
      )
        throw new Error("密钥格式无效");
      const secret = token
        ? await protectSecret(token.trim().replace(/^Bearer\s+/i, ""))
        : old?.secret;
      if (!secret) throw new Error("请填写 API 密钥");
      const next = {
        id: old?.id || randomUUID(),
        name: name.trim(),
        baseUrl: endpoint,
        secret,
        official: new URL(endpoint).hostname === "image.novelai.net",
        // 图像侧字段在只做对话时用不到，保留原值以便随时切回。
        concurrency: old?.concurrency || 1,
        streaming: old?.streaming ?? false,
        // 图像与文字各自独立：这里只登记文字对话这一种用途。
        uses: ["chat"],
        chat: {
          protocol: spec.id,
          model:
            typeof model === "string" ? model.trim().slice(0, 200) : "",
          streaming: streaming !== false,
          includeContext: includeContext !== false,
          includePrompt: !!includePrompt,
          readRecentMetadata: !!readRecentMetadata,
          // 默认开启：模型不支持看图时，用户在设置里关掉即可。
          sendImages: sendImages !== false,
        },
      };
      if (old)
        store.state.connections[store.state.connections.indexOf(old)] = next;
      else store.state.connections.push(next);
      subscriptions.invalidate(next.id);
      await store.save();
      res.json(store.connections());
    }),
  );
  app.delete(
    "/api/assistant-connections/:id",
    wrap(async (req, res) => {
      if (!store.state.connections.some((c) => c.id === req.params.id))
        throw new Error("连接不存在");
      store.state.connections = store.state.connections.filter(
        (c) => c.id !== req.params.id,
      );
      subscriptions.invalidate(req.params.id);
      await store.save();
      res.json(store.connections());
    }),
  );
  app.get(
    "/api/assistant-connections/:id/models",
    wrap(async (req, res) => {
      res.json({
        models: await chat.models(await store.connection(req.params.id)),
      });
    }),
  );
  app.post(
    "/api/assistant-connections/:id/test",
    wrap(async (req, res) => {
      const connection = await store.connection(req.params.id);
      const models = await chat.models(connection);
      res.json({
        ok: true,
        protocol: chatProtocol(connection.chat?.protocol).label,
        models,
      });
    }),
  );
  // 创作助手：会话存在本机，对话内容由用户点击发送后才上行。
  const MAX_CONVERSATIONS = 50,
    MAX_MESSAGES = 200,
    MAX_CONTENT = 20000;
  function cleanConversation(raw) {
    if (!raw || typeof raw !== "object") throw new Error("会话格式错误");
    const messages = Array.isArray(raw.messages)
      ? raw.messages.slice(-MAX_MESSAGES)
      : [];
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
      title: String(raw.title || "新会话").slice(0, 120),
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // 模型跟着会话走：换模型不改动连接里的默认值。
      ...(raw.model ? { model: String(raw.model).slice(0, 200) } : {}),
      messages: messages.map((m) => ({
        id: typeof m.id === "string" && m.id ? m.id : randomUUID(),
        role: m.role === "user" ? "user" : "assistant",
        content: String(m.content || "").slice(0, MAX_CONTENT),
        createdAt: m.createdAt || new Date().toISOString(),
        ...(m.attachment ? { attachment: m.attachment } : {}),
      })),
    };
  }
  app.get(
    "/api/assistant/conversations",
    wrap(async (req, res) =>
      res.json({ conversations: store.state.assistant.conversations }),
    ),
  );
  app.put(
    "/api/assistant/conversations",
    wrap(async (req, res) => {
      const next = cleanConversation(req.body.conversation);
      const list = store.state.assistant.conversations;
      const at = list.findIndex((c) => c.id === next.id);
      if (at >= 0) list[at] = next;
      else list.unshift(next);
      if (list.length > MAX_CONVERSATIONS)
        store.state.assistant.conversations = list.slice(0, MAX_CONVERSATIONS);
      await store.save();
      res.json({ conversation: next });
    }),
  );
  app.delete(
    "/api/assistant/conversations/:id",
    wrap(async (req, res) => {
      store.state.assistant.conversations =
        store.state.assistant.conversations.filter(
          (c) => c.id !== req.params.id,
        );
      await store.save();
      res.json({ conversations: store.state.assistant.conversations });
    }),
  );
  app.post(
    "/api/assistant/chat",
    wrap(async (req, res) => {
      const {
        connectionId,
        messages,
        context,
        temperature,
        model: requested,
        attachmentId,
        attachmentData,
        attachments,
      } = req.body;
      if (!Array.isArray(messages) || !messages.length)
        throw new Error("没有可发送的内容");
      const connection = await store.connection(connectionId);
      const settings = connection.chat || {};
      // 面板里选的模型优先，没选就用连接里的默认模型；都没有就报错，不猜。
      const model = String(requested || settings.model || "").trim();
      if (!model) throw new Error("请先选择模型");
      // 看图：读当前讨论的那张图。太大时压到 1024 以内再发，避免请求失控。
      // 附件可以有多张：工作台里的图按 id 读盘，面板里上传的带 base64。
      const images = [];
      if (settings.sendImages !== false) {
        const list = Array.isArray(attachments)
          ? attachments.slice(0, 6)
          : [
              attachmentData
                ? { data: attachmentData }
                : attachmentId
                  ? { id: attachmentId }
                  : null,
            ].filter(Boolean);
        for (const item of list) {
          let source = null;
          if (
            typeof item?.data === "string" &&
            item.data.length > 0 &&
            item.data.length < 20 * 1024 * 1024
          ) {
            const base64 = item.data.startsWith("data:")
              ? item.data.slice(item.data.indexOf(",") + 1)
              : item.data;
            try {
              source = Buffer.from(base64, "base64");
            } catch {
              source = null;
            }
          } else if (
            typeof item?.id === "string" &&
            /^[a-f0-9-]{36}$/.test(item.id)
          ) {
            try {
              source = await readFile(
                path.join(store.imagesDir, item.id + ".png"),
              );
            } catch {
              source = null;
            }
          }
          if (!source) continue;
          // 太大的压到 1024 以内再发，避免请求失控。
          images.push(
            source.length > 1500000
              ? {
                  mediaType: "image/jpeg",
                  data: await sharp(source)
                    .resize(1024, 1024, {
                      fit: "inside",
                      withoutEnlargement: true,
                    })
                    .jpeg({ quality: 85 })
                    .toBuffer(),
                }
              : { mediaType: "image/png", data: source },
          );
        }
      }
      const baseSystem = systemPrompt(
        settings.includeContext === false ? {} : context || {},
        {
          includePrompt: !!settings.includePrompt,
          readRecentMetadata: !!settings.readRecentMetadata,
        },
      );
      // 用户在「通用」里写的默认提示词接在系统规则后面，留空则不加。
      const extra = String(settings.systemPrompt || "").trim();
      const system = extra ? baseSystem + "\n\n" + extra : baseSystem;
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();
      const abort = new AbortController();
      req.on("close", () => abort.abort());
      const send = (payload) =>
        res.write("data: " + JSON.stringify(payload) + "\n\n");
      try {
        for await (const delta of chat.stream(connection, {
          model,
          images,
          system,
          temperature: Number(temperature) || 0.7,
          signal: abort.signal,
          messages: messages.map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: String(m.content || "").slice(0, MAX_CONTENT),
          })),
        }))
          send({ delta });
        send({ done: true });
      } catch (e) {
        if (!abort.signal.aborted)
          send({ error: String(e?.message || e).slice(0, 500) });
      }
      res.end();
    }),
  );
  app.get("/api/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    const send = (tasks) =>
      res.write("data: " + JSON.stringify(tasks) + "\n\n");
    queue.listeners.add(send);
    send(queue.publicTasks());
    const timer = setInterval(() => res.write(": alive\n\n"), 20000);
    req.on("close", () => {
      clearInterval(timer);
      queue.listeners.delete(send);
    });
  });
  // Read-only estimate: uses the same prepared image parameters as submission.
  app.post(
    "/api/image-actions/quote",
    wrap(async (req, res) => {
      const { kind, connectionId, width, height, tool } = req.body;
      if (!["enhance", "variation", "director", "upscale"].includes(kind))
        throw Error("未知的图像动作");
      const connection = store.state.connections.find(
        (c) => c.id === connectionId,
      );
      if (!connection) throw Error("请先选择连接");
      const unknown = (reason) => ({ kind: "unknown", anlas: null, reason });
      if (!protocolOfConnection(connection).implemented)
        return res.json(unknown("该协议的生图适配器尚未接入"));
      if (!connection.official)
        return res.json(unknown("中转费用以服务商为准"));
      let sub = null;
      if (kind !== "upscale") {
        try {
          sub = await subscriptions.read(connectionId);
        } catch {
          return res.json(unknown("暂无法读取套餐，费用待估算"));
        }
      }
      if (kind === "enhance" || kind === "variation") {
        const params = await imageActionParams(store, req.body);
        return res.json(generationQuote(params, sub, true));
      }
      if (
        ![width, height].every((v) => Number.isFinite(v) && v > 0 && v <= 32768)
      )
        throw Error("无效的输入尺寸");
      if (
        kind === "director" &&
        ![
          "bg-removal",
          "lineart",
          "sketch",
          "colorize",
          "emotion",
          "declutter",
        ].includes(tool)
      )
        throw Error("无效的导演工具");
      const anlas =
        kind === "upscale"
          ? upscaleCost(width, height)
          : directorCost(tool, width, height, sub);
      res.json(
        anlas === null
          ? unknown("当前尺寸的费用暂无法估算")
          : {
              kind: anlas ? "anlas" : "free",
              anlas,
              reason: "按原项目工具计价规则估算，最终以服务端扣费为准",
            },
      );
    }),
  );
  app.post(
    "/api/image-actions",
    wrap(async (req, res) => {
      assertImageProtocol(
        await store.connection(req.body.connectionId),
        "image.augment",
      );
      const params = await imageActionParams(store, req.body);
      res.status(202).json({
        id: await queue.enqueue({
          connectionId: req.body.connectionId,
          kind: "generate",
          params,
        }),
      });
    }),
  );
  app.post(
    "/api/tasks",
    wrap(async (req, res) => {
      // 提交时就挡：协议没接适配器不要先建任务再失败。
      if (req.body?.connectionId)
        assertImageProtocol(
          await store.connection(req.body.connectionId),
          req.body.kind === "generate" ? "image.generate" : "image.augment",
        );
      res.status(202).json({ id: await queue.enqueue(req.body) });
    }),
  );
  app.post(
    "/api/tasks/:id/cancel",
    wrap(async (req, res) => {
      await queue.cancel(req.params.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/tasks/:id/retry",
    wrap(async (req, res) => {
      const t = store.state.tasks.find((t) => t.id === req.params.id);
      if (!t || ["queued", "running"].includes(t.status))
        throw new Error("此任务不能重试");
      if (t.completed >= t.total)
        throw new Error("此任务的结果已经全部保存，无需重试");
      const params = await store.hydrateParams(
          structuredClone(t.params || {}),
        ),
        operation = await store.hydrateOperation(
          structuredClone(t.operation || {}),
        );
      res.json({
        id: await queue.enqueue({
          connectionId: t.connectionId,
          params: {
            ...params,
            seed:
              params.seed === null
                ? null
                : (params.seed + t.completed) >>> 0,
            total: t.total - t.completed,
          },
          kind: t.kind,
          operation,
        }),
      });
    }),
  );
  app.get(
    "/api/history",
    wrap(async (req, res) =>
      res.json(store.state.history.map(({ params, ...h }) => h)),
    ),
  );
  app.get(
    "/api/history/:id",
    wrap(async (req, res) => {
      const h = store.state.history.find((h) => h.id === req.params.id);
      if (!h) return res.status(404).json({ error: "记录不存在" });
      res.json({
        ...h,
        ...(h.params
          ? { params: await store.hydrateParams(structuredClone(h.params)) }
          : {}),
      });
    }),
  );
  const selectedHistory = (ids) => {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      ids.some((id) => typeof id !== "string")
    )
      throw Error("每次请选择 1–200 张作品");
    const unique = [...new Set(ids)],
      items = unique.map((id) => store.state.history.find((h) => h.id === id));
    if (items.some((h) => !h)) throw Error("所选作品不存在");
    return items;
  };
  app.post(
    "/api/history/batch",
    wrap(async (req, res) => {
      const items = selectedHistory(req.body.ids),
        { action, name, collectionId } = req.body;
      if (
        ![
          "archive",
          "restore",
          "favorite",
          "unfavorite",
          "rename",
          "delete",
          "collect",
          "uncollect",
        ].includes(action)
      )
        throw Error("未知整理操作");
      if (
        action === "rename" &&
        (typeof name !== "string" || name.length > 100)
      )
        throw Error("作品名称不能超过 100 字");
      if (action === "delete") {
        // 连本地文件一起删，避免留下孤儿 png / 缩略图。
        for (const h of items) {
          if (/^[a-f0-9-]{36}\.png$/.test(h.filename))
            await unlink(path.join(store.imagesDir, h.filename)).catch(
              () => {},
            );
          await unlink(path.join(store.thumbsDir, h.id + ".webp")).catch(
            () => {},
          );
        }
        const gone = new Set(items.map((h) => h.id));
        store.state.history = store.state.history.filter(
          (h) => !gone.has(h.id),
        );
        await store.save();
        return res.json(store.state.history.map(({ params, ...h }) => h));
      }
      const collection =
        action === "collect" || action === "uncollect"
          ? store.state.collections.find((c) => c.id === collectionId)
          : null;
      if (
        (action === "collect" || action === "uncollect") &&
        !collection
      )
        throw Error("集合不存在");
      for (const h of items) {
        if (action === "archive") h.archivedAt = new Date().toISOString();
        if (action === "restore") delete h.archivedAt;
        if (action === "favorite") h.favorite = true;
        if (action === "unfavorite") h.favorite = false;
        if (action === "rename") h.name = name.trim();
        if (action === "collect" || action === "uncollect") {
          const ids = new Set(h.collections || []);
          action === "collect"
            ? ids.add(collection.id)
            : ids.delete(collection.id);
          h.collections = [...ids];
        }
        if (
          action === "rename" ||
          action === "collect" ||
          action === "uncollect"
        )
          h.searchText = historySearchText(
            h,
            store.state.collections,
            store.state.connections,
          );
      }
      await store.save();
      res.json(store.state.history.map(({ params, ...h }) => h));
    }),
  );
  app.post(
    "/api/history/export",
    wrap(async (req, res) => {
      const items = selectedHistory(req.body.ids),
        files = {};
      let size = 0;
      for (const h of items) {
        if (!/^[a-f0-9-]{36}\.png$/.test(h.filename))
          throw Error("图片路径无效");
        const data = await readFile(path.join(store.imagesDir, h.filename));
        size += data.length;
        if (size > 256 * 1024 * 1024)
          throw Error("本次下载超过 256 MB，请分批下载");
        files[h.id + ".png"] = new Uint8Array(data);
      }
      res.set("Content-Type", "application/zip");
      res.set(
        "Content-Disposition",
        'attachment; filename="Vellum-images.zip"',
      );
      res.send(Buffer.from(zipSync(files, { level: 0 })));
    }),
  );
  app.post(
    "/api/templates",
    wrap(async (req, res) => {
      const { id, name, prompt, negative, category, favorite } = req.body;
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 100 ||
        typeof prompt !== "string" ||
        prompt.length > 50000 ||
        typeof negative !== "string" ||
        negative.length > 50000
      )
        throw new Error("模板格式无效");
      if (
        category !== undefined &&
        !["artist", "character", "scene", "negative", "general"].includes(
          category,
        )
      )
        throw new Error("模板分类无效");
      if (favorite !== undefined && typeof favorite !== "boolean")
        throw new Error("模板收藏状态无效");
      const old = store.state.templates.find((t) => t.id === id);
      const t = {
        id: old?.id || randomUUID(),
        name: name.trim(),
        prompt,
        negative,
        category: category ?? old?.category ?? "general",
        favorite: favorite ?? old?.favorite ?? false,
        // 模板是否带负面提示词；不传就沿用旧值，旧模板默认 true。
        includeNegative:
          typeof req.body.includeNegative === "boolean"
            ? req.body.includeNegative
            : (old?.includeNegative ?? true),
        updatedAt: new Date().toISOString(),
      };
      if (old) store.state.templates[store.state.templates.indexOf(old)] = t;
      else store.state.templates.unshift(t);
      await store.save();
      res.json(store.state.templates);
    }),
  );
  app.delete(
    "/api/templates/:id",
    wrap(async (req, res) => {
      store.state.templates = store.state.templates.filter(
        (t) => t.id !== req.params.id,
      );
      await store.save();
      res.json(store.state.templates);
    }),
  );
  app.post(
    "/api/image/import",
    wrap(async (req, res) => {
      let normalized, info;
      try {
        normalized = await normalizeImage(req.body.data);
        info = await readMetadata(req.body.data);
      } catch {
        throw new Error("图片读取失败，请使用完整的 PNG、JPEG 或 WebP 文件。");
      }
      const result = restoreMetadata(info);
      res.json({
        image: {
          ...normalized,
          name: String(req.body.name || "导入图片").slice(0, 250),
        },
        metadata: result,
        ...(req.body.includeRaw === true ? { raw: info.fields } : {}),
        file: { format: info.format, bytes: info.bytes },
      });
    }),
  );
  app.post(
    "/api/vibe/encode",
    wrap(async (req, res) => {
      const { connectionId, model, image, information_extracted, mask } =
        req.body;
      assertImageProtocol(
        await store.connection(connectionId),
        "image.condition",
      );
      const m = modelById(model);
      if (!m.vibe || m.family === "v3")
        throw new Error("此模型不需要或不支持 Vibe 编码");
      if (
        typeof information_extracted !== "number" ||
        information_extracted < 0 ||
        information_extracted > 1
      )
        throw new Error("信息提取值无效");
      const data = (await normalizeImage(image)).data;
      const body = {
        model,
        image: data,
        information_extracted,
        ...(mask ? { mask: (await normalizeImage(mask)).data } : {}),
      };
      const hash = createHash("sha256")
          .update(JSON.stringify(body))
          .digest("hex"),
        file = path.join(store.vibeDir, hash + ".txt");
      let encoding;
      try {
        encoding = await readFile(file, "utf8");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        encoding = await queue.exclusive(connectionId, async () =>
          provider.encode(await store.connection(connectionId), body),
        );
        await writeFile(file, encoding);
      }
      res.json({ encoding, model, information_extracted });
    }),
  );
  app.get(
    "/api/tags",
    wrap(async (req, res) => {
      const prompt = String(req.query.prompt || "").slice(0, 200),
        model = String(req.query.model);
      modelById(model);
      assertImageProtocol(
        await store.connection(String(req.query.connectionId)),
        "image.tags",
      );
      // Read-only autocomplete must not contend with image generation or explicit tag lookup.
      res.json(
        await provider.tags(
          await store.connection(String(req.query.connectionId)),
          model,
          prompt,
        ),
      );
    }),
  );
  // 网格缩略图：首次请求时从原图生成并落盘，之后直接读缓存。
  const thumbJobs = new Map();
  app.get(
    "/media/thumbs/:name",
    wrap(async (req, res) => {
      const match = /^([a-f0-9-]{36})\.webp$/.exec(req.params.name);
      if (!match) return res.status(404).end();
      const id = match[1],
        file = path.join(store.thumbsDir, req.params.name);
      let job = thumbJobs.get(req.params.name);
      if (!job) {
        job = (async () => {
          try {
            await stat(file);
            return;
          } catch {}
          const source = path.join(store.imagesDir, id + ".png");
          const data = await sharp(source)
            .resize({
              width: 480,
              height: 480,
              fit: "inside",
              withoutEnlargement: true,
            })
            .webp({ quality: 78 })
            .toBuffer();
          await mkdir(store.thumbsDir, { recursive: true });
          const tmp = `${file}.${randomUUID()}.tmp`;
          await writeFile(tmp, data);
          try {
            await rename(tmp, file);
          } catch (e) {
            await unlink(tmp).catch(() => {});
            if (!(await stat(file).catch(() => null))) throw e;
          }
        })().finally(() => thumbJobs.delete(req.params.name));
        thumbJobs.set(req.params.name, job);
      }
      try {
        await job;
      } catch {
        return res.status(404).end();
      }
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.type("image/webp");
      res.send(await readFile(file));
    }),
  );
  app.use(
    "/media",
    (req, res, next) => {
      if (!/^\/[a-f0-9-]{36}\.png$/.test(req.path)) return res.sendStatus(404);
      next();
    },
    express.static(store.imagesDir, { dotfiles: "deny" }),
  );
  app.use(express.static(path.join(ROOT, "dist")));
  app.get("*", (req, res) =>
    res.sendFile(path.join(ROOT, "dist", "index.html")),
  );
  app.use((err, req, res, next) => {
    const status =
      err.type === "entity.too.large"
        ? 413
        : err.status && err.status >= 400 && err.status <= 599
          ? err.status
          : 400;
    res.status(status).json({
      error:
        err.type === "entity.too.large"
          ? "请求超过 100 MB"
          : String(err.message || "请求失败").slice(0, 700),
    });
  });
  return { app, store, queue };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { app } = await createApp();
  const port = Number(process.env.PORT) || 8780;
  app.listen(port, "127.0.0.1", () =>
    console.log(`Vellum http://127.0.0.1:${port}`),
  );
}
