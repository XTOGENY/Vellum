import { useEffect, useRef, useState } from "react";
import { api, download, fileData } from "./api";
import { Button, Field, Icon, Toggle, Select } from "./ui";
import { LibraryDialog, LibraryFrame, RailButton } from "./LibraryUI";
import { artistPrompt } from "../shared/artists.mjs";
import type { Artist, ArtistChoice, ArtistLibraryData, Params } from "./types";
import "./artists.css";

type Shared = {
  data: ArtistLibraryData;
  onChange: (data: ArtistLibraryData) => void;
  params: Params;
  patch: (value: Partial<Params>) => void;
  onError: (message: string) => void;
};
function choices(params: Params): ArtistChoice[] {
  return Array.isArray(params.artists) ? params.artists : [];
}
function addArtist(artist: Artist, params: Params, patch: Shared["patch"]) {
  if (!choices(params).some((a) => a.id === artist.id))
    patch({
      artists: [
        ...choices(params),
        { id: artist.id, name: artist.name, tag: artist.tag, weight: 1 },
      ],
      artistEnabled: true,
    });
}
function Weight({
  item,
  onChange,
}: {
  item: ArtistChoice;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(item.weight.toFixed(1));
  useEffect(() => setText(item.weight.toFixed(1)), [item.weight]);
  function commit() {
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0.1 || value > 3) {
      setText(item.weight.toFixed(1));
      return;
    }
    onChange(Math.round(value * 10) / 10);
  }
  return (
    <div className="artist-weight">
      <button
        type="button"
        aria-label={`降低 ${item.name} 权重`}
        disabled={item.weight <= 0.1}
        onClick={() =>
          onChange(Math.max(0.1, Math.round((item.weight - 0.1) * 10) / 10))
        }
      >
        −
      </button>
      <input
        aria-label={`${item.name} 权重`}
        type="number"
        min="0.1"
        max="3"
        step="0.1"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <button
        type="button"
        aria-label={`提高 ${item.name} 权重`}
        disabled={item.weight >= 3}
        onClick={() =>
          onChange(Math.min(3, Math.round((item.weight + 0.1) * 10) / 10))
        }
      >
        +
      </button>
    </div>
  );
}
export function ArtistCombination({
  params,
  patch,
  preview = true,
  heading = true,
  showToggle = true,
}: {
  params: Params;
  patch: Shared["patch"];
  preview?: boolean;
  heading?: boolean;
  showToggle?: boolean;
}) {
  const items = choices(params);
  function move(index: number, delta: number) {
    const next = [...items];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    patch({ artists: next });
  }
  return (
    <div className="artist-combination">
      {(heading || showToggle) && (
        <div
          className={`artist-combination-title ${heading ? "" : "without-title"}`}
        >
          {showToggle && (
            <Toggle
              label="参与本次生成"
              checked={params.artistEnabled !== false}
              onChange={(artistEnabled) => patch({ artistEnabled })}
            />
          )}
          {heading && (
            <div className="artist-stack-heading">
              <span>
                本次画师串 <small>{items.length}</small>
              </span>
              {showToggle && params.artistEnabled === false && (
                <small>已暂停</small>
              )}
            </div>
          )}
        </div>
      )}
      <div
        className={`artist-selected ${showToggle && params.artistEnabled === false ? "is-paused" : ""}`}
        aria-label="本次画师串"
      >
        {!items.length && (
          <p className="artist-empty">从画师库添加，按列表顺序合并。</p>
        )}
        {items.map((item, index) => (
          <div className="artist-selected-row" key={item.id}>
            <span className="artist-selected-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="artist-choice-name">
              <b title={item.name}>{item.name}</b>
              <small title={item.tag}>{item.tag}</small>
            </div>
            <Weight
              item={item}
              onChange={(weight) =>
                patch({
                  artists: items.map((a) =>
                    a.id === item.id ? { ...a, weight } : a,
                  ),
                })
              }
            />
            <div className="artist-order">
              <button
                type="button"
                aria-label={`上移 ${item.name}`}
                disabled={!index}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`下移 ${item.name}`}
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label={`移除 ${item.name}`}
              onClick={() =>
                patch({ artists: items.filter((a) => a.id !== item.id) })
              }
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
      <div className="artist-format">
        <span>权重格式</span>
        <Select
          aria-label="画师权重格式"
          value={params.artistFormat || "nai"}
          onChange={(e) => patch({ artistFormat: e.target.value })}
        >
          <option value="normal">普通格式</option>
          <option value="nai">NAI 格式</option>
        </Select>
      </div>
      {preview && (
        <>
          <label className="artist-output-label" htmlFor="artist-output">
            发送内容
          </label>
          <textarea
            id="artist-output"
            className="artist-output"
            aria-label="画师串发送内容"
            readOnly
            value={artistPrompt({
              ...params,
              artistEnabled: showToggle ? params.artistEnabled : true,
            })}
            placeholder="添加画师后显示组合"
          />
        </>
      )}
      {showToggle && (
        <>
          <div className="artist-format artist-position">
            <span>画师位置</span>
            <Select
              aria-label="画师位置"
              value={params.artistPosition || "end"}
              onChange={(e) => patch({ artistPosition: e.target.value })}
            >
              <option value="start">画师 → 提示词</option>
              <option value="end">提示词 → 画师</option>
            </Select>
          </div>
          <p className="artist-note">画师相对主体定位，模板在最外层。</p>
        </>
      )}
    </div>
  );
}
function Cover({ artist }: { artist: Artist }) {
  return artist.coverUrl ? (
    <img src={artist.coverUrl} alt="" loading="lazy" />
  ) : (
    <span className="artist-no-cover">
      <Icon name="image" />
      <span>未添加封面</span>
    </span>
  );
}

type Editor = {
  id?: string;
  name: string;
  tag: string;
  categories: string;
  favorite: boolean;
  image?: string | null;
  coverUrl?: string;
};
export function ArtistEditor({
  artist,
  onClose,
  onSave,
}: {
  artist: Artist | null;
  onClose: () => void;
  onSave: (data: ArtistLibraryData) => void;
}) {
  const blank = { name: "", tag: "", categories: "", favorite: false };
  const initial: Editor = artist
    ? { ...artist, categories: artist.categories.join(", ") }
    : blank;
  const [form, setForm] = useState<Editor>(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api<ArtistLibraryData>("/artists", {
        ...form,
        categories: form.categories
          .split(/[,，]/)
          .map((c) => c.trim())
          .filter(Boolean),
      });
      onSave(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <LibraryDialog
      title={artist ? "编辑画师" : "添加画师"}
      onClose={close}
      className="artist-editor-dialog"
    >
      <form onSubmit={save} className="artist-editor library-dialog-body">
        <div className="artist-form-row">
          <Field label="名称">
            <input
              autoFocus
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="画师标签">
            <input
              required
              maxLength={500}
              value={form.tag}
              onChange={(e) => setForm({ ...form, tag: e.target.value })}
              placeholder="例如 mika_pikazo"
            />
          </Field>
        </div>
        <Field label="分类">
          <input
            value={form.categories}
            onChange={(e) => setForm({ ...form, categories: e.target.value })}
            placeholder="多个分类用逗号分开"
            maxLength={500}
          />
        </Field>
        <Field label="封面">
          <div className="artist-cover-editor">
            {form.image || (form.image !== null && form.coverUrl) ? (
              <img src={form.image || form.coverUrl || ""} alt="封面预览" />
            ) : (
              <Icon name="image" />
            )}
            <div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="上传画师封面"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  try {
                    const image = await fileData(file);
                    setForm((old) => ({ ...old, image }));
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                    e.target.value = "";
                  }
                }}
              />
            </div>
            <Button
              small
              disabled={busy}
              onClick={() =>
                setForm({ ...form, image: null, coverUrl: undefined })
              }
            >
              移除封面
            </Button>
          </div>
        </Field>
        <label>
          <input
            type="checkbox"
            checked={form.favorite}
            onChange={(e) => setForm({ ...form, favorite: e.target.checked })}
          />
          收藏这位画师
        </label>
        {error && (
          <p className="artist-error" role="alert">
            {error}
          </p>
        )}
        {discard ? (
          <div className="artist-discard">
            <span>放弃尚未保存的修改？</span>
            <Button onClick={() => setDiscard(false)}>继续编辑</Button>
            <Button onClick={onClose}>放弃修改</Button>
          </div>
        ) : (
          <div className="actions">
            <Button disabled={busy} onClick={close}>
              取消
            </Button>
            <Button primary type="submit" disabled={busy}>
              {busy ? "保存中…" : "保存画师"}
            </Button>
          </div>
        )}
      </form>
    </LibraryDialog>
  );
}

function ArtistStorage({
  data,
  onChange,
  onClose,
}: {
  data: ArtistLibraryData;
  onChange: Shared["onChange"];
  onClose: () => void;
}) {
  const [target, setTarget] = useState(""),
    [copy, setCopy] = useState(true),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  async function pick() {
    setBusy(true);
    setError("");
    try {
      const next = await api<{ path: string }>("/artists/storage/pick", {});
      if (next.path) setTarget(next.path);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const next = await api<ArtistLibraryData>("/artists/storage", {
        dataDir: target,
        mode: copy ? "copy" : "switch",
      });
      onChange(next);
      setTarget("");
      setNote(copy ? "已切换保存位置，原目录保留。" : "已切换画师库位置。");
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <LibraryDialog
      title="画师库保存位置"
      onClose={() => !busy && onClose()}
      className="artist-storage-dialog"
    >
      <div className="artist-storage library-dialog-body">
        <div className="storage-current">
          <b>当前位置</b>
          <code>{data.storage.activeDir}</code>
        </div>
        <p className="artist-note">
          画师资料与封面保存在此文件夹，独立于工作空间。
        </p>
        <Field label="新位置">
          <div className="storage-picker">
            <input
              aria-label="新位置"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="选择或输入完整文件夹路径"
            />
            <Button disabled={busy} onClick={pick}>
              浏览…
            </Button>
          </div>
        </Field>
        <label>
          <input
            type="checkbox"
            checked={copy}
            onChange={(e) => setCopy(e.target.checked)}
            disabled={busy}
          />
          把现有画师与封面复制到新位置（原目录保留）
        </label>
        {!copy && (
          <p className="artist-note">
            读取目标目录中的画师库，当前工作台的组合仍保留。
          </p>
        )}
        {error && (
          <p role="alert" className="artist-error">
            {error}
          </p>
        )}
        {note && <p role="status">{note}</p>}
        <div className="actions">
          <Button disabled={busy} onClick={onClose}>
            完成
          </Button>
          <Button primary disabled={busy || !target.trim()} onClick={apply}>
            {busy ? "处理中…" : "应用位置"}
          </Button>
        </div>
      </div>
    </LibraryDialog>
  );
}

export default function ArtistLibrary({
  data,
  onChange,
  params,
  patch,
  onError,
  onRemove,
}: Shared & { onRemove: (id: string) => void }) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部"),
    [favorites, setFavorites] = useState(false),
    [editor, setEditor] = useState<Artist | null | undefined>(),
    [storage, setStorage] = useState(false),
    [deleting, setDeleting] = useState<Artist | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const categories = [
    ...new Set(
      data.items.flatMap((a) =>
        a.categories.length ? a.categories : ["未分类"],
      ),
    ),
  ];
  const list = data.items.filter(
    (a) =>
      (!favorites || a.favorite) &&
      (category === "全部" ||
        (a.categories.length ? a.categories : ["未分类"]).includes(category)) &&
      `${a.name} ${a.tag}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > 90 * 1024 * 1024)
        throw new Error("导入文件不能超过 90 MB");
      const body = JSON.parse(await file.text());
      const next = await api<ArtistLibraryData>("/artists/import", body);
      onChange(next);
      setMessage(`导入完成，新增 ${next.added || 0} 位画师；未导入风格预设。`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function exportFile() {
    setBusy(true);
    try {
      download(
        "vellum-artists.json",
        JSON.stringify(await api("/artists/export"), null, 2),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      onChange(
        await api<ArtistLibraryData>(`/artists/${deleting.id}`, {}, "DELETE"),
      );
      onRemove(deleting.id);
      setDeleting(null);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LibraryFrame
        className="artists-library"
        rail={
          <>
            <div className="rail-title">
              <Icon name="brush" />
              <h1>画师</h1>
            </div>
            <p className="rail-caption">收藏风格，组合使用。</p>
            <RailButton
              active={!favorites && category === "全部"}
              count={data.items.length}
              onClick={() => {
                setFavorites(false);
                setCategory("全部");
              }}
              icon="grid"
            >
              全部画师
            </RailButton>
            <RailButton
              active={favorites}
              count={data.items.filter((a) => a.favorite).length}
              onClick={() => {
                setFavorites(!favorites);
                setCategory("全部");
              }}
              icon="star"
            >
              我的收藏
            </RailButton>
            <div className="rail-divider" />
            <div className="rail-group-title">分类</div>
            {categories.map((c) => (
              <RailButton
                key={c}
                active={!favorites && category === c}
                count={
                  data.items.filter((a) =>
                    (a.categories.length ? a.categories : ["未分类"]).includes(
                      c,
                    ),
                  ).length
                }
                onClick={() => {
                  setFavorites(false);
                  setCategory(c);
                }}
              >
                {c}
              </RailButton>
            ))}
            <div className="grow" />
            <div className="artist-rail-actions">
              <Button
                small
                disabled={busy || !!data.error}
                onClick={() => input.current?.click()}
              >
                导入
              </Button>
              <Button
                small
                disabled={busy || !!data.error}
                onClick={exportFile}
              >
                导出
              </Button>
            </div>
            <Button small icon="sliders" onClick={() => setStorage(true)}>
              保存位置
            </Button>
          </>
        }
      >
        <div className="artist-page-body">
          <section className="artist-catalog">
            <div className="library-toolbar">
              <label className="library-search">
                <Icon name="search" />
                <input
                  aria-label="搜索画师名称或标签"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索名称或画师标签"
                />
              </label>
              <span className="grow" />
              <Button
                icon="plus"
                primary
                onClick={() => setEditor(null)}
                disabled={!!data.error}
              >
                添加画师
              </Button>
            </div>
            <div className="library-result-line">
              <span>
                {category} · {list.length} 位
              </span>
              <button className="text-link" onClick={() => setStorage(true)}>
                保存位置
              </button>
            </div>
            {data.error && (
              <p className="artist-error" role="alert">
                {data.error}。可在保存位置中切换到其他画师库。
              </p>
            )}
            {message && (
              <p role="status" className="artist-notice">
                {message}
              </p>
            )}
            <div className="artist-gallery" aria-label="画师库">
              {list.map((a) => (
                <article
                  key={a.id}
                  className={`artist-card ${choices(params).some((i) => i.id === a.id) ? "is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="artist-card-select"
                    aria-label={`添加 ${a.name} 到画师串`}
                    aria-pressed={choices(params).some((i) => i.id === a.id)}
                    onClick={() => addArtist(a, params, patch)}
                  >
                    <div className="artist-card-cover">
                      <Cover artist={a} />
                      {choices(params).some((i) => i.id === a.id) && (
                        <span className="artist-card-check">
                          <Icon name="check" />
                          已添加
                        </span>
                      )}
                    </div>
                    <div className="artist-card-copy">
                      <b>{a.name}</b>
                      <span>{a.tag}</span>
                    </div>
                  </button>
                  <div className="artist-card-actions">
                    <small>{a.categories.join(" · ") || "未分类"}</small>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`${a.favorite ? "取消收藏" : "收藏"} ${a.name}`}
                      onClick={async () => {
                        try {
                          onChange(
                            await api<ArtistLibraryData>("/artists", {
                              ...a,
                              favorite: !a.favorite,
                            }),
                          );
                        } catch (e) {
                          onError((e as Error).message);
                        }
                      }}
                    >
                      <Icon name="star" />
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setEditor(a)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`删除 ${a.name}`}
                      onClick={() => setDeleting(a)}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!list.length && !data.error && (
              <div className="artist-library-empty">
                <Icon name="brush" />
                <h2>
                  {data.items.length ? "没有匹配的画师" : "建立你的画师库"}
                </h2>
                <p>
                  {data.items.length
                    ? "试试其他名称、标签或分类。"
                    : "添加画师标签和封面，或导入原工具的 JSON。"}
                </p>
                {data.items.length ? (
                  <Button
                    onClick={() => {
                      setQuery("");
                      setCategory("全部");
                      setFavorites(false);
                    }}
                  >
                    清除筛选
                  </Button>
                ) : (
                  <Button primary onClick={() => setEditor(null)}>
                    添加第一位画师
                  </Button>
                )}
              </div>
            )}
          </section>
          <aside className="artist-recipe">
            <h2>
              本次画师串 <small>{choices(params).length} 位</small>
            </h2>
            <ArtistCombination
              params={params}
              patch={patch}
              heading={false}
              showToggle={false}
            />
            <div className="grow" />
            <Button
              primary
              icon="copy"
              disabled={!choices(params).length}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    artistPrompt({ ...params, artistEnabled: true }),
                  );
                  setMessage("画师串已复制。");
                } catch {
                  onError("无法复制，请手动复制上方画师串。");
                }
              }}
            >
              复制
            </Button>
          </aside>
        </div>
      </LibraryFrame>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {editor !== undefined && (
        <ArtistEditor
          artist={editor}
          onClose={() => setEditor(undefined)}
          onSave={onChange}
        />
      )}
      {storage && (
        <ArtistStorage
          data={data}
          onChange={onChange}
          onClose={() => setStorage(false)}
        />
      )}
      {deleting && (
        <LibraryDialog
          title="删除画师"
          onClose={() => !busy && setDeleting(null)}
        >
          <p>删除「{deleting.name}」并从本次画师串移除？原提示词不受影响。</p>
          <div className="actions">
            <Button disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button disabled={busy} onClick={remove}>
              删除画师
            </Button>
          </div>
        </LibraryDialog>
      )}
    </>
  );
}

