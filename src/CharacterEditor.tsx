import { useEffect, useRef, useState, type CSSProperties } from "react";
import PromptInput from "./PromptInput";
import {
  characterGrid,
  snapCharacterPosition,
  stepCharacterCell,
  CHARACTER_GRID_CELLS,
} from "../shared/novelai.mjs";
import { Button, Icon } from "./ui";
import type { Character, Params } from "./types";
import "./character-editor.css";

// 位置描述跟着模型走：网格模型报「第几列第几行」，V5 连续坐标才用左右中。
export const characterPosition = (c: Character, mode: string, grid = 0) => {
  if (mode !== "custom") return "AI 自动安排";
  if (grid) {
    const index = (v: number) =>
      CHARACTER_GRID_CELLS.reduce(
        (best, cell, i) =>
          Math.abs(cell - v) < Math.abs(CHARACTER_GRID_CELLS[best] - v) ? i : best,
        0,
      );
    return `第 ${index(c.x) + 1} 列 · 第 ${index(c.y) + 1} 行`;
  }
  return c.x < 0.4 ? "画面左侧" : c.x > 0.6 ? "画面右侧" : "画面中央";
};
const coordinate = (v: number) =>
  +Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5)).toFixed(3);
type Props = {
  params: Params;
  selectedId: string;
  maxCharacters: number;
  medium: boolean;
  connectionId: string;
  onSelect: (id: string) => void;
  onUpdate: (id: string, values: Partial<Character>) => void;
  onPosition: (id: string, x: number, y: number) => void;
  onMode: (mode: string) => void;
  onCanvas: () => void;
  onMove: (id: string, direction: number) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
};
export default function CharacterEditor({
  params: p,
  selectedId,
  maxCharacters,
  medium,
  connectionId,
  onSelect,
  onUpdate,
  onPosition,
  onMode,
  onCanvas,
  onMove,
  onCopy,
  onDelete,
  onAdd,
}: Props) {
  const c = p.characters.find((c) => c.id === selectedId) || p.characters[0];
  const index = p.characters.findIndex((ch) => ch.id === c?.id);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null),
    moreRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    id: string;
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
    background: boolean;
  } | null>(null);
  useEffect(() => {
    setMenu(false);
  }, [c?.id]);
  useEffect(() => {
    drag.current = null;
  }, [p.model, p.positionMode]);
  useEffect(() => {
    if (!menu) return;
    const click = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenu(false);
        moreRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  const canPosition = !!maxCharacters && p.positionMode === "custom";
  // V4 / V4.5 官方限制在 5×5 网格；V5 是连续定位。
  const grid = characterGrid(p.model);
  const snap = (x: number, y: number) => snapCharacterPosition(p.model, x, y);
  const ratio = Math.max(
    0.1,
    Math.min(10, (p.width || 1024) / (p.height || 1024)),
  );
  const applyPointer = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const next = snap(
      coordinate((e.clientX - rect.left) / rect.width),
      coordinate((e.clientY - rect.top) / rect.height),
    );
    onPosition(id, next.x, next.y);
  };
  return (
    <div className="character-editor">
      <div className="role-switcher" aria-label="选择角色">
        {p.characters.map((ch, i) => (
          <button
            key={ch.id}
            className={ch.id === c?.id ? "selected" : ""}
            aria-pressed={ch.id === c?.id}
            onClick={() => onSelect(ch.id)}
            title={ch.name}
          >
            {String(i + 1).padStart(2, "0")} {ch.name || `角色 ${i + 1}`}
            {!ch.enabled ? " · 已停用" : ""}
          </button>
        ))}
      </div>
      <div className="role-editor-scroll">
        {!maxCharacters && (
          <p className="note">
            此模型不支持独立角色提示词，已有角色草稿仍保留。
          </p>
        )}
        {c ? (
          <>
            <div className="role-identity">
              <span className="role-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <input
                aria-label="角色名称"
                value={c.name}
                onChange={(e) => onUpdate(c.id, { name: e.target.value })}
              />
            </div>
            <div className="role-actions">
              <label className="role-enabled">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  disabled={
                    !maxCharacters ||
                    (!c.enabled &&
                      p.characters.filter((ch) => ch.enabled).length >=
                        maxCharacters)
                  }
                  title={
                    !c.enabled &&
                    p.characters.filter((ch) => ch.enabled).length >=
                      maxCharacters
                      ? "已达到当前模型的角色人数上限"
                      : undefined
                  }
                  onChange={(e) =>
                    onUpdate(c.id, { enabled: e.target.checked })
                  }
                />
                参与生成
              </label>
              <button
                className="role-icon"
                aria-label="角色上移"
                title="上移"
                disabled={index === 0}
                onClick={() => onMove(c.id, -1)}
              >
                ↑
              </button>
              <button
                className="role-icon"
                aria-label="角色下移"
                title="下移"
                disabled={index === p.characters.length - 1}
                onClick={() => onMove(c.id, 1)}
              >
                ↓
              </button>
              <div ref={menuRef} className="role-menu-anchor">
                <button
                  className="role-icon"
                  ref={moreRef}
                  aria-label="更多角色操作"
                  aria-expanded={menu}
                  onClick={() => setMenu(!menu)}
                >
                  ⋯
                </button>
                {menu && (
                  <div className="role-menu">
                    <button
                      disabled={p.characters.length >= 64 || !maxCharacters}
                      onClick={() => {
                        setMenu(false);
                        onCopy(c.id);
                      }}
                    >
                      复制角色
                    </button>
                  </div>
                )}
              </div>
              {/* 删除固定可见：不藏在 ⋯ 里，长名单里也能一眼找到。 */}
              <button
                type="button"
                className="role-delete"
                onClick={() => onDelete(c.id)}
              >
                删除角色
              </button>
            </div>
            <div className="role-pane">
              <span className="role-label">正面提示词</span>
              <PromptInput
                key={c.id + "-prompt"}
                aria-label="角色正面提示词"
                className="prompt-input role-prompt"
                chunks={p.promptChunks || []}
                connectionId={connectionId}
                model={p.model}
                rows={5}
                placeholder="描述这个角色：外观、服装、姿态…"
                value={c.prompt}
                onChange={(prompt) => onUpdate(c.id, { prompt })}
              />
              <div className="role-wordcount">
                {c.prompt.length.toLocaleString()} 字符
              </div>
              <details className="role-negative" key={c.id + "-negative"}>
                <summary>角色负面提示词</summary>
                {medium && (
                  <p className="note">
                    Medium 模式不支持自定义负面词，已有内容保留。
                  </p>
                )}
                <PromptInput
                  aria-label="角色负面提示词"
                  className="prompt-input role-negative-input"
                  chunks={p.promptChunks || []}
                  connectionId={connectionId}
                  model={p.model}
                  rows={4}
                  disabled={medium}
                  value={c.uc}
                  onChange={(uc) => onUpdate(c.id, { uc })}
                />
              </details>
            </div>
            <section className="role-position-block" aria-label="画面中的角色位置">
              <div className="role-position-head">
                <span className="role-label">画面中的角色位置</span>
                <span className="role-position-now">
                  {p.positionMode === "custom"
                    ? characterPosition(c, "custom", grid)
                    : "AI 自动安排"}
                </span>
              </div>
              <div className="role-mode">
                <button
                  aria-pressed={p.positionMode !== "custom"}
                  disabled={!maxCharacters}
                  onClick={() => onMode("ai")}
                >
                  AI 自动安排
                </button>
                <button
                  aria-pressed={p.positionMode === "custom"}
                  disabled={!maxCharacters}
                  onClick={() => onMode("custom")}
                >
                  指定位置
                </button>
              </div>
              {canPosition ? (
                <div className="role-canvas-entry">
                  <Button icon="grid" onClick={onCanvas}>
                    在画布中调整位置
                  </Button>
                  <span className="role-canvas-hint">
                    {grid > 0 ? "5 × 5 网格" : "连续坐标"} · 完成后回到作品
                  </span>
                </div>
              ) : (
                <p className="note">先选「指定位置」，才能在画布上摆放角色。</p>
              )}
            </section>
          </>
        ) : (
          <div className="role-empty">
            <p className="note">为不同人物分别填写描述。</p>
            <Button small icon="plus" disabled={!maxCharacters} onClick={onAdd}>
              添加角色
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
