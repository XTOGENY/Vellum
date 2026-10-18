import { useEffect, useId, useRef, useState } from "react";
import type { HistoryItem } from "./types";
import { Icon } from "./ui";
export default function RecentWorks({
  items,
  selectedId,
  onSelect,
}: {
  items: HistoryItem[];
  selectedId?: string;
  onSelect: (h: HistoryItem) => void;
}) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null),
    more = useRef<HTMLButtonElement>(null),
    rail = useRef<HTMLDivElement>(null),
    drag = useRef({ x: 0, scroll: 0, active: false, moved: false }),
    [edges, setEdges] = useState({ left: false, right: false }),
    [dragging, setDragging] = useState(false),
    [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setExpanded(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setExpanded(false);
        more.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [expanded]);
  const recent = items;
  function update() {
    const el = rail.current;
    if (el)
      setEdges({
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      });
  }
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const wheel = (e: WheelEvent) => {
      if (
        e.ctrlKey ||
        Math.abs(e.deltaX) >= Math.abs(e.deltaY) ||
        el.scrollWidth <= el.clientWidth
      )
        return;
      const amount =
        e.deltaMode === 1
          ? e.deltaY * 20
          : e.deltaMode === 2
            ? e.deltaY * el.clientWidth
            : e.deltaY;
      const next = Math.max(
        0,
        Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + amount),
      );
      if (next !== el.scrollLeft) {
        e.preventDefault();
        el.scrollLeft = next;
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, [items.length]);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const current = [...el.querySelectorAll<HTMLElement>("button")].find(
      (x) => x.dataset.id === selectedId,
    );
    current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
    update();
  }, [selectedId, items[0]?.id]);
  function scroll(direction: number) {
    const el = rail.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(120, el.clientWidth * 0.75),
      behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  function finish(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setTimeout(() => {
      drag.current.moved = false;
    }, 0);
  }
  return (
    <div className="filmstrip" ref={root}>
      {expanded && (
        <section
          id={panelId}
          className="recent-expanded"
          aria-label="本次打开后生成的图片"
        >
          <header>
            <h3>
              本次作品 <span>{items.length} 张</span>
            </h3>
            <button
              className="icon-btn"
              aria-label="收起本次图片"
              onClick={() => {
                setExpanded(false);
                more.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="recent-grid">
            {items.map((h, i) => (
              <button
                key={h.id}
                className={selectedId === h.id ? "active" : ""}
                aria-label={`查看本次图片 ${i + 1}`}
                aria-pressed={selectedId === h.id}
                onClick={() => {
                  onSelect(h);
                  setExpanded(false);
                  more.current?.focus();
                }}
              >
                <img
                  src={`/media/thumbs/${h.id}.webp`}
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (img.dataset.fallback) return;
                    img.dataset.fallback = "1";
                    img.src = h.url;
                  }}
                  alt={h.prompt || "生成图片"}
                  loading="lazy"
                  draggable={false}
                />
                <span className="recent-tile-caption">
                  <b>{String(i + 1).padStart(2, "0")}</b>
                  <span>
                    {h.width} × {h.height}
                  </span>
                  {selectedId === h.id && <Icon name="check" />}
                </span>
              </button>
            ))}
            {!items.length && (
              <p className="note">生成后的图片会出现在这里。</p>
            )}
          </div>
        </section>
      )}
      <div className="filmstrip-label">
        <span className="recent-label">
          最近作品 <span className="recent-count">{items.length}</span>
        </span>
        <div className="filmstrip-navigation">
          <button
            type="button"
            className="filmstrip-arrow previous"
            aria-label="向左浏览最近作品"
            disabled={!edges.left}
            onClick={() => scroll(-1)}
          >
            <Icon name="arrow" />
          </button>
          <button
            type="button"
            className="filmstrip-arrow"
            aria-label="向右浏览最近作品"
            disabled={!edges.right}
            onClick={() => scroll(1)}
          >
            <Icon name="arrow" />
          </button>
          <button
            ref={more}
            className="recent-more"
            aria-expanded={expanded}
            aria-controls={panelId}
            disabled={!items.length}
            onClick={() => setExpanded(!expanded)}
          >
            <Icon name="grid" />
            <span>{expanded ? "收起" : "更多"}</span>
            <svg
              className="recent-chevron"
              aria-hidden="true"
              viewBox="0 0 16 16"
            >
              <path d="m4 10 4-4 4 4" />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref={rail}
        className={`filmstrip-images ${dragging ? "is-dragging" : ""}`}
        role="region"
        aria-label="最近作品横向列表"
        tabIndex={recent.length ? 0 : undefined}
        onScroll={update}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            scroll(e.key === "ArrowRight" ? 1 : -1);
          }
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || e.button !== 0) return;
          drag.current = {
            x: e.clientX,
            scroll: e.currentTarget.scrollLeft,
            active: true,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d.active) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) > 5) {
            d.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }
          if (d.moved) {
            e.preventDefault();
            e.currentTarget.scrollLeft = d.scroll - dx;
          }
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={() => {
          drag.current.active = false;
          setDragging(false);
        }}
        onClickCapture={(e) => {
          if (drag.current.moved) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        {recent.map((h, i) => (
          <button
            key={h.id}
            data-id={h.id}
            className={selectedId === h.id ? "active" : ""}
            aria-label={`查看最近作品 ${i + 1}`}
            aria-pressed={selectedId === h.id}
            onClick={() => onSelect(h)}
          >
            <img
              src={`/media/thumbs/${h.id}.webp`}
              onError={(e) => {
                const img = e.currentTarget;
                if (img.dataset.fallback) return;
                img.dataset.fallback = "1";
                img.src = h.url;
              }}
              alt={h.prompt || "生成图片"}
              draggable={false}
              loading="lazy"
            />
            <span>{String(i + 1).padStart(2, "0")}</span>
          </button>
        ))}
        {!recent.length && (
          <span className="filmstrip-empty">
            本次打开后生成的作品会显示在这里
          </span>
        )}
      </div>
    </div>
  );
}
