import { useCallback, useEffect, useMemo, useState } from "react";
import { patchStyle } from "../lib/devApi";
import type { ElementSource } from "../lib/fiberUtils";
import { describeElement } from "../lib/fiberUtils";
import { SmartInput } from "./SmartInput";
import { Slider } from "./Slider";

/** Per-property slider ranges. Anything not listed falls back to SmartInput.
 *  `unit` is the suffix appended on output and stripped on input — empty
 *  string for unitless props (font-weight, line-height, opacity). */
interface SliderRange {
  min: number;
  max: number;
  step?: number;
  unit: string;
  precision?: number;
}
const SLIDER_RANGES: Record<string, SliderRange> = {
  padding: { min: 0, max: 64, unit: "px" },
  paddingTop: { min: 0, max: 64, unit: "px" },
  paddingRight: { min: 0, max: 64, unit: "px" },
  paddingBottom: { min: 0, max: 64, unit: "px" },
  paddingLeft: { min: 0, max: 64, unit: "px" },
  margin: { min: -32, max: 64, unit: "px" },
  gap: { min: 0, max: 64, unit: "px" },
  borderRadius: { min: 0, max: 32, unit: "px" },
  fontSize: { min: 8, max: 48, unit: "px" },
  fontWeight: { min: 100, max: 900, step: 100, unit: "" },
  lineHeight: { min: 0.8, max: 2.5, step: 0.05, unit: "", precision: 2 },
  letterSpacing: { min: -2, max: 4, step: 0.05, unit: "px", precision: 2 },
  borderWidth: { min: 0, max: 8, step: 0.5, unit: "px", precision: 1 },
  opacity: { min: 0, max: 1, step: 0.05, unit: "", precision: 2 },
};

const NUMBER_UNIT_RE = /^(-?\d*\.?\d+)([a-z%]*)\s*$/i;

function parseCssValue(s: string): { num: number; unit: string } | null {
  const m = s.trim().match(NUMBER_UNIT_RE);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (!Number.isFinite(n)) return null;
  return { num: n, unit: m[2] ?? "" };
}

function trimNumber(n: number, precision = 0): string {
  if (precision === 0) return String(Math.round(n));
  // Trim trailing zeros (e.g. 1.50 → 1.5, 1.00 → 1)
  return parseFloat(n.toFixed(precision)).toString();
}

type Overrides = Record<string, string | null>;

interface Props {
  element: Element;
  source: ElementSource | null;
  onDeselect: () => void;
}

interface PropDef {
  key: string;
  cssProp: string;
  label: string;
  kind: "size" | "color" | "text" | "weight" | "align" | "shadow";
}

const SPACING_SIZE: PropDef[] = [
  { key: "padding", cssProp: "padding", label: "padding", kind: "size" },
  { key: "paddingTop", cssProp: "padding-top", label: "padding-top", kind: "size" },
  { key: "paddingRight", cssProp: "padding-right", label: "padding-right", kind: "size" },
  { key: "paddingBottom", cssProp: "padding-bottom", label: "padding-bottom", kind: "size" },
  { key: "paddingLeft", cssProp: "padding-left", label: "padding-left", kind: "size" },
  { key: "margin", cssProp: "margin", label: "margin", kind: "size" },
  { key: "gap", cssProp: "gap", label: "gap", kind: "size" },
  { key: "borderRadius", cssProp: "border-radius", label: "border-radius", kind: "size" },
];
const COLORS: PropDef[] = [
  { key: "color", cssProp: "color", label: "color", kind: "color" },
  { key: "backgroundColor", cssProp: "background-color", label: "background", kind: "color" },
];
const TYPOGRAPHY: PropDef[] = [
  { key: "fontSize", cssProp: "font-size", label: "font-size", kind: "size" },
  { key: "fontWeight", cssProp: "font-weight", label: "font-weight", kind: "weight" },
  { key: "lineHeight", cssProp: "line-height", label: "line-height", kind: "size" },
  { key: "letterSpacing", cssProp: "letter-spacing", label: "letter-spacing", kind: "size" },
  { key: "textAlign", cssProp: "text-align", label: "text-align", kind: "align" },
];
const BORDER: PropDef[] = [
  { key: "borderWidth", cssProp: "border-width", label: "border-width", kind: "size" },
  { key: "borderStyle", cssProp: "border-style", label: "border-style", kind: "text" },
  { key: "borderColor", cssProp: "border-color", label: "border-color", kind: "color" },
];
const EFFECTS: PropDef[] = [
  { key: "boxShadow", cssProp: "box-shadow", label: "box-shadow", kind: "shadow" },
  { key: "opacity", cssProp: "opacity", label: "opacity", kind: "text" },
];
const ALL_DEFS: PropDef[] = [
  ...SPACING_SIZE, ...COLORS, ...TYPOGRAPHY, ...BORDER, ...EFFECTS,
  { key: "width", cssProp: "width", label: "width", kind: "size" },
  { key: "height", cssProp: "height", label: "height", kind: "size" },
];

