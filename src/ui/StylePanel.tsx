import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentEntry } from "../lib/storyLoader";
import {
  applyTokenOverride,
  clearTokenOverrides,
  patchRootBlock,
  readAllTokens,
  readFile,
  writeFile,
  type TokenInfo,
} from "../lib/devApi";
import { inferPropDescriptors, type PropDescriptor } from "../lib/propsInference";
import { ElementInspector } from "./ElementInspector";
import type { SelectedElement } from "./ComponentPreview";

type Tab = "element" | "props" | "tokens" | "code";
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
}

export function StylePanel({
  entry,
  variantIndex,
  argsOverride,
  onArgsOverrideChange,
  selectedElement,
  onDeselectElement,
  tokensCssFile = "src/index.css",
}: Props) {
  const [tab, setTab] = useState<Tab>("props");

  useEffect(() => {
    if (selectedElement) setTab("element");
    else if (tab === "element") setTab("props");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement]);

  return (
    <aside style={{ display: "flex", height: "100%", minWidth: 0, flex: 1, flexDirection: "column", borderLeft: "1px solid #e5e5e5", background: "white", color: "#101114" }}>
      <div style={{ display: "flex", borderBottom: "1px solid #e5e5e5" }}>
        {selectedElement && <TabButton active={tab === "element"} onClick={() => setTab("element")}>Element</TabButton>}
        <TabButton active={tab === "props"} onClick={() => setTab("props")}>Props</TabButton>
        <TabButton active={tab === "tokens"} onClick={() => setTab("tokens")}>Tokens</TabButton>
        <TabButton active={tab === "code"} onClick={() => setTab("code")}>Code</TabButton>
      </div>

      {tab === "element" && selectedElement && (
        <ElementInspector
          key={`${selectedElement.source?.file}:${selectedElement.source?.line}:${selectedElement.source?.column}`}
          element={selectedElement.element}
          source={selectedElement.source}
          onDeselect={onDeselectElement}
        />
      )}
      {tab === "props" && (
        <PropsTab entry={entry} variantIndex={variantIndex} argsOverride={argsOverride} onArgsOverrideChange={onArgsOverrideChange} />
      )}
      {tab === "tokens" && <TokensTab tokensCssFile={tokensCssFile} />}
      {tab === "code" && <CodeTab entry={entry} />}
    </aside>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="dw-tab" data-active={active ? "true" : "false"}>
      {children}
    </button>
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
  return (
    <div style={{ borderRadius: 6, border: overridden ? "1px solid #e5e5e5" : "1px solid transparent", background: overridden ? "#fafafa" : "transparent", padding: "6px 8px" }}>
      <div style={{ marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label className="dw-mono" style={{ fontSize: 11, color: "#101114" }}>{key}</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 9, color: "#b3b3b3" }}>
          <span style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>{control.kind}</span>
          {overridden && <button onClick={onReset} className="dw-ghost">reset</button>}
        </div>
      </div>
      <PropControl control={control} value={value} onChange={onChange} />
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
    <div style={{ borderRadius: 4, border: "1px solid #e5e5e5", background: "white" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #e5e5e5", padding: "4px 8px" }}>
        <div className="dw-mono" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", color: "#b3b3b3" }}>object · {Object.keys(value).length} keys</div>
        <button onClick={onSwitchToRaw} className="dw-ghost">raw json</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {Object.entries(value).map(([k, v], idx, arr) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "90px 1fr", alignItems: "start", gap: 8, borderBottom: idx < arr.length - 1 ? "1px solid #f1f1f1" : undefined, padding: "4px 8px" }}>
            <label className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingTop: 4, fontSize: 10, color: "#404040" }} title={k}>{k}</label>
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
          display: "flex",
          height: 20,
          width: 36,
          alignItems: "center",
          justifyContent: checked ? "flex-end" : "flex-start",
          borderRadius: 999,
          border: checked ? "1px solid #101114" : "1px solid #e5e5e5",
          background: checked ? "#101114" : "#f4f4f4",
          transition: "background 120ms",
        }}
      >
        <span style={{ margin: "0 2px", height: 16, width: 16, borderRadius: 999, background: "white" }} />
      </button>
    );
  }
  if (type === "number") return <input type="number" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="dw-input dw-input-sm" />;
  if (type === "string") {
    const str = (value as string) ?? "";
    const isLong = str.length > 40 || str.includes("\n");
    if (isLong) return <textarea value={str} onChange={(e) => onChange(e.target.value)} rows={Math.min(5, Math.max(2, str.split("\n").length))} className="dw-input dw-input-sm" style={{ resize: "none", lineHeight: 1.4 }} spellCheck={false} />;
    return <input type="text" value={str} onChange={(e) => onChange(e.target.value)} className="dw-input dw-input-sm" />;
  }
  if (value === undefined) return <input type="text" value="" placeholder="undefined — type to set" onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} className="dw-input dw-input-sm" style={{ fontStyle: "normal" }} />;
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

