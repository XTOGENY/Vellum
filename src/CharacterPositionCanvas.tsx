import { useEffect, useRef, type CSSProperties } from "react";
import { Button } from "./ui";
import type { Character, Params } from "./types";
import { CHARACTER_GRID_CELLS, snapCharacterPosition, stepCharacterCell } from "../shared/novelai.mjs";
import "./character-position.css";

// 中央定位画布：画布占满工作区，顶栏只做角色切换，完成按钮固定在右下。
type Props = {
  params: Params;
  selectedId: string;
  grid: number;
  onSelect: (id: string) => void;
  onPosition: (id: string, x: number, y: number) => void;
  onDone: () => void;
};

const clamp01 = (v: number) =>
  Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5));

export default function CharacterPositionCanvas({
  params: p,
  selectedId,
  grid,
  onSelect,
  onPosition,
  onDone,
}: Props) {
  const current = p.characters.find((c) => c.id === selectedId) || p.characters[0];
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointer: number; moved: boolean } | null>(null);
  const ratio = Math.max(0.1, Math.min(10, (p.width || 1024) / (p.height || 1024)));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!current) return;
      const move: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (e.key === "Escape") {
        e.preventDefault();
        onDone();
        return;
      }
      if (!move[e.key]) return;
      e.preventDefault();
      const [dx, dy] = move[e.key];
      const next = grid
        ? { x: stepCharacterCell(current.x, dx), y: stepCharacterCell(current.y, dy) }
        : snapCharacterPosition(
            p.model,
            clamp01(current.x + dx * (e.shiftKey ? 0.1 : 0.01)),
            clamp01(current.y + dy * (e.shiftKey ? 0.1 : 0.01)),
          );
      onPosition(current.id, next.x, next.y);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [current, grid, onDone, onPosition, p.model]);

  const pointAt = (clientX: number, clientY: number) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return null;
    return snapCharacterPosition(
      p.model,
      clamp01((clientX - rect.left) / rect.width),
      clamp01((clientY - rect.top) / rect.height),
    );
  };

  // 同一格里有多人时：从当前选中往下轮换，反复点同一个编号也能切换。
  function pickInCell(list: Character[], id: string) {
    if (!list.length) return;
    const active = list.findIndex((c) => c.id === current?.id);
    const next =
      active >= 0
        ? (active + 1) % list.length
        : Math.max(0, list.findIndex((c) => c.id === id));
    onSelect(list[next].id);
  }

  return (
    <div className="position-mode" role="dialog" aria-label="角色定位">
      <header className="position-head">
        <span className="position-mode-badge">定位模式</span>
        <div className="position-chips" role="tablist" aria-label="选择角色">
          {p.characters.map((c, i) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === current?.id}
              className={`position-chip ${c.id === current?.id ? "active" : ""} ${!c.enabled ? "inactive" : ""}`}
              onClick={() => onSelect(c.id)}
              title={c.name || `角色 ${i + 1}`}
            >
              <b>{String(i + 1).padStart(2, "0")}</b>
              <span>{c.name || `角色 ${i + 1}`}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="position-stage-wrap">
        <div
          ref={stage}
          className={`position-stage ${grid ? "grid-5" : "free"}`}
          style={{ "--position-ratio": ratio } as CSSProperties}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.pointer !== e.pointerId) return;
            d.moved = true;
            const next = pointAt(e.clientX, e.clientY);
            if (next) onPosition(d.id, next.x, next.y);
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            if (!d || d.pointer !== e.pointerId) return;
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          {grid > 0 &&
            CHARACTER_GRID_CELLS.map((y) =>
              CHARACTER_GRID_CELLS.map((x) => {
                const owners = p.characters.filter((c) => c.x === x && c.y === y);
                const isCurrent = owners.some((c) => c.id === current?.id);
                return (
                  <button
                    key={`${x}-${y}`}
                    type="button"
                    tabIndex={-1}
                    className={`position-cell ${isCurrent ? "active" : ""} ${owners.length ? "occupied" : ""}`}
                    style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                    aria-label={`第 ${Math.round(x * 5)} 列 第 ${Math.round(y * 5)} 行`}
                    onClick={() => {
                      if (!current) return;
                      onPosition(current.id, x, y);
                    }}
                  />
                );
              }),
            )}
          {p.characters.map((c, i) => {
            const same = p.characters.filter((x) => x.x === c.x && x.y === c.y);
            const order = same.findIndex((x) => x.id === c.id);
            const spread = same.length > 1 ? (order - (same.length - 1) / 2) * 26 : 0;
            return (
              <button
                key={c.id}
                type="button"
                data-character={c.id}
                className={`position-pin ${c.id === current?.id ? "active" : ""} ${!c.enabled ? "inactive" : ""}`}
                style={{
                  left: `${c.x * 100}%`,
                  top: `${c.y * 100}%`,
                  marginLeft: spread,
                }}
                aria-label={`${c.name || `角色 ${i + 1}`}的位置`}
                aria-pressed={c.id === current?.id}
                onClick={() => {
                  if (same.length > 1) pickInCell(same, c.id);
                  else onSelect(c.id);
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  drag.current = { id: c.id, pointer: e.pointerId, moved: false };
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d || d.pointer !== e.pointerId || d.id !== c.id) return;
                  d.moved = true;
                  const next = pointAt(e.clientX, e.clientY);
                  if (next) onPosition(d.id, next.x, next.y);
                }}
                onPointerUp={(e) => {
                  const d = drag.current;
                  if (d && d.pointer === e.pointerId && !d.moved) onSelect(d.id);
                  drag.current = null;
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </button>
            );
          })}
        </div>
      </div>

      <footer className="position-foot">
        <span className="position-hint">
          {grid
            ? "5 × 5 网格 · 点格子放置，拖编号微调，方向键走一格"
            : "连续坐标 · 拖编号或点画布摆放，方向键微调"}
        </span>
        <details className="position-advanced">
          <summary>精确坐标</summary>
          <div className="position-coords">
            {(["x", "y"] as const).map((key) => (
              <label key={key}>
                {key.toUpperCase()}
                <input
                  type="number"
                  min="0"
                  max="1"
                  step={grid ? "0.2" : "0.01"}
                  aria-label={`角色 ${key.toUpperCase()} 坐标`}
                  value={current ? current[key] : 0.5}
                  disabled={!current}
                  onChange={(e) => {
                    if (!current) return;
                    if (!e.target.value || !Number.isFinite(e.target.valueAsNumber)) return;
                    const next = snapCharacterPosition(
                      p.model,
                      key === "x" ? e.target.valueAsNumber : current.x,
                      key === "y" ? e.target.valueAsNumber : current.y,
                    );
                    onPosition(current.id, next.x, next.y);
                  }}
                />
              </label>
            ))}
          </div>
        </details>
        <Button small primary className="position-done" onClick={onDone}>
          完成定位
        </Button>
      </footer>
    </div>
  );
}
