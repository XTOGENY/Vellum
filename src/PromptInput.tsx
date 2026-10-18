// Inline chip/decorations/drag core ported from the reference PromptTextarea.tsx.
// Global app state and the old UI are replaced by this workbench's props.
import { useLayoutEffect, useRef } from "react";
import { EditorState, Compartment, Annotation } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  keymap,
  placeholder,
  tooltips,
} from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { highlightPrompt } from "./ported/prompt-highlight";
import { expandPromptChunks } from "../shared/prompt-tools.mjs";
import { api } from "./api";
import { normalizeTags } from "../shared/tag-suggestions.mjs";
type Chunk = { id: string; name: string; category: string; text: string };
type Props = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "value"
> & {
  value: string;
  onChange: (s: string) => void;
  chunks: Chunk[];
  connectionId: string;
  model: string;
};
const external = Annotation.define<boolean>();
export default function PromptInput(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView>(),
    latest = useRef(props),
    config = useRef(new Compartment()),
    dragSource = useRef<{ from: number; to: number; text: string } | null>(
      null,
    );
  latest.current = props;
  function extensions() {
    const { chunks, disabled } = latest.current;
    class ChunkWidget extends WidgetType {
      constructor(
        readonly name: string,
        readonly from: number,
        readonly to: number,
        readonly source: string,
      ) {
        super();
      }
      eq(other: ChunkWidget) {
        return (
          this.name === other.name &&
          this.from === other.from &&
          this.to === other.to &&
          this.source === other.source
        );
      }
      toDOM() {
        const chip = document.createElement("span"),
          c = chunks.find((c) => c.name === this.name);
        chip.className = "prompt-inline-chunk" + (c ? "" : " missing");
        chip.textContent = this.name;
        chip.setAttribute("role", "button");
        chip.setAttribute("aria-label", `片段 ${this.name}`);
        chip.tabIndex = disabled ? -1 : 0;
        chip.draggable = !disabled;
        chip.title = c
          ? `${c.text}\n双击展开为文本`
          : `找不到片段：${this.name}`;
        const expand = () => {
          if (latest.current.disabled) return;
          try {
            const text = expandPromptChunks(this.source, latest.current.chunks);
            view.current?.dispatch({
              changes: { from: this.from, to: this.to, insert: text },
              selection: { anchor: this.from + text.length },
            });
            view.current?.focus();
          } catch {}
        };
        chip.addEventListener("dblclick", (e) => {
          e.preventDefault();
          expand();
        });
        chip.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            expand();
          }
        });
        chip.addEventListener("dragstart", (e) => {
          dragSource.current = {
            from: this.from,
            to: this.to,
            text: this.source,
          };
          e.dataTransfer?.setData("text/plain", this.source);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
        });
        return chip;
      }
      ignoreEvent() {
        return true;
      }
    }
    const decorate = (v: EditorView) => {
      const text = v.state.doc.toString(),
        ranges = [];
      let from = 0;
      for (const part of highlightPrompt(text)) {
        const to = from + part.text.length;
        if (to > from && part.kind !== "plain")
          ranges.push(
            Decoration.mark({
              attributes: {
                "data-emphasis": part.kind,
                style: `background-color:color-mix(in srgb, ${part.kind === "high" ? "#ad4b31" : "#4d79ab"} ${part.opacity * 100}%, transparent)`,
              },
            }).range(from, to),
          );
        from = to;
      }
      for (const m of text.matchAll(
        /!macro:([^!\r\n]+)!|⌜macro:([^⌟\r\n]+)⌟/g,
      )) {
        const name =
          m[1] ?? chunks.find((c) => c.id === m[2])?.name ?? "缺失片段";
        ranges.push(
          Decoration.replace({
            widget: new ChunkWidget(
              name,
              m.index!,
              m.index! + m[0].length,
              m[0],
            ),
          }).range(m.index!, m.index! + m[0].length),
        );
      }
      return Decoration.set(ranges, true);
    };
    const decorated = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(v: EditorView) {
          this.decorations = decorate(v);
        }
        update(u: any) {
          if (u.docChanged) this.decorations = decorate(u.view);
        }
      },
      {
        decorations: (v) => v.decorations,
        provide: (plugin) =>
          EditorView.atomicRanges.of(
            (v) =>
              v.plugin(plugin)?.decorations.update({
                filter: (_from, _to, value) => !!value.spec.widget,
              }) ?? Decoration.none,
          ),
      },
    );
    return [
      decorated,
      tooltips({ parent: document.body }),
      EditorView.editable.of(!disabled),
      EditorState.readOnly.of(!!disabled),
      placeholder(latest.current.placeholder || ""),
      EditorView.contentAttributes.of({
        "aria-label": String(
          latest.current["aria-label"] ||
            latest.current.placeholder ||
            "提示词",
        ),
        "aria-multiline": "true",
        role: "textbox",
      }),
      autocompletion({
        override: [
          async (context) => {
            const word = context.matchBefore(/[^,\n!|]{2,}$/);
            if (
              !word ||
              !latest.current.connectionId ||
              word.text.includes("::")
            )
              return null;
            try {
              const p = latest.current,
                r = await api(
                  "/tags?" +
                    new URLSearchParams({
                      connectionId: p.connectionId,
                      model: p.model,
                      prompt: word.text.trim(),
                    }),
                );
              if (context.aborted) return null;
              const rows = normalizeTags(r);
              return {
                from: word.from,
                to: context.pos,
                options: rows.slice(0, 12).map((t: string) => ({
                  label: t,
                  apply: t,
                })),
              };
            } catch {
              return null;
            }
          },
        ],
        activateOnTyping: true,
      }),
    ];
  }
  function emphasize(v: EditorView, delta: number) {
    if (latest.current.disabled) return false;
    const value = v.state.doc.toString();
    let { from, to } = v.state.selection.main;
    if (from === to) {
      from = value.lastIndexOf(",", from - 1) + 1;
      const n = value.indexOf(",", to);
      to = n < 0 ? value.length : n;
    }
    const s = value.slice(from, to),
      m = s.match(/^\s*(-?[\d.]+)::([\s\S]*)::$/);
    const n = Math.round(((m ? +m[1] : 1) + delta) * 100) / 100,
      text = `${n}::${m ? m[2] : s.trim()}::`;
    v.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from, head: from + text.length },
    });
    return true;
  }
  useLayoutEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          EditorView.domEventHandlers({
            paste: (event) =>
              Array.from(event.clipboardData?.items || []).some(
                (i) => i.kind === "file" && i.type.startsWith("image/"),
              ),
            drop: (event, v) => {
              const source = dragSource.current;
              dragSource.current = null;
              const chunk = event.dataTransfer?.getData(
                "application/x-nwenai-chunk",
              );
              if (!source && !chunk) return false;
              if (latest.current.disabled) return true;
              const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              event.preventDefault();
              if (chunk) {
                v.dispatch({
                  changes: { from: pos, insert: chunk },
                  selection: { anchor: pos + chunk.length },
                });
                v.focus();
                return true;
              }
              if (source) {
                if (pos >= source.from && pos <= source.to) return true;
                const copy = event.ctrlKey || event.altKey;
                v.dispatch({
                  changes: copy
                    ? [{ from: pos, insert: source.text }]
                    : [
                        { from: source.from, to: source.to, insert: "" },
                        { from: pos, insert: source.text },
                      ].sort((a, b) => a.from - b.from),
                  selection: {
                    anchor:
                      pos +
                      source.text.length -
                      (!copy && pos > source.to ? source.to - source.from : 0),
                  },
                });
                v.focus();
                return true;
              }
              return false;
            },
            dragend: () => {
              dragSource.current = null;
            },
          }),
          history(),
          keymap.of([
            { key: "Mod-ArrowUp", run: (v) => emphasize(v, 0.05) },
            { key: "Mod-ArrowDown", run: (v) => emphasize(v, -0.05) },
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          config.current.of(extensions()),
          EditorView.updateListener.of((u) => {
            if (
              u.docChanged &&
              !u.transactions.some((t) => t.annotation(external))
            )
              latest.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value)
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: props.value },
        annotations: external.of(true),
      });
  }, [props.value]);
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: config.current.reconfigure(extensions()),
    });
  }, [
    props.chunks,
    props.disabled,
    props.connectionId,
    props.model,
    props.placeholder,
    props["aria-label"],
  ]);
  return (
    <div
      ref={host}
      className={`cm-prompt ${props.className || ""}`}
      style={props.style}
    />
  );
}
