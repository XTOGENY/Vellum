import { composeTemplates } from "../shared/prompt-composition.mjs";
import { randomUUID, randomInt, createHash } from "node:crypto";
import {
  assertImageProtocol,
  protocolOfConnection,
} from "../shared/image-protocols.mjs";
import { openAIFields, openAIEditForm } from "./openai-image.mjs";
import { imageAdapter } from "./foreign-image.mjs";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  generationMetadata,
  openAIGenerationMetadata,
} from "./png-metadata.mjs";
import { isOpenAIImageModel } from "../shared/image-models.mjs";
import { restoreMetadata } from "../shared/metadata.mjs";
import { historySearchText } from "../shared/history-index.mjs";
import { realizePrompts } from "../shared/prompt-tools.mjs";
import {
  buildPayload,
  validateParams,
  DIRECTOR_TOOLS,
  EMOTIONS,
  modelById,
} from "../shared/novelai.mjs";
import {
  prepareReferences,
  prepareDirector,
  picture,
  encodeSavedImage,
  normalizeImage,
  prepareFocus,
  readMetadata,
} from "./images.mjs";

export class TaskQueue {
  constructor(store, provider) {
    this.store = store;
    this.provider = provider;
    this.running = new Map();
    this.listeners = new Set();
    this.previews = new Map();
    this.connectionLocks = new Set();
  }
  emit() {
    for (const fn of this.listeners) fn(this.publicTasks());
  }
  publicTasks() {
    return this.store.state.tasks.map(({ params, operation, ...t }) => ({
      ...t,
      preview: this.previews.get(t.id),
    }));
  }
  async recover() {
    for (const t of this.store.state.tasks)
      if (["queued", "running"].includes(t.status)) {
        t.status = "interrupted";
        t.error = "上次运行已中断，请检查已有结果后手动重试";
      }
    await this.store.save();
  }
  async enqueue({ connectionId, params, kind = "generate", operation }) {
    if (!this.store.state.connections.some((c) => c.id === connectionId))
      throw new Error("请先选择有效连接");
    if (
      this.store.state.tasks.filter((t) =>
        ["running", "queued"].includes(t.status),
      ).length >= 32
    )
      throw new Error("队列已满，请等待任务完成");
    if (kind === "generate") {
      const connection = this.store.state.connections.find(
        (c) => c.id === connectionId,
      );
      // 提交时就校验：外部协议按各自的字段验，NovelAI 走原来的表单校验。
      const protocolId = protocolOfConnection(connection).id;
      if (protocolId !== "novelai-native") {
        // 有底图要的是图像输入能力，没有底图要的是文生图。
        assertImageProtocol(
          connection,
          params.baseImage ? "image.edit" : "image.generate",
        );
        const count = Math.min(params.total, params.batchSize);
        if (protocolId === "openai-images") openAIFields(params, { count });
        else {
          const adapter = imageAdapter(protocolId);
          adapter.fields(params, { count });
          adapter.body(params, {
            count,
            images: [
              ...(params.baseImage ? [params.baseImage.data] : []),
              ...(Array.isArray(params.gptRefs) ? params.gptRefs : []).map(
                (r) => r.data,
              ),
            ],
            mask: params.mask || null,
          });
        }
      } else {
        validateParams(params);
        buildPayload(params, {
          seed: params.seed ?? 0,
          samples: Math.min(params.total, params.batchSize),
        });
      }
    } else if (!["director", "upscale"].includes(kind))
      throw new Error("任务类型错误");
    const t = {
      id: randomUUID(),
      connectionId,
      kind,
      status: "queued",
      createdAt: new Date().toISOString(),
      completed: 0,
      total: kind === "generate" ? params.total : 1,
      progress: 0,
      results: [],
      params: structuredClone(params || {}),
      operation: structuredClone(operation || {}),
      title:
        kind === "generate"
          ? (params.imageAction === "enhance"
              ? "增强 · "
              : params.imageAction === "variation"
                ? "变体 · "
                : "") + (params.prompt.slice(0, 80) || "新图像")
          : kind === "upscale"
            ? "图像放大"
            : "导演工具",
    };
    this.store.state.tasks.unshift(t);
    await this.store.save();
    this.emit();
    this.pump();
    return t.id;
  }
  lockKey(id) {
    const c = this.store.state.connections.find((c) => c.id === id);
    return c?.official ? "official-account" : id;
  }
  async exclusive(connectionId, fn) {
    const key = this.lockKey(connectionId);
    if (
      this.connectionLocks.has(key) ||
      [...this.running.values()].some(
        (x) => this.lockKey(x.connectionId) === key,
      )
    )
      throw new Error("该连接正在处理任务，请稍后再试");
    this.connectionLocks.add(key);
    try {
      return await fn();
    } finally {
      this.connectionLocks.delete(key);
      this.pump();
    }
  }
  pump() {
    for (const c of this.store.state.connections) {
      const key = this.lockKey(c.id),
        active = [...this.running.values()].filter(
          (t) => this.lockKey(t.connectionId) === key,
        ).length;
      const limit = c.official
        ? 1
        : Math.max(1, Math.min(4, c.concurrency || 1));
      if (active >= limit || this.connectionLocks.has(key)) continue;
      const tasks = this.store.state.tasks
        .filter((t) => t.connectionId === c.id && t.status === "queued")
        .reverse()
        .slice(0, limit - active);
      for (const t of tasks) {
        const controller = new AbortController();
        this.running.set(t.id, { controller, connectionId: c.id });
        void this.run(t, controller).finally(() => {
          this.running.delete(t.id);
          this.previews.delete(t.id);
          this.emit();
          this.pump();
        });
      }
    }
  }
  async cancel(id) {
    const t = this.store.state.tasks.find((t) => t.id === id);
    if (!t) throw new Error("任务不存在");
    if (["queued", "running"].includes(t.status)) {
      t.status = "cancelled";
      t.finishedAt = new Date().toISOString();
      this.running.get(id)?.controller.abort();
      await this.store.save();
      this.emit();
    }
  }
  async run(t, controller) {
    const signal = controller.signal;
    let requestedAt;
    const responseReceived = () => {
      if (requestedAt && t.timings.responseMs === undefined)
        t.timings.responseMs = Date.now() - requestedAt;
      t.phase = "receiving";
      this.emit();
    };
    try {
      t.status = "running";
      t.startedAt = new Date().toISOString();
      t.phase = "preparing";
      t.timings = {
        queueMs: Date.parse(t.startedAt) - Date.parse(t.createdAt),
      };
      await this.store.save();
      this.emit();
      // 排队时大图已经被抽到 blobs/，真正开跑前再取回 base64。
      await this.store.hydrateTask(t);
      const c = await this.store.connection(t.connectionId);
      // 按任务类型要对应的能力：没接的能力不做，也不按错的协议把请求发出去。
      assertImageProtocol(c, t.kind === "generate" ? "image.generate" : "image.augment");
      if (t.kind === "generate") {
        // OpenAI 图像走自己的一套：不做 Vibe 编码、聚焦选区这些 NovelAI 专有的准备。
        const spec = protocolOfConnection(c),
          // 非 NovelAI 协议统一叫「外部协议」；openai 有自己的一套（多图/流式）。
          foreign = spec.id !== "novelai-native",
          openai = spec.id === "openai-images",
          adapter = foreign && !openai ? imageAdapter(spec.id) : null,
          prepared = foreign
            ? { params: t.params }
            : await prepareFocus(await prepareReferences(t.params)),
          p = prepared.params;
        while (t.completed < t.total) {
          if (signal.aborted) throw new Error("任务已取消");
          const count = Math.min(p.batchSize, t.total - t.completed),
            offset = t.completed,
            seed =
              p.seed === null
                ? randomInt(0, 4294967296)
                : (p.seed + offset) >>> 0;
          // OpenAI 路径不要求调用方带上 NovelAI 的角色 / 参考字段。
          // 外部协议不要求调用方带上 NovelAI 的角色 / 参考字段。
          const resolved = realizePrompts(
            foreign ? { characters: [], references: [], ...p } : p,
          );
          // OpenAI：有底图走 edits（multipart），否则走 generations（JSON）。
          let payload,
            record = null;
          if (foreign) {
            resolved.prompt = composeTemplates(resolved).prompt;
            // 顺序：底图在前（蒙版作用于它），然后是参考图列表的顺序。
            const editImages = [
              ...(p.baseImage ? [p.baseImage.data] : []),
              ...(Array.isArray(p.gptRefs) ? p.gptRefs : []).map((r) => r.data),
            ];
            const mode = editImages.length
              ? p.mask && p.baseImage
                ? "inpaint"
                : "img2img"
              : "generate";
            if (openai) {
              record = {
                ...openAIFields(resolved, { count }),
                mode,
                inputs: editImages.length,
              };
              payload = editImages.length
                ? await openAIEditForm(resolved, {
                    count,
                    images: editImages,
                    mask: p.baseImage ? p.mask || null : null,
                  })
                : record;
            } else {
              // Gemini / FLUX / Grok：请求体由各自的适配器拼。
              record = {
                ...adapter.fields(resolved, { count, images: editImages }),
                mode,
                inputs: editImages.length,
                protocol: spec.id,
              };
              payload = {
                ...adapter.body(resolved, {
                  count,
                  images: editImages,
                  mask: p.mask || null,
                }),
                model: resolved.model,
              };
            }
          } else {
            payload = buildPayload(resolved, { seed, samples: count });
            record = payload;
          }
          t.phase = "requesting";
          if (!requestedAt) {
            requestedAt = Date.now();
            t.timings.prepareMs = requestedAt - Date.parse(t.startedAt);
          }
          this.emit();
          const found = await this.provider.images(c, payload, {
            signal,
            stream: foreign
              ? !!record.stream
              : c.streaming && modelById(p.model).family !== "v3",
            onResponse: responseReceived,
            onPreview: (ev) => {
              t.phase = "generating";
              if (t.timings.firstPreviewMs === undefined)
                t.timings.firstPreviewMs = Date.now() - requestedAt;
              this.previews.set(t.id, ev);
              t.progress = ev.step;
              this.emit();
            },
            onImage: async (bytes, index, returnedSeed) => {
              t.phase = "saving";
              if (t.timings.firstImageMs === undefined)
                t.timings.firstImageMs = Date.now() - requestedAt;
              this.emit();
              let imageSeed;
              try {
                imageSeed = JSON.parse(
                  (await readMetadata(bytes.toString("base64"))).fields
                    .Comment || "{}",
                ).seed;
              } catch {}
              const validSeed = (v) =>
                Number.isInteger(v) && v >= 0 && v <= 4294967295;
              const actualSeed = validSeed(returnedSeed)
                ? returnedSeed
                : validSeed(imageSeed)
                  ? imageSeed
                  : count === 1
                    ? seed
                    : null;
              // 非 NovelAI 的图像没有种子、随机词来源这些概念，按原样保存即可。
              if (foreign) {
                await this.saveImage(
                  t,
                  bytes,
                  { ...t.params, actualPrompt: resolved.prompt },
                  record,
                );
                return;
              }
              await this.saveImage(
                t,
                await prepared.restore(bytes),
                {
                  ...t.params,
                  seed: actualSeed,
                  actualPrompt: resolved.prompt,
                  actualNegative: resolved.negative,
                  actualCharacters: t.params.characters.map((c, i) => ({
                    ...c,
                    prompt: resolved.characters[i]?.prompt ?? c.prompt,
                    uc: resolved.characters[i]?.uc ?? c.uc,
                  })),
                  randomizerSource: {
                    prompt: t.params.prompt,
                    negative: t.params.negative,
                    characters: t.params.characters.map((c) => ({
                      prompt: c.prompt,
                      uc: c.uc,
                    })),
                  },
                },
                payload,
              );
            },
          });
          if (found !== count)
            throw new Error(
              `请求 ${count} 张，接口实际返回 ${found} 张；已收到的结果已保存`,
            );
        }
      } else {
        const image = t.operation.image;
        let sourceParams = t.params;
        try { sourceParams = restoreMetadata(await readMetadata(image))?.params || sourceParams; } catch {}
        sourceParams = { ...sourceParams, localSaveFormat: t.params.localSaveFormat };
        t.phase = "requesting";
        requestedAt = Date.now();
        t.timings.prepareMs = requestedAt - Date.parse(t.startedAt);
        this.emit();
        const options = {
          signal,
          onResponse: responseReceived,
          onImage: (bytes) => {
            t.phase = "saving";
            t.timings.firstImageMs = Date.now() - requestedAt;
            this.emit();
            return this.saveImage(t, bytes, sourceParams, null);
          },
        };
        if (t.kind === "upscale")
          await this.provider.upscale(
            c,
            (await normalizeImage(image)).data,
            options,
          );
        else
          await this.provider.augment(
            c,
            await prepareDirector(t.operation, DIRECTOR_TOOLS, EMOTIONS),
            options,
          );
      }
      if (t.status !== "cancelled") t.status = "completed";
    } catch (e) {
      if (t.status !== "cancelled") {
        t.status = "failed";
        t.error = String(e.message || "任务失败");
        t.correlation = e.correlation;
      }
    } finally {
      t.finishedAt = new Date().toISOString();
      t.phase = undefined;
      if (t.timings)
        t.timings.totalMs = Date.parse(t.finishedAt) - Date.parse(t.createdAt);
      t.progress = 0;
      try {
        await this.store.save();
      } catch (e) {
        t.status = "failed";
        t.error = "本地保存失败：" + e.message;
      }
      this.emit();
    }
  }
  async saveImage(t, bytes, params, payload) {
    const clean = await picture(bytes).png().toBuffer(),
      id = randomUUID(),
      size = await picture(clean).metadata();
    // 按连接协议判断，不看模型名：中转的模型名对不上注册表也要记对。
    const protocol = protocolOfConnection(
      this.store.state.connections.find((c) => c.id === t?.connectionId),
    ).id;
    const foreignResult = protocol !== "novelai-native";
    const format = !foreignResult && params.localSaveFormat === "webp" ? "webp" : "png";
    const output = await encodeSavedImage(
      clean,
      foreignResult
        ? openAIGenerationMetadata(params, payload, {
            width: size.width,
            height: size.height,
            protocol,
          })
        : generationMetadata(params, payload, {
            width: size.width,
            height: size.height,
            kind: t.kind,
            operation: t.operation,
          }),
      format,
    );
    const filename = id + "." + format;
    await writeFile(path.join(this.store.imagesDir, filename), output);
    // 网格用 480px WebP，避免每张卡片都下载几 MB 原图；失败也不影响原图保存。
    try {
      const thumb = await picture(clean)
        .resize({
          width: 480,
          height: 480,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 78 })
        .toBuffer();
      await writeFile(path.join(this.store.thumbsDir, id + ".webp"), thumb);
    } catch {}
    const item = {
      id,
      taskId: t.id,
      filename,
      url: "/media/" + filename,
      createdAt: new Date().toISOString(),
      kind: t.kind,
      model: params.model || "",
      prompt: params.prompt || "",
      connection:
        this.store.state.connections.find((c) => c.id === t.connectionId)
          ?.name || "",
      width: size.width,
      height: size.height,
      seed: params.seed ?? null,
      params: structuredClone(params),
      collections: [],
      hash: createHash("sha256").update(output).digest("hex"),
    };
    item.searchText = historySearchText(
      item,
      this.store.state.collections,
      this.store.state.connections,
    );
    this.store.state.history.unshift(item);
    t.results.push(id);
    t.completed++;
    await this.store.save();
    this.emit();
    return item;
  }
}
