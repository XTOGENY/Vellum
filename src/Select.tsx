import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

export const FieldLabelContext = createContext("");
type Option = {
  value: string;
  label: string;
  disabled: boolean;
  group: string;
};
type Props = {
  value?: string | number;
  onChange?: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  id?: string;
  title?: string;
};
function plain(node: ReactNode): string {
  return Children.toArray(node)
    .map((x) =>
      isValidElement<{ children?: ReactNode }>(x)
        ? plain(x.props.children)
        : String(x),
    )
    .join("");
}
export function Select({
  value,
  onChange,
  disabled = false,
  children,
  className = "",
  ...rest
}: Props) {
  const fieldLabel = useContext(FieldLabelContext),
    uid = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    search = useRef({ text: "", time: 0 });
  // 支持 <optgroup>：选项按分组收集，分组标题只用于显示，不参与键盘选择。
  const options = useMemo(() => {
    const list: Option[] = [];
    const take = (
      node: React.ReactElement<{
        value?: string | number;
        children: ReactNode;
        disabled?: boolean;
      }>,
      group: string,
    ) => {
      const label = plain(node.props.children);
      list.push({
        value: String(node.props.value ?? label),
        label,
        disabled: !!node.props.disabled,
        group,
      });
    };
    Children.toArray(children)
      .filter(isValidElement)
      .forEach((node) => {
        const e = node as React.ReactElement<{
          label?: string;
          children: ReactNode;
        }>;
        if (e.type === "optgroup") {
          const group = String(e.props.label ?? "");
          Children.toArray(e.props.children)
            .filter(isValidElement)
            .forEach((child) =>
              take(
                child as React.ReactElement<{
                  value?: string | number;
                  children: ReactNode;
                  disabled?: boolean;
                }>,
                group,
              ),
            );
        } else
          take(
            node as React.ReactElement<{
              value?: string | number;
              children: ReactNode;
              disabled?: boolean;
            }>,
            "",
          );
      });
    return list;
  }, [children]);
  const selected = options.findIndex((o) => o.value === String(value)),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [position, setPosition] = useState<CSSProperties>({});
  const label = rest["aria-label"] || fieldLabel || "选择选项";
  function place() {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = innerHeight - r.bottom - 10,
      above = r.top - 10,
      up = below < Math.min(220, options.length * 34 + 10) && above > below,
      width = Math.min(Math.max(r.width, 120), innerWidth - 16),
      left = r.width < 120 ? r.right - width : r.left;
    setPosition({
      left: Math.max(8, Math.min(left, innerWidth - width - 8)),
      width,
      maxHeight: Math.max(80, Math.min(304, up ? above : below)),
      ...(up ? { bottom: innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }
  function show() {
    if (disabled || !options.length) return;
    setActive(
      selected >= 0
        ? selected
        : Math.max(
            0,
            options.findIndex((x) => !x.disabled),
          ),
    );
    place();
    setOpen(true);
  }
  function choose(index: number) {
    const o = options[index];
    if (!o || o.disabled) return;
    onChange?.({ target: { value: o.value } });
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  function move(delta: number) {
    let next = active;
    for (let i = 0; i < options.length; i++) {
      next = (next + delta + options.length) % options.length;
      if (!options[next].disabled) {
        setActive(next);
        return;
      }
    }
  }
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !menu.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const scroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const blur = () => {
      if (
        !trigger.current?.contains(document.activeElement) &&
        !menu.current?.contains(document.activeElement)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", blur);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", blur);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  function key(e: KeyboardEvent) {
    if (
      ["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End", "Escape"].includes(
        e.key,
      )
    ) {
      e.preventDefault();
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (!open) {
        show();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        choose(active);
        return;
      }
      if (e.key === "ArrowDown") move(1);
      if (e.key === "ArrowUp") move(-1);
      if (e.key === "Home") setActive(options.findIndex((x) => !x.disabled));
      if (e.key === "End")
        setActive(
          options.length -
            1 -
            [...options].reverse().findIndex((x) => !x.disabled),
        );
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const now = Date.now();
      search.current = {
        text:
          (now - search.current.time < 650 ? search.current.text : "") +
          e.key.toLowerCase(),
        time: now,
      };
      const found = options.findIndex(
        (o) =>
          !o.disabled && o.label.toLowerCase().startsWith(search.current.text),
      );
      if (found >= 0) {
        if (!open) show();
        setActive(found);
      }
    }
  }
  return (
    <>
      <button
        type="button"
        ref={trigger}
        id={rest.id}
        title={rest.title}
        className={`select-trigger ${className} ${open ? "is-open" : ""}`}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        aria-activedescendant={open ? `${uid}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={key}
      >
        <span>{options[selected]?.label || options[0]?.label || "请选择"}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={uid}
            role="listbox"
            aria-label={label}
            className="select-menu"
            style={position}
          >
            {options.map((o, i) => (
              <Fragment key={o.value + "-" + i}>
              {o.group && o.group !== options[i - 1]?.group && (
                <div className="select-group" role="presentation">
                  {o.group}
                </div>
              )}
              <div
                id={`${uid}-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === selected}
                aria-disabled={o.disabled || undefined}
                className={`select-option ${i === active ? "highlighted" : ""} ${i === selected ? "selected" : ""} ${o.disabled ? "disabled" : ""}`}
                onPointerMove={() => !o.disabled && setActive(i)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <span>{o.label}</span>
                {i === selected && (
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m3 8 3 3 7-7" />
                  </svg>
                )}
              </div>
              </Fragment>
            ))}
          </div>,
          trigger.current?.closest("dialog") || document.body,
        )}
    </>
  );
}
