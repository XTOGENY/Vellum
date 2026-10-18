import { useEffect, useRef, useState } from "react";
import { Icon, Select, Toggle } from "./ui";
import { categoryName, TEMPLATE_CATEGORIES } from "./LibraryUI";
import type { Params, Template } from "./types";
import { uniqueTemplates } from "../shared/prompt-composition.mjs";

type Side = "positive" | "negative";
type Item = { id: string; name: string; content: string; target?: string };

export default function TemplatePicker({
  params,
  templates,
  patch,
  side,
  onSideChange,
  query,
  onQueryChange,
  onManage,
}: {
  params: Params;
  templates: Template[];
  patch: (value: Partial<Params>) => void;
  side: Side;
  onSideChange: (side: Side) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onManage: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [feedback, setFeedback] = useState("");
  const selectedRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  useEffect(() => {
    const element = selectedRef.current;
    if (!element) return;
    const measure = () =>
      setCanScroll(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    Array.from(element.children).forEach((child) => observer.observe(child));
    measure();
    return () => observer.disconnect();
  }, [params.templates, side]);
  const stack: Item[] = Array.isArray(params.templates) ? params.templates : [];
  useEffect(() => {
    const unique = uniqueTemplates(stack);
    if (unique.length !== stack.length) patch({ templates: unique });
  }, [params.templates]);
  const targetOf = (item: Item) =>
    item.target === "negative" ? "negative" : "positive";
  const mine = stack.filter((item) => targetOf(item) === side);
  const count = (target: Side) =>
    stack.filter((item) => targetOf(item) === target).length;
  const sideName = side === "positive" ? "正面" : "负面";
  const list = templates.filter(
    (t) =>
      (filter === "all" ||
        (filter === "favorite"
          ? t.favorite
          : (t.category || "general") === filter)) &&
      `${t.name} ${t.prompt}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  function reorder(index: number, offset: number) {
    const positions = stack.flatMap((item, i) =>
      targetOf(item) === side ? [i] : [],
    );
    const from = positions[index],
      to = positions[index + offset];
    if (from === undefined || to === undefined) return;
    const next = [...stack];
    [next[from], next[to]] = [next[to], next[from]];
    patch({ templates: next });
    setFeedback(`${mine[index].name}已${offset < 0 ? "上移" : "下移"}`);
  }
  return (
    <div className="tpl-picker">
      <section className="tpl-current" aria-label="本次使用的模板">
        <Toggle
          label="参与本次生成"
          checked={!!params.templateEnabled}
          onChange={(templateEnabled) => patch({ templateEnabled })}
        />
        <div className="tpl-tabs" role="group" aria-label="模板写入目标">
          {(["positive", "negative"] as const).map((target) => (
            <button
              key={target}
              type="button"
              aria-pressed={side === target}
              onClick={() => {
                onSideChange(target);
                setFeedback("");
              }}
            >
              {target === "positive" ? "正面" : "负面"}
              <span>{count(target)}</span>
            </button>
          ))}
        </div>
        <div
          ref={selectedRef}
          className={`tpl-selected ${!params.templateEnabled ? "is-paused" : ""}`}
          aria-label={`已添加到${sideName}的模板`}
        >
          {!mine.length && (
            <p className="tpl-empty-copy">还没有{sideName}模板，从下方添加。</p>
          )}
          {mine.map((item, index) => (
            <div className="tpl-selected-row" key={`${item.id}-${index}`}>
              <span className="tpl-order">
                {String(index + 1).padStart(2, "0")}
              </span>
              <details className="tpl-content">
                <summary title={item.name}>{item.name}</summary>
                <p>{item.content || "模板内容为空"}</p>
              </details>
              <div className="tpl-row-actions">
                <button
                  type="button"
                  title={`上移 ${item.name}`}
                  aria-label={`上移 ${item.name}`}
                  disabled={index === 0}
                  onClick={() => reorder(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title={`下移 ${item.name}`}
                  aria-label={`下移 ${item.name}`}
                  disabled={index === mine.length - 1}
                  onClick={() => reorder(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  title={`移除 ${item.name}`}
                  aria-label={`移除 ${item.name}`}
                  onClick={() => {
                    let ownIndex = -1;
                    patch({
                      templates: stack.filter(
                        (t) => targetOf(t) !== side || ++ownIndex !== index,
                      ),
                    });
                    setFeedback(`已从${sideName}移除${item.name}`);
                  }}
                >
                  <Icon name="close" />
                </button>
              </div>
            </div>
          ))}
        </div>
        {(canScroll || (!params.templateEnabled && stack.length > 0)) && (
          <div className="tpl-selection-status">
            {" "}
            {canScroll && <small className="tpl-scroll-hint">↕ 滚动查看</small>}
            {!params.templateEnabled && stack.length > 0 && (
              <small className="tpl-paused">已暂停</small>
            )}
          </div>
        )}
        <div className="tpl-position-row">
          {side === "positive" ? (
            <>
              <span>合并顺序</span>
              <Select
                aria-label="正面模板合并顺序"
                value={params.templatePosition === "start" ? "start" : "end"}
                onChange={(e) =>
                  patch({ templatePosition: e.target.value as "start" | "end" })
                }
              >
                <option value="end">提示词 → 模板</option>
                <option value="start">模板 → 提示词</option>
              </Select>
            </>
          ) : (
            <small>追加在负面提示词后，顺序与上方一致。</small>
          )}
        </div>
      </section>
      <section className="tpl-library" aria-label="可添加的模板">
        <div className="tpl-library-title">
          <h3>添加到{sideName}</h3>
          <button type="button" className="text-link" onClick={onManage}>
            管理模板 ↗
          </button>
        </div>
        <div className="tpl-search-wrap">
          <Icon name="search" />
          <input
            aria-label="搜索模板"
            placeholder="搜索名称或模板内容"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="清空模板搜索"
              onClick={() => onQueryChange("")}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="tpl-filters" role="group" aria-label="模板筛选">
          {[
            ["all", "全部"],
            ["favorite", "收藏"],
            ...Object.entries(TEMPLATE_CATEGORIES).filter(([key]) =>
              templates.some((t) => (t.category || "general") === key),
            ),
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="tpl-library-list">
          {list.map((t) => {
            const added = stack.some((item) => item.id === t.id);
            const empty = !t.prompt?.trim();
            return (
              <button
                type="button"
                className="tpl-library-item"
                key={t.id}
                aria-label={`${t.name}，${added ? "已选中，点击取消" : empty ? "内容为空" : `添加到${sideName}`}`}
                aria-pressed={added}
                aria-disabled={empty && !added}
                title={t.prompt || "模板内容为空，请先编辑模板"}
                onClick={() => {
                  if (added) {
                    patch({
                      templates: stack.filter((item) => item.id !== t.id),
                    });
                    setFeedback(`已取消${t.name}`);
                    return;
                  }
                  if (empty) return;
                  patch({
                    templates: [
                      ...stack,
                      {
                        id: t.id,
                        name: t.name,
                        content: t.prompt,
                        target: side,
                      },
                    ],
                    templateEnabled: true,
                  });
                  setFeedback(`已将${t.name}添加到${sideName}`);
                }}
              >
                <span className="tpl-library-copy">
                  <b>
                    {added && <Icon name="check" />}
                    {t.name}
                  </b>
                  <small>
                    {t.prompt || `${categoryName(t.category)} · 内容为空`}
                  </small>
                </span>
              </button>
            );
          })}
          {!list.length && (
            <div className="tpl-library-empty">
              <p>{!templates.length ? "还没有模板" : "没有匹配的模板"}</p>
              {!templates.length ? (
                <button className="text-link" onClick={onManage}>
                  前往模板库创建
                </button>
              ) : (
                <button
                  className="text-link"
                  onClick={() => {
                    onQueryChange("");
                    setFilter("all");
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
        </div>
      </section>
      <span className="sr-only" role="status" aria-live="polite">
        {feedback}
      </span>
    </div>
  );
}
