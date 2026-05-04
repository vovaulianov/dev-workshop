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
    <aside className="flex h-full min-w-0 flex-1 flex-col border-l border-[#e5e5e5] bg-white text-[#101114]">
      <div className="flex border-b border-[#e5e5e5]">
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
    <button
      onClick={onClick}
      className={["flex-1 px-4 py-2.5 text-[13px] font-medium transition-colors", active ? "bg-[#f4f4f4] text-[#101114]" : "text-[#808080] hover:bg-[#fafafa] hover:text-[#101114]"].join(" ")}
    >
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
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#b3b3b3]">{entry.name} · {variant.name}</div>
          {dirty && <button onClick={resetAll} className="text-[10px] text-[#606060] hover:text-[#101114]">reset all</button>}
        </div>
        <div className="flex flex-col gap-2.5">
          {descriptors.map((d) => <PropRow key={d.key} descriptor={d} value={currentArgs[d.key]} overridden={d.key in argsOverride} onChange={(v) => setArg(d.key, v)} onReset={() => resetOne(d.key)} />)}
          {descriptors.length === 0 && <div className="px-1 py-2 text-[11px] text-[#808080]">No props documented in stories for this component.</div>}
        </div>
      </div>
    </div>
  );
}

function PropRow({ descriptor, value, overridden, onChange, onReset }: { descriptor: PropDescriptor; value: unknown; overridden: boolean; onChange: (v: unknown) => void; onReset: () => void }) {
  const { key, control } = descriptor;
  return (
    <div className={["rounded-md border border-transparent px-2 py-1.5", overridden ? "border-[#e5e5e5] bg-[#fafafa]" : ""].join(" ")}>
      <div className="mb-1 flex items-center justify-between">
        <label className="font-mono text-[11px] text-[#101114]">{key}</label>
        <div className="flex items-center gap-2 text-[9px] text-[#b3b3b3]">
          <span className="uppercase tracking-wider">{control.kind}</span>
          {overridden && <button onClick={onReset} className="rounded px-1 py-0.5 text-[#606060] hover:bg-[#ebebeb] hover:text-[#101114]">reset</button>}
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
    <div className="rounded border border-[#e5e5e5] bg-white">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] px-2 py-1">
        <div className="font-mono text-[9px] uppercase tracking-wider text-[#b3b3b3]">object · {Object.keys(value).length} keys</div>
        <button onClick={onSwitchToRaw} className="rounded bg-[#f4f4f4] px-1.5 py-0.5 text-[9px] text-[#606060] hover:bg-[#ebebeb]">raw json</button>
      </div>
      <div className="flex flex-col">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[90px_1fr] items-start gap-2 border-b border-[#f1f1f1] px-2 py-1 last:border-b-0">
            <label className="truncate pt-1 font-mono text-[10px] text-[#404040]" title={k}>{k}</label>
            <div className="min-w-0"><ObjectValueControl value={v} type={v === null ? "null" : typeof v} onChange={(nv) => setKey(k, nv)} /></div>
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
      <button onClick={() => onChange(!checked)} className={["flex h-5 w-9 items-center rounded-full border transition-colors", checked ? "justify-end border-[#101114] bg-[#101114]" : "justify-start border-[#e5e5e5] bg-[#f4f4f4]"].join(" ")}>
        <span className="mx-0.5 h-4 w-4 rounded-full bg-white" />
      </button>
    );
  }
  if (type === "number") return <input type="number" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="w-full rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] text-[#101114] outline-none focus:bg-[#ebebeb]" />;
  if (type === "string") {
    const str = (value as string) ?? "";
    const isLong = str.length > 40 || str.includes("\n");
    if (isLong) return <textarea value={str} onChange={(e) => onChange(e.target.value)} rows={Math.min(5, Math.max(2, str.split("\n").length))} className="w-full resize-none rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] leading-[1.4] text-[#101114] outline-none focus:bg-[#ebebeb]" spellCheck={false} />;
    return <input type="text" value={str} onChange={(e) => onChange(e.target.value)} className="w-full rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] text-[#101114] outline-none focus:bg-[#ebebeb]" />;
  }
  if (value === undefined) return <input type="text" value="" placeholder="undefined — type to set" onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} className="w-full rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] text-[#101114] placeholder:italic placeholder:text-[#b3b3b3] outline-none focus:bg-[#ebebeb]" />;
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
      {onSwitchToObject && <div className="mb-1 flex justify-end"><button onClick={onSwitchToObject} className="rounded bg-[#f4f4f4] px-1.5 py-0.5 text-[9px] text-[#606060] hover:bg-[#ebebeb]">back to keys</button></div>}
      <textarea value={safeText} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} rows={Math.min(14, Math.max(3, safeText.split("\n").length))} className="w-full resize-y rounded bg-[#f4f4f4] px-2 py-1 font-mono text-[10px] leading-[1.5] text-[#101114] outline-none focus:bg-[#ebebeb]" spellCheck={false} />
      {error && <div className="mt-1 text-[10px] text-[#e6365a]">{error}</div>}
    </div>
  );
}

