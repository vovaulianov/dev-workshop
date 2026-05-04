import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { ComponentEntry, StoryVariant } from "../lib/storyLoader";
import { SelectionOverlay } from "./SelectionOverlay";
import { DistanceLayer } from "./DistanceLayer";
import { sourceForElement } from "../lib/fiberUtils";
import type { ElementSource } from "../lib/fiberUtils";
import { PortalTargetProvider } from "../context/PortalTargetContext";

export interface SelectedElement {
  element: Element;
  source: ElementSource | null;
}

interface Props {
  entry: ComponentEntry;
  variantIndex: number;
  onVariantChange?: (index: number) => void;
  argsOverride?: Record<string, unknown>;
  selected: SelectedElement | null;
  onSelectElement: (next: SelectedElement | null) => void;
  hideSelectionOutline?: boolean;
}

type AnyArgs = Record<string, unknown>;
type Decorator = (Story: ComponentType, context?: unknown) => ReactNode;

const WIDTH_PRESETS = [320, 390, 430, 768, 1024];
type Width = number | "full";

function renderVariant(entry: ComponentEntry, variant: StoryVariant, argsOverride: AnyArgs): ReactNode {
  const mergedArgs: AnyArgs = { ...(variant.args as AnyArgs), ...argsOverride };
  const baseRender = variant.render
    ? () => variant.render!(mergedArgs, { args: mergedArgs })
    : () => createElement(entry.component, mergedArgs);

  const decorators: Decorator[] = [...(entry.metaDecorators ?? []), ...(variant.decorators ?? [])];
  if (decorators.length === 0) return baseRender();

  let storyFn: () => ReactNode = baseRender;
  for (const decorator of [...decorators].reverse()) {
    const prev = storyFn;
    const StoryComponent: ComponentType = () => prev() as ReactNode;
    storyFn = () => decorator(StoryComponent, { args: variant.args });
  }
  return storyFn();
}

export function ComponentPreview({ entry, variantIndex, argsOverride, selected, onSelectElement, hideSelectionOutline }: Props) {
  const variant = entry.variants[variantIndex] ?? entry.variants[0]!;
  const [width, setWidth] = useState<Width>(430);
  const stageRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [metaHeld, setMetaHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);

  const rendered = useMemo(() => {
    try {
      return renderVariant(entry, variant, argsOverride ?? {});
    } catch (err) {
      return <div className="p-4 text-sm text-red-600">Render error: {String(err)}</div>;
    }
  }, [entry, variant, argsOverride]);

  useEffect(() => {
    const sync = (e: KeyboardEvent | MouseEvent) => { setMetaHeld(e.metaKey || e.ctrlKey); setAltHeld(e.altKey); };
    const blur = () => { setMetaHeld(false); setAltHeld(false); };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("mousemove", sync);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("mousemove", sync);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    if (!canvas) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as Element | null;
      if (!target || !canvas.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      onSelectElement({ element: target, source: sourceForElement(target) });
    };
    const onMove = (e: MouseEvent) => {
      const active = (e.metaKey || e.ctrlKey) || e.altKey;
      if (!active) { setHovered(null); return; }
      const t = e.target as Element | null;
      if (t && canvas.contains(t)) setHovered(t);
    };
    const onLeave = () => setHovered(null);
    canvas.addEventListener("click", onClick, true);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      canvas.removeEventListener("click", onClick, true);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [canvas, onSelectElement]);

  useEffect(() => { if (!metaHeld && !altHeld) setHovered(null); }, [metaHeld, altHeld]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSelectElement(null); setHovered(null); }, [entry.id, variantIndex]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    if (width === "full") return;
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => setWidth(Math.round(Math.max(120, Math.min(2000, startWidth + (ev.clientX - startX) * 2))));
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const widthLabel = width === "full" ? "full" : `${width}px`;

  return (
    <section className="flex h-full flex-1 flex-col bg-white text-[#101114]">
      <header className="flex items-center justify-between gap-4 border-b border-[#e5e5e5] px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="shrink-0 text-[15px] font-semibold text-[#101114]">{entry.name}</h1>
          {entry.variants[variantIndex] && entry.variants.length > 1 && (
            <div className="shrink-0 rounded-full bg-[#f4f4f4] px-2 py-0.5 text-[11px] text-[#606060]">{entry.variants[variantIndex]!.name}</div>
          )}
          <div className="truncate font-mono text-[11px] text-[#b3b3b3]">{entry.sourceFile}</div>
        </div>
        <div className="font-mono text-[10px] text-[#b3b3b3]">
          <kbd className="rounded bg-[#f4f4f4] px-1 py-0.5">⌘</kbd>+click to select ·{" "}
          <kbd className="rounded bg-[#f4f4f4] px-1 py-0.5">⌥</kbd>+hover for distance ·{" "}
          <kbd className="rounded bg-[#f4f4f4] px-1 py-0.5">esc</kbd> to hide outline
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-[#e5e5e5] px-4 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#b3b3b3]">Width</div>
        <div className="flex gap-1">
          {WIDTH_PRESETS.map((w) => (
            <button key={w} onClick={() => setWidth(w)} className={["rounded px-2 py-1 font-mono text-[10px] transition-colors", width === w ? "bg-[#101114] text-white" : "bg-[#f4f4f4] text-[#606060] hover:bg-[#ebebeb]"].join(" ")}>{w}</button>
          ))}
          <button onClick={() => setWidth("full")} className={["rounded px-2 py-1 font-mono text-[10px] transition-colors", width === "full" ? "bg-[#101114] text-white" : "bg-[#f4f4f4] text-[#606060] hover:bg-[#ebebeb]"].join(" ")}>full</button>
        </div>
        <div className="ml-2 flex items-center gap-1">
          <input
            type="number"
            value={width === "full" ? "" : width}
            onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v > 0) setWidth(v); }}
            placeholder="custom"
            className="w-20 rounded bg-[#f4f4f4] px-2 py-1 font-mono text-[10px] text-[#101114] outline-none focus:bg-[#ebebeb]"
          />
          <span className="font-mono text-[10px] text-[#b3b3b3]">px</span>
        </div>
        <div className="ml-auto font-mono text-[10px] text-[#b3b3b3]">{widthLabel}</div>
      </div>

      <div
        ref={stageRef}
        className="flex flex-1 items-start justify-center overflow-auto bg-[#F4F4F4] p-4"
        style={metaHeld ? { cursor: "crosshair" } : undefined}
      >
        <div
          ref={setCanvas}
          className="relative shrink-0 text-[#101114]"
          style={{
            ...(width === "full" ? { width: "100%", minHeight: "100%" } : { width: `${width}px`, minHeight: "100%" }),
            transform: "translateZ(0)",
          }}
        >
          <PortalTargetProvider target={canvas}>
            {rendered}
          </PortalTargetProvider>
          {width !== "full" && <div onMouseDown={startDrag} title="Drag to resize" className="absolute top-0 -right-3 h-full w-3 cursor-ew-resize" />}
          <SelectionOverlay
            stage={canvas}
            hovered={metaHeld ? hovered : null}
            selected={hideSelectionOutline ? null : (selected?.element ?? null)}
          />
          {selected?.element && altHeld && hovered && hovered !== selected.element && (
            <DistanceLayer stage={canvas} from={selected.element} to={hovered} />
          )}
        </div>
      </div>
    </section>
  );
}
