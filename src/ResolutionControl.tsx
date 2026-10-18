import { useEffect, useRef, useState, type CSSProperties } from "react";
import { constrainResolution, MAX_BASE_PIXELS } from "../shared/resolution.mjs";
import { Field } from "./ui";

type Dimensions = { width: number; height: number };
export default function ResolutionControl({
  width,
  height,
  onChange,
  sliders = false,
}: {
  width: number;
  height: number;
  onChange: (d: Dimensions) => void;
  sliders?: boolean;
}) {
  return (
    <div className="dimension-pair resolution-controls">
      <Side
        label="宽度"
        side="width"
        value={width}
        other={height}
        onChange={onChange}
        slider={sliders}
      />
      <button
        title="交换宽高"
        aria-label="交换宽高"
        className="swap"
        onClick={() => onChange({ width: height, height: width })}
      >
        ×
      </button>
      <Side
        label="高度"
        side="height"
        value={height}
        other={width}
        onChange={onChange}
        slider={sliders}
      />
    </div>
  );
}
function Side({
  label,
  side,
  value,
  other,
  onChange,
  slider,
}: {
  label: string;
  side: "width" | "height";
  value: number;
  other: number;
  onChange: (d: Dimensions) => void;
  slider: boolean;
}) {
  const [text, setText] = useState(String(value)),
    editing = useRef(false),
    max = Math.max(2048, value);
  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);
  function commit(next: number) {
    const dims = constrainResolution(
      side === "width" ? next : other,
      side === "height" ? next : other,
      side,
    );
    setText(String(dims[side]));
    onChange(dims);
  }
  return (
    <div className="resolution-side">
      <Field label={label}>
        <div className="dimension-value">
          <input
            type="number"
            aria-label={label}
            inputMode="numeric"
            min="64"
            max={MAX_BASE_PIXELS / 64}
            step="64"
            value={text}
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => {
              editing.current = false;
              const next = parseFloat(e.target.value);
              if (Number.isFinite(next)) commit(next);
              else setText(String(value));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <span aria-hidden="true">px</span>
        </div>
      </Field>
      {slider && (
        <input
          className="resolution-range"
          type="range"
          aria-label={label + "滑条"}
          min="64"
          max={max}
          step="64"
          value={value}
          style={
            {
              "--range-progress": `${((value - 64) / (max - 64)) * 100}%`,
            } as CSSProperties
          }
          onChange={(e) => commit(+e.target.value)}
        />
      )}
    </div>
  );
}
