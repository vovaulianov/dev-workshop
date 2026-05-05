import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentEntry } from "../lib/storyLoader";
import type { Frame as FrameModel, SourceLoc } from "../lib/useCanvasState";
import { renderVariant } from "../lib/renderVariant";
import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import { PortalTargetProvider } from "../context/PortalTargetContext";
import { sourceForElement, type ElementSource } from "../lib/fiberUtils";
import { SelectionOverlay } from "./SelectionOverlay";
import { DistanceLayer } from "./DistanceLayer";

interface Props {
  /** The component story being rendered. */
  entry: ComponentEntry;
  /** Frame model from canvas state (id, position, label, overrides). */
  frame: FrameModel;
  /** Args injected from the Props tab — same across frames in Phase 1. */
  argsOverride: Record<string, unknown>;
  /** This frame is the active one (ranges of effects: selection, hover render). */
  isActive: boolean;
  /** Selected sourceLoc, only meaningful when isActive. */
  selectedLoc: SourceLoc | null;
  /** Select-on-click — fires whenever a real JSX element inside this frame is clicked. */
  onSelectElement: (
    loc: SourceLoc | null,
    element: Element | null,
    source: ElementSource | null,
  ) => void;
  /** Modifier-key state from the canvas (rendered in parent so wheel/keyboard
   *  share one observer). Used to surface hover outline, distance layer. */
  altHeld: boolean;
  /** Width preset for this frame's canvas. */
  width: number | "full";
}

/**
 * Single Figma-style frame on the canvas. Renders a fresh copy of the
 * story (its own React tree, own component-internal state) and keeps its
 * DOM in sync with `frame.overrides` via a MutationObserver — so style
 * tweaks in the inspector affect ONLY this frame, not the source code.
 */
export function Frame({
  entry,
  frame,
  argsOverride,
  isActive,
  selectedLoc,
  onSelectElement,
  altHeld,
  width,
}: Props) {
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<Element | null>(null);
  const variant = entry.variants[frame.variantIndex] ?? entry.variants[0]!;

  const rendered = useMemo(() => {
    try {
      return renderVariant(entry, variant, argsOverride ?? {});
    } catch (err) {
      return (
        <div style={{ padding: 16, fontSize: 13, color: "#dc2626" }}>
          Render error: {String(err)}
        </div>
      );
    }
  }, [entry, variant, argsOverride]);

  // Resolve the live element matching selectedLoc inside THIS frame's DOM.
  // Re-resolves on overrides changes (which trigger story re-renders) and
  // on selection changes.
  const selectedElement = useMemo(() => {
    if (!isActive || !selectedLoc || !canvas) return null;
    return findElementByLoc(canvas, selectedLoc);
  }, [isActive, selectedLoc, canvas, frame.overrides]);

  // Per-frame overrides → DOM sync. Tracks previously-applied properties so
  // that removing a key from overrides actually removes it from the DOM
  // (otherwise clearProperty never gets called and stale values stick).
  const lastAppliedRef = useRef<Map<SourceLoc, Set<string>>>(new Map());
  useEffect(() => {
    if (!canvas) return;

    const apply = () => {
      const next = new Map<SourceLoc, Set<string>>();
      for (const [loc, styles] of Object.entries(frame.overrides)) {
        const els = findAllElementsByLoc(canvas, loc);
        if (els.length === 0) continue;
        const propsThisRound = new Set<string>();
        for (const [cssProp, value] of Object.entries(styles)) {
          if (value === null || value === "") continue;
          for (const el of els) {
            (el as HTMLElement).style.setProperty(cssProp, value);
          }
          propsThisRound.add(cssProp);
        }
        next.set(loc, propsThisRound);
      }
      // Clear properties that were set last round but are no longer in overrides
      for (const [loc, prev] of lastAppliedRef.current.entries()) {
        const cur = next.get(loc) ?? new Set();
        const removed = [...prev].filter((p) => !cur.has(p));
        if (removed.length === 0) continue;
        const els = findAllElementsByLoc(canvas, loc);
        for (const el of els) {
          for (const cssProp of removed) (el as HTMLElement).style.removeProperty(cssProp);
        }
      }
      lastAppliedRef.current = next;
    };

    apply();
    // Re-apply whenever the user's component re-renders (subtree mutation).
    // Only react to childList/attributes that aren't ours — we filter by
    // checking that the changed attribute isn't `style` to avoid feedback loops.
    let scheduled = false;
    const mo = new MutationObserver((muts) => {
      // Skip if every mutation is a style attribute change WE just made
      const ours = muts.every(
        (m) => m.type === "attributes" && m.attributeName === "style",
      );
      if (ours) return;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        apply();
      });
    });
    mo.observe(canvas, { childList: true, subtree: true, attributes: true });
    return () => mo.disconnect();
  }, [canvas, frame.overrides]);

  // Click → select. Inspect-mode is implicit: if you're seeing the canvas at
  // all, you're in element mode (CanvasStage only renders inside Element tab).
  useEffect(() => {
    if (!canvas) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || !canvas.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      const src = sourceForElement(target);
      const loc = src ? `${src.file}:${src.line}:${src.column}` : null;
      onSelectElement(loc, target, src);
    };
    const onMove = (e: MouseEvent) => {
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

  // Drop hover when frame loses active focus
  useEffect(() => {
    if (!isActive) setHovered(null);
  }, [isActive]);

  return (
    <div
      style={{
        position: "absolute",
        left: frame.x,
        top: frame.y,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        // Figma-style label sits above the frame
      }}
    >
      <div
        style={{
          fontFamily: "var(--dw-font)",
          fontSize: 11,
          color: isActive ? "var(--dw-text)" : "var(--dw-text-muted)",
          fontWeight: isActive ? 600 : 400,
          padding: "0 4px",
          userSelect: "none",
        }}
      >
        {frame.label}
      </div>
      <div
        ref={setCanvas}
        data-dw-frame-id={frame.id}
        style={{
          position: "relative",
          // Transparent canvas with dashed gray outline — the rendered
          // component sits on top of the workshop's gray bg, mimicking
          // a Figma frame. Active state uses a darker dash so multiple
          // frames stay distinguishable in Phase 2.
          background: "transparent",
          border: isActive ? "1px dashed #909090" : "1px dashed #d4d4d4",
          borderRadius: 4,
          color: "#101114",
          ...(width === "full" ? { width: 430 } : { width: `${width}px` }),
          minHeight: 100,
          flexShrink: 0,
          transform: "translateZ(0)",
        }}
      >
        <PortalTargetProvider target={canvas}>
          <CanvasErrorBoundary resetKey={`${entry.id}:${frame.id}:${frame.variantIndex}`}>
            {rendered}
          </CanvasErrorBoundary>
        </PortalTargetProvider>
        {isActive && (
          <SelectionOverlay
            stage={canvas}
            hovered={hovered && hovered !== selectedElement ? hovered : null}
            selected={selectedElement}
          />
        )}
        {isActive && altHeld && selectedElement && hovered && hovered !== selectedElement && (
          <DistanceLayer stage={canvas} from={selectedElement} to={hovered} />
        )}
      </div>
    </div>
  );
}

function escapeAttr(value: string): string {
  // Escape backslash, quote, newline for use in [attr="..."] selectors.
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findElementByLoc(root: HTMLElement, loc: SourceLoc): Element | null {
  return root.querySelector(`[data-devsource="${escapeAttr(loc)}"]`);
}

function findAllElementsByLoc(root: HTMLElement, loc: SourceLoc): Element[] {
  return Array.from(root.querySelectorAll(`[data-devsource="${escapeAttr(loc)}"]`));
}
