import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentEntry } from "../lib/storyLoader";
import {
  applyTokenOverride,
  clearTokenOverrides,
  patchRootBlock,
  readAllTextStyles,
  readAllTokens,
  readFile,
  writeFile,
  type TextStyle,
  type TokenInfo,
} from "../lib/devApi";
import { inferPropDescriptors, type PropDescriptor } from "../lib/propsInference";
import { isUndoRedoKey, useHistory } from "../lib/useHistory";
import { ElementInspector } from "./ElementInspector";
import type { SelectedElement } from "./ComponentPreview";

export type Tab = "props" | "tokens" | "code" | "element";
type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Props {
  entry: ComponentEntry;
  variantIndex: number;
  argsOverride: Record<string, unknown>;
  onArgsOverrideChange: (next: Record<string, unknown>) => void;
  selectedElement: SelectedElement | null;
  onDeselectElement: () => void;
  /** Path to the project's main CSS file (for the Tokens tab "Save" button).
   *  Defaults to `"src/index.css"`. */
  tokensCssFile?: string;
  /** Active tab. Lifted to DevWorkshopPage so ComponentPreview can react to
   *  `tab === "element"` and switch into inspect mode. */
  tab: Tab;
  onTabChange: (next: Tab) => void;
}

export function StylePanel({
  entry,
  variantIndex,
  argsOverride,
  onArgsOverrideChange,
  selectedElement,
  onDeselectElement,
  tokensCssFile = "src/index.css",
  tab,
  onTabChange,
}: Props) {
  return (
    <aside className="dw-card" style={{ display: "flex", height: "100%", minWidth: 0, flex: 1, flexDirection: "column", color: "#101114" }}>
      <div style={{ padding: 10, borderBottom: "1px solid #f1f1f1" }}>
        <div className="dw-segments" role="tablist">
          <button className="dw-segment" role="tab" data-active={tab === "props" ? "true" : "false"} onClick={() => onTabChange("props")}>Props</button>
          <button className="dw-segment" role="tab" data-active={tab === "tokens" ? "true" : "false"} onClick={() => onTabChange("tokens")}>Tokens</button>
          <button className="dw-segment" role="tab" data-active={tab === "code" ? "true" : "false"} onClick={() => onTabChange("code")}>Code</button>
          <button className="dw-segment" role="tab" data-active={tab === "element" ? "true" : "false"} onClick={() => onTabChange("element")}>Element</button>
        </div>
      </div>

      {tab === "element" && (
        selectedElement ? (
          <ElementInspector
            key={`${selectedElement.source?.file}:${selectedElement.source?.line}:${selectedElement.source?.column}`}
            element={selectedElement.element}
            source={selectedElement.source}
            onDeselect={onDeselectElement}
          />
        ) : (
          <ElementEmptyState />
        )
      )}
      {tab === "props" && (
        <PropsTab entry={entry} variantIndex={variantIndex} argsOverride={argsOverride} onArgsOverrideChange={onArgsOverrideChange} />
      )}
      {tab === "tokens" && <TokensTab tokensCssFile={tokensCssFile} />}
      {tab === "code" && <CodeTab entry={entry} />}
    </aside>
  );
}

function ElementEmptyState() {
  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", gap: 10 }}>
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="20" height="20" rx="3" stroke="#b3b3b3" strokeWidth="1.5" strokeDasharray="3 3" />
        <path d="M22 22 L32 28 L26 30 L28 36 L24 32 L22 38 Z" fill="#101114" stroke="white" strokeWidth="1" strokeLinejoin="round" />
      </svg>
      <div style={{ fontSize: 13, color: "#101114", fontWeight: 600 }}>Click any element on the canvas</div>
      <div style={{ fontSize: 11, color: "#808080", lineHeight: 1.5, maxWidth: 220 }}>
        No modifier keys needed while you're on this tab. Hold <kbd className="dw-kbd">⌥</kbd> to also see spacing.
      </div>
    </div>
  );
}

/* ─────────────────────────────── Props Tab ─────────────────────────────── */

