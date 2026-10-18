import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { FieldLabelContext } from "./Select";
export { Select } from "./Select";
export function Icon({ name = "image" }: { name?: string }) {
  const paths: Record<string, ReactNode> = {
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" />
        <path d="m3 16 5-5 5 5 3-3 5 5M15 7h.01" />
      </>
    ),
    plus: <path d="M12 4v16M4 12h16" />,
    layers: <path d="m3 7 9-4 9 4-9 4-9-4m0 5 9 4 9-4m-18 5 9 4 9-4" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v7M12 7h.01" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    star: (
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />
    ),
    archive: (
      <>
        <path d="M4 8h16v13H4ZM3 3h18v5H3Z" />
        <path d="M9 12h6" />
      </>
    ),
    close: <path d="m5 5 14 14M5 19 19 5" />,
    sliders: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    upload: <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />,
    chat: <path d="M3 4h18v13H8l-5 4ZM7 9h10M7 13h6" />,
    grid: <path d="M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z" />,
    history: (
      <>
        <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" />
      </>
    ),
    link: (
      <path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 5 0m4-1 2-2a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-5 0" />
    ),
    brush: <path d="m8 14 10-11 3 3-11 10M8 14c-6-2-1 7-7 7 7 2 11-2 9-5" />,
    download: <path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5" />,
    copy: <><rect x="8" y="8" width="13" height="13" /><path d="M16 8V3H3v13h5" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />,
    expand: <path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6" />,
    user: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 21v-3a8 8 0 0 1 16 0v3" />
      </>
    ),
    undo: <path d="m8 3-6 6 6 6M2 9h11a8 8 0 0 1 8 8" />,
    refresh: (
      <path d="M21 9a9 9 0 0 0-16-4L2 9m0-6v6h6M3 15a9 9 0 0 0 16 4l3-4m0 6v-6h-6" />
    ),
  };
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name] || paths.image}
    </svg>
  );
}
export function Button({
  children,
  icon,
  onClick,
  primary = false,
  disabled = false,
  title,
  small = false,
  className = "",
  ...rest
}: {
  children?: ReactNode;
  icon?: string;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
  small?: boolean;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "title" | "disabled" | "onClick">) {
  return (
    <button
      type="button"
      className={`btn ${primary ? "primary" : ""} ${small ? "small" : ""} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title || (typeof children === "string" ? children : undefined)}
      {...rest}
    >
      {icon && <Icon name={icon} />} {children}
    </button>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <FieldLabelContext.Provider value={label}>
        {children}
      </FieldLabelContext.Provider>
    </label>
  );
}
export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className="slider-field">
      <label>
        <span>{label}</span>
        <input
          aria-label={label + "数值"}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            if (Number.isFinite(e.target.valueAsNumber))
              onChange(e.target.valueAsNumber);
          }}
        />
      </label>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        style={
          {
            "--range-progress": `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`,
          } as CSSProperties
        }
        disabled={disabled}
        onChange={(e) => onChange(+e.target.value)}
      />
      <div className="slider-limits">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
  icon = "image",
}: {
  title: string;
  children?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
