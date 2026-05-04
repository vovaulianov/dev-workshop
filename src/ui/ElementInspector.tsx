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
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] text-[#101114]">{headerLabel}</div>
          {source && <div className="truncate font-mono text-[10px] text-[#b3b3b3]">{source.file}:{source.line}:{source.column}</div>}
        </div>
        <button onClick={onDeselect} className="ml-2 rounded px-2 py-1 text-[11px] text-[#606060] hover:bg-[#f4f4f4] hover:text-[#101114]">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!source && <div className="mb-3 rounded bg-[#fff4f4] px-2 py-2 text-[11px] text-[#e6365a]">This element has no JSX source location. Saves will fail.</div>}
        <LayoutSection element={element} overrides={overrides} onChange={setValue} />
        <Section title="Spacing + Size" defs={SPACING_SIZE} element={element} overrides={overrides} onChange={setValue} />
        <Section title="Typography" defs={TYPOGRAPHY} element={element} overrides={overrides} onChange={setValue} />
        <Section title="Colors" defs={COLORS} element={element} overrides={overrides} onChange={setValue} />

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#b3b3b3]">Border</div>
            {borderVisible
              ? <button onClick={removeBorder} className="rounded bg-[#f4f4f4] px-2 py-0.5 text-[9px] text-[#606060] hover:bg-[#ebebeb]">remove</button>
              : <button onClick={addBorder} className="rounded bg-[#f4f4f4] px-2 py-0.5 text-[9px] text-[#606060] hover:bg-[#ebebeb]">+ add</button>}
          </div>
          {borderVisible && <div className="flex flex-col gap-1.5">{BORDER.map((def) => <Row key={def.key} def={def} element={element} override={overrides[def.key]} onChange={(v) => setValue(def, v)} />)}</div>}
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#b3b3b3]">Effects</div>
            {hasShadow
              ? <button onClick={() => setValue({ key: "boxShadow", cssProp: "box-shadow", label: "", kind: "shadow" }, "none")} className="rounded bg-[#f4f4f4] px-2 py-0.5 text-[9px] text-[#606060] hover:bg-[#ebebeb]">remove shadow</button>
              : <button onClick={() => setValue({ key: "boxShadow", cssProp: "box-shadow", label: "", kind: "shadow" }, "0 4px 12px rgba(0, 0, 0, 0.08)")} className="rounded bg-[#f4f4f4] px-2 py-0.5 text-[9px] text-[#606060] hover:bg-[#ebebeb]">+ add shadow</button>}
          </div>
          <div className="flex flex-col gap-1.5">{EFFECTS.map((def) => <Row key={def.key} def={def} element={element} override={overrides[def.key]} onChange={(v) => setValue(def, v)} />)}</div>
        </div>
      </div>

      <div className="border-t border-[#e5e5e5] p-3">
        {statusMessage && <div className={["mb-2 truncate text-[11px]", status === "error" ? "text-[#e6365a]" : "text-[#1f9d55]"].join(" ")}>{statusMessage}</div>}
        <div className="flex gap-2">
          <button onClick={resetAll} disabled={!hasDirty} className="flex-1 rounded-md border border-[#e5e5e5] bg-white py-2 text-[12px] text-[#606060] transition-colors hover:bg-[#fafafa] disabled:opacity-30">Discard</button>
          <button onClick={save} disabled={!hasDirty || status === "saving" || !source} className="flex-1 rounded-md bg-[#101114] py-2 text-[12px] font-semibold text-white transition-opacity disabled:opacity-30">
            {status === "saving" ? "Saving…" : hasDirty ? `Save ${Object.keys(overrides).length}` : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, defs, element, overrides, onChange }: { title: string; defs: PropDef[]; element: Element; overrides: Overrides; onChange: (def: PropDef, value: string | null) => void }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#b3b3b3]">{title}</div>
      <div className="flex flex-col gap-1.5">{defs.map((def) => <Row key={def.key} def={def} element={element} override={overrides[def.key]} onChange={(v) => onChange(def, v)} />)}</div>
    </div>
  );
}

function LayoutSection({ element, overrides, onChange }: { element: Element; overrides: Overrides; onChange: (def: PropDef, value: string | null) => void }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#b3b3b3]">Layout</div>
      <div className="flex flex-col gap-2">
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
      <div className="mb-1 flex items-center justify-between">
        <label className="font-mono text-[10px] text-[#404040]">{axis}</label>
        <div className="flex gap-0.5">
          {(["fill", "hug", "fixed"] as SizingMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={["rounded px-1.5 py-0.5 font-mono text-[9px]", mode === m ? "bg-[#101114] text-white" : "bg-[#f4f4f4] text-[#606060] hover:bg-[#ebebeb]"].join(" ")}>{m}</button>
          ))}
        </div>
      </div>
      {mode === "fixed" && <SmartInput value={value} onChange={(v) => onChange(def, v)} className="w-full rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] text-[#101114] outline-none focus:bg-[#ebebeb]" />}
    </div>
  );
}

function Row({ def, element, override, onChange }: { def: PropDef; element: Element; override: string | null | undefined; onChange: (v: string | null) => void }) {
  const computed = computedValue(element, def.cssProp);
  const value = override !== undefined ? override ?? "" : computed;
  const dirty = override !== undefined;
  return (
    <div className={["grid grid-cols-[100px_1fr_auto] items-center gap-2 rounded px-1 py-0.5", dirty ? "bg-[#fff4f4]" : ""].join(" ")}>
      <label className="truncate font-mono text-[10px] text-[#404040]">{def.label}</label>
      <div className="min-w-0"><Control def={def} value={value} onChange={onChange} /></div>
      {dirty ? <button onClick={() => onChange(null)} className="rounded px-1.5 py-0.5 text-[9px] text-[#606060] hover:bg-[#ebebeb] hover:text-[#101114]" title="reset">×</button> : <span className="w-4" />}
    </div>
  );
}

function Control({ def, value, onChange }: { def: PropDef; value: string; onChange: (v: string) => void }) {
  if (def.kind === "color") {
    const hex = rgbToHex(value) ?? (value.startsWith("#") ? value : "#000000");
    return (
      <div className="flex items-center gap-1">
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="h-5 w-5 shrink-0 cursor-pointer rounded border border-[#e5e5e5] bg-white" />
        <SmartInput plain value={value} onChange={onChange} placeholder="#hex / rgb / var()" className="w-full rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] text-[#101114] outline-none focus:bg-[#ebebeb]" />
      </div>
    );
  }
  if (def.kind === "align") {
    const opts = [{ v: "left", label: "L" }, { v: "center", label: "C" }, { v: "right", label: "R" }, { v: "justify", label: "J" }];
    return (
      <div className="flex gap-0.5">
        {opts.map((o) => <button key={o.v} onClick={() => onChange(o.v)} className={["h-6 w-6 rounded font-mono text-[10px]", value === o.v ? "bg-[#101114] text-white" : "bg-[#f4f4f4] text-[#606060] hover:bg-[#ebebeb]"].join(" ")}>{o.label}</button>)}
      </div>
    );
  }
  if (def.kind === "shadow") {
    return <SmartInput plain value={value === "none" ? "" : value} onChange={(v) => onChange(v || "none")} placeholder="x y blur color" className="w-full rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] text-[#101114] outline-none focus:bg-[#ebebeb]" />;
  }
  return <SmartInput value={value} onChange={onChange} className="w-full rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] text-[#101114] outline-none focus:bg-[#ebebeb]" />;
}