function PropsTab({ entry, variantIndex, argsOverride, onArgsOverrideChange }: { entry: ComponentEntry; variantIndex: number; argsOverride: Record<string, unknown>; onArgsOverrideChange: (next: Record<string, unknown>) => void }) {
  const variant = entry.variants[variantIndex] ?? entry.variants[0]!;
  const currentArgs = useMemo(() => ({ ...variant.args, ...argsOverride }), [variant.args, argsOverride]);
  const descriptors = useMemo(() => inferPropDescriptors(entry.variants, currentArgs), [entry.variants, currentArgs]);

  const setArg = useCallback((key: string, value: unknown) => onArgsOverrideChange({ ...argsOverride, [key]: value }), [argsOverride, onArgsOverrideChange]);
  const resetAll = useCallback(() => onArgsOverrideChange({}), [onArgsOverrideChange]);
  const resetOne = useCallback((key: string) => { const next = { ...argsOverride }; delete next[key]; onArgsOverrideChange(next); }, [argsOverride, onArgsOverrideChange]);
  const dirty = Object.keys(argsOverride).length > 0;

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px" }}>
        <div style={{ marginBottom: 8, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div className="dw-section-label">{entry.name} · {variant.name}</div>
          {dirty && <button onClick={resetAll} className="dw-link">reset all</button>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {descriptors.map((d) => <PropRow key={d.key} descriptor={d} value={currentArgs[d.key]} overridden={d.key in argsOverride} onChange={(v) => setArg(d.key, v)} onReset={() => resetOne(d.key)} />)}
          {descriptors.length === 0 && <div style={{ padding: "8px 4px", fontSize: 11, color: "#808080" }}>No props documented in stories for this component.</div>}
        </div>
      </div>
    </div>
  );
}

function PropRow({ descriptor, value, overridden, onChange, onReset }: { descriptor: PropDescriptor; value: unknown; overridden: boolean; onChange: (v: unknown) => void; onReset: () => void }) {
  const { key, control } = descriptor;
  const isMultiLine = control.kind === "json";
  if (isMultiLine) {
    // JSON/object editors break to multi-line; keep label on top.
    return (
      <div style={{ padding: "2px 4px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, paddingLeft: 12 }}>
          <label className="dw-mono" style={{ fontSize: 12, fontWeight: 500, color: "var(--dw-text-secondary)" }}>{key}</label>
          {overridden && <button onClick={onReset} className="dw-reset-btn" title="reset"><PropCloseIcon /></button>}
        </div>
        <PropControl control={control} value={value} onChange={onChange} />
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "108px 1fr auto", alignItems: "center", gap: 8, padding: "2px 4px" }}>
      <label className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--dw-font)", fontSize: 12, fontWeight: 500, color: "var(--dw-text-secondary)", paddingLeft: 12 }}>{key}</label>
      <div style={{ minWidth: 0 }}><PropControl control={control} value={value} onChange={onChange} /></div>
      {overridden ? <button onClick={onReset} className="dw-reset-btn" title="reset"><PropCloseIcon /></button> : <span style={{ width: 24 }} />}
    </div>
  );
}

function JsonControl({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const isPlainObject = value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const [rawMode, setRawMode] = useState(!isPlainObject);
  if (!rawMode && isPlainObject) return <ObjectEditor value={value as Record<string, unknown>} onChange={onChange} onSwitchToRaw={() => setRawMode(true)} />;
  return <RawJsonEditor value={value} onChange={onChange} onSwitchToObject={isPlainObject ? () => setRawMode(false) : undefined} />;
}

function ObjectEditor({ value, onChange, onSwitchToRaw }: { value: Record<string, unknown>; onChange: (v: unknown) => void; onSwitchToRaw: () => void }) {
  const setKey = (key: string, nextVal: unknown) => onChange({ ...value, [key]: nextVal });
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, paddingLeft: 12 }}>
        <div className="dw-section-label">{Object.keys(value).length} keys</div>
        <button onClick={onSwitchToRaw} className="dw-link">raw json</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {Object.entries(value).map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "108px 1fr", alignItems: "center", gap: 8, padding: "2px 4px" }}>
            <label className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--dw-font)", fontSize: 12, fontWeight: 500, color: "var(--dw-text-secondary)", paddingLeft: 12 }} title={k}>{k}</label>
            <div style={{ minWidth: 0 }}><ObjectValueControl value={v} type={v === null ? "null" : typeof v} onChange={(nv) => setKey(k, nv)} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ObjectValueControl({ value, type, onChange }: { value: unknown; type: string; onChange: (v: unknown) => void }) {
  if (type === "boolean") {
    const checked = Boolean(value);
    return (
      <button
        onClick={() => onChange(!checked)}
        style={{
          appearance: "none",
          display: "flex",
          height: 28,
          width: 48,
          alignItems: "center",
          justifyContent: checked ? "flex-end" : "flex-start",
          borderRadius: 999,
          border: "none",
          background: checked ? "#101114" : "#e5e5e5",
          padding: 2,
          cursor: "pointer",
          transition: "background 120ms",
        }}
      >
        <span style={{ height: 24, width: 24, borderRadius: 999, background: "white", boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }} />
      </button>
    );
  }
  if (type === "number") return <input type="number" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="dw-input-md" />;
  if (type === "string") {
    const str = (value as string) ?? "";
    const isLong = str.length > 40 || str.includes("\n");
    if (isLong) return <textarea value={str} onChange={(e) => onChange(e.target.value)} rows={Math.min(5, Math.max(2, str.split("\n").length))} className="dw-input-md" style={{ resize: "none", lineHeight: 1.4, height: "auto", padding: "8px 12px" }} spellCheck={false} />;
    return <input type="text" value={str} onChange={(e) => onChange(e.target.value)} className="dw-input-md" />;
  }
  if (value === undefined) return <input type="text" value="" placeholder="undefined — type to set" onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} className="dw-input-md" />;
  return <RawJsonEditor value={value} onChange={onChange} />;
}

