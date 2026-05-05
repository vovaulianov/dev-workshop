import { useEffect, useState } from "react";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  stage: HTMLElement | null;
  hovered: Element | null;
  selected: Element | null;
  /** Live drag callback: while the user drags a resize handle, this fires
   *  with the proposed new size in CSS pixels. Frame forwards it into the
   *  active frame's overrides as `width`/`height`. */
  onResize?: (next: { width: number; height: number }) => void;
  /** Live body-drag callback: a `transform: translate(...)` string the
   *  selected element should adopt while the user drags it. Frame writes
   *  it into the active frame's overrides on each pointermove tick. */
  onMove?: (transform: string) => void;
}

function getRelativeRect(el: Element, stage: HTMLElement): Rect | null {
  const a = el.getBoundingClientRect();
  const b = stage.getBoundingClientRect();
  if (a.width === 0 && a.height === 0) return null;
  // The stage may be sitting inside a CSS-transformed ancestor (the
  // CanvasStage pan/zoom container). getBoundingClientRect returns
  // post-transform pixels; we need pre-transform CSS coords because the
  // overlay div's `top/left/width/height` are themselves subject to the
  // same ancestor transform. Compare visual width to layout width to
  // recover the cumulative scale factor.
  const scale = stage.offsetWidth > 0 ? b.width / stage.offsetWidth : 1;
  const safeScale = scale > 0 ? scale : 1;
  return {
    top: (a.top - b.top) / safeScale + stage.scrollTop,
    left: (a.left - b.left) / safeScale + stage.scrollLeft,
    width: a.width / safeScale,
    height: a.height / safeScale,
  };
}

function useRect(el: Element | null, stage: HTMLElement | null, tick: number) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!el || !stage) {
      setRect(null);
      return;
    }
    const update = () => setRect(getRelativeRect(el, stage));
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(stage);

    const mo = new MutationObserver(update);
    mo.observe(stage, { attributes: true, childList: true, subtree: true });

    stage.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      ro.disconnect();
      mo.disconnect();
      stage.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [el, stage, tick]);

  return rect;
}

export function SelectionOverlay({ stage, hovered, selected, onResize, onMove }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => setTick((t) => t + 1), [hovered, selected]);

  const hoverRect = useRect(hovered && hovered !== selected ? hovered : null, stage, tick);
  const selectedRect = useRect(selected, stage, tick);

  // Cumulative ancestor scale so resize-handle visuals stay constant on
  // screen and pointer deltas convert to CSS coords correctly.
  const scale = stage && stage.offsetWidth > 0
    ? stage.getBoundingClientRect().width / stage.offsetWidth
    : 1;
  const safeScale = scale > 0 ? scale : 1;

  return (
    <>
      {hoverRect && (
        <div
          style={{
            position: "absolute",
            pointerEvents: "none",
            top: hoverRect.top,
            left: hoverRect.left,
            width: hoverRect.width,
            height: hoverRect.height,
            border: "2px dashed rgba(59, 130, 246, 0.7)",
            zIndex: 999,
          }}
        />
      )}
      {selectedRect && (
        <div
          style={{
            position: "absolute",
            pointerEvents: "none",
            top: selectedRect.top,
            left: selectedRect.left,
            width: selectedRect.width,
            height: selectedRect.height,
            border: "2px solid #3b82f6",
            boxShadow: "0 0 0 1px rgba(59, 130, 246, 0.25)",
            zIndex: 1000,
          }}
        />
      )}
      {selectedRect && onMove && selected && (
        <DragHandle rect={selectedRect} scale={safeScale} selected={selected} onMove={onMove} />
      )}
      {selectedRect && onResize && (
        <ResizeHandles rect={selectedRect} scale={safeScale} onResize={onResize} />
      )}
    </>
  );
}

