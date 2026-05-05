import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentEntry } from "../lib/storyLoader";
import { SelectionOverlay } from "./SelectionOverlay";
import { DistanceLayer } from "./DistanceLayer";
import { sourceForElement } from "../lib/fiberUtils";
import type { ElementSource } from "../lib/fiberUtils";
import { PortalTargetProvider } from "../context/PortalTargetContext";
import { renderVariant } from "../lib/renderVariant";
import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import { CanvasStage } from "./CanvasStage";
import type { UseCanvasState } from "../lib/useCanvasState";

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
  /** When true (Element tab is active), the workspace becomes a Figma-like
   *  canvas (pan/zoom + multi-frame). Outside Element tab, falls back to the
   *  legacy single-canvas stage with click-to-select gated by ⌘. */
  inspectMode?: boolean;
  /** Canvas state — only consulted when `inspectMode` is true. */
  canvas?: UseCanvasState;
}

const WIDTH_PRESETS = [320, 390, 430, 768, 1024];
type Width = number | "full";

export function ComponentPreview({
  entry,
  variantIndex,
  argsOverride,
  selected,
  onSelectElement,
  hideSelectionOutline,
  inspectMode = false,
  canvas,
}: Props) {
  const variant = entry.variants[variantIndex] ?? entry.variants[0]!;
  const [width, setWidth] = useState<Width>(430);
  const stageRef = useRef<HTMLDivElement>(null);
  const [legacyCanvas, setLegacyCanvas] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [metaHeld, setMetaHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);

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

  // Modifier-key tracking — kept on the legacy stage; CanvasStage tracks its
  // own (Space/Cmd/Alt for pan/zoom/distance).
  useEffect(() => {
    const sync = (e: KeyboardEvent | MouseEvent) => {
      setMetaHeld(e.metaKey || e.ctrlKey);
      setAltHeld(e.altKey);
    };
    const blur = () => {
      setMetaHeld(false);
      setAltHeld(false);
    };
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

  // Legacy canvas click/hover handlers — only active when NOT in inspectMode.
  useEffect(() => {
    if (inspectMode) return; // CanvasStage handles its own events
    if (!legacyCanvas) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as Element | null;
      if (!target || !legacyCanvas.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      onSelectElement({ element: target, source: sourceForElement(target) });
    };
    const onMove = (e: MouseEvent) => {
      const active = (e.metaKey || e.ctrlKey) || e.altKey;
      if (!active) {
        setHovered(null);
        return;
      }
      const t = e.target as Element | null;
      if (t && legacyCanvas.contains(t)) setHovered(t);
    };
    const onLeave = () => setHovered(null);
    legacyCanvas.addEventListener("click", onClick, true);
    legacyCanvas.addEventListener("mousemove", onMove);
    legacyCanvas.addEventListener("mouseleave", onLeave);
    return () => {
      legacyCanvas.removeEventListener("click", onClick, true);
      legacyCanvas.removeEventListener("mousemove", onMove);
      legacyCanvas.removeEventListener("mouseleave", onLeave);
    };
  }, [legacyCanvas, onSelectElement, inspectMode]);

  useEffect(() => {
    if (!metaHeld && !altHeld) setHovered(null);
  }, [metaHeld, altHeld]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onSelectElement(null);
    setHovered(null);
  }, [entry.id, variantIndex]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (width === "full") return;
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: MouseEvent) =>
        setWidth(
          Math.round(Math.max(120, Math.min(2000, startWidth + (ev.clientX - startX) * 2))),
        );
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width],
  );

  const widthLabel = width === "full" ? "full" : `${width}px`;

  const hint = inspectMode ? (
    <>
      <kbd className="dw-kbd">space</kbd> + drag to pan ·{" "}
      <kbd className="dw-kbd">⌘</kbd>+wheel zoom · click element to select ·{" "}
      <kbd className="dw-kbd">⌥</kbd> for spacing
    </>
  ) : (
    <>
      {" "}
      <kbd className="dw-kbd">⌘</kbd> + click or Element tab to select ·{" "}
      <kbd className="dw-kbd">⌥</kbd> for spacing · <kbd className="dw-kbd">esc</kbd> hides outline
    </>
  );

  return (
    <section
      style={{
        display: "flex",
        height: "100%",
        flex: 1,
        flexDirection: "column",
        background: "transparent",
        color: "#101114",
        minWidth: 0,
        gap: 8,
      }}
    >
      <div className="dw-card" style={{ flexShrink: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "12px 16px",
          }}
        >
          <div style={{ display: "flex", minWidth: 0, alignItems: "baseline", gap: 12 }}>
            <h1 style={{ flexShrink: 0, fontSize: 15, fontWeight: 600, color: "#101114", margin: 0 }}>
              {entry.name}
            </h1>
            {entry.variants[variantIndex] && entry.variants.length > 1 && (
              <div
                style={{
                  flexShrink: 0,
                  borderRadius: 999,
                  background: "#f4f4f4",
                  padding: "2px 8px",
                  fontSize: 11,
                  color: "#606060",
                }}
              >
                {entry.variants[variantIndex]!.name}
              </div>
            )}
            <div
              className="dw-mono"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 11,
                color: "#b3b3b3",
              }}
            >
              {entry.sourceFile}
            </div>
          </div>
          <div className="dw-mono" style={{ fontSize: 10, color: "#b3b3b3", flexShrink: 0 }}>
            {hint}
          </div>
        </header>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderTop: "1px solid #f1f1f1",
            padding: "8px 16px",
          }}
        >
          <div className="dw-section-label">Width</div>
          <div className="dw-segments" style={{ flexShrink: 0 }}>
            {WIDTH_PRESETS.map((w) => (
              <button
                key={w}
                onClick={() => setWidth(w)}
                className="dw-segment"
                data-active={width === w ? "true" : "false"}
                style={{ minWidth: 44, padding: "0 10px", height: 26, fontSize: 12 }}
              >
                {w}
              </button>
            ))}
            <button
              onClick={() => setWidth("full")}
              className="dw-segment"
              data-active={width === "full" ? "true" : "false"}
              style={{ minWidth: 44, padding: "0 10px", height: 26, fontSize: 12 }}
            >
              full
            </button>
          </div>
          <div style={{ marginLeft: 8, display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="number"
              value={width === "full" ? "" : width}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v) && v > 0) setWidth(v);
              }}
              placeholder="custom"
              className="dw-input-md"
              style={{ width: 80 }}
            />
          </div>
          <div className="dw-mono" style={{ marginLeft: "auto", fontSize: 11, color: "#b3b3b3" }}>
            {widthLabel}
          </div>
        </div>
      </div>

      {inspectMode && canvas ? (
        <CanvasStage
          entry={entry}
          argsOverride={argsOverride ?? {}}
          canvas={canvas}
          width={width}
          onSelectElement={onSelectElement}
        />
      ) : (
        <div
          ref={stageRef}
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            alignItems: "flex-start",
            justifyContent: "center",
            overflow: "auto",
            background: "transparent",
            padding: "8px 4px",
            ...(metaHeld ? { cursor: "crosshair" } : null),
          }}
        >
          <div
            ref={setLegacyCanvas}
            style={{
              position: "relative",
              flexShrink: 0,
              color: "#101114",
              ...(width === "full"
                ? { width: "100%", minHeight: "100%" }
                : { width: `${width}px`, minHeight: "100%" }),
              transform: "translateZ(0)",
            }}
          >
            <PortalTargetProvider target={legacyCanvas}>
              <CanvasErrorBoundary resetKey={`${entry.id}:${variantIndex}`}>
                {rendered}
              </CanvasErrorBoundary>
            </PortalTargetProvider>
            {width !== "full" && (
              <div
                onMouseDown={startDrag}
                title="Drag to resize"
                style={{
                  position: "absolute",
                  top: 0,
                  right: -12,
                  height: "100%",
                  width: 12,
                  cursor: "ew-resize",
                }}
              />
            )}
            <SelectionOverlay
              stage={legacyCanvas}
              hovered={metaHeld ? hovered : null}
              selected={hideSelectionOutline ? null : selected?.element ?? null}
            />
            {selected?.element && altHeld && hovered && hovered !== selected.element && (
              <DistanceLayer stage={legacyCanvas} from={selected.element} to={hovered} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