function RawJsonEditor({ value, onChange, onSwitchToObject }: { value: unknown; onChange: (v: unknown) => void; onSwitchToObject?: () => void }) {
  const initial = useMemo(() => { if (value === undefined) return ""; try { const s = JSON.stringify(value, null, 2); return typeof s === "string" ? s : ""; } catch { return ""; } }, [value]);
  const [text, setText] = useState<string>(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(initial); setError(null); }, [initial]);
  const commit = (v: string) => { try { const parsed = v.trim() === "" ? undefined : JSON.parse(v); setError(null); onChange(parsed); } catch (e) { setError(e instanceof Error ? e.message : "invalid json"); } };
  const safeText = typeof text === "string" ? text : "";
  return (
    <div>
      {onSwitchToObject && (
        <div style={{ marginBottom: 4, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onSwitchToObject} className="dw-ghost">back to keys</button>
        </div>
      )}
      <textarea value={safeText} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} rows={Math.min(14, Math.max(3, safeText.split("\n").length))} className="dw-input dw-input-sm" style={{ resize: "vertical", lineHeight: 1.5 }} spellCheck={false} />
      {error && <div style={{ marginTop: 4, fontSize: 10, color: "#e6365a" }}>{error}</div>}
    </div>
  );
}

function PropCloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PropControl({ control, value, onChange }: { control: PropDescriptor["control"]; value: unknown; onChange: (v: unknown) => void }) {
  if (control.kind === "boolean") {
    const checked = Boolean(value);
    return (
      <button
        onClick={() => onChange(!checked)}
        style={{
          appearance: "none",
          display: "flex",
          height: 28,
          width: 48,
          alignItems: "center",
          justifyContent: checked ? "flex-end" : "flex-start",
          borderRadius: 999,
          border: "none",
          background: checked ? "#101114" : "#e5e5e5",
          padding: 2,
          cursor: "pointer",
          transition: "background 120ms",
        }}
      >
        <span style={{ height: 24, width: 24, borderRadius: 999, background: "white", boxShadow: "0 1px 2px rgba(0,0,0,0.15)", transition: "transform 160ms" }} />
      </button>
    );
  }
  if (control.kind === "number") return <input type="number" value={typeof value === "number" ? value : ""} onChange={(e) => { const v = e.target.value; onChange(v === "" ? undefined : Number(v)); }} className="dw-input-md" />;
  if (control.kind === "select") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {control.options.map((opt) => (
          <button key={opt} onClick={() => onChange(opt)} className="dw-pill-md" data-active={value === opt ? "true" : "false"}>{opt}</button>
        ))}
      </div>
    );
  }
  if (control.kind === "json") return <JsonControl value={value} onChange={onChange} />;
  if (control.kind === "node") {
    const isScalar = value === null || value === undefined || typeof value === "string";
    if (!isScalar) return <div className="dw-mono" style={{ borderRadius: 6, background: "#f4f4f4", padding: "8px 12px", fontSize: 11, color: "#808080", height: 32, display: "flex", alignItems: "center" }}>(ReactNode — not editable)</div>;
    return <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="dw-input-md" />;
  }
  return <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="dw-input-md" />;
}