function PropControl({ control, value, onChange }: { control: PropDescriptor["control"]; value: unknown; onChange: (v: unknown) => void }) {
  if (control.kind === "boolean") {
    const checked = Boolean(value);
    return (
      <button
        onClick={() => onChange(!checked)}
        style={{
          display: "flex",
          height: 24,
          width: 44,
          alignItems: "center",
          justifyContent: checked ? "flex-end" : "flex-start",
          borderRadius: 999,
          border: checked ? "1px solid #101114" : "1px solid #e5e5e5",
          background: checked ? "#101114" : "#f4f4f4",
          transition: "background 120ms",
        }}
      >
        <span style={{ margin: "0 2px", height: 20, width: 20, borderRadius: 999, background: "white", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }} />
      </button>
    );
  }
  if (control.kind === "number") return <input type="number" value={typeof value === "number" ? value : ""} onChange={(e) => { const v = e.target.value; onChange(v === "" ? undefined : Number(v)); }} className="dw-input" />;
  if (control.kind === "select") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {control.options.map((opt) => (
          <button key={opt} onClick={() => onChange(opt)} className="dw-pill" data-active={value === opt ? "true" : "false"}>{opt}</button>
        ))}
      </div>
    );
  }
  if (control.kind === "json") return <JsonControl value={value} onChange={onChange} />;
  if (control.kind === "node") {
    const isScalar = value === null || value === undefined || typeof value === "string";
    if (!isScalar) return <div className="dw-mono" style={{ borderRadius: 4, background: "#f4f4f4", padding: "4px 8px", fontSize: 10, color: "#808080" }}>(ReactNode — not editable)</div>;
    return <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="dw-input" />;
  }
  return <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="dw-input" />;
}

/* ─────────────────────────────── Tokens Tab ─────────────────────────────── */

function TokensTab({ tokensCssFile }: { tokensCssFile: string }) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => { setTokens(readAllTokens()); }, []);

  const handleChange = useCallback((name: string, value: string) => { applyTokenOverride(name, value); setOverrides((prev) => ({ ...prev, [name]: value })); }, []);
  const reset = useCallback(() => { clearTokenOverrides(Object.keys(overrides)); setOverrides({}); setTokens(readAllTokens()); setStatus("idle"); setStatusMessage(""); }, [overrides]);
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
      <div style={{ flex: 1, overflowY: "auto", padding: 12, fontSize: 12 }}>
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
  const dirty = overrideValue !== undefined;
  const handleInput = (v: string) => onChange(token.name, v);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 8, borderRadius: 6, background: dirty ? "#fff4f4" : "transparent", padding: "4px 8px" }}>
      <div style={{ minWidth: 0 }}>
        <div className="dw-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "#404040" }}>{token.name}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {token.kind === "color" ? (
          <>
            <input type="color" value={normalizeColor(value)} onChange={(e) => handleInput(e.target.value)} style={{ height: 24, width: 24, cursor: "pointer", borderRadius: 4, border: "1px solid #e5e5e5", background: "white", padding: 0 }} />
            <input type="text" value={value} onChange={(e) => handleInput(e.target.value)} className="dw-input dw-input-sm" style={{ width: 80 }} />
          </>
        ) : (
          <input type="text" value={value} onChange={(e) => handleInput(e.target.value)} className="dw-input dw-input-sm" style={{ width: 144 }} />
        )}
      </div>
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