function PropControl({ control, value, onChange }: { control: PropDescriptor["control"]; value: unknown; onChange: (v: unknown) => void }) {
  if (control.kind === "boolean") {
    const checked = Boolean(value);
    return (
      <button onClick={() => onChange(!checked)} className={["flex h-6 w-11 items-center rounded-full border transition-colors", checked ? "justify-end border-[#101114] bg-[#101114]" : "justify-start border-[#e5e5e5] bg-[#f4f4f4]"].join(" ")}>
        <span className="mx-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform" />
      </button>
    );
  }
  if (control.kind === "number") return <input type="number" value={typeof value === "number" ? value : ""} onChange={(e) => { const v = e.target.value; onChange(v === "" ? undefined : Number(v)); }} className="w-full rounded bg-[#f4f4f4] px-2 py-1 font-mono text-[11px] text-[#101114] outline-none focus:bg-[#ebebeb]" />;
  if (control.kind === "select") {
    return (
      <div className="flex flex-wrap gap-1">
        {control.options.map((opt) => <button key={opt} onClick={() => onChange(opt)} className={["rounded px-2 py-1 font-mono text-[10px] transition-colors", value === opt ? "bg-[#101114] text-white" : "bg-[#f4f4f4] text-[#606060] hover:bg-[#ebebeb]"].join(" ")}>{opt}</button>)}
      </div>
    );
  }
  if (control.kind === "json") return <JsonControl value={value} onChange={onChange} />;
  if (control.kind === "node") {
    const isScalar = value === null || value === undefined || typeof value === "string";
    if (!isScalar) return <div className="rounded bg-[#f4f4f4] px-2 py-1 font-mono text-[10px] text-[#808080]">(ReactNode — not editable)</div>;
    return <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="w-full rounded bg-[#f4f4f4] px-2 py-1 font-mono text-[11px] text-[#101114] outline-none focus:bg-[#ebebeb]" />;
  }
  return <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className="w-full rounded bg-[#f4f4f4] px-2 py-1 font-mono text-[11px] text-[#101114] outline-none focus:bg-[#ebebeb]" />;
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
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 py-3 text-[12px]">
        {Object.entries(groups).map(([group, tokensInGroup]) => (
          <div key={group} className="mb-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#b3b3b3]">{group}</div>
            <div className="flex flex-col gap-1.5">
              {tokensInGroup.map((t) => <TokenRow key={t.name} token={t} overrideValue={overrides[t.name]} onChange={handleChange} />)}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-[#e5e5e5] p-3">
        {statusMessage && <div className={["mb-2 truncate text-[11px]", status === "error" ? "text-[#e6365a]" : "text-[#1f9d55]"].join(" ")}>{statusMessage}</div>}
        <div className="flex gap-2">
          <button onClick={reset} disabled={!dirty} className="flex-1 rounded-md border border-[#e5e5e5] bg-white py-2 text-[12px] text-[#606060] transition-colors hover:bg-[#fafafa] disabled:opacity-30">Reset</button>
          <button onClick={save} disabled={!dirty || status === "saving"} className="flex-1 rounded-md bg-[#101114] py-2 text-[12px] font-semibold text-white transition-opacity disabled:opacity-30">
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
    <div className={["grid grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1", dirty ? "bg-[#fff4f4]" : ""].join(" ")}>
      <div className="min-w-0"><div className="truncate font-mono text-[11px] text-[#404040]">{token.name}</div></div>
      <div className="flex items-center gap-1.5">
        {token.kind === "color" ? (
          <>
            <input type="color" value={normalizeColor(value)} onChange={(e) => handleInput(e.target.value)} className="h-6 w-6 cursor-pointer rounded border border-[#e5e5e5] bg-white" />
            <input type="text" value={value} onChange={(e) => handleInput(e.target.value)} className="w-20 rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] text-[#101114] outline-none focus:bg-[#ebebeb]" />
          </>
        ) : (
          <input type="text" value={value} onChange={(e) => handleInput(e.target.value)} className="w-36 rounded bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] text-[#101114] outline-none focus:bg-[#ebebeb]" />
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
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] px-3 py-2 text-[11px]">
        <div className="truncate font-mono text-[#808080]">{entry.sourceFile}</div>
        {absPath && <a href={`vscode://file${absPath}`} className="shrink-0 text-[#606060] underline-offset-2 hover:text-[#101114] hover:underline">Open in VS Code</a>}
      </div>
      <textarea ref={textareaRef} value={content} readOnly={!loaded} onChange={(e) => { setContent(e.target.value); setDirty(true); }} onKeyDown={handleKeyDown} spellCheck={false} className="flex-1 resize-none whitespace-pre bg-[#fafafa] px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-[#101114] outline-none" style={{ tabSize: 2 }} />
      <div className="border-t border-[#e5e5e5] p-3">
        {statusMessage && <div className={["mb-2 truncate text-[11px]", status === "error" ? "text-[#e6365a]" : "text-[#1f9d55]"].join(" ")}>{statusMessage}</div>}
        <button onClick={save} disabled={!dirty || status === "saving"} className="w-full rounded-md bg-[#101114] py-2 text-[12px] font-semibold text-white transition-opacity disabled:opacity-30">
          {status === "saving" ? "Saving…" : dirty ? "Save (⌘S)" : "No changes"}
        </button>
      </div>
    </div>
  );
}
