import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon } from "./ui";

export const TEMPLATE_CATEGORIES = {
  artist: "画师串",
  character: "角色",
  scene: "场景",
  negative: "负面词",
  general: "未分类",
};
export function categoryName(key?: string) {
  return (
    TEMPLATE_CATEGORIES[key as keyof typeof TEMPLATE_CATEGORIES] || "未分类"
  );
}
export const dayKey = (date: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(date));
export const clockLabel = (date: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));

export function LibraryFrame({
  rail,
  children,
  className = "",
}: {
  rail: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={`library-page ${className}`}>
      <aside className="library-rail">{rail}</aside>
      <div className="library-content">{children}</div>
    </main>
  );
}
export function RailButton({
  active,
  count,
  children,
  onClick,
  icon,
}: {
  active: boolean;
  count?: number;
  children: ReactNode;
  onClick: () => void;
  icon?: string;
}) {
  return (
    <button
      type="button"
      className={`rail-button ${active ? "is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      <span>{children}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
}
export function LibraryDialog({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal library-dialog ${className}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="关闭对话框"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function LibraryEmpty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="library-empty">
      <Icon name="grid" />
      <h2>{title}</h2>
      <p>{children}</p>
      {action && <div className="actions">{action}</div>}
    </div>
  );
}

export function ScrollHint({ target }: { target: RefObject<HTMLDivElement> }) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const update = () =>
      setMore(el.scrollHeight - el.clientHeight - el.scrollTop > 6);
    const resize = new ResizeObserver(update);
    const content = new MutationObserver(update);
    resize.observe(el);
    content.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    el.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      resize.disconnect();
      content.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [target]);
  if (!more) return null;
  return (
    <button
      type="button"
      className="scroll-hint"
      onClick={() => {
        const el = target.current;
        el?.scrollBy({ top: el.clientHeight * 0.7, behavior: "instant" });
      }}
    >
      向下查看 <span aria-hidden="true">↓</span>
    </button>
  );
}