export function ArtistPicker({
  data,
  params,
  patch,
}: Pick<Shared, "data" | "params" | "patch">) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部");
  const categories = [
    "全部",
    ...new Set(data.items.flatMap((a) => a.categories)),
  ];
  const list = data.items.filter(
    (a) =>
      (category === "全部" || a.categories.includes(category)) &&
      `${a.name} ${a.tag}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="artist-picker">
      <ArtistCombination params={params} patch={patch} preview={false} />
      <div className="artist-picker-library">
        <div className="section-title">
          <h3>画师库</h3>
        </div>
        <label className="library-search">
          <Icon name="search" />
          <input
            aria-label="搜索画师"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称或标签"
          />
        </label>
        <div className="artist-filter-strip">
          {categories.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="artist-picker-list">
          {data.error && (
            <p role="alert" className="artist-error">
              {data.error}
            </p>
          )}
          {list.map((a) => {
            const added = choices(params).some((i) => i.id === a.id);
            return (
              <button
                key={a.id}
                className="artist-picker-row"
                aria-label={`${a.name}，${added ? "已选中，点击取消" : "选择画师"}`}
                aria-pressed={added}
                title={`${a.name} · ${a.tag}`}
                onClick={() =>
                  added
                    ? patch({
                        artists: choices(params).filter(
                          (item) => item.id !== a.id,
                        ),
                      })
                    : addArtist(a, params, patch)
                }
              >
                <span className="artist-mini-cover">
                  <Cover artist={a} />
                </span>
                <span className="artist-picker-copy">
                  <b>
                    {added && <Icon name="check" />}
                    {a.name}
                  </b>
                  <small>{a.tag}</small>
                  <span className="artist-picker-category">
                    {a.categories.join(" / ") || "未分类"}
                  </span>
                </span>
              </button>
            );
          })}
          {!list.length && (
            <p className="artist-empty">
              {data.items.length
                ? "没有匹配的画师。"
                : "还没有画师，请到顶部「画师」页添加或导入。"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
