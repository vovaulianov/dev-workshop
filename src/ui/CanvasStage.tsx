import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentEntry } from "../lib/storyLoader";
import type { UseCanvasState } from "../lib/useCanvasState";
import type { ElementSource } from "../lib/fiberUtils";
import { Frame } from "./Frame";
import { PickWinnerButton } from "./PickWinnerButton";

interface Props {
  entry: ComponentEntry;
  argsOverride: Record<string, unknown>;
  canvas: UseCanvasState;
  /** Width preset (per-frame). Phase 1: applies to all frames since there's
   *  always one. */
  width: number | "full";
  /** Notify the parent which DOM element is currently selected so the
   *  StylePanel can render the inspector. */
  onSelectElement: (next: { element: Element; source: ElementSource | null } | null) => void;
}

/**
 * Infinite pan/zoom canvas. Hosts one or more `<Frame>` instances laid out
 * in canvas-space coordinates. Phase 1: always exactly one frame; Phase 2
 * will support Cmd+D duplication.
 *
 * Interaction model (Figma-like):
 *  • Cmd/Ctrl + wheel       → zoom toward cursor
 *  • Wheel (no modifier)    → pan (deltaX, deltaY)
 *  • Space + drag           → pan
 *  • Middle-mouse drag      → pan
 */
export function CanvasStage({ entry, argsOverride, canvas, width, onSelectElement }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const { state, setPan, setZoom, setSelection } = canvas;

  // Modifier-key tracking — for Distance layer (⌥) and Space-pan.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // Don't capture space when typing in inputs
      const t = e.target as HTMLElement | null;
      const inField =
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.code === "Space" && !inField) {
        e.preventDefault();
        setSpaceHeld(true);
      }
      if (e.altKey) setAltHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
      if (!e.altKey) setAltHeld(false);
    };
    const onBlur = () => {
      setSpaceHeld(false);
      setAltHeld(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Wheel: pan or zoom (with Cmd/Ctrl). Zoom anchors at the cursor — standard
  // Figma trick: keep the world-point under the cursor stationary by adjusting
  // pan inversely to the zoom delta.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      // Don't intercept when inside scrollable child (none in our markup, but
      // belt-and-braces).
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        const rect = stage.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const oldZoom = state.zoom;
        const factor = Math.exp(-e.deltaY * 0.001);
        const newZoom = Math.max(0.25, Math.min(4, oldZoom * factor));
        if (newZoom === oldZoom) return;
        // Solve: cursor_world = (cursor - pan) / zoom must stay constant.
        // Therefore: newPan = cursor - cursor_world * newZoom
        const worldX = (cursorX - state.pan.x) / oldZoom;
        const worldY = (cursorY - state.pan.y) / oldZoom;
        const newPanX = cursorX - worldX * newZoom;
        const newPanY = cursorY - worldY * newZoom;
        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
      } else {
        // Pan
        setPan({ x: state.pan.x - e.deltaX, y: state.pan.y - e.deltaY });
      }
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [state.pan, state.zoom, setPan, setZoom]);

  // Space-pan or middle-mouse-pan. Drags the world.
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const isPanGesture = spaceHeld || e.button === 1;
      if (!isPanGesture) return;
      e.preventDefault();
      e.stopPropagation();
      const target = stageRef.current;
      if (!target) return;
      target.setPointerCapture(e.pointerId);
      setPanning(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const startPan = { ...state.pan };
      const onMove = (ev: PointerEvent) => {
        setPan({ x: startPan.x + (ev.clientX - startX), y: startPan.y + (ev.clientY - startY) });
      };
      const onUp = () => {
        setPanning(false);
        target.releasePointerCapture(e.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [spaceHeld, state.pan, setPan],
  );

  // Click on empty canvas area → deselect
  const onStageClick = useCallback(
    (e: React.MouseEvent) => {
      // Only if click landed on the stage/inner div, not inside a frame
      if (e.target === stageRef.current || e.target === innerRef.current) {
        setSelection({
          frameId: state.activeFrameId,
          sourceLoc: null,
        });
        onSelectElement(null);
      }
    },
    [setSelection, state.activeFrameId, onSelectElement],
  );

  const handleSelectInFrame = useCallback(
    (
      frameId: string,
      loc: string | null,
      element: Element | null,
      source: ElementSource | null,
    ) => {
      setSelection({ frameId, sourceLoc: loc });
      if (element) onSelectElement({ element, source });
      else onSelectElement(null);
    },
    [setSelection, onSelectElement],
  );

  const cursor = panning ? "grabbing" : spaceHeld ? "grab" : "default";

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
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onClick={onStageClick}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          background: "transparent",
          cursor,
          touchAction: "none",
        }}
      >
        <div
          ref={innerRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transform: `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`,
            transformOrigin: "0 0",
            // Important: width:0/height:0 so this div's bounding box doesn't
            // capture clicks meant for the stage. Frames are absolute children.
            width: 0,
            height: 0,
          }}
        >
          {state.frames.map((f) => (
            <Frame
              key={f.id}
              entry={entry}
              frame={f}
              argsOverride={argsOverride}
              isActive={f.id === state.activeFrameId}
              selectedLoc={f.id === state.activeFrameId ? state.selection.sourceLoc : null}
              onSelectElement={(loc, el, src) => handleSelectInFrame(f.id, loc, el, src)}
              altHeld={altHeld}
              width={width}
            />
          ))}
        </div>

        {/* Floating pick-winner above the active frame (for Phase 1, this lives
            in stage corner so it's discoverable; in Phase 2 it'll move
            adjacent to each frame). */}
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            pointerEvents: "auto",
          }}
        >
          <PickWinnerButton canvas={canvas} />
        </div>

        {/* Zoom indicator (bottom right) */}
        <div
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
            pointerEvents: "none",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 16, y: 16 });
            }}
            className="dw-pill"
            style={{ pointerEvents: "auto" }}
            title="reset view (1:1)"
          >
            {Math.round(state.zoom * 100)}%
          </button>
        </div>
      </div>
    </section>
  );
}