/* ─────────────────────────────── Tokens Tab ─────────────────────────────── */

function TokensTab({ tokensCssFile }: { tokensCssFile: string }) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [textStyles, setTextStyles] = useState<TextStyle[]>([]);
  const overridesH = useHistory<Record<string, string>>({});
  const overrides = overridesH.value;
  const setOverrides = overridesH.set;
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    setTokens(readAllTokens());
    setTextStyles(readAllTextStyles());
  }, []);

  // Sync overrides → :root CSS variables. Re-runs after each change including
  // undo/redo so the canvas reflects the active values.
  useEffect(() => {
    const live = new Set(Object.keys(overrides));
    for (const [name, value] of Object.entries(overrides)) applyTokenOverride(name, value);
    return () => {
      // Clear only the ones we set so we don't stomp on tokens we never touched.
      clearTokenOverrides([...live]);
    };
  }, [overrides]);

  // Cmd+Z / Cmd+Shift+Z while Tokens tab is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = isUndoRedoKey(e);
      if (!action) return;
      e.preventDefault();
      if (action === "undo") overridesH.undo();
      else overridesH.redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overridesH]);

  const handleChange = useCallback((name: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [name]: value }));
  }, [setOverrides]);
  const reset = useCallback(() => {
    setOverrides({});
    setTokens(readAllTokens());
    setStatus("idle");
    setStatusMessage("");
  }, [setOverrides]);
  const save = useCallback(async () => {
    if (Object.keys(overrides).length === 0) return;
    setStatus("saving"); setStatusMessage("Saving…");
    try {
      const { content } = await readFile(tokensCssFile);
      await writeFile(tokensCssFile, patchRootBlock(content, overrides));
      setOverrides({}); setStatus("saved"); setStatusMessage(`Saved to ${tokensCssFile}`);
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) { setStatus("error"); setStatusMessage(String(err)); }
  }, [overrides, tokensCssFile]);

  const groups = useMemo(() => { const g: Record<string, TokenInfo[]> = {}; for (const t of tokens) (g[t.group] ||= []).push(t); return g; }, [tokens]);
  const dirty = Object.keys(overrides).length > 0;

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden" }}>
      <div className="dw-scroll" style={{ flex: 1, minHeight: 0, padding: 12, fontSize: 12 }}>
        {textStyles.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="dw-section-label" style={{ marginBottom: 8 }}>Text styles</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {textStyles.map((s) => <TextStyleRow key={s.className} style={s} />)}
            </div>
          </div>
        )}
        {Object.entries(groups).map(([group, tokensInGroup]) => (
          <div key={group} style={{ marginBottom: 16 }}>
            <div className="dw-section-label" style={{ marginBottom: 8 }}>{group}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tokensInGroup.map((t) => <TokenRow key={t.name} token={t} overrideValue={overrides[t.name]} onChange={handleChange} />)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #e5e5e5", padding: 12 }}>
        {statusMessage && <div style={{ marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: status === "error" ? "#e6365a" : "#1f9d55" }}>{statusMessage}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={reset} disabled={!dirty} className="dw-btn-secondary">Reset</button>
          <button onClick={save} disabled={!dirty || status === "saving"} className="dw-btn-primary">
            {status === "saving" ? "Saving…" : "Save to CSS"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TokenRow({ token, overrideValue, onChange }: { token: TokenInfo; overrideValue: string | undefined; onChange: (name: string, value: string) => void }) {
  const value = overrideValue ?? token.value;
  const handleInput = (v: string) => onChange(token.name, v);
  if (token.kind === "color") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px", alignItems: "center", gap: 8, padding: "2px 4px" }}>
        <label className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--dw-font-mono)", fontSize: 11, color: "var(--dw-text-secondary)", paddingLeft: 12 }} title={token.name}>{token.name}</label>
        <div style={{ display: "flex", alignItems: "center", gap: 4, height: 32 }}>
          {/* Borderless swatch — clicking it opens the native color picker. */}
          <input
            type="color"
            value={normalizeColor(value)}
            onChange={(e) => handleInput(e.target.value)}
            className="dw-color-input"
            style={{ height: 32, width: 32, flexShrink: 0, borderRadius: 8, background: normalizeColor(value), boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)" }}
          />
          {/* Hex input uses the standard input style so it reads as a regular field. */}
          <input
            type="text"
            value={value}
            onChange={(e) => handleInput(e.target.value)}
            className="dw-input-md"
            spellCheck={false}
          />
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px", alignItems: "center", gap: 8, padding: "2px 4px" }}>
      <label className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--dw-font-mono)", fontSize: 11, color: "var(--dw-text-secondary)", paddingLeft: 12 }} title={token.name}>{token.name}</label>
      <input type="text" value={value} onChange={(e) => handleInput(e.target.value)} className="dw-input-md" spellCheck={false} />
    </div>
  );
}

function TextStyleRow({ style }: { style: TextStyle }) {
  // Build inline style from declarations to render the live preview.
  const previewStyle: Record<string, string> = {};
  for (const [k, v] of Object.entries(style.declarations)) {
    // Convert kebab → camel for inline style API
    const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    previewStyle[camel] = v;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 8, padding: "6px 4px 6px 12px", borderRadius: 6 }}>
      <div style={{ minWidth: 0 }}>
        <div className="dw-mono" style={{ fontSize: 11, color: "var(--dw-text-secondary)", marginBottom: 4 }}>{style.className}</div>
        <div style={{ minWidth: 0, color: "#101114", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...previewStyle }} title={Object.entries(style.declarations).map(([k, v]) => `${k}: ${v}`).join("; ")}>
          Aa Bb Cc
        </div>
      </div>
      <span className="dw-mono" style={{ flexShrink: 0, fontSize: 10, color: "var(--dw-text-placeholder)" }}>{Object.keys(style.declarations).length} props</span>
    </div>
  );
}

function normalizeColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) return "#" + trimmed.slice(1).split("").map((c) => c + c).join("");
  return "#000000";
}

