import { useCallback, useEffect, useMemo, useState } from "react";
import { patchStyle } from "../lib/devApi";
import type { ElementSource } from "../lib/fiberUtils";
import { describeElement } from "../lib/fiberUtils";
import { SmartInput } from "./SmartInput";

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
    <div>
      <div style={{ marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label className="dw-mono" style={{ fontSize: 10, color: "#404040" }}>{axis}</label>
        <div style={{ display: "flex", gap: 2 }}>
          {(["fill", "hug", "fixed"] as SizingMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className="dw-pill" data-active={mode === m ? "true" : "false"} style={{ padding: "2px 6px", fontSize: 9 }}>{m}</button>
          ))}
        </div>
      </div>
      {mode === "fixed" && <SmartInput value={value} onChange={(v) => onChange(def, v)} className="dw-input dw-input-sm" />}
    </div>
  );
}

function Row({ def, element, override, onChange }: { def: PropDef; element: Element; override: string | null | undefined; onChange: (v: string | null) => void }) {
  const computed = computedValue(element, def.cssProp);
  const value = override !== undefined ? override ?? "" : computed;
  const dirty = override !== undefined;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", alignItems: "center", gap: 8, borderRadius: 4, background: dirty ? "#fff4f4" : "transparent", padding: "2px 4px" }}>
      <label className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, color: "#404040" }}>{def.label}</label>
      <div style={{ minWidth: 0 }}><Control def={def} value={value} onChange={onChange} /></div>
      {dirty ? <button onClick={() => onChange(null)} className="dw-ghost" title="reset">×</button> : <span style={{ width: 16 }} />}
    </div>
  );
}

function Control({ def, value, onChange }: { def: PropDef; value: string; onChange: (v: string) => void }) {
  if (def.kind === "color") {
    const hex = rgbToHex(value) ?? (value.startsWith("#") ? value : "#000000");
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} style={{ height: 20, width: 20, flexShrink: 0, cursor: "pointer", borderRadius: 4, border: "1px solid #e5e5e5", background: "white", padding: 0 }} />
        <SmartInput plain value={value} onChange={onChange} placeholder="#hex / rgb / var()" className="dw-input dw-input-sm" />
      </div>
    );
  }
  if (def.kind === "align") {
    const opts = [{ v: "left", label: "L" }, { v: "center", label: "C" }, { v: "right", label: "R" }, { v: "justify", label: "J" }];
    return (
      <div style={{ display: "flex", gap: 2 }}>
        {opts.map((o) => (
          <button key={o.v} onClick={() => onChange(o.v)} className="dw-pill" data-active={value === o.v ? "true" : "false"} style={{ height: 24, width: 24, padding: 0, justifyContent: "center", display: "flex", alignItems: "center" }}>{o.label}</button>
        ))}
      </div>
    );
  }
  if (def.kind === "shadow") {
    return <SmartInput plain value={value === "none" ? "" : value} onChange={(v) => onChange(v || "none")} placeholder="x y blur color" className="dw-input dw-input-sm" />;
  }
  return <SmartInput value={value} onChange={onChange} className="dw-input dw-input-sm" />;
}
