import { useEffect, useState } from "react";

interface Props {
  stage: HTMLElement | null;
  from: Element;
  to: Element;
}

interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function getRelativeRect(el: Element, stage: HTMLElement): Rect {
  const a = el.getBoundingClientRect();
  const b = stage.getBoundingClientRect();
  // Recover ancestor-transform scale so the labels & lines stay aligned
  // when CanvasStage is panned/zoomed. See SelectionOverlay for full notes.
  const rawScale = stage.offsetWidth > 0 ? b.width / stage.offsetWidth : 1;
  const scale = rawScale > 0 ? rawScale : 1;
  const top = (a.top - b.top) / scale + stage.scrollTop;
  const left = (a.left - b.left) / scale + stage.scrollLeft;
  const width = a.width / scale;
  const height = a.height / scale;
  return { top, left, right: left + width, bottom: top + height, width, height };
}

interface Segment {
  x1: number; y1: number;
  x2: number; y2: number;
  label: number;
  labelX: number;
  labelY: number;
}

function computeSegments(s: Rect, h: Rect): Segment[] {
  const segs: Segment[] = [];

  const contains = (outer: Rect, inner: Rect) =>
    outer.left <= inner.left + 0.5 && outer.top <= inner.top + 0.5 &&
    outer.right >= inner.right - 0.5 && outer.bottom >= inner.bottom - 0.5;

  const inside = contains(h, s) ? { outer: h, inner: s } : contains(s, h) ? { outer: s, inner: h } : null;

  if (inside) {
    const { outer, inner } = inside;
    const midX = (inner.left + inner.right) / 2;
    const midY = (inner.top + inner.bottom) / 2;
    const top = inner.top - outer.top;
    const right = outer.right - inner.right;
    const bottom = outer.bottom - inner.bottom;
    const left = inner.left - outer.left;
    if (top > 0.5) segs.push({ x1: midX, y1: outer.top, x2: midX, y2: inner.top, label: Math.round(top), labelX: midX, labelY: (outer.top + inner.top) / 2 });
    if (right > 0.5) segs.push({ x1: inner.right, y1: midY, x2: outer.right, y2: midY, label: Math.round(right), labelX: (inner.right + outer.right) / 2, labelY: midY });
    if (bottom > 0.5) segs.push({ x1: midX, y1: inner.bottom, x2: midX, y2: outer.bottom, label: Math.round(bottom), labelX: midX, labelY: (inner.bottom + outer.bottom) / 2 });
    if (left > 0.5) segs.push({ x1: outer.left, y1: midY, x2: inner.left, y2: midY, label: Math.round(left), labelX: (outer.left + inner.left) / 2, labelY: midY });
    return segs;
  }

  const verticalOverlap = s.top < h.bottom && h.top < s.bottom;
  const horizontalOverlap = s.left < h.right && h.left < s.right;

  if (!horizontalOverlap) {
    const sIsLeft = s.right <= h.left;
    const x1 = sIsLeft ? s.right : h.right;
    const x2 = sIsLeft ? h.left : s.left;
    const y = verticalOverlap
      ? (Math.max(s.top, h.top) + Math.min(s.bottom, h.bottom)) / 2
      : ((s.top + s.bottom) / 2 + (h.top + h.bottom) / 2) / 2;
    segs.push({ x1, y1: y, x2, y2: y, label: Math.round(Math.abs(x2 - x1)), labelX: (x1 + x2) / 2, labelY: y });
  }

  if (!verticalOverlap) {
    const sIsAbove = s.bottom <= h.top;
    const y1 = sIsAbove ? s.bottom : h.bottom;
    const y2 = sIsAbove ? h.top : s.top;
    const x = horizontalOverlap
      ? (Math.max(s.left, h.left) + Math.min(s.right, h.right)) / 2
      : ((s.left + s.right) / 2 + (h.left + h.right) / 2) / 2;
    segs.push({ x1: x, y1, x2: x, y2, label: Math.round(Math.abs(y2 - y1)), labelX: x, labelY: (y1 + y2) / 2 });
  }

  return segs;
}

export function DistanceLayer({ stage, from, to }: Props) {
  const [rects, setRects] = useState<{ s: Rect; h: Rect } | null>(null);

  useEffect(() => {
    if (!stage) return;
    const update = () => setRects({ s: getRelativeRect(from, stage), h: getRelativeRect(to, stage) });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(from); ro.observe(to); ro.observe(stage);
    const mo = new MutationObserver(update);
    mo.observe(stage, { attributes: true, childList: true, subtree: true });
    stage.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); mo.disconnect(); stage.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [stage, from, to]);

  if (!rects) return null;
  const segments = computeSegments(rects.s, rects.h);
  const { h } = rects;

  return (
    <>
      <div
        className="pointer-events-none absolute border border-dashed border-[#ff4d6d]/70"
        style={{ top: h.top, left: h.left, width: h.width, height: h.height, zIndex: 1001 }}
      />
      {segments.map((seg, i) => <SegmentEl key={i} seg={seg} />)}
    </>
  );
}

function SegmentEl({ seg }: { seg: Segment }) {
  const isH = seg.y1 === seg.y2;
  const len = Math.abs(isH ? seg.x2 - seg.x1 : seg.y2 - seg.y1);
  const minL = Math.min(seg.x1, seg.x2);
  const minT = Math.min(seg.y1, seg.y2);
  return (
    <>
      <div
        className="pointer-events-none absolute"
        style={{
          top: isH ? seg.y1 - 0.5 : minT, left: isH ? minL : seg.x1 - 0.5,
          width: isH ? len : 1, height: isH ? 1 : len,
          borderTop: isH ? "1px dashed #ff4d6d" : undefined,
          borderLeft: !isH ? "1px dashed #ff4d6d" : undefined,
          zIndex: 1002,
        }}
      />
      <Tick cx={seg.x1} cy={seg.y1} horizontal={isH} />
      <Tick cx={seg.x2} cy={seg.y2} horizontal={isH} />
      <div
        style={{
          position: "absolute",
          pointerEvents: "none",
          left: seg.labelX,
          top: seg.labelY,
          transform: isH ? "translate(-50%, calc(-100% - 4px))" : "translate(8px, -50%)",
          zIndex: 1003,
          background: "#ff4d6d",
          color: "white",
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          padding: "2px 6px",
          borderRadius: 3,
          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          whiteSpace: "nowrap",
        }}
      >
        {seg.label}
      </div>
    </>
  );
}

function Tick({ cx, cy, horizontal }: { cx: number; cy: number; horizontal: boolean }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: horizontal ? cx - 0.5 : cx - 3, top: horizontal ? cy - 3 : cy - 0.5,
        width: horizontal ? 1 : 6, height: horizontal ? 6 : 1,
        background: "#ff4d6d", zIndex: 1002,
      }}
    />
  );
}