/* ─────────────────────────────── Code Tab ─────────────────────────────── */

function CodeTab({ entry }: { entry: ComponentEntry }) {
  const [content, setContent] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [absPath, setAbsPath] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setDirty(false); setStatus("idle"); setStatusMessage("");
    readFile(entry.sourceFile)
      .then((res) => { if (cancelled) return; setContent(res.content); setAbsPath(res.absPath); setLoaded(true); })
      .catch((err) => { if (cancelled) return; setContent(""); setLoaded(true); setStatus("error"); setStatusMessage(String(err)); });
    return () => { cancelled = true; };
  }, [entry.sourceFile]);

  const save = useCallback(async () => {
    setStatus("saving"); setStatusMessage("Saving…");
    try {
      await writeFile(entry.sourceFile, content);
      setDirty(false); setStatus("saved"); setStatusMessage("Saved — HMR update fired");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) { setStatus("error"); setStatusMessage(String(err)); }
  }, [content, entry.sourceFile]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = content.slice(0, start) + "  " + content.slice(end);
      setContent(next); setDirty(true);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (dirty && status !== "saving") void save();
    }
  };

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #e5e5e5", padding: "8px 12px", fontSize: 11 }}>
        <div className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#808080" }}>{entry.sourceFile}</div>
        {absPath && <a href={`vscode://file${absPath}`} style={{ flexShrink: 0, color: "#606060", textDecoration: "none" }} onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; e.currentTarget.style.color = "#101114"; }} onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; e.currentTarget.style.color = "#606060"; }}>Open in VS Code</a>}
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        readOnly={!loaded}
        onChange={(e) => { setContent(e.target.value); setDirty(true); }}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className="dw-mono"
        style={{
          flex: 1,
          resize: "none",
          whiteSpace: "pre",
          background: "#fafafa",
          padding: "8px 12px",
          fontSize: 11.5,
          lineHeight: 1.55,
          color: "#101114",
          outline: "none",
          tabSize: 2,
          border: "none",
        }}
      />
      <div style={{ borderTop: "1px solid #e5e5e5", padding: 12 }}>
        {statusMessage && <div style={{ marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: status === "error" ? "#e6365a" : "#1f9d55" }}>{statusMessage}</div>}
        <button onClick={save} disabled={!dirty || status === "saving"} className="dw-btn-primary">
          {status === "saving" ? "Saving…" : dirty ? "Save (⌘S)" : "No changes"}
        </button>
      </div>
    </div>
  );
}