function computedValue(el: Element, cssProp: string): string {
  return getComputedStyle(el).getPropertyValue(cssProp).trim();
}

function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  return "#" + [m[1]!, m[2]!, m[3]!].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

type SizingMode = "fixed" | "fill" | "hug";

function inferSizingMode(el: Element, axis: "width" | "height", override: string | undefined | null): SizingMode {
  const inline = (el as HTMLElement).style[axis];
  const source = override !== undefined && override !== null ? override : inline;
  if (!source) return "fixed";
  if (source === "100%") return "fill";
  if (["fit-content", "max-content", "min-content", "auto"].includes(source)) return "hug";
  return "fixed";
}

export function ElementInspector({ element, source, onDeselect }: Props) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [, setDomTick] = useState(0);

  useEffect(() => {
    setOverrides({});
    setStatus("idle");
    setStatusMessage("");
  }, [element, source?.file, source?.line]);

  useEffect(() => {
    if (!element.isConnected) return;
    const mo = new MutationObserver(() => setDomTick((t) => t + 1));
    mo.observe(element, { attributes: true, attributeFilter: ["style", "class"] });
    return () => mo.disconnect();
  }, [element]);

  const headerLabel = useMemo(() => describeElement(element, source ?? null), [element, source]);

  const setValue = useCallback((def: PropDef, value: string | null) => {
    const el = element as HTMLElement;
    if (value === null || value === "") {
      el.style.removeProperty(def.cssProp);
      setOverrides((prev) => { const next = { ...prev }; delete next[def.key]; return next; });
    } else {
      el.style.setProperty(def.cssProp, value);
      setOverrides((prev) => ({ ...prev, [def.key]: value }));
    }
  }, [element]);

  const resetAll = useCallback(() => {
    const el = element as HTMLElement;
    for (const def of ALL_DEFS) el.style.removeProperty(def.cssProp);
    setOverrides({});
  }, [element]);

  const save = useCallback(async () => {
    if (!source) { setStatus("error"); setStatusMessage("No source location available"); return; }
    if (Object.keys(overrides).length === 0) return;
    setStatus("saving");
    setStatusMessage("Saving…");
    try {
      await patchStyle({ file: source.file, line: source.line, column: source.column, styleUpdates: overrides });
      const el = element as HTMLElement;
      for (const key of Object.keys(overrides)) {
        const def = ALL_DEFS.find((d) => d.key === key);
        if (def) el.style.removeProperty(def.cssProp);
      }
      setOverrides({});
      setStatus("saved");
      setStatusMessage("Saved");
      setTimeout(() => { setStatus("idle"); setStatusMessage(""); }, 1500);
    } catch (err) {
      setStatus("error");
      setStatusMessage(String(err));
    }
  }, [overrides, source, element]);

  const hasDirty = Object.keys(overrides).length > 0;
  const computedBorderWidth = computedValue(element, "border-width");
  const computedBorderStyle = computedValue(element, "border-style");
  const borderVisible = computedBorderStyle !== "none" && computedBorderStyle !== "" && !/^0(px)?$/.test(computedBorderWidth.split(" ")[0] ?? "");
  const addBorder = () => {
    setValue({ key: "borderWidth", cssProp: "border-width", label: "", kind: "size" }, "1px");
    setValue({ key: "borderStyle", cssProp: "border-style", label: "", kind: "text" }, "solid");
    setValue({ key: "borderColor", cssProp: "border-color", label: "", kind: "color" }, "#e5e5e5");
  };
  const removeBorder = () => setValue({ key: "borderStyle", cssProp: "border-style", label: "", kind: "text" }, "none");
  const computedShadow = computedValue(element, "box-shadow");
  const hasShadow = computedShadow && computedShadow !== "none";

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #e5e5e5", padding: "8px 12px" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "#101114" }}>{headerLabel}</div>
          {source && <div className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, color: "#b3b3b3" }}>{source.file}:{source.line}:{source.column}</div>}
        </div>
        <button onClick={onDeselect} className="dw-ghost" style={{ marginLeft: 8, fontSize: 14, lineHeight: 1, padding: "4px 8px" }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {!source && <div style={{ marginBottom: 12, borderRadius: 4, background: "#fff4f4", padding: "8px", fontSize: 11, color: "#e6365a" }}>This element has no JSX source location. Saves will fail.</div>}
        <LayoutSection element={element} overrides={overrides} onChange={setValue} />
        <Section title="Spacing + Size" defs={SPACING_SIZE} element={element} overrides={overrides} onChange={setValue} />
        <Section title="Typography" defs={TYPOGRAPHY} element={element} overrides={overrides} onChange={setValue} />
        <Section title="Colors" defs={COLORS} element={element} overrides={overrides} onChange={setValue} />

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="dw-section-label">Border</div>
            {borderVisible
              ? <button onClick={removeBorder} className="dw-ghost">remove</button>
              : <button onClick={addBorder} className="dw-ghost">+ add</button>}
          </div>
          {borderVisible && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{BORDER.map((def) => <Row key={def.key} def={def} element={element} override={overrides[def.key]} onChange={(v) => setValue(def, v)} />)}</div>}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="dw-section-label">Effects</div>
            {hasShadow
              ? <button onClick={() => setValue({ key: "boxShadow", cssProp: "box-shadow", label: "", kind: "shadow" }, "none")} className="dw-ghost">remove shadow</button>
              : <button onClick={() => setValue({ key: "boxShadow", cssProp: "box-shadow", label: "", kind: "shadow" }, "0 4px 12px rgba(0, 0, 0, 0.08)")} className="dw-ghost">+ add shadow</button>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{EFFECTS.map((def) => <Row key={def.key} def={def} element={element} override={overrides[def.key]} onChange={(v) => setValue(def, v)} />)}</div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid #e5e5e5", padding: 12 }}>
        {statusMessage && <div style={{ marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: status === "error" ? "#e6365a" : "#1f9d55" }}>{statusMessage}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={resetAll} disabled={!hasDirty} className="dw-btn-secondary">Discard</button>
          <button onClick={save} disabled={!hasDirty || status === "saving" || !source} className="dw-btn-primary">
            {status === "saving" ? "Saving…" : hasDirty ? `Save ${Object.keys(overrides).length}` : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, defs, element, overrides, onChange }: { title: string; defs: PropDef[]; element: Element; overrides: Overrides; onChange: (def: PropDef, value: string | null) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="dw-section-label" style={{ marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{defs.map((def) => <Row key={def.key} def={def} element={element} override={overrides[def.key]} onChange={(v) => onChange(def, v)} />)}</div>
    </div>
  );
}

function LayoutSection({ element, overrides, onChange }: { element: Element; overrides: Overrides; onChange: (def: PropDef, value: string | null) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="dw-section-label" style={{ marginBottom: 8 }}>Layout</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <AxisRow axis="width" element={element} overrides={overrides} onChange={onChange} />
        <AxisRow axis="height" element={element} overrides={overrides} onChange={onChange} />
      </div>
    </div>
  );
}

function AxisRow({ axis, element, overrides, onChange }: { axis: "width" | "height"; element: Element; overrides: Overrides; onChange: (def: PropDef, value: string | null) => void }) {
  const def: PropDef = { key: axis, cssProp: axis, label: axis, kind: "size" };
  const computed = computedValue(element, axis);
  const override = overrides[axis];
  const value = override !== undefined ? override ?? "" : computed;
  const mode = inferSizingMode(element, axis, override);
  const setMode = (m: SizingMode) => {
    if (m === "fill") onChange(def, "100%");
    else if (m === "hug") onChange(def, "fit-content");
    else onChange(def, `${Math.round(parseFloat(computed) || 0)}px`);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px" }}>
      <label style={{ flexShrink: 0, width: 64, paddingLeft: 12, fontFamily: "var(--dw-font)", fontSize: 12, fontWeight: 500, color: "var(--dw-text-secondary)" }}>{axis}</label>
      <div className="dw-segments" style={{ flexShrink: 0 }}>
        {(["fill", "hug", "fixed"] as SizingMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="dw-segment"
            data-active={mode === m ? "true" : "false"}
            style={{ minWidth: 44, padding: "0 10px", height: 26, fontSize: 12 }}
          >
            {m}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {mode === "fixed"
          ? <SmartInput value={value} onChange={(v) => onChange(def, v)} className="dw-input-md" />
          : <input className="dw-input-md" value={value} readOnly tabIndex={-1} style={{ opacity: 0.6, cursor: "default" }} />
        }
      </div>
    </div>
  );
}

function Row({ def, element, override, onChange }: { def: PropDef; element: Element; override: string | null | undefined; onChange: (v: string | null) => void }) {
  const computed = computedValue(element, def.cssProp);
  const value = override !== undefined ? override ?? "" : computed;
  const dirty = override !== undefined;

  // Slider applies to numeric kinds with a known range. The slider has its
  // own inline label, so we drop the 100px label cell and let it span.
  const range = SLIDER_RANGES[def.key];
  const useSlider = !!range && def.kind !== "color" && def.kind !== "align" && def.kind !== "shadow";

  if (useSlider) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 4, background: dirty ? "#fff4f4" : "transparent", padding: "2px 4px" }}>
        <CssSlider def={def} value={value} range={range!} onChange={onChange} />
        {dirty
          ? <button onClick={() => onChange(null)} className="dw-ghost" title="reset">×</button>
          : <span style={{ width: 16 }} />}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "108px 1fr auto", alignItems: "center", gap: 8, borderRadius: 4, background: dirty ? "#fff4f4" : "transparent", padding: "2px 4px" }}>
      {/* paddingLeft: 12 mirrors the slider's internal label inset so labels
          line up vertically across slider rows and non-slider rows. */}
      <label style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--dw-font)", fontSize: 12, fontWeight: 500, color: "var(--dw-text-secondary)", paddingLeft: 12 }}>{def.label}</label>
      <div style={{ minWidth: 0 }}><Control def={def} value={value} onChange={onChange} /></div>
      {dirty ? <button onClick={() => onChange(null)} className="dw-ghost" title="reset">×</button> : <span style={{ width: 16 }} />}
    </div>
  );
}

