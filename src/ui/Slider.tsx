import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** Drag step (continuous moves snap to nearest multiple). Defaults to a
   *  precision derived from the range. Click-snap always uses deciles. */
  step?: number;
  label: string;
  /** Render the numeric value as a string (e.g. `${v}px`). */
  format: (v: number) => string;
  /** Reverse of `format` — used for the editable input. Returns null when
   *  the input string can't be parsed. */
  parse?: (s: string) => number | null;
  onChange: (next: number) => void;
}

const HANDLE_INSET = 6;       // distance from the fill edge in resting state
const HANDLE_MIN_LEFT = 4;     // clamp at zero so the handle stays visible
const SNAP_DECILES = 10;
const SPRING_DURATION_MS = 280;

const DEFAULT_PARSE = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function snapToStep(v: number, step: number, min: number) {
  const offset = v - min;
  const snapped = Math.round(offset / step) * step;
  return min + snapped;
}

function springTransition(
  from: number,
  to: number,
  duration: number,
  onTick: (v: number) => void,
  onDone: () => void,
): () => void {
  let cancelled = false;
  const start = performance.now();
  const frame = (now: number) => {
    if (cancelled) return;
    const t = Math.min((now - start) / duration, 1);
    // ease-out cubic with a tiny overshoot
    const eased = 1 - Math.pow(1 - t, 3);
    const overshoot = t < 0.85 ? 0 : Math.sin((t - 0.85) * Math.PI * 6) * 0.012 * (1 - t);
    onTick(from + (to - from) * (eased + overshoot));
    if (t < 1) requestAnimationFrame(frame);
    else onDone();
  };
  requestAnimationFrame(frame);
  return () => { cancelled = true; };
}

export function Slider({ value, min, max, step, label, format, parse = DEFAULT_PARSE, onChange }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelAnimRef = useRef<(() => void) | null>(null);

  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const [animValue, setAnimValue] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");

  const range = max - min;
  const display = animValue ?? value;
  const progress = clamp((display - min) / range, 0, 1);

  // Effective step: explicit, or a sensible default based on range size
  const effectiveStep = step ?? (range >= 100 ? 1 : range >= 10 ? 0.5 : 0.05);

  // Stop animation when value changes externally (e.g. typed in input)
  useEffect(() => {
    if (cancelAnimRef.current) {
      cancelAnimRef.current();
      cancelAnimRef.current = null;
      setAnimValue(null);
    }
  }, [value]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing) {
      setDraftText(format(value));
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, format, value]);

  const valueAtPointer = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return value;
    const rect = track.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    return x * range + min;
  };

  const commit = (next: number) => {
    let v = snapToStep(next, effectiveStep, min);
    v = clamp(v, min, max);
    if (v !== value) onChange(v);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editing) return;
    const startedOnValue = (e.target as HTMLElement).closest("[data-slider-value]") != null;
    // Let the value span receive its own clicks (single + double) so we
    // can distinguish a single-click from a double-click without a timer.
    if (startedOnValue) return;

    e.preventDefault();
    const startX = e.clientX;
    const targetEl = e.currentTarget;
    targetEl.setPointerCapture(e.pointerId);

    cancelAnimRef.current?.();
    cancelAnimRef.current = null;
    setActive(true);

    let didDrag = false;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) didDrag = true;
      if (didDrag) commit(valueAtPointer(ev.clientX));
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setActive(false);

      if (didDrag) return;

      // Click on track (not on value): snap to nearest decile with a spring
      const target = valueAtPointer(ev.clientX);
      const targetProgress = clamp((target - min) / range, 0, 1);
      const snappedProgress = Math.round(targetProgress * SNAP_DECILES) / SNAP_DECILES;
      const snappedValue = snappedProgress * range + min;

      if (Math.abs(snappedValue - value) < effectiveStep / 2) return;
      cancelAnimRef.current = springTransition(value, snappedValue, SPRING_DURATION_MS,
        (v) => setAnimValue(v),
        () => { setAnimValue(null); cancelAnimRef.current = null; commit(snappedValue); },
      );
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const commitEdit = () => {
    const parsed = parse(draftText);
    if (parsed != null) commit(parsed);
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  // Visual progress with handle clamping
  const trackWidth = trackRef.current?.getBoundingClientRect().width ?? 1;
  const fillPx = progress * trackWidth;
  const handleLeftRaw = fillPx - HANDLE_INSET;
  const handleLeft = Math.max(HANDLE_MIN_LEFT, handleLeftRaw);
  const handleVisible = (hover || active) && !editing;

  return (
    <div
      ref={trackRef}
      className="dw-slider"
      data-active={active ? "true" : "false"}
      data-hover={hover ? "true" : "false"}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={handlePointerDown}
    >
      {/* Fill */}
      <div
        className="dw-slider-fill"
        style={{ width: `${progress * 100}%` }}
      />

      {/* Hash marks */}
      <div className="dw-slider-ticks" data-visible={hover || active ? "true" : "false"}>
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="dw-slider-tick" style={{ left: `${(i + 1) * 10}%` }} />
        ))}
      </div>

      {/* Handle */}
      <div
        className="dw-slider-handle"
        data-visible={handleVisible ? "true" : "false"}
        style={{ left: handleLeft, transform: handleVisible ? "scaleX(1)" : "scaleX(0)" }}
      />

      {/* Overlay content */}
      <div className="dw-slider-content">
        <span className="dw-slider-label">{label}</span>
        {editing ? (
          <input
            ref={inputRef}
            className="dw-slider-input"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
            }}
            spellCheck={false}
          />
        ) : (
          <span
            ref={valueRef}
            data-slider-value
            className="dw-slider-value"
            title="Double-click to edit"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            {format(display)}
          </span>
        )}
      </div>
    </div>
  );
}
