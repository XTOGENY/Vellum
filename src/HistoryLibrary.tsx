import { useEffect, useState } from "react";
import { api, download } from "./api";
import { Button, Icon, Select } from "./ui";
import {
  LibraryFrame,
  LibraryDialog,
  LibraryEmpty,
  RailButton,
  dayKey,
  dateLabel,
  clockLabel,
} from "./LibraryUI";
import ArtworkDetails from "./ArtworkDetails";
import { MODELS_BY_NEWEST } from "../shared/novelai.mjs";
import { OPENAI_IMAGE_MODELS } from "../shared/image-models.mjs";
import type { Collection, HistoryItem, Params, Template } from "./types";

export default function HistoryLibrary({
  items,
  collections,
  onCollectionsChange,
  onUpdate,
  onUse,
  onError,
  onTemplatesChange,
}: {
  items: HistoryItem[];
  collections: Collection[];
  onCollectionsChange: (items: Collection[]) => void;
  onUpdate: (items: HistoryItem[]) => void;
  onUse: (p: Params) => void;
  onError: (message: string) => void;
  onTemplatesChange: (items: Template[]) => void;
}) {
  const [scope, setScope] = useState("all"),
    [search, setSearch] = useState(""),
    [model, setModel] = useState(""),
    [period, setPeriod] = useState("all"),
    [day, setDay] = useState(""),
    [collection, setCollection] = useState(""),
    [collectionDialog, setCollectionDialog] = useState<
      "" | "new" | "rename" | "assign"
    >(""),
    [collectionName, setCollectionName] = useState("");
  const [selectionMode, setSelectionMode] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(0),
    [viewId, setViewId] = useState<string | null>(null),
    [compare, setCompare] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [organizeError, setOrganizeError] = useState("");
  const [dateManager, setDateManager] = useState(false),
    [dateMonth, setDateMonth] = useState(""),
    [datePage, setDatePage] = useState(0),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState(""),
    [dateAction, setDateAction] = useState<{
      day: string;
      action: "archive" | "delete";
      ids: string[];
    } | null>(null),
    [dateError, setDateError] = useState(""),
    [dateProgress, setDateProgress] = useState(0);
  const allDates = [...new Set(items.map((h) => dayKey(h.createdAt)))]
    .sort()
    .reverse();
  const managedDates = allDates.filter(
    (d) => !dateMonth || d.startsWith(dateMonth),
  );
  const datePages = Math.max(1, Math.ceil(managedDates.length / 20));
  useEffect(() => {
    setDatePage((p) => Math.min(p, datePages - 1));
  }, [datePages]);
  function browseDay(value: string) {
    setScope(
      items.some((h) => !h.archivedAt && dayKey(h.createdAt) === value)
        ? "all"
        : "archived",
    );
    setDay(value);
    setPeriod("all");
    setCollection("");
    setSearch("");
    setModel("");
    setDateManager(false);
  }
  function prepareDateAction(value: string, action: "archive" | "delete") {
    setDateError("");
    setDateProgress(0);
    setDateAction({
      day: value,
      action,
      ids: items
        .filter(
          (h) =>
            dayKey(h.createdAt) === value &&
            (action === "delete" || !h.archivedAt),
        )
        .map((h) => h.id),
    });
  }
  async function runDateAction() {
    if (!dateAction || busy) return;
    setBusy(true);
    setDateError("");
    let remaining = [...dateAction.ids],
      completed = 0;
    try {
      // Reconcile retries when the server committed but its response was lost.
      const latest = await api<HistoryItem[]>("/history");
      onUpdate(latest);
      const pendingIds = new Set(
        latest
          .filter((h) => dateAction.action === "delete" || !h.archivedAt)
          .map((h) => h.id),
      );
      remaining = remaining.filter((id) => pendingIds.has(id));
      completed = dateAction.ids.length - remaining.length;
      while (remaining.length) {
        const batch = remaining.slice(0, 200);
        const updated = await api<HistoryItem[]>("/history/batch", {
          action: dateAction.action,
          ids: batch,
        });
        onUpdate(updated);
        remaining = remaining.slice(batch.length);
        completed += batch.length;
        setDateProgress(completed);
      }
      setDateAction(null);
      setSelected([]);
      setMessage(
        `${dateAction.day} 的 ${completed} 张作品已${dateAction.action === "delete" ? "删除" : "归档"}。`,
      );
    } catch (e) {
      setDateAction({ ...dateAction, ids: remaining });
      setDateError(
        `已完成 ${completed} 张，剩余 ${remaining.length} 张未完成：${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }
  const live = items.filter((h) => !h.archivedAt),
    dates = [...new Set(live.map((h) => dayKey(h.createdAt)))].sort().reverse(),
    activeCollection = collections.find((c) => c.id === collection),
    keyword = search.trim().toLowerCase();
  const modelOptions = [
    ...MODELS_BY_NEWEST.map((m) => ({ id: m.id, label: m.label })),
    ...OPENAI_IMAGE_MODELS.map((m) => ({ id: m.id, label: m.label })),
    ...items
      .map((h) => h.model)
      .filter((id): id is string => !!id)
      .filter(
        (id) =>
          !MODELS_BY_NEWEST.some((m) => m.id === id) &&
          !OPENAI_IMAGE_MODELS.some((m) => m.id === id),
      )
      .filter((id, index, list) => list.indexOf(id) === index)
      .map((id) => ({ id, label: id })),
  ];
  const filtered = items
    .filter((h) =>
      scope === "archived"
        ? !!h.archivedAt
        : !h.archivedAt && (scope !== "favorites" || h.favorite),
    )
    .filter((h) => !collection || (h.collections || []).includes(collection))
    .filter(
      (h) =>
        (!model || h.model === model) &&
        (!day || dayKey(h.createdAt) === day) &&
        (period === "all" ||
          (period === "custom"
            ? (!dateFrom || dayKey(h.createdAt) >= dateFrom) &&
              (!dateTo || dayKey(h.createdAt) <= dateTo)
            : Date.now() - Date.parse(h.createdAt) <
              Number(period) * 86400000)) &&
        (!keyword ||
          (h.searchText || [h.name, h.prompt, h.seed].join(" "))
            .toLowerCase()
            .includes(keyword)),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const pageSize = 48,
    pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    visible = filtered.slice(page * pageSize, (page + 1) * pageSize),
    days = [...new Set(visible.map((h) => dayKey(h.createdAt)))];
  const view = items.find((h) => h.id === viewId);
  useEffect(() => {
    setSelected([]);
    setPage(0);
    setCompare(false);
  }, [scope, search, model, period, day, collection, dateFrom, dateTo]);
  useEffect(() => {
    if (page >= pages) setPage(pages - 1);
    setSelected((ids) => ids.filter((id) => items.some((h) => h.id === id)));
  }, [items, pages, page]);
  function changePage(next: number) {
    setPage(next);
    setSelected([]);
    setCompare(false);
  }
  function changeScope(next: string) {
    setScope(next);
    setDay("");
    setCollection("");
  }
  async function organize(
    action: string,
    ids = selected,
    name?: string,
    collectionId?: string,
  ) {
    if (busy) return false;
    setBusy(true);
    setOrganizeError("");
    try {
      onUpdate(
        await api("/history/batch", { action, ids, name, collectionId }),
      );
      if (
        action === "archive" ||
        action === "restore" ||
        action === "delete" ||
        action === "collect" ||
        action === "uncollect"
      ) {
        setSelected([]);
        setCompare(false);
        setMessage(
          action === "archive"
            ? "作品已归档，可在已归档中恢复。"
            : action === "restore"
              ? "作品已恢复到作品库。"
              : action === "delete"
                ? "已删除所选作品，本地图片文件也一并删除了。"
                : action === "collect"
                  ? `已加入「${collections.find((c) => c.id === collectionId)?.name || "集合"}」。`
                  : "已移出集合，作品本身仍保留。",
        );
      }
      return true;
    } catch (e: any) {
      setOrganizeError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function openNewCollection() {
    setCollectionName("");
    setCollectionDialog("new");
  }
  function openRenameCollection() {
    if (!activeCollection) return;
    setCollectionName(activeCollection.name);
    setCollectionDialog("rename");
  }
  async function saveCollection(assign: boolean) {
    const name = collectionName.trim();
    if (!name || busy) return;
    setBusy(true);
    setOrganizeError("");
    try {
      if (collectionDialog === "rename" && activeCollection) {
        const r = await api<{
          collections: Collection[];
          history?: HistoryItem[];
        }>("/collections/" + activeCollection.id, { name }, "POST");
        onCollectionsChange(r.collections);
        if (r.history) onUpdate(r.history);
        setMessage("集合已重命名。");
      } else {
        const r = await api<{
          collections: Collection[];
          collection: Collection;
        }>("/collections", { name }, "POST");
        onCollectionsChange(r.collections);
        if (assign && selected.length) {
          onUpdate(
            await api("/history/batch", {
              action: "collect",
              ids: selected,
              collectionId: r.collection.id,
            }),
          );
          setSelected([]);
          setMessage(`已加入「${r.collection.name}」。`);
        } else {
          setMessage(`已创建集合「${r.collection.name}」。`);
        }
      }
      setCollectionDialog("");
      setCollectionName("");
    } catch (e: any) {
      setOrganizeError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteCollection() {
    if (!activeCollection || busy) return;
    if (
      !window.confirm(
        `删除集合「${activeCollection.name}」？作品本身不会被删除。`,
      )
    )
      return;
    setBusy(true);
    setOrganizeError("");
    try {
      const r = await api<{
        collections: Collection[];
        history: HistoryItem[];
      }>("/collections/" + activeCollection.id, undefined, "DELETE");
      onCollectionsChange(r.collections);
      onUpdate(r.history);
      setCollection("");
      setMessage("集合已删除，作品仍在全部作品里。");
    } catch (e: any) {
      setOrganizeError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function exportSelected() {
    setBusy(true);
    try {
      const r = await fetch("/api/history/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NWENAI-Request": "1",
        },
        body: JSON.stringify({ ids: selected }),
      });
      if (!r.ok) throw Error((await r.json()).error);
      download("Vellum-images.zip", await r.blob(), "application/zip");
      setMessage(`已打包 ${selected.length} 张作品`);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const title = activeCollection
    ? activeCollection.name
    : day
      ? `${day} ${scope === "archived" ? "· 已归档" : ""}`
      : scope === "favorites"
        ? "我的收藏"
        : scope === "archived"
          ? "已归档"
          : "全部作品";
  const rail = (
    <>
      <div className="rail-title">
        <Icon name="history" />
        <h1>历史记录</h1>
      </div>
      <p className="rail-caption">找回作品，继续创作。</p>
      <nav aria-label="作品集合">
        <RailButton
          active={scope === "all" && !day && !collection}
          count={live.length}
          onClick={() => changeScope("all")}
          icon="grid"
        >
          全部作品
        </RailButton>
        <RailButton
          active={scope === "favorites"}
          count={live.filter((h) => h.favorite).length}
          onClick={() => changeScope("favorites")}
          icon="star"
        >
          我的收藏
        </RailButton>
        <RailButton
          active={scope === "archived"}
          count={items.length - live.length}
          onClick={() => changeScope("archived")}
          icon="archive"
        >
          已归档
        </RailButton>
      </nav>
      <div className="rail-divider" />
      <p className="rail-group-title">集合</p>
      {!!collections.length && (
        <nav aria-label="按集合浏览">
          {collections.map((c) => (
            <RailButton
              key={c.id}
              active={collection === c.id}
              count={
                items.filter((h) => (h.collections || []).includes(c.id)).length
              }
              onClick={() => {
                setScope("all");
                setDay("");
                setCollection(c.id);
              }}
            >
              {c.name}
            </RailButton>
          ))}
        </nav>
      )}
      <button type="button" className="rail-add" onClick={openNewCollection}>
        <Icon name="plus" />
        新建集合
      </button>
      {!!dates.length && (
        <>
          <div className="rail-divider" />
          <p className="rail-group-title">最近日期</p>
          <nav aria-label="按日期浏览">
            {dates.slice(0, 8).map((d) => (
              <RailButton
                key={d}
                active={day === d}
                count={live.filter((h) => dayKey(h.createdAt) === d).length}
                onClick={() => browseDay(d)}
              >
                {dateLabel(d + "T12:00:00+08:00")}
              </RailButton>
            ))}
          </nav>
        </>
      )}
      {!!allDates.length && (
        <button
          type="button"
          className="rail-add"
          onClick={() => setDateManager(true)}
        >
          <Icon name="history" />
          全部日期 · {allDates.length}
        </button>
      )}
      <div className="rail-bottom">
        <Icon name="history" />
        <p>图片与生成设置自动保存在本机。</p>
      </div>
    </>
  );
  return (
    <LibraryFrame rail={rail} className="history-library">
      <header className="library-heading">
        <div>
          <h2>{title}</h2>
          <p>
            {activeCollection
              ? "这个集合里的作品；可随时移出，作品本身不会删除。"
              : "找回喜欢的画面，连同当时的设置一起复用。"}
          </p>
        </div>
        <div className="history-heading-actions">
          {day && (
            <Button
              small
              onClick={() => {
                setDateMonth(day.slice(0, 7));
                setDatePage(0);
                setDateManager(true);
              }}
            >
              管理日期
            </Button>
          )}
          <Button
            onClick={() => {
              setSelectionMode(!selectionMode);
              setSelected([]);
            }}
          >
            {selectionMode ? "退出多选" : "批量选择"}
          </Button>
          {activeCollection && (
            <details
              className="collection-actions"
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.open = false;
              }}
            >
              <summary aria-label="集合操作">⋯</summary>
              <div className="collection-actions-menu">
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    openRenameCollection();
                  }}
                >
                  重命名
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    void deleteCollection();
                  }}
                >
                  删除集合
                </button>
              </div>
            </details>
          )}
        </div>
      </header>
      <div className="library-toolbar">
        <div className="library-search">
          <Icon name="search" />
          <input
            aria-label="搜索历史"
            placeholder="搜索名称、提示词、负面词、角色、模板或连接…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="icon-btn"
              aria-label="清除历史搜索"
              onClick={() => setSearch("")}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        <Select
          aria-label="筛选历史模型"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">全部模型</option>
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="筛选历史时间"
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setDay("");
          }}
        >
          <option value="all">全部时间</option>
          <option value="1">最近 24 小时</option>
          <option value="7">最近 7 天</option>
          <option value="30">最近 30 天</option>
          <option value="custom">自定义日期范围</option>
        </Select>
      </div>
      {period === "custom" && (
        <div className="history-date-range">
          <label>
            开始日期
            <input
              type="date"
              aria-label="开始日期"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <span>—</span>
          <label>
            结束日期
            <input
              type="date"
              aria-label="结束日期"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          {dateFrom && dateTo && dateFrom > dateTo && (
            <span role="alert">开始日期不能晚于结束日期</span>
          )}
        </div>
      )}
      <div className="library-result-line">
        <span>
          {filtered.length} 张作品
          {(search || model || period !== "all" || day || collection) && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setSearch("");
                setModel("");
                setPeriod("all");
                setDay("");
                setCollection("");
              }}
            >
              清除筛选
            </button>
          )}
        </span>
        <span>按生成时间 · 最新在前</span>
      </div>
      {organizeError && (
        <p className="library-error" role="alert">
          {organizeError}
        </p>
      )}
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
      <div className="library-scroll gallery-scroll">
        {!visible.length ? (
          <LibraryEmpty
            title={
              keyword || model || period !== "all" || day
                ? "没有匹配的作品"
                : activeCollection
                  ? "这个集合还是空的"
                  : scope === "favorites"
                    ? "把喜欢的作品留在这里"
                    : scope === "archived"
                      ? "暂时没有归档作品"
                      : "第一张作品，等你开始"
            }
          >
            {scope === "archived"
              ? "归档作品可以随时恢复，不会删除图片文件。"
              : keyword
                ? "换个关键词，或清除筛选再试一次。"
                : activeCollection
                  ? "在全部作品里点「批量选择」，选中后点「加入集合」。"
                  : scope === "favorites"
                    ? "点击作品上的星标，之后能在这里快速找到。"
                    : "生成完成后，图片与设置会自动出现在这里。"}
          </LibraryEmpty>
        ) : (
          days.map((d) => (
            <section className="gallery-day" key={d}>
              <div className="gallery-day-heading">
                <h3>{dateLabel(d + "T12:00:00+08:00")}</h3>
                <span>
                  {visible.filter((h) => dayKey(h.createdAt) === d).length} 张
                </span>
              </div>
              <div className="artwork-grid">
                {visible
                  .filter((h) => dayKey(h.createdAt) === d)
                  .map((h) => (
                    <article
                      className={`artwork-tile ${selected.includes(h.id) ? "is-selected" : ""}`}
                      key={h.id}
                    >
                      <button
                        type="button"
                        className="artwork-thumbnail"
                        aria-label={`${selectionMode ? "选择作品" : "查看作品"} ${h.name || clockLabel(h.createdAt)}`}
                        onClick={() =>
                          selectionMode
                            ? setSelected((ids) =>
                                ids.includes(h.id)
                                  ? ids.filter((id) => id !== h.id)
                                  : [...ids, h.id],
                              )
                            : setViewId(h.id)
                        }
                      >
                        <img
                          loading="lazy"
                          src={`/media/thumbs/${h.id}.webp`}
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (img.dataset.fallback) return;
                            img.dataset.fallback = "1";
                            img.src = h.url;
                          }}
                          alt={h.name || h.prompt || "生成作品"}
                        />
                      </button>
                      {selectionMode && (
                        <input
                          className="artwork-checkbox"
                          type="checkbox"
                          aria-label={`选择作品 ${h.id}`}
                          checked={selected.includes(h.id)}
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, h.id]
                                : ids.filter((id) => id !== h.id),
                            )
                          }
                        />
                      )}
                      <button
                        type="button"
                        className={`favorite-button icon-btn ${h.favorite ? "is-favorite" : ""}`}
                        aria-label={`${h.favorite ? "取消收藏作品" : "收藏作品"} ${h.name || h.id}`}
                        disabled={busy}
                        onClick={() =>
                          void organize(
                            h.favorite ? "unfavorite" : "favorite",
                            [h.id],
                          )
                        }
                      >
                        <Icon name="star" />
                      </button>
                      <div className="artwork-tile-caption">
                        <b>{h.name || clockLabel(h.createdAt) + " 的作品"}</b>
                        <span>
                          {modelOptions.find((m) => m.id === h.model)?.label ||
                            h.model ||
                            "图像处理"}{" "}
                          <i>·</i> {h.width} × {h.height}
                        </span>
                      </div>
                    </article>
                  ))}
              </div>
            </section>
          ))
        )}
        {pages > 1 && (
          <div className="library-pagination">
            <span>
              第 {page + 1} / {pages} 页
            </span>
            <Button disabled={!page} onClick={() => changePage(page - 1)}>
              上一页
            </Button>
            <Button
              disabled={page >= pages - 1}
              onClick={() => changePage(page + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </div>
      {selectionMode && (
        <div className="selection-bar" aria-label="作品批量操作">
          <label>
            <input
              type="checkbox"
              aria-label="选择本页作品"
              checked={
                visible.length > 0 &&
                visible.every((h) => selected.includes(h.id))
              }
              onChange={(e) =>
                setSelected(e.target.checked ? visible.map((h) => h.id) : [])
              }
            />
            本页 {visible.length} 张
          </label>
          <b>已选 {selected.length} 张</b>
          <span className="grow" />
          {selected.length === 2 && (
            <Button disabled={busy} onClick={() => setCompare(true)}>
              两图对照
            </Button>
          )}
          <Button
            disabled={!selected.length || busy}
            onClick={() => {
              setCollectionName("");
              setCollectionDialog("assign");
            }}
          >
            加入集合…
          </Button>
          {activeCollection && (
            <Button
              disabled={!selected.length || busy}
              onClick={() =>
                void organize("uncollect", selected, undefined, collection)
              }
            >
              移出「{activeCollection.name}」
            </Button>
          )}
          <Button
            disabled={!selected.length || busy}
            onClick={() =>
              void organize(scope === "archived" ? "restore" : "archive")
            }
          >
            {scope === "archived" ? "恢复所选" : "归档所选"}
          </Button>
          {scope === "archived" && (
            <Button
              disabled={!selected.length || busy}
              onClick={() => {
                if (
                  window.confirm(
                    "删除所选作品？本地图片文件也会一并删除，无法恢复。",
                  )
                )
                  void organize("delete");
              }}
            >
              删除所选
            </Button>
          )}
          <Button
            primary
            icon="download"
            disabled={!selected.length || busy}
            onClick={() => void exportSelected()}
          >
            {busy ? "处理中…" : "下载所选 ZIP"}
          </Button>
        </div>
      )}
      {view && (
        <ArtworkDetails
          item={view}
          neighbors={filtered}
          onNavigate={(h) => setViewId(h.id)}
          onClose={() => setViewId(null)}
          onUse={(p) => {
            setViewId(null);
            onUse(p);
          }}
          onOrganize={organize}
          operationError={organizeError}
          onTemplatesChange={onTemplatesChange}
        />
      )}
      {compare && selected.length === 2 && (
        <LibraryDialog
          title="两图对照"
          className="compare-dialog"
          onClose={() => setCompare(false)}
        >
          <div className="compare-images">
            {selected.map((id) => {
              const h = items.find((h) => h.id === id)!;
              return (
                <figure key={id}>
                  <img src={h.url} alt={h.name || "对照作品"} />
                  <figcaption>
                    <b>{h.name || clockLabel(h.createdAt)}</b>
                    <span>
                      {h.width} × {h.height} · Seed {h.seed ?? "未知"}
                    </span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </LibraryDialog>
      )}
      {dateManager && !dateAction && (
        <LibraryDialog
          title="全部日期"
          onClose={() => !busy && setDateManager(false)}
          className="history-date-dialog"
        >
          <div className="library-dialog-body history-dates-body">
            <div className="history-date-toolbar">
              <label>
                按月份查找
                <input
                  type="month"
                  aria-label="按月份查找"
                  value={dateMonth}
                  onChange={(e) => {
                    setDateMonth(e.target.value);
                    setDatePage(0);
                  }}
                />
              </label>
              <Button
                small
                onClick={() => {
                  setDateMonth("");
                  setDatePage(0);
                }}
              >
                全部月份
              </Button>
              <span>{managedDates.length} 个日期</span>
            </div>
            <p className="note">
              按生成日期整理，包含全部集合与已归档作品。归档保留图片；删除会永久移除作品和本地图片。
            </p>
            <div className="history-date-list">
              {managedDates
                .slice(datePage * 20, (datePage + 1) * 20)
                .map((d) => {
                  const records = items.filter(
                      (h) => dayKey(h.createdAt) === d,
                    ),
                    active = records.filter((h) => !h.archivedAt).length;
                  return (
                    <div className="history-date-row" key={d}>
                      <button
                        type="button"
                        className="history-date-name"
                        onClick={() => browseDay(d)}
                      >
                        <b>{d}</b>
                        <small>
                          {records.length} 张 · {records.length - active}{" "}
                          张已归档
                        </small>
                      </button>
                      <Button
                        small
                        disabled={!active || busy}
                        onClick={() => prepareDateAction(d, "archive")}
                      >
                        归档
                      </Button>
                      <Button
                        small
                        disabled={busy}
                        onClick={() => prepareDateAction(d, "delete")}
                      >
                        删除…
                      </Button>
                    </div>
                  );
                })}
              {!managedDates.length && (
                <p className="note">这个月份没有作品。</p>
              )}
            </div>
            <div className="history-date-pagination">
              <Button
                small
                disabled={!datePage}
                onClick={() => setDatePage((p) => p - 1)}
              >
                上一页
              </Button>
              <span>
                {datePage + 1} / {datePages}
              </span>
              <Button
                small
                disabled={datePage >= datePages - 1}
                onClick={() => setDatePage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </LibraryDialog>
      )}
      {dateAction && (
        <LibraryDialog
          title={
            dateAction.action === "delete" ? "删除当天作品" : "归档当天作品"
          }
          onClose={() => !busy && setDateAction(null)}
        >
          <div className="library-dialog-body collection-dialog">
            <p>
              <b>{dateAction.day}</b> · 共 {dateAction.ids.length} 张作品
            </p>
            <p className="note">
              {dateAction.action === "delete"
                ? "将永久删除这一天在全部集合中的作品，包括已归档作品及其本地图片，无法撤销。"
                : "将归档这一天的未归档作品，图片与生成设置保留，可在「已归档」中恢复。"}
            </p>
            {dateError && (
              <p role="alert" className="library-error">
                {dateError}
              </p>
            )}
            {busy && <p role="status">已处理 {dateProgress} 张，请稍候…</p>}
            <div className="actions">
              <Button disabled={busy} onClick={() => setDateAction(null)}>
                取消
              </Button>
              <Button
                primary
                disabled={busy || !dateAction.ids.length}
                onClick={() => void runDateAction()}
              >
                {busy
                  ? "处理中…"
                  : dateAction.action === "delete"
                    ? `确认删除 ${dateAction.ids.length} 张`
                    : `确认归档 ${dateAction.ids.length} 张`}
              </Button>
            </div>
          </div>
        </LibraryDialog>
      )}
      {(collectionDialog === "new" || collectionDialog === "rename") && (
        <LibraryDialog
          title={collectionDialog === "rename" ? "重命名集合" : "新建集合"}
          onClose={() => setCollectionDialog("")}
        >
          <div className="library-dialog-body collection-dialog">
            <label className="field">
              <span>集合名称</span>
              <input
                autoFocus
                maxLength={40}
                value={collectionName}
                placeholder="例如：赛博朋克、客户 A、待修"
                onChange={(e) => setCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveCollection(false);
                  }
                }}
              />
            </label>
            <div className="actions">
              <Button onClick={() => setCollectionDialog("")}>取消</Button>
              <Button
                primary
                disabled={!collectionName.trim() || busy}
                onClick={() => void saveCollection(false)}
              >
                {collectionDialog === "rename" ? "保存名称" : "创建"}
              </Button>
            </div>
          </div>
        </LibraryDialog>
      )}
      {collectionDialog === "assign" && (
        <LibraryDialog title="加入集合" onClose={() => setCollectionDialog("")}>
          <div className="library-dialog-body collection-dialog">
            <p className="note">已选 {selected.length} 张作品。</p>
            <div className="collection-list">
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="collection-option"
                  disabled={busy}
                  onClick={async () => {
                    setCollectionDialog("");
                    await organize("collect", selected, undefined, c.id);
                  }}
                >
                  <span>{c.name}</span>
                  <small>
                    {
                      items.filter((h) => (h.collections || []).includes(c.id))
                        .length
                    }{" "}
                    张
                  </small>
                </button>
              ))}
              {!collections.length && (
                <p className="note">还没有集合，先在下边建一个。</p>
              )}
            </div>
            <div className="collection-new">
              <input
                maxLength={40}
                value={collectionName}
                placeholder="新集合名称"
                onChange={(e) => setCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveCollection(true);
                  }
                }}
              />
              <Button
                small
                disabled={!collectionName.trim() || busy}
                onClick={() => void saveCollection(true)}
              >
                新建并加入
              </Button>
            </div>
          </div>
        </LibraryDialog>
      )}
    </LibraryFrame>
  );
}