function CssSlider({ def, value, range, onChange }: { def: PropDef; value: string; range: SliderRange; onChange: (v: string) => void }) {
  const parsed = parseCssValue(value);
  const num = parsed?.num ?? range.min;
  const currentUnit = parsed?.unit ?? range.unit;

  const formatValue = (v: number): string => {
    const text = trimNumber(v, range.precision ?? 0);
    return text + (currentUnit || range.unit);
  };

  const parseValue = (s: string): number | null => {
    const p = parseCssValue(s);
    return p?.num ?? null;
  };

  return (
    <Slider
      label={def.label}
      value={Math.max(range.min, Math.min(range.max, num))}
      min={range.min}
      max={range.max}
      step={range.step}
      format={formatValue}
      parse={parseValue}
      onChange={(v) => {
        const text = trimNumber(v, range.precision ?? 0);
        onChange(text + (currentUnit || range.unit));
      }}
    />
  );
}

function AlignIcon({ kind }: { kind: "left" | "center" | "right" | "justify" }) {
  const lines: Record<string, Array<[number, number, number]>> = {
    // [y, x, width] — 4 lines top to bottom
    left:    [[3, 1, 10], [6, 1, 6], [9, 1, 8], [12, 1, 5]],
    center:  [[3, 2, 10], [6, 4, 6], [9, 3, 8], [12, 5, 4]],
    right:   [[3, 3, 10], [6, 7, 6], [9, 5, 8], [12, 8, 5]],
    justify: [[3, 1, 12], [6, 1, 12], [9, 1, 12], [12, 1, 12]],
  };
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      {lines[kind]!.map(([y, x, w], i) => (
        <rect key={i} x={x} y={y} width={w} height="1.4" rx="0.7" fill="currentColor" />
      ))}
    </svg>
  );
}

