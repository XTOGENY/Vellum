import { useEffect, useRef, useState } from "react";
import { api, download } from "./api";
import { Button, Field, Icon, Select } from "./ui";
import {
  LibraryFrame,
  RailButton,
  LibraryDialog,
  LibraryEmpty,
  ScrollHint,
  TEMPLATE_CATEGORIES,
  categoryName,
  dateLabel,
} from "./LibraryUI";
import { expandedPrompts } from "../shared/prompt-tools.mjs";
import type { Params, Template } from "./types";

export default function TemplateLibrary({
  items,
  onChange,
  onApply,
  onError,
  params,
  onImport,
}: {
  items: Template[];
  onChange: (items: Template[]) => void;
  onApply: (t: Template, append: boolean) => void;
  onError: (message: string) => void;
  params: Params;
  onImport: () => void;
}) {
  const blank = (): Template => ({
    id: "",
    name: "",
    prompt: "",
    negative: "",
    includeNegative: true,
    category: "general",
  });
  const inspectorBody = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("all"),
    [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [form, setForm] = useState<Template | null>(null),
    [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [discard, setDiscard] = useState(false),
    pending = useRef<null | (() => void)>(null);
  const selected = items.find((t) => t.id === selectedId),
    dirty = !!form && JSON.stringify(form) !== baseline;
  const filtered = items.filter(
    (t) =>
      (!favoriteOnly || t.favorite) &&
      (category === "all" || (t.category || "general") === category) &&
      [t.name, t.prompt]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
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
  function safely(action: () => void) {
    if (dirty) {
      pending.current = action;
      setDiscard(true);
    } else action();
  }
  function open(t?: Template, edit = false) {
    safely(() => {
      setSelectedId(t?.id || null);
      setForm(edit ? { ...(t || blank()) } : null);
      setBaseline(JSON.stringify(t || blank()));
      setError("");
      setMessage("");
    });
  }
  function filter(nextCategory: string, favorites = false) {
    safely(() => {
      setCategory(nextCategory);
      setFavoriteOnly(favorites);
      setForm(null);
      setSelectedId(null);
      setError("");
    });
  }
  async function save() {
    if (!form || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<Template[]>("/templates", form);
      onChange(next);
      const saved = form.id ? next.find((t) => t.id === form.id) : next[0];
      setSelectedId(saved?.id || null);
      setForm(null);
      setMessage("模板已保存");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleFavorite(t: Template) {
    if (busy) return;
    setBusy(true);
    try {
      onChange(await api("/templates", { ...t, favorite: !t.favorite }));
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const rail = (
    <>
      <div className="rail-title">
        <Icon name="grid" />
        <h1>模板</h1>
      </div>
      <p className="rail-caption">常用描述，随手取用。</p>
      <nav aria-label="模板分类">
        <RailButton
          active={category === "all" && !favoriteOnly}
          count={items.length}
          onClick={() => filter("all")}
          icon="grid"
        >
          全部模板
        </RailButton>
        <RailButton
          active={favoriteOnly}
          count={items.filter((t) => t.favorite).length}
          onClick={() => filter("all", true)}
          icon="star"
        >
          我的收藏
        </RailButton>
        <div className="rail-divider" />
        <p className="rail-group-title">按用途</p>
        {Object.entries(TEMPLATE_CATEGORIES).map(([key, label]) => (
          <RailButton
            key={key}
            active={category === key && !favoriteOnly}
            count={
              items.filter((t) => (t.category || "general") === key).length
            }
            onClick={() => filter(key)}
          >
            {label}
          </RailButton>
        ))}
      </nav>
      <div className="rail-bottom">
        <Button icon="upload" onClick={() => safely(onImport)}>
          导入模板
        </Button>
        <p>支持已有模板 JSON 文件。</p>
      </div>
    </>
  );
  return (
    <LibraryFrame rail={rail} className="templates-library">
      <header className="library-heading">
        <div>
          <h2>
            {favoriteOnly
              ? "我的收藏"
              : category === "all"
                ? "全部模板"
                : categoryName(category)}
          </h2>
          <p>挑选一段画师词、角色或场景，继续创作。</p>
        </div>
        <Button primary icon="plus" onClick={() => open(undefined, true)}>
          新建模板
        </Button>
      </header>
      <div className="library-toolbar">
        <div className="library-search">
          <Icon name="search" />
          <input
            aria-label="搜索模板"
            placeholder="搜索名称或提示词…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="icon-btn"
              aria-label="清除模板搜索"
              onClick={() => setSearch("")}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        <span className="result-count">{filtered.length} 个模板</span>
      </div>
      {message && (
        <div className="library-notice" role="status">
          {message}
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭提示"
            onClick={() => setMessage("")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      <div
        className={`template-browser ${form || selected ? "has-inspector" : ""}`}
      >
        <section className="library-scroll" aria-label="模板列表">
          <div className="prompt-card-grid">
            {filtered.map((t) => (
              <article
                className={`prompt-card ${selectedId === t.id ? "is-selected" : ""}`}
                key={t.id}
              >
                <div className="prompt-card-top">
                  <span className="category-label">
                    {categoryName(t.category)}
                  </span>
                  <button
                    type="button"
                    className={`icon-btn favorite-button ${t.favorite ? "is-favorite" : ""}`}
                    aria-label={`${t.favorite ? "取消收藏" : "收藏模板"} ${t.name}`}
                    disabled={busy}
                    onClick={() => void toggleFavorite(t)}
                  >
                    <Icon name="star" />
                  </button>
                </div>
                <button
                  type="button"
                  className="prompt-card-body"
                  aria-label={`查看模板 ${t.name}`}
                  onClick={() => open(t)}
                >
                  <h3>{t.name}</h3>
                  <p>{t.prompt || "尚未填写内容"}</p>
                </button>
                <footer>
                  <span>{t.updatedAt ? dateLabel(t.updatedAt) : "已保存"}</span>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => safely(() => onApply(t, true))}
                  >
                    追加到工作台 <Icon name="arrow" />
                  </button>
                </footer>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <LibraryEmpty
              title={
                search || category !== "all" || favoriteOnly
                  ? "没有匹配的模板"
                  : "收好第一段画师词"
              }
              action={
                <Button
                  onClick={() =>
                    search || category !== "all" || favoriteOnly
                      ? (setSearch(""), filter("all"))
                      : open(undefined, true)
                  }
                >
                  {search || category !== "all" || favoriteOnly
                    ? "清除筛选"
                    : "新建模板"}
                </Button>
              }
            >
              {search
                ? "换个关键词，或查看其他分类。"
                : "从当前提示词建立模板，之后随时追加或替换。"}
            </LibraryEmpty>
          )}
        </section>
        {(form || selected) && (
          <aside
            className="library-inspector"
            aria-label={form ? "模板编辑" : "模板详情"}
          >
            <header>
              <div>
                <span className="category-label">
                  {form
                    ? form.id
                      ? "编辑模板"
                      : "新建模板"
                    : categoryName(selected?.category)}
                </span>
                <h3>{form ? form.name || "未命名模板" : selected?.name}</h3>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="收起模板详情"
                disabled={busy}
                onClick={() =>
                  safely(() => {
                    setForm(null);
                    setSelectedId(null);
                  })
                }
              >
                <Icon name="close" />
              </button>
            </header>
            <div className="inspector-scroll" ref={inspectorBody}>
              {form ? (
                <>
                  <Field label="模板名称">
                    <input
                      aria-label="模板名称"
                      maxLength={100}
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      placeholder="例如：鸢尾柔光画师串"
                    />
                  </Field>
                  <Field label="用途分类">
                    <Select
                      aria-label="模板用途分类"
                      value={form.category || "general"}
                      onChange={(e) =>
                        setForm({ ...form, category: e.target.value })
                      }
                    >
                      {Object.entries(TEMPLATE_CATEGORIES).map(
                        ([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ),
                      )}
                    </Select>
                  </Field>
                  <div className="section-title">
                    <h4>提示词</h4>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        try {
                          const current = expandedPrompts(params);
                          setForm({
                            ...form,
                            prompt: current.prompt,
                            negative: current.negative,
                          });
                          setError("");
                        } catch (e: any) {
                          setError(e.message);
                        }
                      }}
                    >
                      读取当前提示词
                    </button>
                  </div>
                  <Field label="模板内容">
                    <textarea
                      aria-label="模板内容"
                      rows={9}
                      maxLength={50000}
                      value={form.prompt}
                      onChange={(e) =>
                        setForm({ ...form, prompt: e.target.value })
                      }
                      placeholder="粘贴画师串或常用描述…"
                    />
                  </Field>
                </>
              ) : (
                <>
                  <div className="section-title">
                    <h4>模板内容</h4>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => open(selected, true)}
                    >
                      编辑
                    </button>
                  </div>
                  <pre className="library-prompt">
                    {selected!.prompt || "未填写"}
                  </pre>
                  <p className="inspector-note">
                    模板只有一段内容；用到哪一侧（正面或负面）在生成设置里选。
                  </p>
                  <div className="inspector-secondary">
                    <Button
                      small
                      icon="download"
                      onClick={() =>
                        download(
                          selected!.name + ".json",
                          JSON.stringify(selected, null, 2),
                        )
                      }
                    >
                      导出模板
                    </Button>
                    <Button
                      small
                      icon="trash"
                      onClick={() => setConfirmDelete(true)}
                    >
                      删除模板
                    </Button>
                  </div>
                </>
              )}
              {error && (
                <p className="library-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer>
              <ScrollHint target={inspectorBody} />
              {form ? (
                <>
                  <span className="inspector-note">
                    {dirty ? "有未保存的修改" : "填写后保存"}
                  </span>
                  <div className="actions">
                    <Button
                      disabled={busy}
                      onClick={() => safely(() => setForm(null))}
                    >
                      取消
                    </Button>
                    <Button
                      primary
                      disabled={busy || !form.name.trim()}
                      onClick={() => void save()}
                    >
                      {busy ? "保存中…" : "保存模板"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Button primary onClick={() => onApply(selected!, true)}>
                    追加到工作台
                  </Button>
                  <Button onClick={() => onApply(selected!, false)}>
                    替换工作台提示词
                  </Button>
                </>
              )}
            </footer>
          </aside>
        )}
      </div>
      {discard && (
        <LibraryDialog
          title="保留未保存的修改？"
          onClose={() => setDiscard(false)}
        >
          <div className="library-dialog-body">
            <p>当前模板还未保存，继续操作将放弃这些修改。</p>
            <div className="actions">
              <Button onClick={() => setDiscard(false)}>继续编辑</Button>
              <Button
                primary
                onClick={() => {
                  setDiscard(false);
                  pending.current?.();
                  pending.current = null;
                }}
              >
                放弃修改
              </Button>
            </div>
          </div>
        </LibraryDialog>
      )}
      {confirmDelete && selected && (
        <LibraryDialog
          title="删除模板"
          onClose={() => !busy && setConfirmDelete(false)}
        >
          <div className="library-dialog-body">
            <p>删除“{selected.name}”？已生成的作品和当前提示词不受影响。</p>
            {error && (
              <p role="alert" className="library-error">
                {error}
              </p>
            )}
            <div className="actions">
              <Button disabled={busy} onClick={() => setConfirmDelete(false)}>
                保留模板
              </Button>
              <Button
                primary
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    onChange(
                      await api(
                        "/templates/" + selected.id,
                        undefined,
                        "DELETE",
                      ),
                    );
                    setSelectedId(null);
                    setConfirmDelete(false);
                    setMessage("模板已删除");
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "删除中…" : "删除模板"}
              </Button>
            </div>
          </div>
        </LibraryDialog>
      )}
    </LibraryFrame>
  );
}