function DragHandle({
  rect,
  scale,
  selected,
  onMove,
}: {
  rect: Rect;
  scale: number;
  selected: Element;
  onMove: (transform: string) => void;
}) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    // Read existing transform translate so subsequent drags accumulate
    // instead of resetting to 0,0 each time.
    const computed = getComputedStyle(selected).transform;
    let startTx = 0;
    let startTy = 0;
    if (computed && computed !== "none") {
      try {
        const m = new DOMMatrixReadOnly(computed);
        startTx = m.m41;
        startTy = m.m42;
      } catch {
        /* unparseable — start from 0 */
      }
    }

    const onPointerMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startMouseX) / scale;
      const dy = (ev.clientY - startMouseY) / scale;
      const newTx = startTx + dx;
      const newTy = startTy + dy;
      onMove(`translate(${newTx.toFixed(1)}px, ${newTy.toFixed(1)}px)`);
    };
    const onPointerUp = (ev: PointerEvent) => {
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
    };
    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  };

  return (
    <div
      data-dw-drag="body"
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        cursor: "move",
        // Below resize handles (1010) so corners/edges still take priority
        // for pointer events, above the outline (1000) and the user's
        // component DOM so we capture the body drag.
        zIndex: 1005,
        background: "transparent",
        touchAction: "none",
      }}
    />
  );
}

type HandlePos = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: Array<{ pos: HandlePos; cursor: string }> = [
  { pos: "nw", cursor: "nwse-resize" },
  { pos: "n", cursor: "ns-resize" },
  { pos: "ne", cursor: "nesw-resize" },
  { pos: "e", cursor: "ew-resize" },
  { pos: "se", cursor: "nwse-resize" },
  { pos: "s", cursor: "ns-resize" },
  { pos: "sw", cursor: "nesw-resize" },
  { pos: "w", cursor: "ew-resize" },
];

function ResizeHandles({
  rect,
  scale,
  onResize,
}: {
  rect: Rect;
  scale: number;
  onResize: (next: { width: number; height: number }) => void;
}) {
  // Render handles at constant 10px on screen regardless of zoom by
  // inversely scaling their CSS size. At zoom=0.25 the CSS size is 40px;
  // visually it's still 10px because the parent transform scales it down.
  const VISUAL_PX = 10;
  const sizeCss = VISUAL_PX / scale;
  const offsetCss = sizeCss / 2;
  const borderCss = 1.5 / scale;

  const positionFor = (pos: HandlePos) => {
    let cx = 0;
    let cy = 0;
    if (pos.includes("e")) cx = rect.width;
    else if (pos.includes("w")) cx = 0;
    else cx = rect.width / 2;
    if (pos.includes("s")) cy = rect.height;
    else if (pos.includes("n")) cy = 0;
    else cy = rect.height / 2;
    return { cx, cy };
  };

  const onPointerDown = (pos: HandlePos) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startWidth = rect.width;
    const startHeight = rect.height;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      // Mouse delta is in screen pixels; divide by scale to get CSS-space delta.
      const dx = (ev.clientX - startMouseX) / scale;
      const dy = (ev.clientY - startMouseY) / scale;
      let dw = 0;
      let dh = 0;
      if (pos.includes("e")) dw = dx;
      else if (pos.includes("w")) dw = -dx;
      if (pos.includes("s")) dh = dy;
      else if (pos.includes("n")) dh = -dy;
      // Clamp to a reasonable minimum so the user can't tear an element
      // down to 0 by overshooting.
      const nextW = Math.max(8, Math.round(startWidth + dw));
      const nextH = Math.max(8, Math.round(startHeight + dh));
      onResize({ width: nextW, height: nextH });
    };
    const onUp = (ev: PointerEvent) => {
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  return (
    <>
      {HANDLES.map((h) => {
        const { cx, cy } = positionFor(h.pos);
        return (
          <div
            key={h.pos}
            data-dw-handle={h.pos}
            onPointerDown={onPointerDown(h.pos)}
            style={{
              position: "absolute",
              top: rect.top + cy - offsetCss,
              left: rect.left + cx - offsetCss,
              width: sizeCss,
              height: sizeCss,
              background: "white",
              border: `${borderCss}px solid #3b82f6`,
              borderRadius: 2 / scale,
              cursor: h.cursor,
              zIndex: 1010,
              boxShadow: `0 ${1 / scale}px ${2 / scale}px rgba(0,0,0,0.15)`,
              touchAction: "none",
            }}
          />
        );
      })}
    </>
  );
}