function Control({ def, value, onChange }: { def: PropDef; value: string; onChange: (v: string) => void }) {
  if (def.kind === "color") {
    // Always display as HEX. Computed values come back as rgb() — convert
    // before showing. The native picker emits HEX naturally.
    const hex = rgbToHex(value) ?? (value.startsWith("#") ? value : "#000000");
    const display = value.startsWith("#") ? value : (rgbToHex(value) ?? value);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          style={{ height: 32, width: 32, flexShrink: 0, cursor: "pointer", borderRadius: 8, border: "1px solid #e5e5e5", background: "white", padding: 0, overflow: "hidden" }}
        />
        <SmartInput plain value={display} onChange={onChange} placeholder="#hex / rgb / var()" className="dw-input-md" />
      </div>
    );
  }
  if (def.kind === "align") {
    const opts: Array<"left" | "center" | "right" | "justify"> = ["left", "center", "right", "justify"];
    return (
      <div className="dw-segments" style={{ width: "100%" }}>
        {opts.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className="dw-segment"
            data-active={value === o ? "true" : "false"}
            style={{ height: 26, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
            title={o}
            aria-label={o}
          >
            <AlignIcon kind={o} />
          </button>
        ))}
      </div>
    );
  }
  if (def.kind === "shadow") {
    return <SmartInput plain value={value === "none" ? "" : value} onChange={(v) => onChange(v || "none")} placeholder="x y blur color" className="dw-input-md" />;
  }
  return <SmartInput value={value} onChange={onChange} className="dw-input-md" />;
}
